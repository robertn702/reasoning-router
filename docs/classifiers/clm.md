# CLM findings

Issue: [#23](https://github.com/robertn702/reasoning-router/issues/23).
Checked 2026-10-07 against primary sources: the upstream repository source
and the Hugging Face model API. No CLM server was run.

## Result

CLM's `clm-serve` accepts the router's existing System One request without a
code change. The `clm` preset (`provider: "clm"`) posts to
`{baseUrl}/v1/systemone` with an optional bearer key and `model`. It reuses
Laya's connection rules and the shared System One transport, and its base URL
defaults to `clm-serve`'s `http://127.0.0.1:8700`. Decision logs record
`classifier: "clm"`.

This result covers API compatibility only. It says nothing about the quality
of CLM's reasoning-effort decisions. Upstream reports CLM results as a
verifier, a reranker, and on the T-Rex game, not as a per-step effort
classifier. No one has measured how well it picks effort.

## Pinned upstream

| Item | Value |
| --- | --- |
| Repository | [Contrastive-LM/CLM](https://github.com/Contrastive-LM/CLM), commit `d5f9ef0fd9bde185df0ceaad4f4ecc6cfe8c34f6` (2026-10-05), Apache-2.0 |
| Python package | `contrastive-lm` 0.1.0 (no tags or releases upstream), which ships `clm-serve` |
| Model served as `clm-latest` | Head `CLM_v0.1-8B.pt` from [Contrastive-LM/CLM-v0.1-8B](https://huggingface.co/Contrastive-LM/CLM-v0.1-8B), revision `e939398d4556fcd9400c76fa8c5a513202f42b0a`, release date `2026-09-19` |
| Encoder the head requires | `Qwen/Qwen3-8B`, last-token pooling, served as `qwen3-8b` |

The repository has no tags, so pin it by commit. `clm-serve` downloads the
head into `~/.cache/clm` on first start unless you pass `--ckpt PATH`. To pin
the checkpoint, download that revision yourself and run
`clm-serve --no-download --ckpt PATH`.

## Confirmed HTTP contract

Sources: `src/clm/server.py`, `src/clm/schema.py`, and `src/clm/engine.py`
at the pinned commit.

- `POST /v1/systemone` takes a JSON body `{state, questions, model?, temperature?}`.
  It returns 422 unless `state` is present and `questions` is an object.
  `model` defaults to `clm-latest`; `clm-raw` (no projection head) and extra
  heads loaded with `--model NAME=PATH` or `--ckpt-dir` are also accepted.
  An unknown model gets a 422. `temperature` defaults to 1.0. The router
  does not send it.
- A `choice` question needs a non-empty `criteria` object. Each option's
  description is embedded as its candidate text. The answer is
  `{type: "choice", choice, confidence, probabilities}` at
  `answers.<id>`, and `choice` is always one of the `criteria` keys. The
  response also has `model` and `usage`, plus an `X-CLM-Latency-Ms` header.
  The router reads only `answers.effort.choice`.
- Auth: when `CLM_API_KEY` is set, every `/v1/*` route requires
  `Authorization: Bearer <key>`. Otherwise it returns 401. When the key is
  unset, auth is off. `GET /health` never requires auth.
- Errors: 401 for a bad key, 422 for a malformed body or unknown model, 502
  when the pooling backend fails or is unreachable. The router maps these to
  `http_auth`, `http_4xx` (no retry), and `http_5xx`. Under the shared
  policy, a 5xx, a 429, a connection error, or a timeout is retried (once by
  default, `maxRetries` 1) within the total deadline. After that the router
  applies `fallbackMode`.
- Other routes (`/v1/rank`, `/v1/models`, the `/` playground) are unused.

## External servers you operate

The router never installs, downloads, or starts any of these. It only calls
`clm-serve` over HTTP.

1. **Pooling backend:** an OpenAI-compatible `/v1/embeddings` server for
   Qwen3-8B, for example
   `vllm serve Qwen/Qwen3-8B --served-model-name qwen3-8b --runner pooling --max-model-len 2048 --host 127.0.0.1 --port 8090`
   on a GPU. vLLM binds every interface without auth unless told otherwise.
   Keep it on loopback, or put it behind auth and TLS if `--emb-url` points
   to another host. `clm-serve` reaches it at `--emb-url`, which defaults to
   `http://127.0.0.1:8090/v1/embeddings`.
2. **API server:** `clm-serve`, default port 8700, CPU or GPU heads.
   It binds `0.0.0.0` with no auth and plain HTTP by default. Pass
   `--host 127.0.0.1` for a local-only server. Set `CLM_API_KEY` whenever it
   is reachable from beyond loopback, and pass `--no-ui` to disable the
   playground.

## Context truncation

`clm-serve --max-tokens` (default 2,048, env `CLM_EMB_MAX_TOKENS`) is sent to
the pooling server as `truncate_prompt_tokens`. Longer state text is
truncated without an error. Upstream advises raising it together with vLLM's
`--max-model-len`. The router's state is already bounded. It holds the recent
user text and assistant progress (2,000 characters each) and up to 8 tool
results (1,600 characters each). The last failure excerpt can repeat one of
them. That totals up to about 18,000 characters, so a full state can exceed
2,048 tokens. CLM renders the state as text and appends the question's instructions after it.
Truncation can therefore cut part of the state or the instruction. Treat a
large state as a quality risk, not an API failure.

## What is sent

Each classification sends the same bounded, metadata-limited state as every
other classifier (see [architecture](../architecture.md#classifiers)), plus the
`effort` choice question with the target model's supported efforts and their
descriptions. `clm-serve` passes that text to the pooling backend, and both
may keep it in memory caches. Router logs stay metadata-only. They never hold
the state or the response body.

## Configuration example

Run the two servers yourself, then:

```bash
REASONING_ROUTER_CLASSIFIER=clm reasoning-router
```

The base URL defaults to `http://127.0.0.1:8700`, so
`REASONING_ROUTER_CLASSIFIER_BASE_URL` is optional. `REASONING_ROUTER_CLASSIFIER_MODEL`
is also optional and selects the CLM head; when unset, `clm-serve` uses
`clm-latest`. Set `REASONING_ROUTER_CLASSIFIER_API_KEY` only when `clm-serve`
runs with `CLM_API_KEY`. The OpenCode plugin form is
`classifier: { provider: "clm" }`, plus `baseUrl`, `apiKey`, or `model` when
needed. The base URL must be HTTPS, or HTTP to a loopback host. For a remote
GPU host, use an SSH tunnel (`ssh -L 8700:localhost:8700 <host>`) or an HTTPS
proxy.

The mocked contract tests in
[`packages/classifiers/test/clm.test.ts`](../../packages/classifiers/test/clm.test.ts)
cover this configuration. They exercise the `clm` preset: the request shape,
the default base URL, `clm-latest`, auth, selection from the
`REASONING_ROUTER_CLASSIFIER_*` variables, base URL rejection, invalid
answers, 401/422/502 handling, retries, the deadline, and cancellation. No
live CLM call is made, and none is needed for `npm run check`.

## Limitations

- No live server was run, so the compatibility claim rests on reading the
  source and on mocked tests.
- The first call for a new state includes an embedding round trip to an 8B
  model. Whether this fits the router's 4,000 ms default budget depends on
  your hardware.
- Effort-decision quality is unvalidated.
