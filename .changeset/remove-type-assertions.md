---
"@reasoning-router/core": patch
"@reasoning-router/opencode": patch
"@reasoning-router/proxy": patch
---

Replace type assertions with runtime checks. Core exports `isEffort`, and
`classificationPolicy` accepts unvalidated option values. The OpenCode plugin
reports a non-string `classifier.provider` or `decisionsLogPath` with a clear
setup error.
