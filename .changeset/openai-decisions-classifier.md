---
"@reasoning-router/classifiers": minor
"@reasoning-router/proxy": patch
---

Add the OpenAI Decisions classifier (`provider: "openai-decisions"`), which calls OpenAI's public-beta `POST /v1/decisions` with model `gpt-6-luna`. Base URLs are limited to the global, `us.`, and `eu.` OpenAI API roots. The proxy's `--help` lists the new provider.
