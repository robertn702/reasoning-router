# Gemini Decision 1

Researched 2026-11-12 against Vercel's [announcement](https://vercel.com/changelog/gemini-decision-1-now-available-on-ai-gateway)
(published 2026-11-11), [TypeSafe API documentation](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe),
[Choice documentation](https://vercel.com/docs/ai-gateway/modalities/decision#choice),
and the live [model catalog](https://ai-gateway.vercel.sh/v1/models), which lists
`google/gemini-decision-1` as an evaluation model with `max_tokens: 0`.
These are documentation and catalog checks, not a paid inference test.

## HTTP contract

The preset reuses `createSystemOneClassifier`:

- `POST https://ai-gateway.vercel.sh/typesafe/v1/systemone` (the `/typesafe`
  base URL alone is not the request path).
- `Authorization: Bearer <Vercel AI Gateway key>` and `Content-Type: application/json`.
  Google API keys are not Gateway credentials. The API also documents OIDC
  bearer authentication; the router does not acquire or refresh tokens.
- Request: `{model: "google/gemini-decision-1", state, questions: {effort:
  {type: "choice", instructions: "Select the reasoning effort for the next model call.",
  criteria: {low: "...", medium: "...", high: "..."}}}}`.
  The actual criteria contain exactly the target model's supported efforts and
  the shared descriptions. `state` is the existing bounded text state.
- Response: `{model, answers: {effort: {type: "choice", choice: "low",
  probabilities: {low: 0.7, medium: 0.2, high: 0.1}, confidence: 0.6}},
  usage: {input_tokens: 120, output_tokens: 0}}`. Only `answers.effort.choice`
  is consumed. Probabilities, confidence, usage, and provider metadata do not
  change routing or enter decision logs.
- Validation/authentication errors use `{message, error_type}` (for example
  `authentication_error`). Credits, unknown-model, and provider failures may
  instead use `{error: {message, type}}`. The transport discards both error
  bodies and categorizes by HTTP status: 401/403 auth, 429 rate limit, other
  4xx, and 5xx. Auth errors are not retried; rate limits and server failures
  follow the existing retry policy, respecting `Retry-After` and the shared deadline.

Missing, malformed, or off-menu choices use `classifier_invalid_output` fallback.
Timeout aborts the request; client cancellation propagates without fallback.
Redirects are rejected. Endpoint validation prevents accidentally sending the
Gateway credential to another host. Logs remain metadata only.

## Configuration

OpenCode plugin options (see [example](../../examples/opencode.jsonc)):

```json
{
  "classifier": {
    "provider": "gemini-decision",
    "apiKey": "{env:REASONING_ROUTER_CLASSIFIER_API_KEY}",
    "timeoutMs": 4000
  }
}
```

Proxy and Pi:

```bash
export REASONING_ROUTER_CLASSIFIER=gemini-decision
export REASONING_ROUTER_CLASSIFIER_API_KEY="$AI_GATEWAY_API_KEY"
export REASONING_ROUTER_CLASSIFICATION_TIMEOUT_MS=4000
reasoning-router # with the usual upstream configuration
# Or: pi --model reasoning-router/claude-opus-5-5
```

`baseUrl` / `REASONING_ROUTER_CLASSIFIER_BASE_URL` may be omitted or set to
`https://ai-gateway.vercel.sh/typesafe`; `model` /
`REASONING_ROUTER_CLASSIFIER_MODEL` may be omitted or set to
`google/gemini-decision-1`. Other endpoints and models are rejected.
The key is required. Existing classifier and harness defaults remain unchanged.

## Compatibility versus quality

Mocked transport tests verify the documented HTTP contract and failure handling.
They do not establish effort-selection quality. Before recommending this preset
as a default, compare it with existing classifiers and fixed effort on the same
representative tasks, recording task success, latency, total cost, selected
efforts, and fallback rates. Live inference and paid evaluation remain opt-in;
none was performed for this integration. This preset does not change the
upstream generation model or add multimodal state, confidence thresholds,
Boolean routing, or score routing.
