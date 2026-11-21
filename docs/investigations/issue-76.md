# Issue 76: router models transiently unavailable during plugin reload

Status: root cause identified in OpenCode V2 core and reproduced on a real
host; no fix in reasoning-router. Issue
[#76](https://github.com/robertn702/reasoning-router/issues/76) stays open
until OpenCode is fixed.

## Summary

Both failures in issue 76 have the same cause. While OpenCode re-activates
plugins, a session can start its next step against an incomplete registry.

1. OpenCode re-activates plugins when a local plugin module or a config
   directory's `plugin/` or `plugins/` folder changes. It disposes every plugin from the
   first changed one onward, then sets them up again one at a time.
2. `SessionRunner.drain` waits for plugin activation once, before its step
   loop. Later steps resolve the model and send requests with no further
   readiness check.
3. If a step runs inside the reload window, the registry is missing one of
   two things:
   - **The router itself** (it is listed after the changed plugin). Model
     resolution fails with `SessionRunnerModel.ModelUnavailableError: Model
     unavailable: reasoning-router/<model>`, which is persisted as
     `provider.no-route`. This is the 08:23 incident.
   - **The configured source providers.** `opencode.config.provider` is a
     built-in plugin that runs after all user plugins. It is disposed
     whenever any user plugin reloads, so the router's model transform re-runs
     without the sources. The request hook then rejects with
     `reasoning-router: source model <ref> not found; check wrap`. This is
     the 07:01 incident (all five wrap sources missing).

The next user message starts a new drain, which waits for activation, so it
succeeds with the same model.

OpenCode 2.0.28 (the running server) and 2.0.29 (current `latest`) both
reproduce this deterministically.

## Evidence

Times are UTC on 2026-10-14. Only lifecycle metadata was extracted.

### 08:23, `Model unavailable: reasoning-router/claude-opus-5-5`

Read-only `session_message` rows for the affected session:

| Time | Row |
| --- | --- |
| 08:22:57.345 | assistant step on `claude-opus-5-5`, finish `tool-calls` |
| 08:23:07.230 | `idle`, error type `provider.no-route` |
| 08:24:09.118 | next user message |
| 08:24:09–08:24:57 | assistant steps on `claude-opus-5-5`; last finishes `stop` |

The server log for the same run shows:

| Time | Event |
| --- | --- |
| 08:23:02.740 | the session's shell tool runs `orca worktree create …` |
| 08:23:05.5 | other OpenCode processes log `plugin reconciliation` |
| 08:23:06.2–08:23:07.3 | the server re-loads the Orca overlay plugin, `opencode-see-image`, `opencode-episodic-memory`, and `@reasoning-router/opencode` for every open directory |
| 08:23:07.229 | `Failed to drain Session`: `ModelUnavailableError` from `SessionRunnerModel.resolve` ← `SessionContext.load` ← `SessionRunner.advanceToStep` ← `SessionRunner.drain` |
| 08:23:07.922 / 08:23:08.769 | `config.updated` / `provider.updated` for the affected directory |

The failure happened inside one drain, right after a tool call, while
plugins were being re-activated. No user message came in between.

### 07:01, `source model … not found` for all five wrap sources

| Time | Event |
| --- | --- |
| 07:01:17.015–07:01:17.103 | the affected directory re-loads its config-overlay plugins, then `opencode-see-image`, `opencode-episodic-memory`, and `@reasoning-router/opencode` |
| 07:01:17.689 | `Failed to drain Session`: router validation reports all five configured sources missing |
| 07:01:17.801 / 07:01:18.077 | `config.updated` / `provider.updated` for the affected directory |

### Frequency

The current log (01:01–14:37 UTC) has two `Failed to drain Session` errors.
They are these two incidents.

### OpenCode host behavior

OpenCode V2 is distributed as a compiled Bun binary. The code below was read
from the JavaScript embedded in the 2.0.28 binary, so names are minified.
Readable span names such as `Plugin.activate` and `SessionRunner.drain` are
quoted where they exist.

- **Registry state** (`@opencode/State`, `pl`). Provider and model state are
  rebuilt lazily on `get()`: `initial()`, then every registered transform
  runs synchronously in registration order. Each rebuild is atomic.
  Disposing a transform registration removes it and invalidates the state,
  so the next `get()` rebuilds without it.
- **`Plugin.activate`.** Holds the activation latch. It finds the first plugin
  whose ID or revision changed, disposes that plugin and every later one in
  reverse order, then calls each `setup` again in order.
  `awaitActivation` exposes the latch.
- **Plugin order** (`PluginSupervisor.activate`). Built-in "pre" plugins come
  first, then config-directory plugins, then configured plugins (such as
  reasoning-router), then built-in "post" plugins. The "post" plugins include
  `opencode.config.provider`, which adds the providers from `opencode.json`.
- **Reload trigger** (`PluginSupervisor`). Changes to a watched local plugin
  module or to a config directory's `plugin/` or `plugins/` folder take the
  hold and, after a 100 ms debounce, run `Plugin.activate`. In the
  reproduction, changing only plugin options in `opencode.json` published
  `config.updated` but did not re-activate plugins.
- **`SessionRunner.drain`.** Runs `yield* awaitActivation` once. It then loops
  `advanceToStep` (`SessionContext.load` → `SessionRunnerModel.resolve`
  against `Model.available`) and `runStep` (auto-compaction and the primary
  request), and never waits for activation again.
- **`SessionRunnerModel.resolve`.** Looks the session model up in
  `Model.available` and fails with `ModelUnavailableError` if it is absent.
  The session error mapper classifies that as `provider.no-route`.

## Reproduction

[`scripts/repro-issue-76.mjs`](../../scripts/repro-issue-76.mjs) runs
`opencode run --standalone` against a private `HOME`/XDG tree under
`/tmp/opencode`. The only reachable endpoint is a loopback fake Anthropic
upstream; every other host goes through a proxy on a refusing port. The live
OpenCode server, its config, and its data are not touched.

The script loads the built router through a wrapper plugin directory and adds
a second local plugin. Both record setup and dispose times. When the fake
upstream receives the first primary request, it does two things:

1. It rewrites the second plugin's module, which triggers re-activation. The
   new revision's `setup` waits `delayMs`, standing in for slow plugin setups
   such as the production overlay and memory plugins.
2. It answers with a `shell` tool call (`sleep 1`), so the session's next step
   starts inside the reload window.

```sh
npm run build
node scripts/repro-issue-76.mjs before 3000  # changed plugin listed before the router
node scripts/repro-issue-76.mjs after 3000   # changed plugin listed after the router
OPENCODE_BIN=/path/to/opencode node scripts/repro-issue-76.mjs before 3000
```

The script exits 0 if the session completes and 1 if the failure
reproduces.

Results, three runs per row on 2.0.28 and one per row on 2.0.29 (installed
with `npm install --prefix /tmp/opencode/oc-2.0.29 @opencode/cli@2.0.29`):

| OpenCode | Order | `delayMs` | Result |
| --- | --- | --- | --- |
| 2.0.28 | before | 3000 | 3/3 fail: `Model unavailable: reasoning-router/claude-opus-5-5` |
| 2.0.28 | after | 3000 | 3/3 fail: `reasoning-router: source model src/claude-opus-5-5 not found` |
| 2.0.28 | before | 0 | 3/3 complete |
| 2.0.28 | after | 0 | 3/3 complete |
| 2.0.29 | before | 3000 | fail: `Model unavailable: reasoning-router/claude-opus-5-5` |
| 2.0.29 | after | 3000 | fail: `reasoning-router: source model src/claude-opus-5-5 not found` |

A typical `before` timeline on 2.0.28:

```text
+0ms     router.setup.start
+14ms    router.setup.end
+217ms   upstream.primary      (step 1: returns the shell tool call)
+357ms   router.dispose        (re-activation disposes the router)
+358ms   slow1.setup.start
         step 2 fails: Model unavailable: reasoning-router/claude-opus-5-5
+3358ms  slow1.setup.end
```

In the `after` run, the router is never disposed, yet step 2 is rejected
because the source provider is gone. Only the changed plugin and the "post"
plugins (including `opencode.config.provider`) were re-activated.

## Ruled out

- **Upstream model withdrawal.** The failure is raised during local model
  resolution, before any request is sent. The same model works on the next
  message, and the directory's model list still contains both the alias and
  its source.
- **A non-atomic router transform.** Each registry rebuild runs every
  transform synchronously. The router's transform never removes an alias it
  wraps, and when validation fails it keeps all aliases. The alias disappears
  only when OpenCode has disposed the router's registration.
- **Server restart.** Run `f22db61b` was a long-running server. The stack's
  `ServerProcess.start` frame is the fiber's origin, not a restart.
- **The plugin's mocked reload test.** `keeps active aliases during
  provider-transform reload` covers the provider pass running before the model
  pass within one registration. It cannot cover OpenCode disposing the plugin,
  or another plugin's provider.

## Why there is no fix in reasoning-router

- In the 08:23 shape, the router's registrations do not exist during the
  window. OpenCode disposed them, so nothing the plugin does can keep the
  alias resolvable.
- In the 07:01 shape, the alias is the unconfigured placeholder (base URL
  `http://127.0.0.1:1/v1`, no source settings), and the request is already
  built against it. Suppressing the validation error would send the request
  to the placeholder.
- A "last known good" cache inside the plugin would need to rewrite the URL,
  headers, and credentials from stale source metadata. It would also hide a
  genuine source removal, because a transient gap and a removal look the
  same to the transform. It would not help the 08:23 shape, and it would be
  close to the blanket retry that issue 76's acceptance criteria rule out.

## Suggested upstream fix and report

Proposed OpenCode change: wait for plugin activation before each step, not
only once per drain. In `SessionRunner.drain`, run `yield* awaitActivation`
before every `advanceToStep` context load, and before `runStep` reloads
context for a continuation or auto-compaction. An alternative is to have
`SessionContext.select`/`load` wait on `awaitActivation`, as
`SessionGenerate` and `SessionCommand` already do (`yield* Eh`).

Draft upstream report (not filed):

> **Session steps run during plugin re-activation and see a partial
> model/provider registry**
>
> OpenCode 2.0.28 and 2.0.29. `SessionRunner.drain` awaits
> `Plugin.awaitActivation` once, before its step loop. When a local plugin
> module or a config directory's `plugin/` or `plugins/` folder changes
> mid-drain (for example,
> a tool call that rewrites it), `Plugin.activate` disposes every plugin from
> the changed one onward and sets them up again in order. A step that starts
> in that window resolves its model against a registry that lacks the
> disposed plugins' providers. Model resolution fails with
> `ModelUnavailableError` (persisted as `provider.no-route`). If only
> `opencode.config.provider` and other post plugins are disposed,
> plugin-provided aliases lose their configured source providers. The next
> user message succeeds. Reproduction: a local plugin whose `setup` sleeps,
> rewritten while a session runs a tool call (reproducer attached).
> Suggested fix: await activation before each step's context load and
> before compaction.

## Remaining unknowns

- **The production trigger at 07:01.** At 08:23, the session's own
  `orca worktree create` call ran just before plugins were re-loaded. Orca's
  config-overlay `plugins/` directory is the first plugin source, so a write
  there re-activates every later plugin. At 07:01, which process wrote the
  overlay was not established.
- **Whether per-step gating is enough.** A request already in flight when
  the router's `http.request` hook is disposed could still go to the
  placeholder base URL. That narrower window was not reproduced.
- **The upstream fix is untested.** OpenCode V2 ships as a bytecode-compiled
  binary, so it could not be patched and re-tested here.

## Next discriminating experiment

Build OpenCode with `yield* awaitActivation` added to the `SessionRunner`
step loop, and run `node scripts/repro-issue-76.mjs before 3000` and
`… after 3000` with `OPENCODE_BIN` set to that build. If gating is
sufficient, both runs complete after about `delayMs` instead of failing. If
the `after` case still fails, also gate the compaction and continuation
reloads inside `runStep`.

Until OpenCode is fixed, the workaround is to avoid rewriting plugin
directories (for example, Orca config overlays) while sessions are running,
or to resend the message.
