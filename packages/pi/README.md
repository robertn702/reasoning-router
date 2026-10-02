# @reasoning-router/pi

A [Pi](https://pi.dev) extension that asks a classifier how much reasoning
each Claude request needs and lets Pi place that effort without breaking the
prompt cache. Requires Pi 1.0.0 or later and Node.js 24.x.

## Usage

```bash
export REASONING_ROUTER_CLASSIFIER_API_KEY=your-jev-key
pi install npm:@reasoning-router/pi
pi --model reasoning-router/claude-opus-5-5
```

The extension adds a virtual model `reasoning-router/<id>` for each Claude
model the router knows. Each request runs on the matching `anthropic/<id>`
model with your existing Anthropic login or key; the router only picks its
thinking level. Pi pins the base effort in `output_config` and states the
chosen effort in an effort-only system message, so changing effort keeps the
cached prefix.

- User turns and continuations are classified. A retry reuses the failed
  attempt's thinking level. Direct requests, such as compaction, use
  `REASONING_ROUTER_BASE_EFFORT`, or the model's base effort.
- The last classified effort is stored in the session, so `previous`
  fallback survives a restart.
- A model that Pi lacks, or that Pi cannot give mid-conversation effort, is
  rejected with `reasoning-router unsupported_model (400)`. In Pi 1.0.0 that
  includes `claude-mythos-5-1`.
- A classification failure in `error` fallback mode rejects the request with
  `reasoning-router classification_failed (502)`. Cancelling a request never
  falls back.

OpenAI models are not routed yet.

## Environment

The extension reads the proxy's variables when Pi loads it; an invalid value
stops Pi with a `reasoning-router:` error.

| Variable | Default | Purpose |
| --- | --- | --- |
| `REASONING_ROUTER_CLASSIFIER` | `jev` | Classifier provider: `jev` or `clef`. |
| `REASONING_ROUTER_CLASSIFIER_API_KEY` | none | Classifier credential. Required. |
| `REASONING_ROUTER_CLASSIFIER_BASE_URL` | provider default | Jev endpoint. Ignored by `clef`. |
| `REASONING_ROUTER_CLASSIFIER_ACCOUNT_ID` | none | Clef: Cloudflare account ID. Required for `clef`. |
| `REASONING_ROUTER_CLASSIFIER_MODEL` | none | Clef: `clef` or `clef-flash`. Required for `clef`. |
| `REASONING_ROUTER_CLASSIFICATION_TIMEOUT_MS` | `4000` | Total classification budget, including retries. |
| `REASONING_ROUTER_MAX_RETRIES` | `1` | Classifier retries after a retryable error (0–10). |
| `REASONING_ROUTER_FALLBACK_MODE` | `fixed` | On failure: `fixed`, `previous` (last classified effort, else fixed), or `error`. |
| `REASONING_ROUTER_FALLBACK_EFFORT` | `high` | Effort for `fixed` fallback. |
| `REASONING_ROUTER_BASE_EFFORT` | model default | Effort for direct requests. |
| `REASONING_ROUTER_DECISIONS_LOG_PATH` | none | Absolute path for a JSONL log of decisions. |

See [`docs/environment.md`](../../docs/environment.md) for the classifier
credentials. The decision log holds metadata only: model, effort, classifier
latency and attempts, fallback, token usage including cache reads, and
outcome, with no prompt text or credentials.

## License

[MIT](LICENSE)
