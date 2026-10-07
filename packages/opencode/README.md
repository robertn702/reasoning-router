# @reasoning-router/opencode

An [OpenCode](https://opencode.ai) V2 plugin that asks a classifier how much
reasoning each step needs, then applies that effort to the outgoing model
request without breaking the prompt cache. Every classifier in
[`@reasoning-router/classifiers`](../classifiers) (Jev, Cloudflare Clef,
and Laya) is available.

> **Alpha.** OpenCode installs the plugin from npm by package name; list it
> under `plugins` as shown below.

Ported from
[`opencode-jev-router`](https://github.com/robertn702/opencode-jev-router).

## Requirements

- OpenCode V2 2.0.4 or newer (smoke-tested with 2.0.18).
- A classifier key. For Jev: a [TypeSafe](https://typesafe.ai/) key, or a
  [Vercel AI Gateway](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe)
  key used with `baseUrl: "https://ai-gateway.vercel.sh/typesafe"`. For Clef:
  a Cloudflare Workers AI API token and account ID. For Laya: a Laya server
  you run (see [`docs/environment.md`](../../docs/environment.md)).
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

See [`examples/opencode.jsonc`](../../examples/opencode.jsonc) for a full
example.

## Options

| Option | Default | Purpose |
| --- | --- | --- |
| `classifier.provider` | `REASONING_ROUTER_CLASSIFIER` env, then `jev` | Classifier provider: `jev`, `clef`, or `laya`. |
| `classifier.apiKey` | `REASONING_ROUTER_CLASSIFIER_API_KEY` env | Classifier key. Required for `jev` and `clef` unless `fixedEffort` is set; optional for `laya`. |
| `classifier.baseUrl` | `REASONING_ROUTER_CLASSIFIER_BASE_URL` env, then the provider default | Jev endpoint, or the Laya server (default `http://127.0.0.1:8000`). |
| `classifier.accountId` | `REASONING_ROUTER_CLASSIFIER_ACCOUNT_ID` env | Clef: Cloudflare account ID. |
| `classifier.model` | `REASONING_ROUTER_CLASSIFIER_MODEL` env | Clef: `clef` or `clef-flash` (required). |
| `classifier.timeoutMs` | `4000` | Total classification budget, including retries. |
| `wrap` | none | Required nonempty object of `openai`/`anthropic` source refs. |
| `decisionsLogPath` | off | Absolute path for `ReasoningDecision` JSONL. |
| `baseEffort` | profile default | Request-level effort reported by responses. |
| `fixedEffort` | none | Skip the classifier and always use this effort. |
| `maxRetries` | `1` | Extra attempts after transient classifier errors. |
| `fallbackMode` | `fixed` | `fixed`, `previous`, or `error`. |
| `fallbackEffort` | `high` | Effort used when classification fails. |
| `maxRequestBytes` | `1048576` | Largest request body. |
| `maxInFlight` | `32` | Concurrent requests. |
| `upstreamHeaderTimeoutMs` | `10000` | Wait for endpoint response headers. |
| `upstreamIdleTimeoutMs` | `60000` | Longest gap between streamed chunks. |

Wire behavior, logging, and limits are documented in
[`docs/behavior.md`](../../docs/behavior.md) and
[`docs/classification-policy.md`](../../docs/classification-policy.md).

## License

[MIT](LICENSE)
