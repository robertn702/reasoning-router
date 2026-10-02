# Claude Code

Status: research for [#10](https://github.com/robertn702/reasoning-router/issues/10).
Nothing here is implemented. Versions: Claude Code 2.1.287 (released
2026-10-01, the first with mods) and 2.1.266; docs fetched 2026-10-02.

## Summary

Claude Code has two places to hook in:

- **A mod** (Claude Code 2.1.287+). Mods are in-process JS/TS plugin hooks.
  The `turn.step` event wraps each model request and can rewrite its `effort`.
  Claude Code then places the per-turn effort on the wire itself, using its
  own betas and prompt-cache handling.
- **A proxy at `ANTHROPIC_BASE_URL`**. This is the path every existing router
  uses. Today `@reasoning-router/proxy` fails on Claude Code requests in two
  separate ways (see "Proxy path").

Recommendation: build a mod as the Claude Code adapter, and keep the proxy as a
later fallback. Settings hooks (`UserPromptSubmit` and the others) and MCP
servers cannot change effort.

## What Claude Code sends

Verified locally. Claude Code pointed at a fake upstream that records requests
(dummy key `sk-ant-dummy-000`, isolated `CLAUDE_CONFIG_DIR`, no real
credentials):

- `POST /v1/messages?beta=true` with `stream: true`. It also sends a
  `HEAD /api/hello` probe.
- `thinking: {type: "adaptive", display: "omitted"}`, plus `output_config.effort`
  from `--effort`, plus `context_management` (`clear_thinking_20251015`). 2.1.287
  also sends a top-level `safeguards` field and `max_tokens: 128000`.
- The `anthropic-beta` header on 2.1.287 includes `mid-conversation-system-2026-04-07`,
  `per-turn-control-2026-07-01`, `effort-2025-11-24`,
  `context-management-2025-06-27`, and `prompt-caching-scope-2026-01-05`,
  among others.
- **Claude Code already pins effort per turn.** On 2.1.287 the first request
  is `[user prompt, system(environment block, output_config: {effort})]`: the
  effort is carried by a mid-conversation system message that also has
  content, and it comes *after* the prompt. In the 2.1.266 binary this is
  `perTurnEffortPins`, gated by the model catalog capability `per_turn_effort`.
  On rejection, the binary logs "server rejected the per-turn effort statement
  — falling back … sticky-rejecting the beta until /clear or /compact".
- `system` has three blocks. The first is the attribution block
  (`x-anthropic-billing-header: cc_version=…`).
- Headers: `x-claude-code-session-id` (UUID), and `x-claude-code-prompt-id`
  plus `x-claude-code-request-class` (`main`, `subagent`, `compaction`, …)
  when `CLAUDE_CODE_GATEWAY_HINT_HEADERS=1`. Auth is `x-api-key` (API key) or
  `Authorization: Bearer` (subscription or token).
- `metadata.user_id` is a JSON string containing `device_id`, `account_uuid`,
  and `session_id`.

## Extension points

### Mechanism

- **Mods** ([overview](https://code.claude.com/docs/en/plugins/mods/overview),
  [events](https://code.claude.com/docs/en/plugins/mods/events),
  [types at `684800b`](https://github.com/anthropics/claude-code/blob/684800b206824dfd0cc8a876e8604b20f72c3617/mods/types/claude-code.d.ts)):
  `turn.step` fires before each model request of a turn, for main and for
  subagents (`e.agentId`). It is an async generator. A hook returns
  `yield* next({...e, effort})`. Of the input fields, only `model` and
  `effort` are rewritable; `turnId`, `index`, and `messageCount` are pinned
  (`TurnStepInput`, d.ts ~L10427).
  - Verified on 2.1.287 with a 6-line mod loaded via `--plugin-dir`, against
    the fake upstream:
    - Step 0 set `xhigh` on both the top-level field and Claude Code's own
      environment system message.
    - Step 1, after a tool result, sent top-level `low` and appended a new
      effort-only system message after the `tool_result`. The earlier pin
      stayed in place.
- **Base-URL proxy**
  ([gateway protocol](https://code.claude.com/docs/en/llm-gateway-protocol)):
  `ANTHROPIC_BASE_URL` sends every Messages request through the proxy.
- **Not usable:**
  - [Settings hooks](https://code.claude.com/docs/en/hooks) can add context
    but cannot change effort or the request.
  - A hook-injected `ultrathink` is ignored
    ([Qcko/claude-code-effort-router](https://github.com/Qcko/claude-code-effort-router),
    verified there on 2.1.281).
  - MCP tools only return text.

### Visibility

- **Mod:**
  - `$.session.messages()` returns `{role, text, toolUses, toolResults}`, where
    tool results include `text` and `isError`, for up to the newest 4096
    messages (d.ts ~L2350, `SessionMessage` ~L8962). This is enough for the
    core's `ClassifierState`.
  - Other inputs: `$.session.id()`, `e.model`, `e.effort` (a level or a number),
    and `e.agentId`.
  - It cannot see the raw body, beta headers, or thinking.
- **Proxy:**
  - It sees the full body and headers, including
    `x-claude-code-session-id`.
  - It sees request-class hints only if the user sets
    `CLAUDE_CODE_GATEWAY_HINT_HEADERS=1` (v2.1.273+).

### Control

- **Mod:**
  - It sets a per-request effort (or model) and leaves the wire format to
    Claude Code.
  - A hook can also answer without calling the model, or throw. What a thrown
    error shows the user is unverified.
- **Proxy:**
  - It can rewrite the body.
  - An error body it returns is shown to the user. The gateway docs require
    forwarding upstream errors unmodified, because Claude Code retries without
    effort, thinking, or mid-conversation system content when the upstream
    rejects them.

### Streaming

- **Mod:** `yield* next(e)` passes the stream through. The result has `usage`,
  including cache read and creation tokens. jev-effort reports that it does
  not include thinking tokens.
- **Proxy:** must stream, forward `ping` events, and stay under Claude Code's
  5-minute idle watchdog (gateway protocol).

### Auth

- **Mod:** never sees credentials. It works the same with an API key, a
  subscription, or a cloud provider.
- **Proxy:**
  - With `ANTHROPIC_BASE_URL` and no gateway credential, Claude Code keeps the
    claude.ai subscription login and sends the OAuth `anthropic-beta` value.
    Stripping that value causes a 401
    ([gateway docs](https://code.claude.com/docs/en/llm-gateway)).
  - The proxy's `forward` auth policy passes `Authorization` through and
    merges betas, so subscriptions should work. This is unverified: it needs a
    real login.

### Stability

- **Mods:**
  - They shipped in 2.1.287
    ([changelog](https://code.claude.com/docs/en/changelog): "Added Claude
    Mods").
  - Before that, they were the early-access "function hooks" behind
    `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` (2.1.260+, per jev-effort). Those
    were marked "may change between releases without notice".
  - The d.ts is generated per version and is the de facto contract.
- **Proxy:**
  - Base-URL forwarding is documented and stable.
  - Its request shape changes with nearly every release. Examples from the
    changelog: the attribution block became stable in 2.1.181, mid-conversation
    system messages arrived behind gateways in 2.1.212, and the per-turn beta
    appeared, which the 2.1.266 captures did not send.

### Distribution

- **Mod:**
  - A mod is a plugin directory (`.claude-plugin/plugin.json` plus
    `hooks/hooks.json` → `modules`). It is loaded with `--plugin-dir` or
    installed from a plugin marketplace.
  - The module may import only relative files and `claude-code`. It cannot use
    npm packages or dynamic `import()`
    ([create](https://code.claude.com/docs/en/plugins/mods/create)). So the
    core and classifiers must be bundled into the plugin, and Laya (an optional
    peer dependency loaded with `import()`) cannot be used.
  - Global `fetch` is undefined inside a mod; only `$.http.fetch` works
    (verified on 2.1.287).
  - Mods are disabled by `--bare`, `--safe-mode`, `disableAllHooks`, and
    managed policy.
- **Proxy:**
  - Uses the existing `reasoning-router` command.
  - Desktop apps and IDE extensions need `ANTHROPIC_BASE_URL` set where they
    allow it.

### Wire APIs and models

- Claude Code speaks only Anthropic Messages: direct, or in the
  Bedrock/Vertex/Foundry formats.
- Per-turn effort needs a model whose catalog entry has `per_turn_effort`.
  - The 2.1.266 catalog lists it for `claude-fable-5-1`.
  - Vertex rejects it for Sonnet 5 with "requires a model that supports
    per-turn effort"
    ([LiteLLM #43557](https://github.com/BerriAI/litellm/issues/43557)).
  - Our registry (Opus 5.5, Fable 5.1, Mythos 5.1, Opus 5) is the starting
    allowlist.
  - 2.1.266 does not recognize `claude-opus-5-5`
    (`[claude-code:unrecognized_model]`); 2.1.287 does.

### Prompt cache

- **Docs:** on Opus 5.5, Sonnet 5.5, and Fable 5.1 with an API key or
  subscription, changing effort keeps the cache
  ([prompt caching](https://code.claude.com/docs/en/prompt-caching); Fable
  5.1 since 2.1.260).
  - This does not hold on Bedrock, Vertex, or a Claude apps gateway, under
    `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`, or under HIPAA. There, a change
    rewrites the cache.
- **jev-effort measurements:** on 2.1.280 with a subscription, both its proxy
  marker and a function-hook mod kept the cache when effort alternated every
  step. Each read equalled the previous read plus write. Across 470 steps it
  measured 0 unexpected misses.
- Not verified here: that needs real credentials.

## Proxy path: what breaks today

Each item below was verified against captures, except where marked otherwise.

1. **The `?beta=true` query string 404s.** `server.ts` matches
   `request.url === "/v1/messages"` exactly
   (`packages/proxy/src/server.ts:248`, `:341`, `:344`). Claude Code then
   reports a model error. Patching the match to ignore the query was enough
   for 2.1.266.
2. **Claude Code 2.1.287 requests are rejected locally.**
   `validateAnthropicRequest` accepts a system `output_config` only on an empty
   effort-only message (`packages/core/src/wire-anthropic.ts:46-59`, `:92-100`).
   Claude Code's environment message carries content, so the request gets "system
   output_config must contain only an effort valid for request.model".
   Verified by running the built core on the captured body.
3. **The insert position loses to Claude Code's pin.** The core inserts before
   the newest user message (`wire-anthropic.ts:119-131`). Claude Code's own pin
   follows the prompt, and jev-effort measured that the last effort statement
   wins. Its marker must be the last message. A top-level rewrite has no effect
   while the pin is present. Not verified here.
4. **The beta names differ.** The core adds `mid-conversation-output-config-2026-07-01`;
   Claude Code sends `per-turn-control-2026-07-01`. Both names appear in the
   2.1.266 binary. Which beta the API requires for an empty effort-only message
   is unverified.
5. **There is no session.** The proxy reads only `x-reasoning-router-session-id`
   matching `^ses_` (`server.ts:430-431`), so Claude Code requests log
   `session: null` and `lineage_status: untracked`.
6. **Claude Code degrades behind any base URL.**
   - It turns off MCP tool search: a fresh session went from 27K to
     281K–500K tokens. `ENABLE_TOOL_SEARCH=true` restores it if the proxy
     forwards `tool_reference` blocks.
   - It turns off fine-grained tool streaming and hint headers.
   - It disables Remote Control and server-managed settings.
   - Claude Code 2.1.287 warns that auto-mode classifier requests stay billed
     ([auto-mode classifier billing](https://code.claude.com/docs/en/auto-mode-classifier-billing)).
   - Sources: jev-effort
     [usage.md](https://github.com/ifoster01/jev-effort/blob/19944cad93883b5f2b8c9bd57b420a140d885125/docs/usage.md#limitations),
     the gateway protocol docs, and the CLI notice observed here.

## Existing solutions

- **[jev-effort](https://github.com/ifoster01/jev-effort)** (at `19944ca`,
  tested on 2.1.280). The closest prior art: Jev picks the effort per step.
  - **How it hooks in:**
    - A wrapper starts a local proxy and launches `claude` with
      `ANTHROPIC_BASE_URL` set.
    - It appends an empty effort-only system message as the *last* message.
    - It re-inserts earlier markers by their position and a hash of the
      normalized prefix. Claude Code re-sends the environment message as a
      string after first sending it as blocks, so the history is normalized
      before hashing.
    - Jev grants leases of 1–10 steps, so it is not called on every step.
    - It fails open: on a 400, it re-sends the original request, and switches
      to shadow mode after two rejections.
  - **Results** ([how-it-works.md](https://github.com/ifoster01/jev-effort/blob/19944cad93883b5f2b8c9bd57b420a140d885125/docs/how-it-works.md),
    [Reddit](https://www.reddit.com/r/ClaudeCode/comments/1woo3f4/)):
    - Cost was −1.1% at `high` and −55% at `max` on Opus 5.5.
    - Jev added 747 ms median latency per call.
  - **Copy:**
    - Marker-last placement.
    - Normalized hashing.
    - Fail-open behaviour.
    - Restoring environment variables.
    - Its release-verification checklist.
  - **Avoid:** nothing major. It is a proxy only because function hooks were
    early access; its own notes say a plugin could replace the proxy.
- **[claude-code-router](https://github.com/musistudio/claude-code-router)**
  (37.5k stars, v3.1.1). Routes models, not effort.
  - **How it hooks in:**
    - `ccr` launches Claude Code with `ANTHROPIC_BASE_URL` set
      ([`profiles/service.ts:435`](https://github.com/musistudio/claude-code-router/blob/f2e01bfe0c01e0c7ea7a37077747473f69869048/packages/core/src/profiles/service.ts#L435)).
    - Subagent routing works by injecting a `<CCR-SUBAGENT-MODEL>` tag into
      the Agent tool description
      ([routing.md](https://github.com/musistudio/claude-code-router/blob/f2e01bfe0c01e0c7ea7a37077747473f69869048/docs/src/content/docs/en/configuration/routing.md)).
    - It removes the attribution system block.
    - It reads the session from `x-claude-code-session-id`, or falls back to a
      legacy `_session_` split of `metadata.user_id`
      ([L1686](https://github.com/musistudio/claude-code-router/blob/f2e01bfe0c01e0c7ea7a37077747473f69869048/packages/core/src/gateway/claude-code-router-plugin.ts#L1686)).
      That field is now JSON.
  - **What broke:**
    - [#1528](https://github.com/musistudio/claude-code-router/issues/1528):
      replacing `anthropic-beta` produced 400s on `context_management` and
      `effort`.
    - [#1628](https://github.com/musistudio/claude-code-router/issues/1628):
      a copied OAuth token expired after about 8 hours.
    - [#1810](https://github.com/musistudio/claude-code-router/issues/1810):
      OAuth 401s in v3.1.1 (open).
    - [#1654](https://github.com/musistudio/claude-code-router/issues/1654):
      compaction and subagent requests bypass routing (open).
  - **Copy:** the launcher, and the session header.
  - **Avoid:**
    - Replacing headers.
    - Holding OAuth tokens.
    - Editing tool descriptions or the system array. Both change the cached
      prefix, and the gateway docs say to drop attribution with
      `CLAUDE_CODE_ATTRIBUTION_HEADER=0` rather than strip it.
- **[LiteLLM](https://github.com/BerriAI/litellm)**, the `/v1/messages`
  gateway. Its open and recent bugs map our risks:
  - Beta maps and allowlists drop `per-turn-control`, causing 400s on the
    per-message `output_config`
    ([#43557](https://github.com/BerriAI/litellm/issues/43557) Vertex,
    [#44174](https://github.com/BerriAI/litellm/issues/44174) Copilot).
  - Passthrough drops adaptive thinking and effort
    ([#40890](https://github.com/BerriAI/litellm/issues/40890)).
  - The subscription token is not forwarded
    ([#42170](https://github.com/BerriAI/litellm/issues/42170)).
  - Signed, empty thinking blocks are stripped
    ([#42550](https://github.com/BerriAI/litellm/issues/42550)).
  - **Lesson:** forward betas and bodies verbatim; never allowlist.
- **Hooks only** ([Qcko/claude-code-effort-router](https://github.com/Qcko/claude-code-effort-router)):
  it abandoned MCP and keyword injection, and now only adds steering text.
  This confirms that hooks cannot set effort.
- **Observers and translators**
  ([seifghazi/claude-code-proxy](https://github.com/seifghazi/claude-code-proxy),
  [1rgs/claude-code-proxy](https://github.com/1rgs/claude-code-proxy)): these
  use the same base-URL mechanism but do not touch effort. They have nothing
  further to copy.

## Recommendation

Build `@reasoning-router/claude-code` as a mod, for Claude Code 2.1.287 and
later.

- **Why a mod:**
  - It is the documented per-request effort control.
  - Claude Code keeps the wire format, betas, cache placement, auth, and its
    own fallback when the server rejects per-turn effort. The adapter needs no
    rewrite or lineage code.
  - It is the second extension model `docs/architecture.md` asks for: a
    "per-request effort parameter", where OpenCode offers a raw-body rewrite.
- **Limitations:**
  - The API is days old and may change.
  - It requires 2.1.287 or later.
  - It is off under `--bare`, `--safe-mode`, and managed policy.
  - Code must be bundled, and the HTTP client must be `$.http.fetch`. Whether
    `$.http.fetch` supports timeouts or abort is unverified.
  - There is no Laya.
  - Each step waits for the classifier.
  - Usage has no thinking tokens.
  - The adapter sees the transcript, not the body.
- **Smallest first slice:**
  1. A bundled mod with one `turn.step` hook. It skips models outside the
     registry, or steps where `e.effort` is absent.
  2. The hook builds `ClassifierState` from `$.session.messages()` and calls
     the configured hosted classifier through an injected fetch backed by
     `$.http.fetch`.
  3. On success it sends `next({...e, effort})`; on failure it sends `next(e)`.
  4. It writes metadata-only decision events.
  - **Core change needed:** classifier transport accepts an injected fetch.
  - **Tests:** `claude plugin test`, plus the fake-upstream check used here.
  - **Out of scope:** proxy fixes, subagent policy, leases.

## Open questions for Robert

1. Mod first and 2.1.287+ only (recommended), or fix the proxy first so it
   covers older Claude Code versions and the IDE and desktop apps (items 1–5
   above)?
2. On classifier failure, keep Claude Code's own effort (`next(e)`), or use
   the core's fixed `high` fallback?
3. Should the user's `/effort` act as a ceiling for the classifier's choice?
4. Should subagent steps (`e.agentId`) be classified? Should there be leases
   or other ways to skip classifier calls, given the latency?
5. Distribution: a plugin marketplace in this repo, an npm package that ships
   the built plugin directory, or both?
6. Should a small, budgeted real-API run be approved? It would confirm the
   cache behaviour, which beta names are needed, and subscription auth
   through the proxy. None of this was verified here.

## Verification log

- **Verified locally:**
  - Request shape, headers, and betas from Claude Code 2.1.266 (installed) and
    2.1.287 (`npm i` into `.scratch`).
  - Mod effort rewriting.
  - Global `fetch` is unavailable in mods.
  - The proxy 404s on `?beta=true`.
  - The core rejects 2.1.287's environment pin.
  - The proxy's `session: null` (checked on the 2.1.266 run, after
    hot-patching the 404).
- **From docs or other projects, unverified:**
  - Prompt-cache behaviour.
  - Beta semantics.
  - OAuth passthrough.
  - Effort precedence (marker last).
  - Thinking tokens missing from mod usage.
  - The behaviour Claude Code degrades behind a proxy.
