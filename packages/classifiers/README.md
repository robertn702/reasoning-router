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

## Exports

- `classifierProviders`: every classifier, for `createConfiguredSelector` in
  [`@reasoning-router/core`](../core).
- `jevClassifierProvider`, `clefClassifierProvider`: each provider.
- `createJevClassifier`, `createJevTransport`, `createClefTransport`,
  `resolveJevConnection`, `resolveClefConnection`: lower-level helpers.
- `ClassifierRequestError` and the `Fetch` type, used by the transports.

## License

[MIT](LICENSE)
