---
"@reasoning-router/classifiers": minor
"@reasoning-router/proxy": patch
---

Add the Kev classifier (`provider: "kev"`), which calls a `kev.serve` server you run at `{baseUrl}/v1/systemone` (default `http://127.0.0.1:8008`), with Laya's connection rules. The proxy's `--help` text lists it.
