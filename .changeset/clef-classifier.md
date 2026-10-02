---
"@reasoning-router/classifiers": minor
"@reasoning-router/opencode": minor
"@reasoning-router/proxy": minor
---

Rename `@reasoning-router/classifier-jev` to `@reasoning-router/classifiers` and add Cloudflare Clef on Workers AI as `provider: "clef"` (`accountId`, `apiKey`, and `model`: `clef` or `clef-flash`). Classifiers now call their endpoints with plain `fetch`; `@typesafe-ai/sdk` is no longer a dependency. The proxy reads `REASONING_ROUTER_CLASSIFIER_ACCOUNT_ID` and `REASONING_ROUTER_CLASSIFIER_MODEL`, and the plugin accepts `classifier.accountId` and `classifier.model` and reads `REASONING_ROUTER_CLASSIFIER` when `classifier.provider` is omitted.

Breaking: `createJevClassifier` no longer returns the SDK `client`, the `JevClassifier` type is removed, and `Fetch` is now this package's own type.
