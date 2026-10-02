# Hermes Agent

Status: initial investigation for
[#12](https://github.com/robertn702/reasoning-router/issues/12). Findings,
a recommended integration path, and open questions. Nothing is implemented.

[Hermes Agent](https://github.com/NousResearch/hermes-agent) (Nous Research)
is a Python agent that runs one agent core behind a CLI, a TUI, a desktop
app, and a messaging gateway. It talks to many providers through its own
transports and is extended mainly through plugins and skills.

## Sources and versions

- **Source:** `main` at [`4e3fcd5`][src] (2026-10-02, `rc.35-v0.21.5`+13).
  The links below point at that commit.
- **Run locally:** Hermes Agent v0.21.5 (git install, release
  `v2026.9.24`). The runs used a temporary `HERMES_HOME`, a local stub
  upstream, and no credentials. The Hermes install and the user's
  `~/.hermes` were not changed.
- **Labels:** each claim is marked **verified** (run locally),
  **source** (read in the code or docs), or **unverified** (reported
  elsewhere and not checked).

## Extension point

### Mechanism

Hermes gives us two mechanisms:

1. **In-process plugin middleware.** A plugin is a directory with a
   `plugin.yaml` and an `__init__.py` that defines `register(ctx)`, or a pip
   package. It calls `ctx.register_middleware(kind, callback)`. Of the four
   middleware kinds, two matter here ([`middleware.py#L19-L26`][mw-kinds],
   [middleware docs][mw-docs]):
   - **`llm_request`** returns `{"request": {...}}`, which replaces the
     provider kwargs before the provider call. It runs once per attempt, in
     `build_api_request`, after Hermes builds the request and before the
     `pre_api_request` hook ([`turn_api_request.py#L142-L164`][turn-req]).
   - **`llm_execution`** wraps the provider call with a `next_call`
     callback ([`turn_api_call.py#L122-L140`][turn-call]).

   The observer hooks (`pre_llm_call`, `pre_api_request`,
   `post_api_request`, `on_stream_*`) cannot change the request
   ([`plugins.py#L109-L124`][hooks]).
2. **Provider configuration.** A named entry under `providers:` (or the
   `custom` provider) sets `base_url`, `api_key`, and `api_mode`. `api_mode`
   is `chat_completions`, `codex_responses`, or `anthropic_messages`
   ([`cli-config.yaml.example#L250-L274`][cfg-providers]). This is enough to
   point Hermes at the standalone proxy.

**Verified:** a probe plugin's `llm_request` middleware changed
`reasoning_effort` from `high` to `low` on the wire for a `chat_completions`
request. Separately, a named provider with `api_mode: codex_responses` sent
its requests through `@reasoning-router/proxy` unchanged. The proxy accepted
them and inserted a `configuration_update` item.

### Visibility

- **Request body (verified):** `llm_request` receives the real, deep-copied
  provider kwargs (`model`, `messages` or Responses `input`/`instructions`,
  `tools`, the reasoning fields, `extra_body`, `extra_headers`). These
  contain the full conversation, including tool results. Two exceptions:
  - The kwargs contain no `stream` or `stream_options`; Hermes adds them
    later, inside the call.
  - The observer `pre_api_request` gets a sanitized copy instead, capped at
    `HERMES_PLUGIN_PAYLOAD_MAX_CHARS` (50,000 by default) with secrets
    redacted ([`api_request_hooks.py#L52-L140`][hook-payload]).
- **Context (verified):** each callback also receives:
  - `session_id` (for example `20261002_195326_ec5062`)
  - `turn_id`
  - `api_call_count`, which is **1** on a turn's first request, not 0
  - `api_request_id`, `task_id`, `provider`, `model`, `base_url`,
    `api_mode`, and `platform`
- **Credentials (verified):** none. There is no `api_key` in the kwargs; it
  lives on the SDK client.
- **Auxiliary calls (source, verified for titling):** calls such as titling,
  compression, vision, and MoA skip the main-loop middleware
  ([`agent/AGENTS.md`][agent-agents]). They only fire the observer hooks
  `pre_auxiliary_call` and `post_auxiliary_call`. The titling call went to
  the same endpoint with `reasoning_effort: "none"` and was not routed.
- **Through the proxy (verified):**
  - The proxy sees every request sent to the configured provider,
    auxiliary calls included.
  - Hermes sends a per-session `prompt_cache_key` (`pck_…`) on Responses
    requests.
  - It sends its session ID in a header only when `session_affinity_header`
    is set ([`cli-config.yaml.example#L187-L195`][cfg-affinity]).
  - It sends no turn ID.

### Control

- **Rewrite (verified):** `llm_request` can replace any field, including
  `model`, the reasoning fields, `input`/`messages`, and headers
  (`extra_headers`).
- **Effort parameter (source):** Hermes has no per-request effort API. The
  middleware edits the wire field for each `api_mode` directly:

  | `api_mode` | Effort field | Source |
  | --- | --- | --- |
  | `chat_completions` | top-level `reasoning_effort`, or provider-specific `extra_body` | **verified**; [`chat_completions.py#L489-L505`][cc-effort] |
  | `codex_responses` | `reasoning: {effort, summary}` | **verified**; [`codex.py#L281-L331`][codex-effort] |
  | `anthropic_messages` | `thinking: {type: "adaptive"}` plus `output_config.effort` on newer models; `budget_tokens` on older ones | [`anthropic_adapter.py#L585-L601`][anth-effort] |

  The user's level comes from `agent.reasoning_effort`, the `/reasoning`
  command, or `agent.reasoning_overrides`. Hermes clamps it to the
  vocabulary of the model's route before the middleware runs.
- **Reject:** no supported way. Both middleware kinds fail open
  ([`plugins_dispatch.py#L591-L602`][invoke-mw],
  [`middleware.py#L204-L212`][exec-chain]):
  - If a callback raises, Hermes logs a warning and sends the request
    unchanged.
  - An `llm_execution` callback could return a synthetic response instead
    of calling `next_call`, but that is undocumented for this purpose.
    **Unverified.**
- **Several middleware plugins (source):** when two plugins register
  `llm_request`, each callback receives the original request and only the
  last result is kept ([`middleware.py#L63-L85`][req-chain]). This is
  [#128638] (open), with a fix in [#128643] (open). Until that fix lands,
  our plugin and another router such as Switchyard would overwrite each
  other.
- **Retries and fallback (source):** `build_api_request` runs again for
  every retry and for every fallback provider, so `llm_request` fires on
  each attempt. A plugin must cache its decision by
  `(turn_id, api_call_count)`, or it classifies again on every retry.

### Streaming

- **Plugin (verified):** `llm_execution` receives the response only after
  Hermes has consumed the stream: an assembled object that includes
  `usage`. It does not sit on the token path, and nothing is buffered on
  our behalf.
  - The `on_stream_*` hooks receive normalized text only, and cannot
    change it.
  - `post_api_request` reports normalized usage, including
    `cache_read_tokens` and `cache_write_tokens`
    ([`usage_pricing.py#L66-L77`][usage]).
  - That is enough for decision logs and cache lineage. Raw SSE bytes are
    not available.
- **Proxy:** streams the response unchanged, as for OpenCode.

### Auth

- **Plugin:** never sees credentials. Hermes's own client sends the
  rewritten request, so the plugin works with every provider and login
  Hermes supports, including the OAuth-based ones (`openai-codex` against
  `chatgpt.com/backend-api/codex`, Nous Portal, Copilot). **Source**; not
  tested with a real login.
- **Proxy (verified):** Hermes sends a named provider's `api_key` as
  `Authorization: Bearer`, and the proxy's `forward` policy passes it
  upstream. Subscription logins are a different matter (**unverified**):
  - Hermes's built-in OAuth providers carry their own base URL and auth.
  - Routing them through the proxy would mean overriding that base URL.
  - We did not check whether Hermes allows the override, or whether those
    endpoints would accept the rewritten body.

### Stability

- **Middleware (source):**
  - Documented in [developer-guide/middleware.md][mw-docs], with a schema
    version (`hermes.middleware.v1`).
  - Covered by the native plugin compatibility contract ([plugins
    docs][plugin-contract]): documented hooks and `ctx` methods change only
    additively, payloads are keyword-based, and unknown manifest fields are
    ignored.
  - Internal module paths are not API. Patching core functions is refused
    at catalog admission.
- **Maturity:** the middleware is young.
  - jev-effort-router requires Hermes `>=0.21.4`
    ([catalog entry][catalog-jev]).
  - In June 2026, [#41190] reported `llm_request` as not yet wired into the
    loop. **Unverified** when that changed.
  - Open bugs remain: [#128638] (chaining), and [#131257] (a warning on
    every load for the `provides_middleware` manifest field, which
    `hermes plugins validate` requires).
- **Release cadence:** Hermes releases are dated (`v2026.9.24`,
  `v2026.9.21`, …) and arrive about weekly, with daily canaries.
- **Provider config (source):** `providers:` with `api_mode` is documented
  user configuration and is less likely to change than plugin internals.

### Distribution

- **Plugin (source):**
  - Either a directory in `$HERMES_HOME/plugins/<name>/`, or a pip package
    exposing the `hermes_agent.plugins` entry point
    ([`plugins_discovery.py#L29`][entrypoints],
    [plugins docs][plugin-pip]).
  - Users enable it with `hermes plugins enable <name>` (**verified**).
  - The community catalog (`plugin-catalog/*.yaml`) pins a repo and commit
    SHA, and lists the hooks and middleware the plugin provides.
  - Hermes policy wants third-party integrations shipped as standalone
    plugin repos, not merged into Hermes ([`AGENTS.md`][root-agents]).
  - **Unverified:** the install scanner reportedly flags routers that send
    conversation text off-machine as "context exfiltration", so users must
    install with `--force`.
  - A Hermes plugin is Python. It cannot be an npm package and cannot
    import `@reasoning-router/core`.
- **Proxy:** nothing to install in Hermes. Users add a named provider in
  `config.yaml` and run `reasoning-router`.

### Wire APIs and models

- **Wire APIs (source):** a provider profile chooses each request's
  `api_mode`:
  - `chat_completions` is the default for `custom`, OpenRouter, Ollama
    Cloud, and most OpenAI-compatible providers.
  - `codex_responses` is used by OpenAI, `openai-codex`, Router, Meta, or
    any provider configured with `api_mode: codex_responses`.
  - `anthropic_messages` is used by Anthropic and Anthropic-compatible
    providers.
  - Hermes also has `bedrock_converse`, a native Gemini transport, and a
    Codex app-server transport. The app-server transport is JSON-RPC to the
    `codex` CLI; we did not check whether middleware applies to it.
- **Tested shapes (verified):**
  - **Chat Completions:** `messages`, `tools`, a top-level
    `reasoning_effort`, `stream: true`, and
    `stream_options.include_usage`.
  - **Responses:** `instructions`, array `input`, `reasoning.effort` and
    `summary`, `store: false`, `include: ["reasoning.encrypted_content"]`,
    `prompt_cache_key`, `parallel_tool_calls`, and `tool_choice`.
  - **Not tested:** Anthropic Messages. Its transport needs the optional
    `anthropic` extra, and installing it would have changed the shared
    Hermes install.
- **Prompt cache:** Hermes treats its per-conversation prompt cache as an
  invariant. The system prompt stays byte-stable, and the only sanctioned
  cache break is compression ([`agent/AGENTS.md#L56`][agent-agents]).
  Mid-conversation effort changes affect each wire API differently:
  - **Responses:** the core's existing rewrite applies. The request-level
    effort stays fixed and a `configuration_update` item carries the
    selected effort (verified that the proxy does this to Hermes's
    request). The cache effect was not measured again here.
  - **Chat Completions:** has no mid-conversation item. The only lever is
    the top-level `reasoning_effort`. **Unverified:** whether changing it
    between requests keeps the OpenAI or OpenRouter prefix cache. Hermes
    sends the field on every `custom` request ([#72649]).
  - **Anthropic Messages:** the core inserts an effort-only system message.
    Hermes adds its own `cache_control` breakpoints. Changing `thinking` or
    `output_config` per request instead would, according to Anthropic's
    prompt-caching docs, invalidate message-level cache breakpoints
    (**unverified** here).
  - **Model switches:** changing the model, as jev-effort-router does,
    always discards the cache.

## Existing solutions

Hermes has no built-in automatic effort routing. `/reasoning` and `/model`
are manual and last for the whole session. Its keyword-based
`smart_model_routing` (cheap model for short turns) was removed in
[#12732] (April 2026). [#13663], a request for smart `reasoning_effort`
routing, is closed; we did not determine what shipped. [#41190], a
plugin route selector for per-turn model overrides, was closed as not
planned.

| Project | Hook | What it does | Problems |
| --- | --- | --- | --- |
| [jev-effort-router] (0.2.1, catalog-listed) | `llm_request` + `post_llm_call` + `on_session_end` | Jev (via OpenRouter) picks model **and** effort once per user turn; writes both `reasoning_config` and `reasoning_effort` | Chat Completions on `ollama-cloud` only; leaves Responses/Messages untouched; scanner flags it; manifest warning [#131257] |
| [hermes-switchyard] (0.5.6, catalog-listed) | `pre_llm_call`, `llm_request`, `post_tool_call`, `transform_llm_output` | Lowers effort below the user's `/reasoning` level (a ceiling), never switches model; trivial turns decided locally; appends a `Reasoning: high→low` receipt | Bundles many unrelated features; collides with another `llm_request` plugin until [#128643] |
| [ClawRouter] (6.6k stars) | `custom` provider `base_url` → local proxy | Per-request **model** routing via virtual models (`blockrun/auto`) | Model-only, no effort; billing tied to x402/USDC; wire API and effort handling unverified |

The table is from the subagent survey and the plugins' catalog entries.
The catalog entries were read locally; the READMEs and issue states were
checked through the GitHub API.

**Copy:**

- Decide on a turn's first request and replay that decision on later tool
  loop requests and retries. Key it on `turn_id`.
- Fail open, and leave the body byte-identical on any error.
- Treat the user's `/reasoning` level as a ceiling.
- Show the effort actually sent.
- Keep a per-model table of allowed efforts, and omit the field rather than
  send a value that causes a 400.

**Avoid:**

- Routing only one provider.
- Switching models mid-session, which breaks the cache.
- Depending on `llm_request` ordering while [#128638] is open.
- Sending the top-level `reasoning_effort` to endpoints that reject unknown
  fields ([#72649]: LiteLLM returns a non-retryable 400 since Hermes
  v0.19.0).

## Recommendation

**Use the standalone proxy for Hermes now, with no new adapter package.**
A Hermes-native plugin is a later option; see the open questions.

Reasons:

- Hermes can already send Responses (and, per the source, Messages)
  requests to any base URL through a named provider with an explicit
  `api_mode`. The proxy accepted a real Hermes Responses request unchanged
  and applied the cache-preserving rewrite (verified).
- An in-process adapter would have to be Python. It would reimplement
  validation, rewriting, lineage, the classifier client, and logging
  outside `@reasoning-router/core`. That is a second implementation to keep
  at parity, which [`docs/architecture.md`](../architecture.md) tries to
  avoid.
- The Hermes middleware is documented but young: it has an open chaining
  bug, a manifest warning, and was wired in only recently.

Example configuration (verified with a stub upstream):

```yaml
model:
  default: gpt-6-sol
  provider: reasoning-router
providers:
  reasoning-router:
    base_url: http://127.0.0.1:4320/v1   # REASONING_ROUTER_PORT
    api_mode: codex_responses
    api_key: ${OPENAI_API_KEY}           # forwarded upstream
```

### Limitations

- **Subscription logins:** API-key providers only. Hermes's OAuth
  providers (ChatGPT/Codex, Nous Portal, Copilot) are unverified behind
  the proxy and probably unsupported.
- **Wire APIs:** Responses and Messages only. Most Hermes providers default
  to Chat Completions, which the proxy does not serve, and the proxy's
  model registry lists only the GPT-6 and Claude models it supports.
- **Auxiliary calls:** titling, compression, and the other auxiliary calls
  reach the proxy and are classified like main-loop steps, which adds
  latency and classifier cost. Users can pin `auxiliary.*` to a direct
  provider. The proxy cannot distinguish auxiliary calls by itself.
- **The user's effort:** the user's `agent.reasoning_effort` and
  `/reasoning` are overridden. In the probe, Hermes sent `high`, and the
  proxy sent the base effort (`medium`) plus its own selection.
- **Session correlation:** the proxy accepts
  `x-reasoning-router-session-id` only in OpenCode's `ses_…` format
  ([`server.ts`](../../packages/proxy/src/server.ts)). Hermes session IDs
  (`20261002_195519_ddd798`) are dropped even with
  `session_affinity_header` set, so lineage falls back to Hermes's
  `prompt_cache_key` (verified: `session: null` in the decision log).
  There is no turn ID either.
- **Rejections:** the proxy's local `400`s are shown to the user as provider
  errors. Hermes classifies them as non-retryable and may then try its
  fallback providers (verified: the message was "custom rejected the
  request and retrying won't help").

### Smallest first slice

1. Capture a real multi-request Hermes Responses turn: user message, tool
   call, tool result, and final answer. Add it as a proxy test fixture
   that checks validation, the `configuration_update` placement, and
   lineage replay across the tool loop.
2. Accept Hermes session IDs in `x-reasoning-router-session-id`, by
   widening the pattern or adding a second one, so that Hermes's
   `session_affinity_header` gives the proxy a real session.
3. Add a "Hermes Agent" section to the proxy README with the configuration
   above and the limitations.

No new package, and no change to the core's contract.

## Open questions for Robert

1. **Plugin vs. proxy long term.** Should we ever ship a Hermes-native
   plugin? It would be a Python package on PyPI, outside the npm
   workspaces and the package list in `AGENTS.md`. It would be either a
   full port, or a thin shim that only adds session and turn headers via
   `llm_request` and points at the proxy. The shim keeps one
   implementation but still needs the proxy running.
2. **Chat Completions in the proxy.** Most Hermes providers use it. It
   has no mid-conversation effort item, so effort can only change through
   the top-level `reasoning_effort`, and its cache cost is unmeasured.
   Should we measure it before deciding?
3. **User effort semantics.** Should Hermes's `/reasoning` level stay
   overridden (current proxy behavior) or act as a ceiling, as Switchyard
   does? This would also apply to other harnesses.
4. **Auxiliary traffic.** Should the proxy classify auxiliary calls,
   bypass them by a header or heuristic, or should we tell users to pin
   auxiliary providers?
5. **Anthropic path.** Is it worth installing the `anthropic` extra in a
   throwaway Hermes install to verify `anthropic_messages` through the
   proxy before documenting it?

[src]: https://github.com/NousResearch/hermes-agent/tree/4e3fcd5cd7e40c37cb6f9a21a76fc57a7361957a
[mw-kinds]: https://github.com/NousResearch/hermes-agent/blob/4e3fcd5cd7e40c37cb6f9a21a76fc57a7361957a/hermes_cli/middleware.py#L19-L26
[req-chain]: https://github.com/NousResearch/hermes-agent/blob/4e3fcd5cd7e40c37cb6f9a21a76fc57a7361957a/hermes_cli/middleware.py#L63-L85
[exec-chain]: https://github.com/NousResearch/hermes-agent/blob/4e3fcd5cd7e40c37cb6f9a21a76fc57a7361957a/hermes_cli/middleware.py#L204-L212
[mw-docs]: https://github.com/NousResearch/hermes-agent/blob/4e3fcd5cd7e40c37cb6f9a21a76fc57a7361957a/website/docs/developer-guide/middleware.md
[turn-req]: https://github.com/NousResearch/hermes-agent/blob/4e3fcd5cd7e40c37cb6f9a21a76fc57a7361957a/agent/turn_api_request.py#L142-L164
[turn-call]: https://github.com/NousResearch/hermes-agent/blob/4e3fcd5cd7e40c37cb6f9a21a76fc57a7361957a/agent/turn_api_call.py#L122-L140
[hooks]: https://github.com/NousResearch/hermes-agent/blob/4e3fcd5cd7e40c37cb6f9a21a76fc57a7361957a/hermes_cli/plugins.py#L109-L124
[invoke-mw]: https://github.com/NousResearch/hermes-agent/blob/4e3fcd5cd7e40c37cb6f9a21a76fc57a7361957a/hermes_cli/plugins_dispatch.py#L591-L602
[hook-payload]: https://github.com/NousResearch/hermes-agent/blob/4e3fcd5cd7e40c37cb6f9a21a76fc57a7361957a/agent/api_request_hooks.py#L52-L140
[cc-effort]: https://github.com/NousResearch/hermes-agent/blob/4e3fcd5cd7e40c37cb6f9a21a76fc57a7361957a/agent/transports/chat_completions.py#L489-L505
[codex-effort]: https://github.com/NousResearch/hermes-agent/blob/4e3fcd5cd7e40c37cb6f9a21a76fc57a7361957a/agent/transports/codex.py#L281-L331
[anth-effort]: https://github.com/NousResearch/hermes-agent/blob/4e3fcd5cd7e40c37cb6f9a21a76fc57a7361957a/agent/anthropic_adapter.py#L585-L601
[usage]: https://github.com/NousResearch/hermes-agent/blob/4e3fcd5cd7e40c37cb6f9a21a76fc57a7361957a/agent/usage_pricing.py#L66-L77
[cfg-providers]: https://github.com/NousResearch/hermes-agent/blob/4e3fcd5cd7e40c37cb6f9a21a76fc57a7361957a/cli-config.yaml.example#L250-L274
[cfg-affinity]: https://github.com/NousResearch/hermes-agent/blob/4e3fcd5cd7e40c37cb6f9a21a76fc57a7361957a/cli-config.yaml.example#L187-L195
[agent-agents]: https://github.com/NousResearch/hermes-agent/blob/4e3fcd5cd7e40c37cb6f9a21a76fc57a7361957a/agent/AGENTS.md#L56
[root-agents]: https://github.com/NousResearch/hermes-agent/blob/4e3fcd5cd7e40c37cb6f9a21a76fc57a7361957a/AGENTS.md
[plugin-contract]: https://github.com/NousResearch/hermes-agent/blob/4e3fcd5cd7e40c37cb6f9a21a76fc57a7361957a/website/docs/developer-guide/plugins/index.md#native-plugin-compatibility-contract
[plugin-pip]: https://github.com/NousResearch/hermes-agent/blob/4e3fcd5cd7e40c37cb6f9a21a76fc57a7361957a/website/docs/developer-guide/plugins/index.md
[entrypoints]: https://github.com/NousResearch/hermes-agent/blob/4e3fcd5cd7e40c37cb6f9a21a76fc57a7361957a/hermes_cli/plugins_discovery.py#L29
[catalog-jev]: https://github.com/NousResearch/hermes-agent/blob/4e3fcd5cd7e40c37cb6f9a21a76fc57a7361957a/plugin-catalog/jev-effort-router.yaml
[jev-effort-router]: https://github.com/AlphaPerseii3000/jev-effort-router
[hermes-switchyard]: https://github.com/bgrablin/hermes-switchyard
[ClawRouter]: https://github.com/BlockRunAI/ClawRouter
[#12732]: https://github.com/NousResearch/hermes-agent/pull/12732
[#13663]: https://github.com/NousResearch/hermes-agent/issues/13663
[#41190]: https://github.com/NousResearch/hermes-agent/issues/41190
[#72649]: https://github.com/NousResearch/hermes-agent/issues/72649
[#128638]: https://github.com/NousResearch/hermes-agent/issues/128638
[#128643]: https://github.com/NousResearch/hermes-agent/pull/128643
[#131257]: https://github.com/NousResearch/hermes-agent/issues/131257
