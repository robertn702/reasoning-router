---
"@reasoning-router/pi": minor
---

Route OpenAI GPT-6 models (`reasoning-router/gpt-6-sol` and others) to the `openai` provider on a Pi that sends `configuration_update` items (pi#10930), gated on `compat.supportsMidConvoEffort`. Older Pi, and Sign in with ChatGPT, are rejected with `unsupported_model`.
