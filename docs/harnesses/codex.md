# Codex CLI

Status: findings for [#11](https://github.com/robertn702/reasoning-router/issues/11).
Recommends the standalone proxy behind a custom Codex model provider, with
no Codex adapter package.

Sources are [Codex CLI](https://github.com/openai/codex) at tag
`rust-v0.159.0` (`687a119`, released 2026-09-29; `0.160.0` is the latest
release). Paths below are under
[`codex-rs/`](https://github.com/openai/codex/tree/rust-v0.159.0/codex-rs)
at that tag. **Verified** means run locally with `codex-cli 0.159.0`
against a fake upstream that served SSE replies, using a throwaway
`CODEX_HOME`, a dummy API key, and no paid requests. Everything else is from
source, or from third-party reports, which are marked as such.

## Summary

- Codex has no in-process surface that can read or rewrite the model request.
  Its hooks, plugins, and MCP servers never see the request body or the
  reasoning effort.
- A custom `[model_providers.<id>]` entry with a `base_url` sends every
  request to the existing `@reasoning-router/proxy` over plain HTTP
  Responses. The unmodified proxy already routes Codex 0.159.0 requests:
  it pins the request-level effort, inserts a `configuration_update`, and
  replays it on later turns, including after Codex restarts (verified).
- Codex has an under-development `reasoning_effort_override` feature that
  emits its own `configuration_update` items. It does not pick the effort; it
  only makes manual `/model` changes keep the cache. Custom providers never
  get it.
- ChatGPT-subscription login works through a custom provider in source, but
  the proxy does not yet forward the headers the ChatGPT backend needs, and
  subscription routes may reject `configuration_update`. This is the main
  open item.

## Extension points

### Mechanism

Provider configuration in `~/.codex/config.toml` (or `-c` overrides) is the
only surface that reaches the model request:

```toml
model = "gpt-6.1-sol"
model_provider = "reasoning-router"

[model_providers.reasoning-router]
name = "reasoning-router"
base_url = "http://127.0.0.1:4320/v1"
wire_api = "responses"
```

Codex sends no credential here, and the proxy adds its own in
`REASONING_ROUTER_UPSTREAM_AUTH=bearer` mode (verified). `forward` mode
requires a loopback upstream, so it does not apply to `api.openai.com`.

Codex posts to `{base_url}/responses`
([`codex-api/src/endpoint/responses.rs`](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/codex-api/src/endpoint/responses.rs)),
which matches the proxy's `/v1/responses` route. The provider fields are in
`ModelProviderInfo`
([`model-provider-info/src/lib.rs:135-199`](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/model-provider-info/src/lib.rs#L135-L199)).
`wire_api = "chat"` was removed, so Responses is the only wire API
([`lib.rs:96`](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/model-provider-info/src/lib.rs#L96)).
A provider cannot reuse a built-in ID such as `openai`
([`config/src/config_toml.rs:66-72`](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/config/src/config_toml.rs#L66-L72)).

Two other ways to redirect requests exist, but the custom provider is
simpler:

- **`openai_base_url`** replaces only the base URL of the built-in `openai`
  provider
  ([`core/src/config/mod.rs:3799-3805`](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/core/src/config/mod.rs#L3799-L3805)).
  The provider keeps its OpenAI behaviors:
  - **WebSockets:** it opens a Responses WebSocket first. Verified: a `426`
    on the upgrade makes Codex fall back to HTTP for the rest of the session
    ([`core/src/client.rs:1505-1510`](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/core/src/client.rs#L1505-L1510)).
  - **zstd request bodies** under ChatGPT login
    ([`client.rs:1617-1626`](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/core/src/client.rs#L1617-L1626)).
  - **Remote model catalog** under ChatGPT login
    ([`models-manager/src/manager.rs:565-569`](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/models-manager/src/manager.rs#L565-L569)).
  - **Codex's own `configuration_update` items** (see "Prompt cache").
- **`name = "openai"`** on a custom provider, the codex-lb approach. This
  works because `is_openai()` compares the display name
  ([`lib.rs:606-608`](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/model-provider-info/src/lib.rs#L606-L608)),
  so the provider gets the same OpenAI-only behaviors. See "Existing
  solutions" for why to avoid it.

Surfaces ruled out:

- **Hooks** (`hooks.json` or `[hooks]`, stable and on by default) offer 12
  events: tool, permission, compaction, session, prompt-submit, sub-agent,
  stop, and interrupt
  ([`hooks/src/lib.rs:23-36`](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/hooks/src/lib.rs#L23-L36)).
  - None of them runs before a model request.
  - Their inputs carry `session_id`, `turn_id`, `model`, a `transcript_path`,
    and event data such as tool input/output, but no effort and no request
    body ([`hooks/src/schema.rs`](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/hooks/src/schema.rs)).
  - No hook output can change the model or effort. An upstream proposal to
    let `PostToolUse` request an effort change is open
    ([openai/codex#47395](https://github.com/openai/codex/issues/47395)).
- **Plugins** (`.codex-plugin/plugin.json`) bundle skills, MCP servers, apps,
  and hooks
  ([`plugin/src/manifest.rs:8-25`](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/plugin/src/manifest.rs#L8-L25)),
  so they have the same limits.
- **MCP servers** only receive tool calls.
- **Extension API:** the Rust `ModelRequestContributor` trait can add
  `client_metadata` and wrap the response stream, but cannot touch the body
  or effort
  ([`ext/extension-api/src/model_request.rs:20-44`](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/ext/extension-api/src/model_request.rs#L20-L44)).
  It is compiled into the binary; nothing loads it dynamically.
- **App-server protocol:** a client driving `codex app-server` can set
  `effort` on `turn/start`
  ([`app-server-protocol/src/protocol/v2/turn.rs:245-247`](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/app-server-protocol/src/protocol/v2/turn.rs#L245-L247))
  or on the experimental `turn/settings/update`, mid-turn (`turn.rs:41-73`).
  That only helps a router that is itself the Codex front end, not users of
  the TUI or `codex exec`. It sets the request-level effort, so it does not
  preserve the cache unless Codex's own override feature is on.

### Visibility

The proxy sees the full request body.

- **Shape:** `ResponsesApiRequest` has `model`, `instructions`, `input`,
  `tools`, `reasoning`, `store: false`, `stream: true`, `include`,
  `prompt_cache_key`, `text`, and `client_metadata`
  ([`codex-api/src/common.rs:279-304`](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/codex-api/src/common.rs#L279-L304)).
- **History:** every HTTP request replays the full `input`, with no
  `previous_response_id`. That covers tool calls and results, and the
  environment and `AGENTS.md` messages Codex injects as `developer` and
  `user` items (verified).
- **Two shapes**, depending on model metadata (both verified):
  - *Standard:* top-level `instructions` and `tools`.
  - *Responses Lite* (`use_responses_lite`, for example bundled
    `gpt-6-astra`): empty `instructions`, no top-level `tools`, a leading
    `additional_tools` input item with `role: "developer"`, and
    `reasoning.context: "all_turns"`
    ([`client.rs:885-938`](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/core/src/client.rs#L885-L938)).

  The proxy passes `additional_tools` through as an opaque typed item.
- **Session identity:**
  - `prompt_cache_key` is the session ID (sub-agents use
    `{source}:{parent_thread_id}`;
    [`client.rs:575-586`](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/core/src/client.rs#L575-L586)).
  - The headers `session-id`, `thread-id`, and `x-client-request-id`
    (verified).
  - `client_metadata["x-codex-turn-metadata"]`, a JSON string with
    `session_id`, `turn_id`, `model`, and `reasoning_effort` (verified).

  The proxy keys lineage on `prompt_cache_key`. It does not read Codex's
  headers, so decision events log `session: null` (verified).

### Control

The proxy can rewrite the body, set the effort, and reject requests with a
local `400`. Codex shows the upstream error message to the user. Verified:
the proxy pinned `reasoning.effort` to `medium` and inserted
`{"type":"configuration_update","reasoning":{"effort":"high"}}` before the
newest user message.

This overrides the effort the user picks with `/model` or
`model_reasoning_effort`. Codex still reports its own choice in
`x-codex-turn-metadata` and the TUI.

### Streaming

The proxy streams SSE through and observes usage, as for any client.
Codex's custom providers default to `supports_websockets = false`
([`lib.rs:191`](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/model-provider-info/src/lib.rs#L191)),
so no WebSocket path is needed.

The proxy forwards only allowlisted response headers
(`packages/core/src/headers.ts`). That drops `x-codex-turn-state`, the
sticky-routing token the ChatGPT backend expects to see echoed within a turn
([`client.rs:284-297`](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/core/src/client.rs#L284-L297)),
and the rate-limit headers Codex shows to users. This is harmless for API-key
upstreams, but matters for the ChatGPT backend.

### Auth

- **API key (works today):**
  - In `bearer` mode the proxy adds its own key, so the provider needs no
    `env_key`. If the provider sets `env_key`, Codex sends
    `Authorization: Bearer`, which the proxy replaces in `bearer` mode or
    forwards to a loopback upstream in `forward` mode.
  - Verified end to end through the proxy against a fake upstream, with
    `gpt-6.1-sol` (standard shape) and `gpt-6-astra` (Responses Lite).
- **ChatGPT login (source only, not verified):**
  - A custom provider with `requires_openai_auth = true` uses the token
    from `auth.json` and sends it to the configured `base_url`
    ([`lib.rs:184-188`, `419-437`](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/model-provider-info/src/lib.rs#L419-L437)).
  - The proxy would forward it upstream to
    `https://chatgpt.com/backend-api/codex`, but today it forwards only
    `authorization`. Existing ChatGPT proxies also send
    `ChatGPT-Account-ID` and Codex's identity headers (see codex-lb and
    codex-openai-proxy below).
  - The local test of this path was not run, to avoid copying `auth.json`
    and risking a refresh-token rotation.
- **Subscription limits** (third-party report): ChatGPT-subscription
  requests through `api.openai.com` reject `configuration_update` with
  `subscription_sharing_unsupported_capability`. The same report says
  `chatgpt.com/backend-api/codex` accepted it and kept the cache
  ([comment on openai/codex#42996](https://github.com/openai/codex/issues/42996)).
  Unverified here.

### Stability

- **Stable surfaces:**
  - `model_providers` with `base_url`, `env_key`, `wire_api`, and
    `requires_openai_auth`. These are documented by Codex and by LiteLLM's
    [Codex setup guide](https://docs.litellm.ai/docs/proxy/client_setup/codex_cli),
    and have been stable for months.
  - The Responses body shape. Its contents change often, though: Codex
    released 20 stable `rust-v*` versions between 2026-09-01 and 2026-10-01.
- **Internal or under development:**
  - `reasoning_effort_override` is `UnderDevelopment` and off by default
    ([`features/src/lib.rs:1711-1714`](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/features/src/lib.rs#L1711-L1714)).
  - The Responses Lite shape and the `x-codex-*` headers are internal.

### Distribution

Nothing is installed into Codex. Users run `reasoning-router` and add a
provider block, so there are no package name or format constraints. A Codex
plugin could not carry the proxy, because plugins only bundle skills, MCP
servers, apps, and hooks.

### Wire APIs and models

- **Wire API:** Responses only, over HTTP (custom providers) or WebSocket
  (the built-in `openai` provider).
- **Models with registered efforts:** `gpt-6-astra`, `gpt-6-luna`,
  `gpt-6-sol`, and `gpt-6.1-sol` already have profiles in the proxy.
  - Codex's bundled catalog also lists `gpt-5.6-*`, `gpt-5.5`, and hidden
    models
    ([`models-manager/models.json`](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/models-manager/models.json)).
    The proxy rejects these with a local `400`.
  - Codex efforts include `ultra` and `persistent`
    ([`protocol/src/openai_models.rs:59-90`](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/protocol/src/openai_models.rs#L59-L90)).
    The proxy does not offer them, which is harmless because it replaces the
    request-level effort.
- **Model metadata:** a custom provider never fetches the remote catalog. A
  model missing from the bundled catalog, such as `gpt-6.1-sol` in 0.159.0,
  runs on generic fallback metadata (standard shape, default context window)
  unless the user supplies `model_catalog_json` (verified: no `/models`
  request was made).

### Prompt cache

Codex's own `/model` effort changes alter the request-level
`reasoning.effort`, which loses the cache
([openai/codex#42996](https://github.com/openai/codex/issues/42996)). The
proxy avoids this by keeping the request-level effort fixed.

Codex's native fix is `reasoning_effort_override`
([`core/src/session/reasoning_effort.rs`](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/core/src/session/reasoning_effort.rs)).

- **Gates:** it needs the feature flag, an `openai`-named provider, and model
  metadata with `supports_reasoning_effort_updates`
  ([`client.rs:552-556`](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/core/src/client.rs#L552-L556)).
- **What it sends:** the same item the proxy uses, `{"type":
  "configuration_update", "reasoning": {"effort": …}}`. Codex places it
  after the user message, and also writes one on the first turn
  ([`core/tests/suite/reasoning_effort_override.rs:403-490`](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/core/tests/suite/reasoning_effort_override.rs#L403-L490)).
  The proxy places its update before the user message.
- **Custom providers:** Codex strips these items before sending
  ([`client.rs:896-900`](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/core/src/client.rs#L896-L900)),
  so the proxy never sees caller updates that conflict with its own.
- **Not reproduced locally:** with the flag on and the built-in provider
  pointed at the fake upstream, 0.159.0 emitted no update for `gpt-6-astra`.
  Codex's tests are the evidence for the placement above.

Reported problems with the native path, all unverified here:

- Codex sends updates to models that reject them
  ([#44751](https://github.com/openai/codex/issues/44751)).
- Resume resets the request-level baseline
  ([#48802](https://github.com/openai/codex/issues/48802)).
- `gpt-6-luna` and `gpt-6-sol` accept an update but do not reason at the
  new effort ([#47843](https://github.com/openai/codex/issues/47843)).

That last report also applies to the proxy's inserted updates. Measure it
against a live endpoint before trusting per-model support.

## Existing solutions

- **[Soju06/codex-lb](https://github.com/Soju06/codex-lb)** (about 3.3k
  stars) is a ChatGPT multi-account load balancer.
  - **How it hooks in:** a custom provider with `name = "openai"`,
    `base_url = …/backend-api/codex`, `requires_openai_auth = true`, and
    `supports_websockets = true`.
  - **What broke:**
    - A Codex release started sending top-level `tools`, which codex-lb
      rejected
      ([#441](https://github.com/Soju06/codex-lb/issues/441) and duplicates).
    - Codex renamed its built-in provider from `OpenAI` to `openai`, which
      silently broke the `name` trick
      ([#783](https://github.com/Soju06/codex-lb/issues/783)).
    - Its typed request model added `tools: []` to Responses Lite requests,
      which then failed with a reserved-tool error
      ([#1184](https://github.com/Soju06/codex-lb/issues/1184)).
    - Its WebSocket/HTTP bridge produced a long series of stream and
      lineage bugs (for example
      [#2465](https://github.com/Soju06/codex-lb/issues/2465) and
      [#2493](https://github.com/Soju06/codex-lb/issues/2493)).
  - **Copy:** pass unknown fields and item types through byte-for-byte.
  - **Avoid:** WebSockets, and impersonating the built-in provider.
- **[anxkhn/codex-openai-proxy](https://github.com/anxkhn/codex-openai-proxy)**
  serves Responses and Chat Completions from a ChatGPT login.
  - **How it hooks in:** it imports `~/.codex/auth.json` and forwards to
    `chatgpt.com/backend-api/codex` with `ChatGPT-Account-ID` and a
    Codex-like `originator` and user agent.
  - **Lesson:** it shows which headers the ChatGPT backend expects. Taking
    over Codex's OAuth tokens is something to avoid.
- **[LiteLLM](https://docs.litellm.ai/docs/proxy/client_setup/codex_cli)**
  is the documented custom-provider gateway for Codex.
  - Its guide raises `stream_idle_timeout_ms` and retries for long turns,
    and uses `model_catalog_json` so unknown model names get real metadata.
  - **Copy** both settings into our setup docs.
- **Per-launch effort routers,
  [codex-auto-effort](https://github.com/MECMwithShawn/codex-auto-effort)
  and [auto-reasoning](https://github.com/luckeyfaraday/auto-reasoning),**
  wrap `codex exec -c model_reasoning_effort=…`.
  - They choose the effort once per process, from the first prompt.
  - codex-auto-effort's README says true per-turn effort needs upstream
    support ([openai/codex#8649](https://github.com/openai/codex/issues/8649),
    "Auto reasoning effort", still open).
  - The proxy already does better than this approach.
- **Protocol translators,
  [codex-relay](https://github.com/lihuanshuai/codex-relay) and
  [codex-universal-proxy](https://github.com/bharat2808/codex-universal-proxy),**
  convert Responses to Chat Completions for other vendors. This confirms that
  the `base_url` provider is the ecosystem's standard interception point.
- **Codex's own
  [`responses-api-proxy`](https://github.com/openai/codex/tree/rust-v0.159.0/codex-rs/responses-api-proxy)**
  forwards `POST /v1/responses` and injects an API key read from stdin. It
  is the same provider-plus-proxy pattern, endorsed upstream.

## Recommendation

Use `@reasoning-router/proxy` behind a custom `model_providers` entry with
`wire_api = "responses"` and the default `supports_websockets = false`. Do
not add a `@reasoning-router/codex` package; no in-process surface could use
one.

Limitations:

- The user runs and supervises a separate process.
- The effort the user selects in Codex is ignored.
- Lineage is in memory, so restarting the proxy loses it (restarting Codex
  does not; verified).
- `session` is null in decision events.
- ChatGPT-subscription use needs the header work below and may not accept
  `configuration_update` at all.
- Models outside the proxy registry get a local `400`.
- Sub-agents share a `prompt_cache_key` across sibling threads, which may
  create ambiguous lineage branches. Unverified.
- Codex's internal compaction requests also go through the proxy and are
  classified. Unverified.

Smallest first slice, API keys only:

1. **Setup docs:** done in the "Codex CLI" section of
   [`packages/proxy/README.md`](../../packages/proxy/README.md). Codex's own
   stream idle timeout defaults to 300 s, so the proxy's 60 s
   `REASONING_ROUTER_UPSTREAM_IDLE_TIMEOUT_MS` is the limit to raise.
2. **Regression fixtures:** captured Codex 0.159.0 requests (standard and
   Responses Lite, plus a tool-call continuation) as proxy tests. Codex
   changes its body shape most weeks, and this is where codex-lb broke.
3. **Session ID:** read Codex's `session-id` header as the decision-log
   session, so events can be correlated. This is a small, Codex-agnostic
   header option, not Codex-specific code.

A second slice, if Robert wants subscription support:

- Forward an allowlist of Codex request headers upstream: `ChatGPT-Account-ID`,
  `session-id`, `originator`, `version`, and `x-codex-*`.
- Pass back `x-codex-turn-state` and the rate-limit response headers.
- Verify `configuration_update` and cache hits on
  `chatgpt.com/backend-api/codex` with a live account.

## Open questions for Robert

- **ChatGPT subscriptions:** is routing ChatGPT-subscription traffic through
  the proxy in scope? It needs header passthrough, a live test with a real
  account, and acceptance that `chatgpt.com/backend-api/codex` is an
  undocumented, internal endpoint.
- **The user's Codex effort:** should it be ignored (current behavior), or
  act as a floor or ceiling on the classifier's choice? Codex reports it in
  `x-codex-turn-metadata`, so the proxy could read it.
- **Codex's model catalog:** should the proxy registry track it (`gpt-5.6-*`,
  `ultra`)? This ties into the open registry question in `architecture.md`.
- **Effort updates on Luna and Sol:** before the proxy relies on them for
  `gpt-6-luna` and `gpt-6-sol`, should we measure whether these models apply
  a mid-conversation update
  ([openai/codex#47843](https://github.com/openai/codex/issues/47843))?
