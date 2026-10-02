# Architecture

Status: problem statement, one constraint, and open questions. Apart from the
constraint below, nothing here is decided; the open questions are framed for
a later research pass to answer.

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

- **Any decision model.** Jev is one of several *decision models* (models that
  pick a reasoning effort for a step), and more are being released. Step 2
  should call whichever decision model is configured, with provider-specific
  code limited to talking to that provider.
- **Any harness.** Harness-specific code should be limited to whatever is
  needed to intercept or influence the model request.

## Constraint: the decision model is configuration

`reasoning-router` must not depend on Jev or any single decision-model
provider. The decision model is chosen by configuration, and shared code must
not import a provider SDK (such as `@typesafe-ai/sdk`) or assume one
provider's request shape, efforts, or failure modes. This is decided; how it is
achieved is covered in [open question 2](#2-decision-models).

Steps 1–6 are largely independent of OpenCode; what varies by harness is
*where* the router can hook in, *what it can see* (full request body vs. a
higher-level message list), and *what it can change* (raw body vs. a
per-request effort parameter vs. nothing, requiring a proxy).

## Open questions

### 1. Which harnesses to target

Candidates: OpenCode, Hermes, Claude Code, Codex, Pi, and others (e.g. Cline,
Aider, Goose, Cursor-style IDE agents).

- Which harnesses have enough users and a stable enough extension surface to
  justify an adapter?
- Which models and wire APIs (OpenAI Responses, Anthropic Messages, Chat
  Completions, others) does each harness use, and do they support
  mid-conversation effort changes?
- What is the order of work? Which harness is the first to validate the shared
  core against a second, different extension model?

### 2. Decision models

- Which decision models exist today (Jev and others), and which should be
  supported first? Is a local, no-network heuristic useful as a baseline or
  fallback?
- What is the common contract? What state does each model need (recent turns,
  tool results, errors, target model and its supported efforts), and what does
  it return (one effort, a score, a confidence)?
- How does the router keep the classification input bounded and
  metadata-limited when different providers want different context?
- What does configuration look like: selecting a provider, its credentials and
  endpoint, per-model overrides, and whether more than one can be chained (for
  example a primary model with another as fallback)?
- Which parts of today's fallback policy (timeout, retries, fixed or previous
  effort, `error` mode) are provider-independent, and which belong to a
  provider?
- Should decision events record which decision model made the choice, so
  models can be compared on the same workload?

### 3. Each harness's extension point

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

### 4. What belongs in a shared core

- Which of validation, classification, fallback, rewriting, forwarding, usage
  observation, lineage, and decision logging are harness-independent and
  decision-model-independent?
- Is the core's input the raw wire request (as in `opencode-jev-router`) or a
  normalized conversation model that adapters translate into?
- Do decision-model providers live in the core (with their SDKs as optional
  dependencies) or in separate packages?
- Is the standalone proxy part of the core, a separate package, or one more
  "adapter"?
- How much of `opencode-jev-router` can be moved as-is, and does that repo
  later depend on the core or get replaced by an adapter here?

### 5. Package naming and boundaries

- Scope is `@reasoning-router`. What is the core called (`core`, `router`,
  unscoped `reasoning-router`)?
- Adapter naming: bare harness name (`@reasoning-router/opencode`) or a suffix
  matching the extension type (`@reasoning-router/opencode-plugin`)? Does any
  harness's discovery convention require a particular name or keyword?
- If decision-model providers are separate packages, how are they named so
  they are not confused with harness adapters (e.g. a `decider-` or
  `classifier-` prefix)?
- One package per harness, or per harness *and* wire API?
- Are model/effort registries part of the core or a separate, more frequently
  released package?
- Versioning: independent per package or lockstep? (Affects the choice of
  release tooling, which is deferred until a first package exists.)
