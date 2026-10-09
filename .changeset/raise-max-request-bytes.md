---
"@reasoning-router/opencode": patch
"@reasoning-router/proxy": patch
---

Raise the default request-body limit (`maxRequestBytes` and `REASONING_ROUTER_MAX_REQUEST_BYTES`) from 1 MiB to 32 MiB. Agent sessions that read several images exceeded 1 MiB and failed with `413 request_too_large` before reaching the provider.
