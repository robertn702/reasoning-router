---
"@reasoning-router/core": minor
"@reasoning-router/classifiers": minor
"@reasoning-router/opencode": patch
"@reasoning-router/pi": patch
"@reasoning-router/proxy": patch
---

Decision events now record the classifier model as `classifier_model` (the model the preset requested, omitted when the server chooses), alongside `classifier`.
