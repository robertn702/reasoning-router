# Classification retries and fallback

Normal use defaults to one additional retry, then fixed **high** effort.
The core classifier selector (`@reasoning-router/core`) owns this policy for
every classifier provider. It retries connection failures, provider timeouts,
HTTP 429 and HTTP 5xx, as categorized by the provider. Authentication errors,
other 4xx responses, and invalid classifier output are not retried.
Providers make no retries of their own, to avoid
multiplying attempts. Exponential backoff with jitter starts at approximately 200 ms;
Retry-After is respected within the total classification deadline.

| Plugin option | CLI environment | Default |
| --- | --- | --- |
| `maxRetries` | `REASONING_ROUTER_MAX_RETRIES` | 1 (0–10 additional attempts) |
| `fallbackMode` | `REASONING_ROUTER_FALLBACK_MODE` | `fixed` |
| `fallbackEffort` | `REASONING_ROUTER_FALLBACK_EFFORT` | `high` |
| `classifier.timeoutMs` | `REASONING_ROUTER_CLASSIFICATION_TIMEOUT_MS` | 4000, total budget including backoff |

Modes: `fixed` uses the configured effort; `previous` uses the last successful
selection for the same credential/model/cache context, otherwise the configured
effort; `error` returns a local 502 `classification_failed` without starting
upstream generation. Client cancellation always aborts and never falls back.

Decision metadata includes `classifier`, `classifier_attempts` and, when falling back,
`fallback_source` (`fixed` or `previous`). Failed closed requests emit
`outcome: "classification_failed"` with no selected effort. No prompt or raw
provider error content is logged.

Rebuild before using the changed local plugin and restart OpenCode to load it.
