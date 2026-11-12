---
"@reasoning-router/classifiers": minor
"@reasoning-router/opencode": patch
"@reasoning-router/pi": patch
"@reasoning-router/proxy": patch
---

Add the opt-in `gemini-decision` classifier preset for `google/gemini-decision-1`
through Vercel AI Gateway's TypeSafe API, using a Gateway key and the existing
classification deadline, retries, cancellation, and fallback policy. Defaults
are unchanged; API compatibility is tested with mocked HTTP, while effort-selection
quality and paid inference remain unevaluated.
