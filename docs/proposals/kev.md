# Kev classifier preset

Status: implemented
([#21](https://github.com/robertn702/reasoning-router/issues/21)) as the `kev`
preset. The HTTP contract below comes from Kev's source and was checked
against mocked transport tests. It wasn't checked against a running server,
because doing that would mean downloading weights and running a GPU
inference runtime. Neither API compatibility nor any Kev benchmark shows
that Kev picks good reasoning efforts. That still has to be measured on real
router traffic.

[Kev](https://github.com/jaredpalmer/kev) (Apache-2.0) is a family of Jev-like
decision models built on Qwen3.5 and Qwen3.8. It includes `kev.serve`, a
FastAPI server that speaks TypeSafe's System One API. The `kev` preset calls a
`kev.serve` instance that you run. Our packages don't install, download, load,
or run Kev, as [`architecture.md`](../architecture.md) requires for every
local model.

## Pinned upstream

- **Code:** tag [`kev-1.0`](https://github.com/jaredpalmer/kev/releases/tag/kev-1.0),
  commit `6b719c3c3f367295f6ef336f4f751cf5ff970abc` (2026-10-01). On
  2026-10-07, `kev/serve.py`, `kev/api.py`, and `kev/model.py` had no changes
  between that tag and `main` (`5e42a7a`).
- **Checkpoint:** Kev-4B, `jaredpalmer/kev-4b@v1.0` (weights revision
  `139fdd94`, Qwen3.5-4B-Base, temperature 2.41). Kev's README uses Kev-4B
  in its local example, and it runs on a 32 GB Mac or an L40S/H100.
- **Context:** the server accepts states of up to 65,536 tokens and refuses
  longer ones with a 422. Kev-4B was trained on states of up to 7,552 tokens,
  and upstream validates its accuracy only up to 8,192 tokens. The router's
  state summary caps each field (excerpts of 1,600–2,000 characters, at most
  8 tool results), so it is a few thousand characters. There is no separate
  token cap.

## Confirmed HTTP contract

All of this comes from `kev/serve.py` and `kev/api.py` at the pinned commit.

- **Endpoint:** `POST {baseUrl}/v1/systemone`. The `jev` and `laya` presets
  use the same path.
- **Request:** `{ state, model?, questions }`. A `choice` question has
  `criteria` with 1 to 255 options, and `instructions` is optional. We
  always send `instructions`.
- **Response:** `{ model, answers, usage, latency_ms }` with no wrapper.
  `answers.effort` is `{ type: "choice", choice, confidence, probabilities }`.
  `choice` is the option with the highest probability, so it is always one
  of the criteria keys we sent. The router still validates it against the
  target model's supported efforts. With `KEV_TRUNCATE_STATES=1`, the server
  also returns `truncated`, which we ignore.
- **Model selector:** none on the wire. The checkpoint is fixed when the
  server starts (`--run jaredpalmer/kev-4b@v1.0`). The request `model`
  defaults to `kev-latest` and is only echoed back. `/v1/models` lists
  `kev-latest` and `jev-latest`, both pointing at the loaded checkpoint. The
  preset forwards `model` only when you set one.
- **Auth:** open by default. With `KEV_API_KEY` set, every `/v1/*` route
  requires the exact header `Authorization: Bearer <key>`. The server
  compares it in constant time and returns 401 otherwise. The preset sends
  the header only when `apiKey` is set.
- **Errors:**
  - 401 for a missing or wrong key (`http_auth`, not retried).
  - 422 for an invalid request or an over-length state (`http_4xx`, not
    retried).
  - 503 while the server is stopping (`http_5xx`, retried).
  - 500 for an inference failure (`http_5xx`, retried).
  - Error bodies are discarded and never logged.
- **Concurrency:** one model thread batches up to 64 queued requests. A
  request that times out on our side is dropped by us, and the server still
  finishes its forward pass.
- **Bind:** `127.0.0.1:8008` by default (`--host`, `--port`). The README
  example uses `--port 8009`.

## Why a preset, not configuration reuse

The `laya` preset would already work:
`REASONING_ROUTER_CLASSIFIER=laya REASONING_ROUTER_CLASSIFIER_BASE_URL=http://127.0.0.1:8008`.
But [`architecture.md`](../architecture.md) says a provider name identifies
the service. With `laya`, the decision log would label Kev's decisions as
Laya's, and you'd have to set the URL every time. The `kev` preset reuses
Laya's connection rules unchanged and only changes the name and the default
port, so it adds no new behavior to review.

## Configuration

| Setting | Proxy / Pi variable | Value |
| --- | --- | --- |
| `provider` | `REASONING_ROUTER_CLASSIFIER` | `kev` |
| `baseUrl` | `REASONING_ROUTER_CLASSIFIER_BASE_URL` | Default `http://127.0.0.1:8008`. Must be HTTPS, or HTTP to loopback only. No credentials, query, or fragment. |
| `apiKey` | `REASONING_ROUTER_CLASSIFIER_API_KEY` | Optional. Set it only when the server sets `KEV_API_KEY`. |
| `model` | `REASONING_ROUTER_CLASSIFIER_MODEL` | Optional. Echoed only; it doesn't select a checkpoint. |
| `timeoutMs` | `REASONING_ROUTER_CLASSIFICATION_TIMEOUT_MS` | Default 4000. |

These apply to every harness. The proxy and the Pi extension read the
variables. The OpenCode plugin takes the same keys in its `classifier` option
and falls back to the variables.

```sh
# You run Kev yourself, outside the router (this downloads the weights):
git clone https://github.com/jaredpalmer/kev && cd kev && git checkout kev-1.0
uv sync --extra serve
uv run --extra serve python -m kev.serve --run jaredpalmer/kev-4b@v1.0
# Then:
REASONING_ROUTER_CLASSIFIER=kev reasoning-router
```

```jsonc
// OpenCode plugin
{ "classifier": { "provider": "kev", "baseUrl": "http://127.0.0.1:8008" } }
```

## State sent to the service

Each classification sends the bounded, metadata-limited summary the router
builds for every classifier. It contains:

- the target model ID;
- recent user text;
- assistant progress;
- tool-result metadata;
- a short excerpt of the last failure.

It also sends the effort question. Plain HTTP stays on loopback, so the
summary crosses a network only over TLS.

## Hosted endpoints

Upstream's `kev-deploy` skill deploys the same server to your Modal account
at `https://<workspace>--kev-api.modal.run`, behind a bearer key. The preset
accepts that URL. Two things weren't verified, because they would need a
paid deployment:

- A cold start with cached weights takes about 35 s, according to upstream
  (a first deploy takes longer), which is far past
  the 4000 ms deadline. The first calls after the endpoint goes idle will
  time out and fall back.
- Network latency comes on top of model time.

Treat any third-party host as a separate transport that needs its own
verification.

## Limitations

- Not checked against a live `kev.serve`. A run on this repo's CPU-only dev
  host would also not be representative, because upstream targets CUDA and
  MLX.
- No evidence yet on how well Kev picks efforts. Kev's published accuracy
  numbers come from unrelated decision benchmarks. Kev-4B trails Jev on
  held-out datasets (breadth-v1 index 38.0 against 54.0).
- Latency depends on your hardware and grows with state length. Upstream
  reports 41.5 ms of model time for a short new state on an L40S, and
  721 ms for a ~270-token state on an Apple M5. Every router call sends a
  new state, so the server's prefix cache rarely helps. Measure your own
  server against the 4000 ms deadline.
