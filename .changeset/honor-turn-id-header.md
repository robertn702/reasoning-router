---
"@reasoning-router/opencode": patch
---

Log the caller's `x-reasoning-router-turn-id` (or `x-opencode-turn-id`) header as `turn_id` on primary requests, falling back to a random UUID only when the header is missing or not a UUID.
