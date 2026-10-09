# @reasoning-router/classifiers

The reasoning-effort classifiers for reasoning-router. Each one asks a decision
model one System One `choice` question, limited to the target model's supported
efforts, over plain `fetch`.

Select one with `provider` in a `classifier` config block.

## Jev (`provider: "jev"`)

[Jev](https://typesafe.ai/), through TypeSafe or Vercel AI Gateway.

| Field | Default | Purpose |
| --- | --- | --- |
| `apiKey` | none | TypeSafe key, or a Vercel AI Gateway key. Required. |
| `baseUrl` | `https://api.typesafe.ai` | Set to `https://ai-gateway.vercel.sh/typesafe` for a Vercel key. No other values are accepted. |
| `model` | the endpoint's model | Optional. Must be `jev-latest` for TypeSafe or `typesafe-ai/jev` for Vercel. |
| `timeoutMs` | `4000` | Total classification budget, including retries. |

## Clef (`provider: "clef"`)

Cloudflare's [Clef](https://developers.cloudflare.com/workers-ai/models/clef/),
on Workers AI.

| Field | Default | Purpose |
| --- | --- | --- |
| `apiKey` | none | Cloudflare API token with Workers AI permissions. Required. |
| `accountId` | none | Cloudflare account ID. Required. |
| `model` | none | `clef` or `clef-flash`. Required. |
| `timeoutMs` | `4000` | Total classification budget, including retries. |

## Laya (`provider: "laya"`)

[Laya](https://huggingface.co/convaiinnovations/laya), an open-source
Jev-compatible model served by a Laya server that you run. This package only
calls it over HTTP.

| Field | Default | Purpose |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:8000` | Laya server. HTTPS, or plain HTTP to a loopback host only. |
| `apiKey` | none | Optional; set only when the server sets `LAYA_API_KEY`. |
| `model` | server's choice | Optional checkpoint, e.g. `english` or `multilingual`. |
| `timeoutMs` | `4000` | Total classification budget, including retries. |

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

## Exports

- `classifierProviders`: every classifier, for `createConfiguredSelector` in
  [`@reasoning-router/core`](../core).
- `jevClassifierProvider`, `clefClassifierProvider`, `layaClassifierProvider`,
  `kevClassifierProvider`: each provider.
- `createJevClassifier`, `createJevTransport`, `createClefTransport`,
  `createLayaTransport`, `createKevTransport`, `resolveJevConnection`,
  `resolveClefConnection`, `resolveLayaConnection`, `resolveKevConnection`:
  lower-level helpers.
- `ClassifierRequestError` and the `Fetch` type, used by the transports.

## License

[MIT](LICENSE)
