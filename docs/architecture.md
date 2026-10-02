# Architecture

Status: problem statement, the package plan for the first port, the
classifier starting point, and open questions.

## Problem statement

Coding agents send every model request at one fixed reasoning effort. A fixed
high effort wastes tokens and time on easy steps (a rename, reading a file);
a fixed low effort fails on hard ones (a subtle failing test). Switching effort
by hand mid-session is tedious and rarely done.

[`opencode-jev-router`](https://github.com/robertn702/opencode-jev-router)
solves this for OpenCode. For each primary generation request it:

1. **Validates** the request locally (supported model, mode, and input shape),
   rejecting unsupported requests before any network call.
2. **Classifies** the step: sends a bounded, metadata-limited summary of the
   recent conversation (user text, assistant progress, recent tool results and
   errors) to [Jev](https://typesafe.ai/), which picks one of the model's
   supported efforts.
3. **Falls back** to a configured effort (default `high`) if Jev times out or
   fails, but aborts without generating if the client disconnects.
4. **Rewrites** the request so the effort change preserves the cacheable prompt
   prefix: the request-level effort stays fixed, and the selected effort is
   inserted mid-conversation (an OpenAI `configuration_update` item or an
   Anthropic effort-only system message). Earlier updates stay in place.
5. **Forwards** the request and streams the response back unchanged, observing
   usage without altering bytes or backpressure.
6. **Logs** metadata-only decision events (no prompts, tool output, or
   credentials).

It ships two integration paths that share steps 1–6: an in-process OpenCode V2
plugin (using OpenCode's provider transform and `http.request` /
`http.response` hooks) and a standalone Responses/Messages API proxy.

Generalized, `reasoning-router` should provide the same per-step effort routing
along two independent axes:

- **Any classifier.** The *classifier* is the component that picks a
  reasoning effort for a step. Jev is one of several decision models that can
  serve as a classifier, and more are being released. Step 2 should call
  whichever classifier is configured, with provider-specific code limited to
  talking to that provider.
- **Any harness.** Harness-specific code should be limited to whatever is
  needed to intercept or influence the model request.

Steps 1–6 are largely independent of OpenCode; what varies by harness is
*where* the router can hook in, *what it can see* (full request body vs. a
higher-level message list), and *what it can change* (raw body vs. a
per-request effort parameter vs. nothing, requiring a proxy).

## Constraint: the classifier is configuration

`reasoning-router` must not depend on Jev or any single classifier provider.
The classifier is chosen by configuration, and shared code must not import a
provider SDK (such as `@typesafe-ai/sdk`) or assume one provider's request
shape, efforts, or failure modes.

## Packages

The first port of `opencode-jev-router` creates three packages under the
`@reasoning-router` scope, versioned independently:

- **`@reasoning-router/core`:** validation, rewriting, cache lineage,
  forwarding, usage observation, decision logging, the model registry, and
  the classifier interface. It has no classifier SDK dependencies.
- **`@reasoning-router/opencode`:** the OpenCode V2 plugin (the port of
  `plugin*.ts`).
- **`@reasoning-router/classifier-jev`:** the Jev classifier (the port of
  `jev.ts`), the only package that depends on `@typesafe-ai/sdk`.

Later, `@reasoning-router/classifier-laya` adds Laya as its own package, so
ONNX Runtime and the model download reach only Laya users.

Naming:

- The core is `@reasoning-router/core`, a common convention (`@babel/core`)
  that leaves unscoped `reasoning-router` free for a CLI or proxy entry point.
- Harness adapters use the bare harness name (`@reasoning-router/opencode`),
  which users type into their harness configuration.
- Classifiers use a `classifier-` prefix. Names like Jev and Laya do not say
  what kind of package they are, and some names (Hermes, Codex) could mean
  either a harness or a model.

The standalone proxy is not part of the first port.

## Classifiers

The starting point is `opencode-jev-router`'s classifier, unchanged except
that Jev-specific names become provider-neutral.

- **First providers:** [Jev](https://typesafe.ai/) (hosted by TypeSafe or
  through Vercel AI Gateway), the best-known decision model, and
  [Laya](https://huggingface.co/convaiinnovations/laya), an open-source,
  Jev-compatible model, requested by users. Laya runs locally through
  [`@receptron/laya`](https://github.com/receptron/laya) on ONNX Runtime; its
  weights are about 1.7 GB, downloaded on first use, and need about 2 GB of
  RAM.
- **Contract:** one `system_one` call. The state is the bounded,
  metadata-limited summary `opencode-jev-router` builds (recent user text,
  assistant progress, up to 8 tool results with names and error flags, a
  failure summary, and the target model ID). The single question is a
  `choice` named `effort` whose options are the target model's supported
  efforts. The answer is `answers.effort.choice`, rejected if the model does
  not support it. Laya accepts the same request and response shape as Jev's
  `system_one`, so both providers fit this contract.
- **Policy:** as in `opencode-jev-router`'s
  [classification policy](https://github.com/robertn702/opencode-jev-router/blob/main/docs/classification-policy.md):
  a 4000 ms total deadline, one retry for connection errors, timeouts, 429,
  and 5xx, then fallback (`fixed` high by default, or `previous`, or
  `error`). Client cancellation aborts and never falls back.
- **Configuration:** one `classifier` block selects the provider, for example
  `classifier: { provider: "jev", apiKey, baseUrl, timeoutMs }`.
- **Logging:** the same metadata-only decision events, with Jev-specific
  names made provider-neutral (`jev_attempts` becomes `classifier_attempts`,
  `jev_timeout` becomes `classifier_timeout`) and the classifier recorded.

## Porting

- Environment variables use the `REASONING_ROUTER_*` prefix; `JEV_ROUTER_*`
  is not carried over.
- Once the port reaches parity, `opencode-jev-router` is frozen and its
  README points to `@reasoning-router/opencode`. It is not kept as a
  compatibility wrapper for its existing configuration.

## Open questions

### Before porting

- Copy files fresh (noting the source commit) or preserve their git history?
- Since OpenCode installs only the plugin package, does
  `@reasoning-router/opencode` depend on `@reasoning-router/classifier-jev`
  directly, with other classifiers as optional installs?

### Which harnesses to target

Candidates: OpenCode, Hermes, Claude Code, Codex, Pi, and others (e.g. Cline,
Aider, Goose, Cursor-style IDE agents).

- Which harnesses have enough users and a stable enough extension surface to
  justify an adapter?
- Which models and wire APIs (OpenAI Responses, Anthropic Messages, Chat
  Completions, others) does each harness use, and do they support
  mid-conversation effort changes?
- What is the order of work? Which harness is the first to validate the shared
  core against a second, different extension model?

### Each harness's extension point

For each target harness, establish:

- **Mechanism:** in-process plugin/hook, extension API, provider/model config,
  MCP, CLI wrapper, or only a base-URL override pointing at a proxy.
- **Visibility:** can the extension read the full outbound request body, the
  conversation history, tool results, and a session identifier?
- **Control:** can it rewrite the body, set a per-request effort parameter, or
  only observe? Can it reject a request with a user-visible error?
- **Streaming:** can it observe the response stream (for usage and cache
  lineage) without buffering it?
- **Auth:** does it see or reuse the harness's provider credentials, including
  subscription/OAuth logins?
- **Stability:** is the API versioned and documented, or internal?
- **Distribution:** how are extensions installed (npm package, config entry,
  file in a directory), and does that constrain the package name or format?

Where no adequate in-process hook exists, is the standalone proxy the
supported path for that harness?

### Core and remaining boundaries

- Is the core's input the raw wire request (as in `opencode-jev-router`) or a
  normalized conversation model that adapters translate into? The raw request
  is the starting point, because the cache-preserving rewrite needs the exact
  body; revisit this only for a harness that does not expose it.
- Is the standalone proxy the unscoped `reasoning-router` package, part of the
  core, or one more adapter?
- One package per harness, or per harness *and* wire API?
- Model/effort registries: prefer a reliable third-party package that lists
  models and their supported reasoning efforts, if one exists. Otherwise,
  maintain the registry as a separate package in this repo so it can be
  released more often than the core.
