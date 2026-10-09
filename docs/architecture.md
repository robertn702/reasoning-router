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
`@reasoning-router` scope plus the proxy, versioned independently:

- **`@reasoning-router/core`:** validation, rewriting, cache lineage,
  forwarding, usage observation, decision logging, the model registry, and
  the classifier interface. It has no classifier SDK dependencies.
- **`@reasoning-router/opencode`:** the OpenCode V2 plugin (the port of
  `plugin*.ts`).
- **`@reasoning-router/classifiers`:** every classifier, as presets selected
  by `classifier.provider`. The first port created it as
  `@reasoning-router/classifier-jev` (the port of `jev.ts`); it was renamed
  when Clef was added.
- **`@reasoning-router/pi`:** the Pi extension. It registers Pi virtual
  models that pick each request's thinking level and leave effort placement
  to Pi, so it does not rewrite payloads. See
  [`harnesses/pi.md`](harnesses/pi.md).

One package holds every classifier because the decision models share one
request format but not one endpoint: Jev, Clef, Laya, and others accept the
same System One `state` and `questions` and return the same `answers`, but are
reached through different URLs, auth, and response envelopes. A new
compatible model is a preset of a few lines, not a new package. Harnesses
cannot install extra packages next to a plugin, so per-classifier packages
would all be dependencies of every harness anyway. Split a classifier into
its own package only if someone else needs to release it independently.

Every classifier is reached over HTTP. A classifier that runs a local model
is a server the user installs, runs, and supervises (for Laya,
`laya-serve`); the preset only needs its URL. Our packages never install,
download, load, or start a model, its weights, or its runtime, and depend on
no model runtime. Running a model inside the router was rejected for Laya
([proposal](proposals/laya.md)): inference blocks the router's event loop,
each process would hold its own 1.7 GB copy of the model, and harnesses
cannot install the runtime next to a plugin.

Naming:

- The core is `@reasoning-router/core`, a common convention (`@babel/core`)
  that leaves unscoped `reasoning-router` free for a future umbrella CLI.
- Harness adapters use the bare harness name (`@reasoning-router/opencode`),
  which users type into their harness configuration.
- Classifiers live in `@reasoning-router/classifiers`, named for its role
  rather than for a vendor, API, or transport. Provider names in
  configuration identify the service, not the model: `clef` is Clef on
  Workers AI, and a model served elsewhere uses that service's provider.

The standalone proxy is part of the first port, as
`@reasoning-router/proxy` (the port of `index.ts`, `config.ts`, and
`server.ts`, run as the `reasoning-router` command). It depends on core and
classifiers and reads `REASONING_ROUTER_*` variables. Porting it keeps every
`opencode-jev-router` test, since the proxy tests also cover shared behavior.

## Classifiers

The starting point is `opencode-jev-router`'s classifier, unchanged except
that Jev-specific names become provider-neutral.

- **First providers:** [Jev](https://typesafe.ai/) (hosted by TypeSafe or
  through Vercel AI Gateway), the best-known decision model, and
  [Laya](https://huggingface.co/convaiinnovations/laya), an open-source,
  Jev-compatible model, requested by users. Users run it themselves with
  `laya-serve` from Laya's authors, which serves the Jev
  `POST /v1/systemone` API; the `laya` preset calls that server
  ([proposal](proposals/laya.md)).
- **Clef:** Cloudflare's
  [Clef and Clef-flash](https://blog.cloudflare.com/clef-decision-models/)
  ([#1](https://github.com/robertn702/reasoning-router/issues/1)), hosted on
  Workers AI at `/client/v4/accounts/{accountId}/ai/run/@cf/cloudflare/clef`
  with the System One request and a `{ result, success, errors }` envelope
  around the answer. It cannot reuse the Jev endpoint, which is fixed at
  `{baseUrl}/v1/systemone`. `model` (`clef` or `clef-flash`) is required
  until effort selection is evaluated. Running Clef locally is out of scope;
  its backbones need a GPU.
- **OpenAI Decisions:** OpenAI's public-beta
  [`POST /v1/decisions`](https://developers.openai.com/api/docs/guides/decisions), with
  classifier model `gpt-6-luna`. It is not System One: it takes text `input`
  and a `questions` array, and returns an `answers` array. The
  `openai-decisions` preset sends the state as JSON text and one `effort`
  choice, and matches the answer by name. It shares the transport; the
  translation stays in the preset.
- **Transport:** presets share one `fetch`-based client that maps HTTP
  status and `fetch` failures to the error categories and reads
  `Retry-After`. `@typesafe-ai/sdk` is dropped; it only adds a `choice()`
  helper, the HTTP call, and typed errors, and its retries are already off.
- **Contract:** one `system_one` call. The state is the bounded,
  metadata-limited summary `opencode-jev-router` builds (recent user text,
  assistant progress, up to 8 tool results with names and error flags, a
  failure summary, and the target model ID). The single question is a
  `choice` named `effort` whose options are the target model's supported
  efforts. The answer is `answers.effort.choice`, rejected if the model does
  not support it. Laya, Kev, SemIf, Clef, and CLM accept the same request and response
  shape as Jev's `system_one`, so they fit this contract; OpenAI Decisions
  maps the same state and question onto its own format.
- **Policy:** as in `opencode-jev-router`'s
  [classification policy](https://github.com/robertn702/opencode-jev-router/blob/main/docs/classification-policy.md):
  a 4000 ms total deadline, one retry for connection errors, timeouts, 429,
  and 5xx, then fallback (`fixed` high by default, or `previous`, or
  `error`). Client cancellation aborts and never falls back.
- **Configuration:** one `classifier` block selects the provider, for example
  `classifier: { provider: "jev", apiKey, baseUrl, timeoutMs }`,
  `classifier: { provider: "clef", accountId, apiKey, model, timeoutMs }`,
  `classifier: { provider: "laya", baseUrl, apiKey, model, timeoutMs }`,
  `classifier: { provider: "kev", baseUrl, apiKey, model, timeoutMs }`,
  `classifier: { provider: "semif", baseUrl, apiKey, model, timeoutMs }`,
  `classifier: { provider: "openai-decisions", apiKey, baseUrl, model, timeoutMs }`, or
  `classifier: { provider: "clm", baseUrl, apiKey, model, timeoutMs }`.
- **Logging:** the same metadata-only decision events, with Jev-specific
  names made provider-neutral (`jev_attempts` becomes `classifier_attempts`,
  `jev_timeout` becomes `classifier_timeout`) and the classifier recorded.

## Porting

- Environment variables use the `REASONING_ROUTER_*` prefix; `JEV_ROUTER_*`
  is not carried over.
- Once the port reaches parity, `opencode-jev-router` is frozen and its
  README points to `@reasoning-router/opencode`. It is not kept as a
  compatibility wrapper for its existing configuration.
- Files are copied fresh, with the source commit noted in the port commit
  message; `opencode-jev-router`'s git history is not imported.
- `@reasoning-router/opencode` depends on `@reasoning-router/classifiers`
  so every classifier preset works once the plugin is installed. The
  classifier is still selected by configuration through the core classifier
  interface. A classifier that runs a local model (such as Laya) also needs
  the user's own server running.

## Open questions

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
- One package per harness, or per harness *and* wire API?
- Model/effort registries: prefer a reliable third-party package that lists
  models and their supported reasoning efforts, if one exists. Otherwise,
  maintain the registry as a separate package in this repo so it can be
  released more often than the core.
