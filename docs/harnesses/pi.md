# Pi

Status: findings for [#13](https://github.com/robertn702/reasoning-router/issues/13).
Research only; nothing here is implemented.

[Pi](https://pi.dev) is the `pi` coding agent. Its repository moved from
`badlogic/pi-mono` to [`earendil-works/pi`](https://github.com/earendil-works/pi),
and its packages moved from the `@mariozechner` scope to `@earendil-works`
(`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`). The extension
loader still maps the old names
([`loader.ts`](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/src/core/extensions/loader.ts#L108)).

Every claim below is against Pi **1.0.0** (tag `v1.0.0`, released
2026-10-01), unless marked otherwise. Links point at that tag. Claims marked
**verified** were checked locally against the published
`@earendil-works/pi-coding-agent@1.0.0`, using a probe extension and a fake
Responses endpoint on `127.0.0.1` (no credentials, no paid calls). Claims
marked **code-read** come from reading the source. Claims marked
**unverified** have not been checked.

## Summary

Pi supports an in-process adapter. It does not need the proxy. Two documented
extension points cover the router's steps:

- **Virtual models** (`pi.registerVirtualModel()`, new in 0.99.0 and labeled
  experimental) run a `route()` callback before every request. The callback
  receives the conversation, the reason for the request, an abort signal, and
  per-branch state. It returns the physical model and thinking level. If it
  throws, the request fails with a visible error.
- **`before_provider_request`** receives the provider payload (the wire request
  body as a JavaScript object, before serialization) and can replace it.

On Anthropic models that accept mid-conversation effort, Pi already does what
the router's rewrite does. It pins the request-level `output_config.effort`,
inserts an effort-only system message for each turn, and stores each turn's
effort in the session file. A virtual model that only picks the thinking level
therefore gets cache-preserving effort changes without rewriting anything. On
OpenAI Responses and Codex, Pi changes the request-level `reasoning.effort`.
That invalidates the cached prefix. Fixing it takes a `before_provider_request`
rewrite: the core's `configuration_update` insertion.

Recommendation: build a `@reasoning-router/pi` Pi package (an npm package
installed with `pi install`). It classifies in a virtual model's `route()`.
On OpenAI it rewrites the payload in `before_provider_request`. On Anthropic it
leaves effort placement to Pi. The smallest first slice is the Anthropic
virtual model, which needs no payload rewrite.

## Extension point

### Mechanism

An extension is a TypeScript module whose default export receives
`ExtensionAPI`. Pi loads it with `jiti`, so it needs no build step
([`docs/extensions.md`](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/extensions.md)).
These are the points the router can use:

| Point | Gives | Router step |
| --- | --- | --- |
| [`registerVirtualModel`](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/virtual-models.md) `route(request, ctx)` | `messages` (Pi's normalized transcript, including system messages), `reason` (`user`, `continuation`, `retry`, `direct`), `previous`/`failed` dispatch, `state`, `signal`; returns `{ model, thinkingLevel, state }` | validate, classify, select effort, reject |
| [`before_provider_request`](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/src/core/extensions/types.ts#L866-L870) | `payload`, the provider SDK params object; the handler's return value replaces it | rewrite |
| `before_provider_headers` | mutable request headers, minus auth | (not needed) |
| `after_provider_response` | HTTP status and headers, before the body is read | outcome |
| [`provider_stream_event`](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/src/core/extensions/types.ts#L889-L896) | each parsed stream event, with provider, API, and model | usage, cache lineage |
| `message_end` | the final assistant message with normalized `usage` (`input`, `cacheRead`, `cacheWrite`), dispatched `model`, and `thinkingLevel` | usage, decision log |

Other routing points exist: `pi.setModel()` and `pi.setThinkingLevel()`,
called from `before_agent_start` or `turn_start`. These change the user's
session selection and fire once per prompt or turn, not once per request. Most
existing Pi routers use them (see "Existing solutions"). The router should not.
They overwrite the user's choice, and they cannot act on tool-continuation
requests on their own.

### Visibility

- **Request body:** yes. `before_provider_request` sees the provider-shaped
  body. For `openai-responses` it carries `model`, `input`, `stream`,
  `prompt_cache_key`, `prompt_cache_retention`, `prompt_cache_options`,
  `store`, `max_output_tokens`, `tools`, `reasoning`, and `include`
  (**verified**). The prompt is the leading `developer` item. The event does
  not carry the model or API (use `payload.model`, or the API the adapter
  configured). Its `ctx.model` is the *selected* model, so with a virtual
  model it names the virtual model, not the physical one (**verified**).
- **Conversation and tool results:** yes. `route()` receives `messages`.
  `ctx.sessionManager.getBranch()` returns the whole branch, including
  `toolResult` messages with `toolName` and `isError`
  ([`jev-router.ts`](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/examples/extensions/jev-router.ts)
  reads them).
- **Session ID:** yes. `ctx.sessionManager.getSessionId()`. Pi also sends the
  session ID as `prompt_cache_key` on Responses requests (**verified**).
- **Request reason:** only in `route()`. `before_provider_request` cannot tell
  a user turn from a tool continuation, a retry, or a cache-warming replay.

### Control

- **Rewrite the body:** yes. The returned object is what gets serialized.
  **Verified:** a handler that set `reasoning.effort` to `medium` and appended
  `{ "type": "configuration_update", "reasoning": { "effort": "high" } }`
  produced exactly that body on the wire.
- **Per-request effort parameter:** yes. `route()` returns `thinkingLevel`,
  and each provider adapter maps it to its own effort field. Pi clamps the
  level to what the model supports. Pi's levels are `off`, `minimal`, `low`,
  `medium`, `high`, `xhigh`, and `max`. The core's `none` is Pi's `off`.
  Pi has no core equivalent of `minimal`.
- **Reject with a user-visible error:** only from `route()`. **Verified:** a
  `route()` that throws `reasoning-router unsupported_model (400): …` makes no
  network request. The assistant message ends with `stopReason: "error"` and
  that message, and `pi -p` exits 1. A throw in `before_provider_request` is
  caught. Pi reports it as an extension error and sends the **unmodified**
  payload ([`runner.ts`](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/src/core/extensions/runner.ts#L1352-L1381);
  **verified**). The payload hook therefore fails open: a validation or
  rewrite failure there sends the original request at the user's level.

### Streaming

The router can observe the stream without buffering it:

- `provider_stream_event` delivers each parsed event, such as Responses
  `response.completed` with its `usage` (**verified**).
- `message_end` delivers normalized usage, with `cacheRead` already separated
  from `input` (**verified**).

Handlers are awaited in stream order, so a slow handler delays the stream. The
events are parsed objects, not the original SSE bytes. The router never
forwards bytes in-process (Pi does), so `forward.ts` is unused.

### Auth

Pi makes the provider request with its own credentials. That includes OAuth
subscription logins: Anthropic, OpenAI Codex, ChatGPT, GitHub Copilot, and
others
([`packages/ai/src/auth/oauth`](https://github.com/earendil-works/pi/tree/v1.0.0/packages/ai/src/auth/oauth)).
The extension never handles provider credentials. `before_provider_headers`
does not include the authorization header (**verified**: the header set was
empty, and the SDK added `Authorization` later). A virtual model can route only
to models whose provider has credentials.

Pi also ships classifier models that use the user's Pi credentials
(`ctx.modelRegistry.classify()`), including TypeSafe `jev-latest`, Jev through
OpenRouter, Vercel AI Gateway, and OpenCode Zen, and Clef and Clef Flash on
Cloudflare Workers AI (added after 1.0.0, unreleased). See the 0.99.0 and
Unreleased entries in
[`CHANGELOG.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/CHANGELOG.md).

### Stability

The extension API is documented
([`docs/extensions.md`](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/extensions.md),
[`docs/virtual-models.md`](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/virtual-models.md)).
Its exact types are exported from
[`extensions/types.ts`](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/src/core/extensions/types.ts).
The API has no separate version and no compatibility policy beyond the
package version.

- **Churn:** Pi releases about weekly. The 0.85.x through 0.87.x releases each
  have a "Breaking Changes" section that touches extension or provider
  types, such as the `TurnEndEvent` shape and providers receiving
  `TranscriptContext`.
- **Virtual models:** added on 2026-09-29 (0.99.0) and called "experimental"
  in the changelog. They are not behind the `PI_EXPERIMENTAL` flag.
- **Payload hooks:** `before_provider_request` has existed since 0.57.0
  (2026-03-07), `after_provider_response` since 0.67.6, and
  `provider_stream_event` since 0.99.0.

### Distribution

An extension can come from a file in `~/.pi/agent/extensions/` or
`.pi/extensions/`, from `pi -e <path|npm:…>`, or from a Pi package installed
with `pi install npm:@scope/name@version` (or `git:`). The package declares its
entry points under a `pi` key in `package.json`
([`docs/packages.md`](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/packages.md)).

- **Name and format:** neither is constrained. `@reasoning-router/pi` works.
  The `pi-package` keyword lists the package in the pi.dev gallery.
- **Dependencies:** Pi installs the package's `dependencies`. The Pi packages
  (`@earendil-works/pi-ai`, `pi-agent-core`, `pi-coding-agent`, `pi-tui`,
  `typebox`) must be `peerDependencies` with range `"*"`, never bundled. Pi
  suppresses automatic peer installation, so an optional peer such as Laya's
  `@receptron/laya` does not get installed. This is the same limit as the
  OpenCode plugin.
- **Configuration:** Pi has no per-extension options block like OpenCode's
  plugin options. An extension reads its own file, environment variables, or
  CLI flags (`pi.registerFlag()`).

### Wire APIs and models

Pi's provider layer (`@earendil-works/pi-ai`) speaks many APIs:
`openai-responses`, `openai-codex-responses` (ChatGPT/Codex subscription, at
`chatgpt.com/backend-api/codex/responses`, WebSocket by default with SSE
fallback), `azure-openai-responses`, `anthropic-messages`,
`openai-completions`, `bedrock-converse-stream`, `google-*`,
`mistral-conversations`, and others
([`packages/ai/src/api`](https://github.com/earendil-works/pi/tree/v1.0.0/packages/ai/src/api)).
The router's registered models map to the first four.

How a mid-conversation effort change affects the prompt cache:

- **Anthropic Messages, cache preserved (code-read).** This applies to models
  with `compat.supportsMidConvoEffort`: Claude Opus 5, Opus 5.5, Sonnet 5.5,
  Fable 5.1, and Mythos 5.1, on the `anthropic` and `openrouter` providers.
  OpenRouter Opus 5 is excluded because OpenRouter rejects mid-conversation
  effort for it
  ([`generate-models.ts`](https://github.com/earendil-works/pi/blob/v1.0.0/packages/ai/scripts/generate-models.ts#L593-L607);
  [pi#9165](https://github.com/earendil-works/pi/issues/9165)). For these
  models Pi does the following
  ([`anthropic-messages.ts`](https://github.com/earendil-works/pi/blob/v1.0.0/packages/ai/src/api/anthropic-messages.ts#L1242-L1251),
  [`insertThinkingLevelMessages`](https://github.com/earendil-works/pi/blob/v1.0.0/packages/ai/src/api/anthropic-messages.ts#L1525-L1539)):
  - It sends `anthropic-beta: mid-conversation-output-config-2026-07-01` and
    `thinking-binding-controls-2026-08-01`.
  - It pins the request-level `output_config.effort` to `high`.
  - It sets `thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } }`.
  - Before each historical assistant message, it inserts an effort-only system
    message carrying that message's recorded `providerThinkingLevel`.
  - It appends one more with the current effort at the tail.

  Changing the thinking level per request therefore changes only the suffix.
  The per-turn effort is stored in the session file, so unlike the core's
  in-memory lineage it survives restarts, branch navigation, and compaction.
  `drop_block` addresses the "Invalid signature in thinking block" failure
  that [`behavior.md`](../behavior.md) lists as unverified.
- **OpenAI Responses and Codex, cache broken.** Pi sets the request-level
  `reasoning.effort` to the selected level
  ([`openai-responses.ts`](https://github.com/earendil-works/pi/blob/v1.0.0/packages/ai/src/api/openai-responses.ts#L363-L378),
  [`openai-codex-responses.ts`](https://github.com/earendil-works/pi/blob/v1.0.0/packages/ai/src/api/openai-codex-responses.ts#L581-L597)).
  It never emits `configuration_update`. A user reported that changing the
  level on 0.85.1 rewrites the prefix and misses the cache. The issue was
  closed as `no-action`
  ([pi#9335](https://github.com/earendil-works/pi/issues/9335)). On the Codex
  WebSocket transport, a changed top-level field also stops Pi from sending
  `previous_response_id` plus an input delta. Pi then resends the full input
  ([`requestBodiesMatchExceptInput`](https://github.com/earendil-works/pi/blob/v1.0.0/packages/ai/src/api/openai-codex-responses.ts#L1434-L1458);
  code-read). The core's rewrite fixes both: the top-level effort stays fixed
  and only `input` grows. Pi rebuilds `input` from its transcript on every
  request, so inserted updates are not replayed (**verified**). The core's
  lineage store, or a reconstruction from each assistant message's recorded
  `thinkingLevel`, has to restore them.
- **Other APIs:** effort is top-level only, and the cache impact is
  provider-specific. These are out of scope, as they are for the router
  today.
- **Switching physical models** loses the cache, as Pi's virtual-model docs
  state. The router keeps the physical model fixed and changes only effort.

## Existing solutions

Many Pi extensions already route models. A search of npm for `pi-package`
routers found more than 30. None of the ones reviewed preserves the OpenAI
prompt cache when it changes effort.

- **Pi's own [`jev-router.ts`](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/examples/extensions/jev-router.ts)**
  (official example, 0.99.0). It uses a virtual model, calls Jev through
  `ctx.modelRegistry.classify()` on the first user message, and keeps the
  phase in router state. It switches models once per session to bound cache
  misses, and passes the user's thinking level through unchanged.
  - Copy: the virtual model and router state. Keep continuations and retries on
    the physical model in `previous` and `failed`.
  - Avoid: model switching. It is not effort routing.
- **[`proper-llm-router`](https://github.com/sharaf-nassar/proper-pi-extensions/tree/main/proper-llm-router)**
  picks a model once per session, on the first task, so later turns keep the
  cache. It moved from a placeholder provider at port 1 to a virtual model in
  0.99.1. Its history shows a compatibility fix on almost every Pi minor
  release: [0.86](https://github.com/sharaf-nassar/proper-pi-extensions/commit/11bb345),
  [0.87.1](https://github.com/sharaf-nassar/proper-pi-extensions/commit/3a69075),
  and [0.99.1](https://github.com/sharaf-nassar/proper-pi-extensions/commit/7d3a1e6).
  0.99 changed a prompt preflight return type. It also patches Pi's thinking
  selector to add an `ultra` level.
  - Avoid: patching host internals.
  - Copy: pinning a minimum Pi version and testing against a real host.
- **`setModel`/`setThinkingLevel` routers.** These call `pi.setModel()` and
  `pi.setThinkingLevel()` from `before_agent_start` or `turn_start`, once per
  user prompt. Examples:
  [`@alexeiled/pi-model-router`](https://github.com/alexei-led/pi-model-router)
  (Jev advisor, per-turn model and effort),
  [`@ygncode/pi-model-router`](https://github.com/ygncode/pi-router)
  (a confidence threshold, `minSwitchConfidence`, to limit cache misses),
  [`pi-codex-router`](https://github.com/burggraf/pi-codex-router)
  (deterministic, with hysteresis), and
  [`@ejstembler/pi-classifier-router`](https://gitlab.com/ejstembler/pi-classifier-router)
  and [`pi-jev-model-router`](https://github.com/da-vinci-noob/pi-jev-model-router)
  (both Jev).
  - Lesson: these routers rely on hysteresis to reduce cache misses. The
    router's insertion of `configuration_update` and effort messages avoids
    the misses in the first place.
  - Avoid: rewriting the user's selection. `alexei-led` added a bidirectional
    sync between the user's thinking level and the router's
    ([66a3519](https://github.com/alexei-led/pi-model-router/commit/66a3519)),
    then fixed routes lost across thinking-level changes
    ([3606486](https://github.com/alexei-led/pi-model-router/commit/3606486)).
- **[Weave Router](https://github.com/weave-os/router/tree/main/install/pi-router)**
  (`@weave-os/router`) is a remote proxy. Its installer writes a `weave`
  provider with the proxy's base URL to `~/.pi/agent/models.json` and installs
  a Pi package. That package uses `before_provider_request` only to add
  `metadata.user_id` as a sticky session key, because "before_provider_request
  can't set headers"
  ([`metadata.ts`](https://github.com/weave-os/router/blob/main/install/pi-router/src/metadata.ts)).
  Most of its Pi fixes concern compaction and context windows of routed
  models, not hooks.
  - Copy: the base-URL-plus-package pattern, if the proxy path is ever
    offered.
- **[`pi-smart-router`](https://github.com/beettlle/pi-smart-router)**,
  **[`pi-typesafe-router`](https://github.com/jekozyra/pi-typesafe-router)**,
  **[`pi-jev-router`](https://github.com/mejiasd3v/pi-jev-router)**, and
  **[`pi-model-auto-router`](https://github.com/weisanju/pi-plugins)**
  register their own provider through `pi.registerProvider()`, a pattern from
  before virtual models existed. Virtual models make it unnecessary.

## Recommended path

Build a `@reasoning-router/pi` adapter package. Do not use the proxy.

1. **Register one virtual model per wrapped model.** For example,
   `reasoning-router/claude-opus-5-5` routes to `anthropic/claude-opus-5-5`.
   The user selects it as they would select any model. The router keeps the
   user's physical model and changes only effort.
2. **Classify in `route()`.**
   - `user` and `continuation` requests are classified.
   - `retry` reuses `failed.thinkingLevel`.
   - `direct` (compaction, nested calls) uses the base effort.

   Unsupported models or input make `route()` throw a `reasoning-router …`
   error, which is visible. A classifier failure falls back as the policy
   says. The last decision goes in router state, which supports the
   `previous` fallback across restarts.
3. **Anthropic:** return the effort as `thinkingLevel`. Pi places it and keeps
   the cache. No rewrite is needed.
4. **OpenAI Responses and Codex:** return the base effort, or any fixed
   level, as `thinkingLevel`. Then in `before_provider_request`:
   - keep the request-level `reasoning.effort` fixed;
   - insert `configuration_update` items with the core's OpenAI wire adapter.

   The handler identifies requests that `route()` decided by the session ID
   and the order of calls. Requests it does not recognize, such as
   cache-warming replays, pass through unchanged.
5. **Log** decisions from `route()`, and usage and outcome from `message_end`,
   as the existing metadata-only events.

### Limitations

- `route()` receives Pi's normalized messages, not a wire body. The
  classifier's input (`ClassifierState`, built by `wire-*.ts` from a raw
  body) needs a builder that takes neutral messages. That builder answers the
  "raw request vs. normalized conversation" question in
  [`architecture.md`](../architecture.md) for this harness. The OpenAI rewrite
  still uses the raw body.
- `before_provider_request` fails open, and it receives no model, API,
  request reason, or turn ID. A bug in the rewrite sends an unrouted request
  at the user's level rather than failing.
- The two hooks must be correlated by call order within a session. That works
  because Pi runs one request at a time per session, an assumption that is
  **unverified** for subagents and parallel sessions in one process.
- **Cache warming (code-read, unverified):**
  - With a virtual model selected, Pi appears to skip warming, because
    `cacheContextIsCurrent` compares the selected model with the request
    model
    ([`sdk.ts`](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/src/core/sdk.ts#L345-L356)).
    The default `cacheWarming: "streaming"` would be lost for routed sessions.
  - If warming does run, its replays go through `before_provider_request`
    with `maxTokens: 1`, and the rewrite must replay the same updates.
- Virtual models are experimental, and Pi breaks extension types often. The
  package needs a pinned minimum Pi version and a smoke test against a real
  Pi, like `smoke:plugin:v2`.
- The core's lineage store reconstructs OpenAI updates in memory only. After
  a restart, a resumed Responses session loses its cached prefix once. The
  Anthropic path has no such loss.
- Optional classifier peers (Laya) are not installed, as with OpenCode.

### Smallest first slice

An Anthropic-only virtual model. It covers the following:

- One wrapped model from the core registry, such as `claude-opus-5-5`.
- The configured classifier from `@reasoning-router/classifiers`.
- A `ClassifierState` built from `route()`'s messages.
- `thinkingLevel` as the effort, a visible error for unsupported input, and
  fallback.
- A metadata-only decision event that includes `cacheRead` from
  `message_end`.

It needs no payload rewrite. It exercises the classifier, policy, and logging
against a second extension model. A local test can check its requests (the
`thinking`, `output_config`, and effort-only messages) against a fake Messages
endpoint, without credentials. OpenAI with the payload rewrite comes second.

The proxy remains possible only for API-key `openai` and `anthropic` providers.
The user would override `baseUrl` in `~/.pi/agent/models.json`, as Weave does.
The proxy serves only `/v1/responses` and `/v1/messages`, so it cannot serve
the Codex subscription endpoint (`/codex/responses`) or its WebSocket
transport. On Anthropic, the core's effort messages would conflict with the
ones Pi already inserts (**unverified**).

## Open questions

- **Upstream first?** Pi closed the `configuration_update` request
  ([pi#9335](https://github.com/earendil-works/pi/issues/9335)) without
  action, but it does the equivalent for Anthropic. A pi-ai change that keeps
  the request-level effort fixed on Responses and Codex would leave the
  adapter as only a virtual model, with no payload hook. Should the router
  propose it upstream before building step 4?
- **Classifier transport.** Pi already calls Jev and Clef with the user's Pi
  credentials (`ctx.modelRegistry.classify()`). Should
  `@reasoning-router/classifiers` gain a preset that delegates to it inside
  Pi, or should the adapter keep the router's own transport and
  `REASONING_ROUTER_CLASSIFIER*` configuration?
- **Classifier input.** Should the core accept a neutral message list for
  classification, with the raw body kept for the rewrite, as Pi needs?
- **Configuration.** Pi has no plugin options block. Options are environment
  variables (as the proxy uses), a `reasoning-router` file under
  `~/.pi/agent/`, or flags.
- **Model registry.** pi-ai ships a generated catalog with each model's
  `thinkingLevelMap` and `supportsMidConvoEffort`. Is it worth evaluating as
  the third-party registry `architecture.md` asks about, or is it too tied to
  Pi?
