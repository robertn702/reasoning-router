---
"@reasoning-router/classifiers": minor
---

Add the Microsoft-Decision-1 classifier (`provider: "microsoft-decision"`), which calls a Microsoft Foundry deployment at `{baseUrl}/providers/microsoft/v1/systemone` with the System One request. `baseUrl` (the HTTPS resource endpoint), `apiKey` (sent in an `api-key` header), and `model` (the deployment name) are required.
