---
"@reasoning-router/core": minor
"@reasoning-router/classifier-jev": patch
"@reasoning-router/opencode": patch
"@reasoning-router/proxy": patch
---

Validate configuration with Zod schemas. Core exports `parseConfig`,
`universalEffort`, `classificationPolicySchema`, and `EFFORTS`. Invalid plugin
options, proxy environment variables, and Jev settings now report every problem
in one error, one message per line, with the same messages as before.
