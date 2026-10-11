# @reasoning-router/opencode

English | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md)

An [OpenCode](https://opencode.ai) V2 plugin that asks a classifier how much
reasoning each step needs, then applies that effort to the outgoing model
request without breaking the prompt cache. Every classifier in
[`@reasoning-router/classifiers`](../classifiers) is available.

> **Alpha.** OpenCode installs the plugin from npm by package name; list it
> under `plugins` as shown below.

Ported from
[`opencode-jev-router`](https://github.com/robertn702/opencode-jev-router).

## Requirements

- OpenCode V2 2.0.4 or newer (smoke-tested with 2.0.18).
- Whatever the chosen classifier needs (a key, or a server you run); see
  [classifiers](../classifiers/README.md).
- A Responses API endpoint serving GPT-6 Astra, Luna, or Sol, or an Anthropic
  Messages endpoint with the mid-conversation output-config beta.

## Usage

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [{ "package": "@reasoning-router/opencode", "options": {
    "classifier": { "provider": "jev", "apiKey": "{env:REASONING_ROUTER_CLASSIFIER_API_KEY}" },
    "wrap": { "openai": ["openai/gpt-6-astra"] },
    "decisionsLogPath": "/tmp/reasoning-decisions.jsonl"
  }}],
  "model": "reasoning-router/gpt-6-astra"
}
```

The plugin registers `reasoning-router/<profile>` aliases only for the source
models listed in `wrap` (`openai` and/or `anthropic` arrays of
`provider/model` refs). Source models are left untouched. Each primary request
to an alias gets one classification; if the classifier fails, the request
continues at the fallback effort (`high` by default). With
`decisionsLogPath`, each routed request appends a metadata-only
`ReasoningDecision` event that records the deciding `classifier`.

For OpenAI Decisions (public beta), replace the `classifier` block with:

```jsonc
"classifier": { "provider": "openai-decisions", "apiKey": "{env:REASONING_ROUTER_CLASSIFIER_API_KEY}" }
```

See [`examples/opencode.jsonc`](../../examples/opencode.jsonc) for a full
example.

## Options

| Option | Default | Purpose |
| --- | --- | --- |
| `classifier.provider` | `REASONING_ROUTER_CLASSIFIER` env, then `jev` | Classifier provider name, such as `jev` (see [classifiers](../classifiers/README.md)). |
| `classifier.apiKey` | `REASONING_ROUTER_CLASSIFIER_API_KEY` env | Classifier key, if the provider needs one (not needed when `fixedEffort` is set). |
| `classifier.baseUrl` | `REASONING_ROUTER_CLASSIFIER_BASE_URL` env, then the provider default | Classifier endpoint; defaults to the provider's. |
| `classifier.accountId` | `REASONING_ROUTER_CLASSIFIER_ACCOUNT_ID` env | Account ID, for providers that take one. |
| `classifier.model` | `REASONING_ROUTER_CLASSIFIER_MODEL` env | Classifier model, for providers that take one. |
| `classifier.timeoutMs` | `4000` | Total classification budget, including retries. |
| `wrap` | none | Required nonempty object of `openai`/`anthropic` source refs. |
| `decisionsLogPath` | off | Absolute path for `ReasoningDecision` JSONL. |
| `baseEffort` | profile default | Request-level effort reported by responses. |
| `fixedEffort` | none | Skip the classifier and always use this effort. |
| `maxRetries` | `1` | Extra attempts after transient classifier errors. |
| `fallbackMode` | `fixed` | `fixed`, `previous`, or `error`. |
| `fallbackEffort` | `high` | Effort used when classification fails. |
| `maxRequestBytes` | `33554432` | Largest request body. |
| `maxInFlight` | `32` | Concurrent requests. |
| `upstreamHeaderTimeoutMs` | `10000` | Wait for endpoint response headers. |
| `upstreamIdleTimeoutMs` | `60000` | Longest gap between streamed chunks. |

Wire behavior, logging, and limits are documented in
[`docs/behavior.md`](../../docs/behavior.md) and
[`docs/classification-policy.md`](../../docs/classification-policy.md).

## License

[MIT](LICENSE)
