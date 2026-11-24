---
"@reasoning-router/core": patch
"@reasoning-router/opencode": patch
"@reasoning-router/proxy": patch
---

Register `gpt-6.2-sol` (efforts low through max, base effort medium), so the OpenCode plugin and the proxy accept it on `/v1/responses` instead of returning a local `400`.
