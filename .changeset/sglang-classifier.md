---
"@reasoning-router/classifiers": minor
---

Add the SGLang classifier (`provider: "sglang"`), which calls an SGLang server you run at `{baseUrl}/v1/systemone` (default `http://127.0.0.1:30000`) with an optional bearer key. SGLang requires a `model` it otherwise ignores, so an unset `model` is sent as `default`. Only API compatibility is verified, against SGLang v0.5.21's source with mocked tests; effort-decision quality is unvalidated.
