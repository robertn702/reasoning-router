---
"@reasoning-router/proxy": patch
---

The proxy now matches routes on the request path and ignores the query string, so `GET /v1/models?client_version=1` (sent by Codex when it refreshes its model catalog) returns the upstream model list instead of 404. `/health`, `/ready`, `/v1/responses`, and `/v1/messages` match the same way. Unknown paths still return the same 404.
