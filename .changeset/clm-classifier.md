---
"@reasoning-router/classifiers": minor
"@reasoning-router/proxy": patch
---

Add the CLM classifier (`provider: "clm"`), which calls a `clm-serve` server you run at `{baseUrl}/v1/systemone` (default `http://127.0.0.1:8700`), with Laya's connection rules. The optional `model` selects the CLM head (`clm-latest` by default). The proxy's `--help` text lists it.
