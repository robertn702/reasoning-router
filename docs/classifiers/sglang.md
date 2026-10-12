# SGLang findings

Issue: [#27](https://github.com/robertn702/reasoning-router/issues/27).
Checked 2026-10-12 against primary sources: SGLang's
[decision models guide](https://docs.sglang.io/docs/supported-models/decision_models)
and the SGLang source at the pinned release. No SGLang server was run, and no
model was downloaded.

## Result

SGLang's `POST /v1/systemone` accepts the router's System One request, with
one exception: SGLang requires a `model` field, and the router omits `model`
when none is set. So the `sglang` preset (`provider: "sglang"`) sends
`model: "default"` when `model` is unset. SGLang accepts any name without a
colon and answers with whatever model it serves. Otherwise the preset is the
same server preset that Laya, Kev, and CLM use. It posts to
`{baseUrl}/v1/systemone` with an optional bearer key and follows the same
HTTPS-or-loopback rule. Its base URL defaults to SGLang's
`http://127.0.0.1:30000`, and decision logs record `classifier: "sglang"`.

A dedicated preset is used instead of pointing `laya`, `kev`, or `clm` at
SGLang for three reasons. Those presets omit `model` when it is unset, so
every request would get a 422 and fall back. Decision logs would also name
the wrong service ([docs/proposals/kev.md](../proposals/kev.md) makes the
same argument). And you would need to set the URL every time.

This covers API compatibility only. It says nothing about how well SGLang
picks reasoning effort. No one has measured any model served by SGLang as a
per-step effort classifier.

The earlier [openjev-sglang](https://github.com/ekzhang/openjev-sglang)
experiment, a separate Jev-compatible server on SGLang, is archived. Its
README sends users to this SGLang endpoint. The router has no integration
for it.

## Pinned upstream

| Item | Value |
| --- | --- |
| Release | [SGLang v0.5.21](https://github.com/sgl-project/sglang/releases/tag/v0.5.21), commit `e00930c5489053f26d86b179cee0d087f846acbb` (2026-09-29), published 2026-10-02 |
| Route added | `16d1c93b3d` "add a system one compatible /v1/systemone route" (#41208), 2026-09-25, contained in v0.5.21 |
| Model | `Qwen/Qwen3.8-27B`, one of the two chat models SGLang lists as validated (on one H200, BF16); `Qwen/Qwen3.5-35B-A3B` is the other |
| Decision checkpoints | Not in v0.5.21. [PPLX-Decider](https://docs.sglang.io/cookbook/autoregressive/Perplexity/PPLX-Decider-v1-27B) support landed in `482b062d28` (#42183, 2026-10-03) and Clef support in `bd2d73daa5` (#42721, 2026-10-09). Both need a nightly build; `main` was checked at `6966c5d027163f1d2005e5fec8e0ed40cf95213e` (2026-10-12) |

The guide still says a nightly build is needed "until a release contains"
the route. v0.5.21 does contain it, for chat models. It does not contain the
decision checkpoint, Clef, or image support added afterwards.

## Confirmed HTTP contract

Sources at v0.5.21: `python/sglang/srt/entrypoints/systemone/protocol.py`
and `serving.py`, `python/sglang/srt/entrypoints/openai/serving_decisions.py`
and `serving_base.py`, `python/sglang/srt/entrypoints/http_server.py`, and
`python/sglang/srt/utils/auth.py`.

- **Request:** `POST /v1/systemone` with `content-type: application/json`.
  The body is `{state, model, questions, chat_template_kwargs?}`. `state` may
  be a string, object, or array. `model` is a required string. It is
  rejected only when it names a LoRA adapter (`base:adapter`); any other
  value is accepted and ignored. Unknown top-level fields are ignored.
  `temperature`, `prompt_format_version`, and `return_prompt_token_ids` are
  refused. The router sends none of them.
- **Choice question:** `criteria` takes 1 to 255 options. For chat models,
  options beyond 26 need two-letter labels that the tokenizer can support.
  Option names must not be blank, must not contain control or line-break
  characters, and must not repeat after case folding. The router sends 4 to
  6 effort names, all of which pass.
- **Response:** `{model, answers, usage}`. `answers.effort` is
  `{type: "choice", choice, confidence, probabilities, x_label_mass}`.
  `choice` is the option with the highest probability, so it is always one
  of the keys that were sent. The router reads only `answers.effort.choice`
  and still checks it against the target model's supported efforts. The
  response `model` is the served model name.
- **Auth:** open by default. With `--api-key KEY`, every route except
  `/health*`, `/ready*`, and `/metrics*` requires
  `Authorization: Bearer KEY`. The key is compared in constant time, and a
  missing or wrong key gets a 401. The preset sends the header only when
  `apiKey` is set.
- **Errors:**
  - 401 for a missing or wrong key (`http_auth`, not retried).
  - 422 with FastAPI's detail list for an invalid body, such as a missing
    `model` (`http_4xx`, not retried).
  - 400 when SGLang refuses the request: a server or chat template it cannot
    score (see below), a label that is not a single token, a prompt longer
    than the context window, or a LoRA `model` (`http_4xx`, not retried).
  - 500 for an internal or non-finite scoring fault (`http_5xx`, retried).
  - Under the shared policy, a 5xx, 429, connection error, or timeout is
    retried once by default within the total deadline. After that,
    `fallbackMode` applies. Error bodies are discarded and never logged.
- **Bind:** `127.0.0.1:30000` by default (`--host`, `--port`).
- Other routes (`/v1/decisions`, `/v1/score`, `/v1/chat/completions`) are
  unused.

## Model and template restrictions

For an ordinary chat model, `/v1/systemone` uses `/v1/decisions`'s prompt
rendering, label checks, and scoring. It refuses the same servers and
templates, each with a 400:

- a server launched with `--enable-mis` or `--dllm-algorithm`, or with
  `--skip-tokenizer-init`;
- a built-in conversation template instead of the tokenizer's Jinja
  template (whether named with `--chat-template`, loaded from a JSON file,
  or inferred from the model path), or a model whose chat route uses a
  built-in encoder;
- a model that is not a generation model, or a tokenizer that does not
  encode the rendered chat text back to the same IDs;
- a template that always reasons before answering, or a prompt that leaves a
  reasoning block open. SGLang turns thinking off for these requests, so
  thinking models such as Qwen3.8 work, and `--reasoning-parser` affects only
  chat.

Leave `--preferred-sampling-params` without a default temperature. The guide
warns that it can scale decision probabilities when decisions share a batch
with generation.

## Next-token scores versus decision checkpoints

How SGLang answers depends on the model it serves:

- **A chat model, such as Qwen3.8-27B (v0.5.21).** SGLang renders the state
  as compact JSON, then adds a blank line, a `Question:` line with our
  instructions, one line per effort (`A: low - <description>`), and "Answer
  with the letter of one option only." It reads the next-token
  log-probabilities of the letters `A` to `F` in one prefill pass. These are
  generic next-token scores. The guide says that none of these values is a
  calibrated probability that the decision is correct. Letter labels have
  unequal priors, so answers can depend on option order, and the router
  always lists efforts from lowest to highest. Probabilities can shift by up
  to about 0.07 between cold and prefix-cached requests. In SGLang's tests
  the chosen option did not change.
- **A decision checkpoint, such as PPLX-Decider-v1-27B (nightly only).** It
  is fine-tuned from Qwen3.8-27B. SGLang applies the prompt, answer codes,
  and calibrated temperature that the checkpoint was trained with. Perplexity
  reports better accuracy than the base model on public decision benchmarks.
  None of those benchmarks is reasoning-effort selection. The checkpoint was
  trained on prompts of up to 8,192 tokens.
- **A joint schema checkpoint, such as Clef (nightly only).** It answers from
  its own head without the chat template.

The router sends the same request in every case and reads only `choice`.
Calibration therefore affects decision quality but not compatibility.

## Context

The router's state is bounded: recent user text and assistant progress
(2,000 characters each), up to 8 tool results (1,600 characters each), and a
failure excerpt. That is up to about 18,000 characters, or a few thousand
tokens. This is well inside Qwen3.8-27B's 262,144-token context window (per
SGLang's PPLX-Decider cookbook). A prompt that does not fit gets a 400 rather
than being truncated. Latency grows with state
length and depends on your hardware. Every router call sends a new state, so
the prefix cache rarely helps. Measure your server against the 4,000 ms
default deadline.

## What is sent

Each classification sends the same bounded, metadata-limited state as every
other classifier (see [architecture](../architecture.md#classifiers)), plus
the `effort` choice question with the target model's supported efforts and
their descriptions. SGLang tokenizes that text and may keep it in its prefix
cache. SGLang logs request bodies only when request logging is enabled
(`--log-requests`). Router logs stay metadata-only and never hold the state
or the response body.

## Configuration example

Run SGLang yourself, outside the router. This downloads the weights and
needs a GPU:

```bash
python -m sglang.launch_server --model-path Qwen/Qwen3.8-27B --host 127.0.0.1 --port 30000
REASONING_ROUTER_CLASSIFIER=sglang reasoning-router
```

The base URL defaults to `http://127.0.0.1:30000`, so
`REASONING_ROUTER_CLASSIFIER_BASE_URL` is optional. Set
`REASONING_ROUTER_CLASSIFIER_API_KEY` only when SGLang runs with
`--api-key`. `REASONING_ROUTER_CLASSIFIER_MODEL` is optional because SGLang
ignores the value. It must not contain a colon, which the router does not
check: SGLang refuses such a name with a 400 on every request. The OpenCode
plugin form is
`classifier: { provider: "sglang" }`, plus `baseUrl`, `apiKey`, or `model`
when needed. The base URL must be HTTPS, or HTTP to a loopback host. For a
remote GPU host, use an SSH tunnel (`ssh -L 30000:localhost:30000 <host>`) or
an HTTPS proxy.

The mocked contract tests in
[`packages/classifiers/test/sglang.test.ts`](../../packages/classifiers/test/sglang.test.ts)
cover this configuration. They exercise the request shape, the default base
URL and `model`, auth, selection from the `REASONING_ROUTER_CLASSIFIER_*`
variables, base URL rejection, invalid answers, 401/400/422/500 handling,
retries, the deadline, and cancellation. No live SGLang call is made, and
none is needed for `npm run check`.

## Limitations

- No live server was run, so the compatibility claim rests on reading the
  source and on mocked tests.
- Effort-decision quality is unvalidated for every model, including the
  decision checkpoints.
- SGLang Model Gateway does not route `/v1/systemone` yet, according to the
  PPLX-Decider cookbook. Put a plain HTTPS load balancer in front of several
  servers instead.
