---
"@reasoning-router/proxy": patch
---

Route on the request path so a query string no longer turns a known route into a 404. Codex's `GET /v1/models?client_version=...` model catalog refresh now reaches the upstream.
