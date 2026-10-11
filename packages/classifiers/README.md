# @reasoning-router/classifiers

English | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md)

The reasoning-effort classifiers for reasoning-router. Each one asks a decision
model one `choice` question, limited to the target model's supported efforts,
over plain `fetch`. OpenAI Decisions uses its own request format.

Select one with `provider` in a `classifier` config block.

## Jev (`provider: "jev"`)

[Jev](https://typesafe.ai/), through TypeSafe or Vercel AI Gateway.

| Field | Default | Purpose |
| --- | --- | --- |
| `apiKey` | none | TypeSafe key, or a Vercel AI Gateway key. Required. |
| `baseUrl` | `https://api.typesafe.ai` | Set to `https://ai-gateway.vercel.sh/typesafe` for a Vercel key. No other values are accepted. |
| `model` | the endpoint's model | Optional. Must be `jev-latest` for TypeSafe or `typesafe-ai/jev` for Vercel. |
| `timeoutMs` | `4000` | Total classification budget, including retries. |

The key is not inspected and the endpoint is not detected automatically, so
`baseUrl` must match the credential.

## Clef (`provider: "clef"`)

Cloudflare's [Clef](https://developers.cloudflare.com/workers-ai/models/clef/),
on Workers AI.

| Field | Default | Purpose |
| --- | --- | --- |
| `apiKey` | none | Cloudflare API token with Workers AI permissions. Required. |
| `accountId` | none | Cloudflare account ID. Required. |
| `model` | none | `clef`, `clef-omni`, or `clef-flash`. Required. |
| `timeoutMs` | `4000` | Total classification budget, including retries. |

The key is used with the account ID to call Workers AI at
`https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/run/@cf/cloudflare/{model}`.
`baseUrl` is ignored.

## Laya (`provider: "laya"`)

[Laya](https://huggingface.co/convaiinnovations/laya), an open-source
Jev-compatible model served by a Laya server that you run, such as `laya-serve`. This package only
calls it over HTTP.

| Field | Default | Purpose |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:8000` | Laya server. HTTPS, or plain HTTP to a loopback host only. |
| `apiKey` | none | Optional; set only when the server sets `LAYA_API_KEY`. |
| `model` | server's choice | Optional checkpoint: `english`, `multilingual`, or `typed-decisions`. When unset, the server chooses by the language of the state. |
| `timeoutMs` | `4000` | Total classification budget, including retries. |

Calls `{baseUrl}/v1/systemone`. The key is sent as a bearer token; a blank key
counts as unset.

## Kev (`provider: "kev"`)

[Kev](https://github.com/jaredpalmer/kev), an open-source Jev-compatible
family of decision models served by a `kev.serve` server that you run. This
package only calls it over HTTP.

| Field | Default | Purpose |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:8008` | Kev server. HTTPS, or plain HTTP to a loopback host only. |
| `apiKey` | none | Optional; set only when the server sets `KEV_API_KEY`. |
| `model` | none | Optional. Only echoed back; the server picks the checkpoint at startup (`--run`). |
| `timeoutMs` | `4000` | Total classification budget, including retries. |

Calls `{baseUrl}/v1/systemone`, with the same key rules as Laya (a bearer
token; a blank key counts as unset). See
[the Kev proposal](../../docs/proposals/kev.md).

## OpenAI Decisions (`provider: "openai-decisions"`)

Calls OpenAI's Decisions API. Users bring an OpenAI API key with Decisions
access.

| Field | Default | Purpose |
| --- | --- | --- |
| `apiKey` | none | OpenAI API key. Required. |
| `baseUrl` | `https://api.openai.com/v1` | Also accepts `https://us.api.openai.com/v1` or `https://eu.api.openai.com/v1`. No other values are accepted. |
| `model` | `gpt-6-luna` | Only accepted value: `gpt-6-luna`. Independent of the target generation model. |
| `timeoutMs` | `4000` | Total classification budget, including retries. |

The provider calls `POST {baseUrl}/decisions`. The bounded classifier state is
JSON text in `input`; a `choice` question named `effort` offers only the target
model's supported efforts, with the existing effort descriptions. Answers are
matched by name. Refusals, missing or duplicate answers, non-choice answers,
and unsupported efforts fall back as `classifier_invalid_output`. Authentication
errors are not retried; 429 and 5xx responses retry within the deadline,
honoring `Retry-After`. Client cancellation aborts without fallback.

OpenAI receives the same bounded summary as other classifiers: recent user
text, assistant progress, up to 8 tool results, a failure summary, and the
target model ID. Zero Data Retention and residency depend on project
eligibility; see [OpenAI's data guide](https://developers.openai.com/api/docs/guides/your-data).
The `us.` and `eu.` endpoints need a project or organization that meets
OpenAI's regional requirements (for `eu.`, Modified Abuse Monitoring or Zero
Data Retention); otherwise requests fail and the router falls back.
The API is public beta; `gpt-6-luna` is the only supported model. Pricing,
checked 2026-10-07, is $0.10 per 1M input tokens with no output or cache
charges; regional premiums and long-context multipliers can apply. Recheck
[OpenAI pricing](https://developers.openai.com/api/docs/pricing).

Verification used mocked HTTP contract tests only; no live or authenticated
calls were made, so live compatibility is unverified. OpenAI's claim of about
10x lower latency than the Responses API is its own and was not measured
under the router's deadline. Effort-selection quality has not been evaluated
against labeled coding-agent decisions, so Jev remains the default.

The [Decisions guide](https://developers.openai.com/api/docs/guides/decisions)
was checked 2026-10-07. Request and response types came from the `openai`
npm package 7.30.0 (`src/resources/decisions.ts`, generated from OpenAI's
OpenAPI spec); no `/v1/decisions` API reference page was published then.
Regional URLs come from the data controls guide, checked the same day. See
[issue #33](https://github.com/robertn702/reasoning-router/issues/33).

## CLM (`provider: "clm"`)

[CLM](https://github.com/Contrastive-LM/CLM), served by a `clm-serve` server
that you run. `clm-serve` needs a separate pooling backend (Qwen3-8B
embeddings, for example vLLM) that you also run. This package only calls
`clm-serve` over HTTP. See [docs/classifiers/clm.md](../../docs/classifiers/clm.md)
for the pinned version and limits. Only API compatibility is verified, not
effort-decision quality.

| Field | Default | Purpose |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:8700` | CLM server. HTTPS, or plain HTTP to a loopback host only. |
| `apiKey` | none | Optional; set only when the server sets `CLM_API_KEY`. |
| `model` | server's `clm-latest` | Optional CLM head: `clm-latest`, `clm-raw`, or a head loaded with `--model NAME=PATH`. |
| `timeoutMs` | `4000` | Total classification budget, including retries. |

Calls `{baseUrl}/v1/systemone`, with the same key rules as Laya (a bearer
token; a blank key counts as unset).

## Microsoft-Decision-1 (`provider: "microsoft-decision"`)

Microsoft's [Microsoft-Decision-1](https://learn.microsoft.com/azure/foundry/foundry-models/how-to/use-foundry-models-microsoft-decision),
deployed in your own Microsoft Foundry resource. Deploy the model, then copy
the resource endpoint, deployment name, and API key from the deployment
details page.

| Field | Default | Purpose |
| --- | --- | --- |
| `baseUrl` | none | Foundry resource endpoint, e.g. `https://<resource>.services.ai.azure.com`. Required. HTTPS, without credentials, query, or fragment. |
| `apiKey` | none | The resource's API key, sent in an `api-key` header. Required. |
| `model` | none | Your deployment name, not the model name. Required. |
| `timeoutMs` | `4000` | Total classification budget, including retries. |

The provider calls `POST {baseUrl}/providers/microsoft/v1/systemone` with the
System One request: the bounded state and one `choice` question named
`effort` over the target model's supported efforts. It reads
`answers.effort.choice`; an unsupported or missing choice falls back as
`classifier_invalid_output`. Error bodies are discarded. Authentication errors
are not retried; 429 and 5xx responses retry within the deadline, honoring
`Retry-After`. Microsoft Entra ID bearer tokens are not supported, because
the router does not acquire or refresh them. Pricing was not rechecked;
see Foundry's model catalog before use.

The contract was checked against Microsoft's how-to guide on 2026-10-11 (see
[issue #64](https://github.com/robertn702/reasoning-router/issues/64)).
Verification used mocked HTTP contract tests only; no live or authenticated
calls were made. Microsoft's accuracy and latency claims are its own, and
effort-selection quality has not been evaluated, so Jev remains the default.

## Liquid d1 (`provider: "liquid"`)

[Liquid d1](https://docs.liquid.ai/lfm/models/d1), Liquid AI's hosted decision
model, through Liquid's API or Vercel AI Gateway.

| Field | Default | Purpose |
| --- | --- | --- |
| `apiKey` | none | Liquid key (`liquid_...`), or a Vercel AI Gateway key. Required. |
| `baseUrl` | `https://api.liquid.ai` | Set to `https://ai-gateway.vercel.sh/typesafe` for a Vercel key. No other values are accepted. |
| `model` | the endpoint's model | Optional. `d1` (default) or the text-only `d1:free` for Liquid; `liquid/d1` for Vercel. |
| `timeoutMs` | `4000` | Total classification budget, including retries. |

The provider calls `POST https://api.liquid.ai/decisions/v1/systemone` or
`POST https://ai-gateway.vercel.sh/typesafe/v1/systemone` with the System One
request and a bearer key, and reads `answers.effort.choice`. As with Jev, the
key is not inspected, so `baseUrl` must match the credential. An unsupported
or missing choice falls back as `classifier_invalid_output`. Error bodies are
discarded. Authentication errors are not retried; 429 and 5xx responses retry
within the deadline, honoring `Retry-After`. d1's `probabilities` and
`confidence` are ignored.

The contract was checked against Liquid's d1 guide and Vercel's TypeSafe API
page and d1 changelog on 2026-10-11 (see
[issue #68](https://github.com/robertn702/reasoning-router/issues/68)).
Verification used mocked HTTP contract tests only; no live or authenticated
calls were made. Liquid's quality claims are its own, and effort-selection
quality has not been evaluated, so Jev remains the default.

## Exports

- `classifierProviders`: every classifier, for `createConfiguredSelector` in
  [`@reasoning-router/core`](../core).
- `jevClassifierProvider`, `clefClassifierProvider`, `layaClassifierProvider`,
  `kevClassifierProvider`: each provider.
- `openAIDecisionsClassifierProvider`, `createOpenAIDecisionsTransport`,
  `resolveOpenAIDecisionsConnection`, and the `OpenAIDecisionsConnection` type.
- `clmClassifierProvider`, `createClmTransport`, `resolveClmConnection`, and
  the `ClmConnection` type.
- `microsoftDecisionClassifierProvider`, `createMicrosoftDecisionTransport`,
  `resolveMicrosoftDecisionConnection`, and the `MicrosoftDecisionConnection`
  type.
- `liquidClassifierProvider`, `createLiquidTransport`,
  `resolveLiquidConnection`, and the `LiquidConnection` type.
- `createJevClassifier`, `createJevTransport`, `createClefTransport`,
  `createLayaTransport`, `createKevTransport`, `resolveJevConnection`,
  `resolveClefConnection`, `resolveLayaConnection`, `resolveKevConnection`:
  lower-level helpers.
- `ClassifierRequestError` and the `Fetch` type, used by the transports.

## License

[MIT](LICENSE)
