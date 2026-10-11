# Router environment namespace

The standalone proxy (`@reasoning-router/proxy`, command `reasoning-router`) reads only `REASONING_ROUTER_*`
variables; `.env.example` lists the supported names. The `JEV_ROUTER_*`,
`JEV_API_KEY`, and `JEV_BASE_URL` names used by `opencode-jev-router` are not
carried over. `TYPESAFE_API_KEY`, `JEV_ROUTER_API_KEY`, and
`JEV_ROUTER_BASE_URL` are rejected at startup with a message naming the
replacement.

## Classifier

| Variable | Default | Purpose |
| --- | --- | --- |
| `REASONING_ROUTER_CLASSIFIER` | `jev` | Classifier provider name, such as `jev` (see [classifiers](../packages/classifiers/README.md)). |
| `REASONING_ROUTER_CLASSIFIER_API_KEY` | none | Classifier credential, if the provider needs one. |
| `REASONING_ROUTER_CLASSIFIER_BASE_URL` | provider default | Classifier endpoint; defaults to the provider's. |
| `REASONING_ROUTER_CLASSIFIER_ACCOUNT_ID` | none | Account ID, for providers that take one. |
| `REASONING_ROUTER_CLASSIFIER_MODEL` | none | Classifier model, for providers that take one. |
| `REASONING_ROUTER_CLASSIFICATION_TIMEOUT_MS` | `4000` | Total classification budget, including retries. |

The [classifiers README](../packages/classifiers/README.md) lists each
provider's required settings, defaults, and setup.

The OpenCode plugin takes the same settings as its `classifier` option
(`provider`, `apiKey`, `baseUrl`, `accountId`, `model`, `timeoutMs`). Each
omitted setting except `timeoutMs` falls back to its environment variable
above. Empty `REASONING_ROUTER_CLASSIFIER_ACCOUNT_ID` and
`REASONING_ROUTER_CLASSIFIER_MODEL` values count as unset. A provider rejects a
`model` it does not support, so unset `REASONING_ROUTER_CLASSIFIER_MODEL` when
switching providers.

## Anthropic upstream

The optional `POST /v1/messages` route needs
`REASONING_ROUTER_ANTHROPIC_UPSTREAM_BASE_URL` (for example
`https://api.anthropic.com/v1`); without it the route returns 404. In
`REASONING_ROUTER_UPSTREAM_AUTH=bearer` mode also set
`REASONING_ROUTER_ANTHROPIC_UPSTREAM_API_KEY` (sent as `x-api-key`). In `forward`
mode only a loopback Anthropic upstream is allowed; client `x-api-key` and/or
`authorization` are forwarded. The plugin instead wraps an existing Anthropic
model via `wrap.anthropic` and reuses its provider's route and key.

## Migrating from opencode-jev-router

| opencode-jev-router | reasoning-router |
| --- | --- |
| `JEV_API_KEY` | `REASONING_ROUTER_CLASSIFIER_API_KEY` |
| `JEV_BASE_URL` | `REASONING_ROUTER_CLASSIFIER_BASE_URL` |
| `JEV_ROUTER_<NAME>` | `REASONING_ROUTER_<NAME>` |
| plugin `jevApiKey`, `jevBaseUrl`, `jevTimeoutMs` | plugin `classifier.apiKey`, `classifier.baseUrl`, `classifier.timeoutMs` |
