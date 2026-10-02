# @reasoning-router/classifier-jev

The [Jev](https://typesafe.ai/) classifier for reasoning-router, built on
`@typesafe-ai/sdk`. It asks Jev one choice question limited to the model's
supported efforts.

Select it with `provider: "jev"` in a `classifier` config block:

| Field | Default | Purpose |
| --- | --- | --- |
| `apiKey` | none | TypeSafe key, or a Vercel AI Gateway key. Required. |
| `baseUrl` | `https://api.typesafe.ai` | Set to `https://ai-gateway.vercel.sh/typesafe` for a Vercel key. No other values are accepted. |
| `timeoutMs` | `4000` | Total classification budget, including retries. |

Exports `jevClassifierProvider` (for `createConfiguredSelector` in
[`@reasoning-router/core`](../core)) and `createJevClassifier`.

## License

[MIT](LICENSE)
