---
"@reasoning-router/classifiers": minor
"@reasoning-router/proxy": patch
---

Add the SemIf classifier (`provider: "semif"`), which calls a `semif-serve` server you run at `{baseUrl}/v1/systemone` (default `http://127.0.0.1:8471`), with Laya's connection rules. The server requires a `model`, so the preset always sends one (`semif-latest` by default). Upstream has not released `semif-serve` (it exists only in PR #27), so the preset was verified against a fake `fetch` only. The proxy's `--help` text lists it.
