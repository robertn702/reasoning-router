# @reasoning-router/core

The shared, harness- and classifier-independent part of reasoning-router:
request validation, the model registry, cache-preserving effort rewrites for
Responses and Anthropic Messages, cache lineage, classifier selection with
retries and fallback, upstream forwarding helpers, usage observation, and
decision logging.

Classifiers plug in through the `Classifier` and `ClassifierProvider`
interfaces; `createConfiguredSelector` picks one from a `classifier` config
block (`provider`, `timeoutMs`, and that provider's fields). This package depends on no
classifier SDK.

Used by [`@reasoning-router/opencode`](../opencode) and the
[`@reasoning-router/proxy`](../proxy). See
[`docs/behavior.md`](../../docs/behavior.md) and
[`docs/classification-policy.md`](../../docs/classification-policy.md).

## License

[MIT](LICENSE)
