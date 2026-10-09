---
"@reasoning-router/core": minor
---

Remove `ModelProfile.fallbackEffort`. It was always `medium` and never chose the effort when classification failed; the classification policy's `fallbackEffort` (default `high`) does.
