---
"@reasoning-router/classifiers": minor
---

Add the Liquid d1 classifier (`provider: "liquid"`), which calls Liquid AI's d1 decision model with the System One request at Liquid's API (`https://api.liquid.ai/decisions/v1/systemone`, the default; model `d1` or `d1:free`) or Vercel AI Gateway (`baseUrl: "https://ai-gateway.vercel.sh/typesafe"`; model `liquid/d1`). `apiKey` is required.
