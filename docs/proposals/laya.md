# Proposal: Laya classifier preset

Status: proposal for review
([#9](https://github.com/robertn702/reasoning-router/issues/9)). Nothing here
is implemented.

[Laya](https://huggingface.co/convaiinnovations/laya) is an open-source,
Jev-compatible decision model. This proposal adds it as the `laya` preset in
`@reasoning-router/classifiers`. The preset calls a Laya server that the user
runs, such as `laya-serve` from Laya's authors, over the same System One HTTP
API that Jev uses. Our packages don't install, download, load, or run Laya.

## Responsibility

- **The user** installs, runs, and supervises the Laya server: the Python
  runtime, the model weights, the hardware, preloading, and authentication.
- **Our packages** send one System One request per classification to a
  configured URL and treat the server like any hosted classifier: the same
  deadline, retries, and fallback. They depend on no model runtime.

`docs/architecture.md` records this as the rule for every classifier that
runs a local model, not only Laya.

## Findings

### `laya-serve` speaks the Jev API

Laya's authors publish `laya-serve` in the `laya` Python package
(`pip install "laya[serve]"`, or their Docker Compose setup for CPU or NVIDIA
GPUs). According to its
[HTTP API documentation](https://nandhakishorm.github.io/laya/http-api/),
which I haven't checked against a running server:

- **Endpoint:** `POST /v1/systemone`, the same path that the `jev` preset
  builds from its base URL. The default address is port 8000 on every
  interface.
- **Request:** `state` and `questions`, as Jev takes them. `model` is
  optional. A checkpoint name (`english`, `multilingual`, `typed-decisions`,
  or a Hugging Face ID) selects that checkpoint. Any other value lets the
  server choose by the language of the state.
- **Response:** `{ model, answers, usage }`, with no wrapper (unlike Clef's
  `{ result, success, errors }`). It adds fields such as `routing`,
  `answer_confidence`, and extra `usage` keys, which our parser ignores.
  `LAYA_JEV_STRICT=1` removes them. `answers.effort.choice` is always one of
  the options we sent.
- **Authentication:** none unless `LAYA_API_KEY` is set. With a key set, the
  server requires `Authorization: Bearer <key>` and returns 401 otherwise.
  Version 0.3.20 also returns 401 for a malformed bearer header, so we
  should leave the header out when no key is configured.
- **Errors:**
  - 400 for a malformed body.
  - 413 for an oversized request.
  - 422 for a question Laya can't answer.
  - 500 for an inference failure.
  - 503 when `LAYA_MAX_CONCURRENT` (16) requests are already in flight.
    Excess requests are refused, not queued.
- **Concurrency:** one forward pass at a time, on a worker. `GET /health`
  stays responsive while inference runs.
- **Speed:** they report 193–464 ms per call on CPU and about 33 ms on a GPU
  with the checkpoints preloaded (`LAYA_PRELOAD=1`). Their Docker CPU guide
  asks for 8 GB of RAM and 10 GB of disk.
- **Token window:** the English checkpoint reads 512 tokens (about 320 of
  them state). The multilingual checkpoint reads 1,024, and up to 8,192 when
  a request sets `max_len`. `usage.truncated` reports whether the state was
  cut.

A hosted option also exists. Opper serves Laya, run by Berget in Sweden, at
`https://api.opper.ai/v3/compat/v1/systemone` with
`"model": "berget/convaiinnovations/laya"`, for $0.05 per million input
tokens.

### Why not in-process

I first investigated running Laya inside our packages through
[`@receptron/laya`](https://github.com/receptron/laya) 0.1.2, which runs it on
ONNX Runtime. I measured it on this host, a shared 16-vCPU AMD EPYC-Rome VM
with Node 24.21 and Bun 1.3.14. The scripts are in `.scratch/laya/` and
aren't committed.

- **Install and weights:** `onnxruntime-node` is 301 MB unpacked. On Linux
  x64, its `postinstall` adds a 272 MB CUDA download. The weights are
  1.69 GB, downloaded in 23 s here. Every load also makes size checks against
  Hugging Face, with no timeout.
- **Memory:** about 1.7 GB of RAM in every process that loads the model.
  Each OpenCode process would load its own copy.
- **Speed:** loading takes 1.6–9 s. A call takes 0.3–2 s, and calls run one
  at a time.
- **Blocking:** inference runs synchronously on the calling thread. On the
  main thread, the classification deadline can't fire, and every other
  stream stalls for the length of the call.
- **Worker threads:** they keep the event loop free, but terminating the
  worker or exiting the process during a call aborts the whole process
  (SIGABRT).
- **Child processes:** under OpenCode's compiled Bun binary, a child process
  only works with an undocumented environment variable (`BUN_BE_BUN=1`).
- **Installing for the plugin:** OpenCode can't install an optional runtime
  next to a plugin, so plugin users would need a separate install.

A server that the user runs avoids all of these problems, and it already
exists.

## Recommended design

### The preset

`laya.ts` is a preset of a few lines on top of `createSystemOneClassifier`,
like `clef.ts`, with no response wrapper:

```ts
classifier: {
  provider: "laya",
  baseUrl?: string,  // default http://127.0.0.1:8000; requests go to {baseUrl}/v1/systemone
  apiKey?: string,   // sent as a bearer token only when set (LAYA_API_KEY on the server)
  model?: string,    // forwarded; a Laya checkpoint name, or omit to let the server choose
  timeoutMs?: number,
}
```

- **`baseUrl`** must be HTTPS, or plain HTTP to a loopback host
  (`localhost`, `127.0.0.0/8`, `[::1]`). It may not contain credentials, a
  query, or a fragment, which matches the `jev` checks. HTTPS allows a
  server on another machine behind TLS. Plain HTTP stays on the same
  machine, so the conversation summary never crosses a network unencrypted.
- **`apiKey`** is optional, so `systemone.ts` needs a small change: send the
  `authorization` header only when a key is set. Jev and Clef always set one.
- **`model`** is sent as given, and left out when unset. `systemone.ts`
  needs `model` to become optional. Today it always sends one.
- **`accountId`** is ignored, as `jev` ignores it.

### Proxy and plugin configuration

The proxy needs no new variables. It reuses
`REASONING_ROUTER_CLASSIFIER=laya`, `REASONING_ROUTER_CLASSIFIER_BASE_URL`,
`REASONING_ROUTER_CLASSIFIER_API_KEY`, and
`REASONING_ROUTER_CLASSIFIER_MODEL`. The plugin already accepts `baseUrl`,
`apiKey`, and `model` in its `classifier` option and falls back to the same
variables.

Example:

```sh
pip install "laya[serve]"
LAYA_PRELOAD=1 LAYA_HOST=127.0.0.1 laya-serve
REASONING_ROUTER_CLASSIFIER=laya reasoning-router
```

`docs/environment.md` describes the API key as required. With this change it
becomes required for `jev` and `clef` only.

### Policy

No changes. The existing categories cover the server:

- A server that isn't running fails as `connection`, which is retried once
  and then falls back.
- 503 (busy) and 500 count as 5xx, which is retried.
- 401 counts as `http_auth`, which isn't retried.
- 400, 413, and 422 count as other 4xx errors, which aren't retried.
- The 4000 ms default deadline covers CPU inference with room to spare once
  the server has preloaded.
- A cancelled request aborts the `fetch`. The server finishes the forward
  pass, and the reply is discarded.

The core classifier interface doesn't change. The in-process design would
have needed a new error category and a `close()` method; this one needs
neither.

### Testing

Use a fake `fetch`, as `clef.test.ts` does, to test:

- the URL and the `/v1/systemone` path, including the default base URL;
- the `baseUrl` rules (HTTPS, loopback-only HTTP, no credentials);
- that the bearer header is sent only when `apiKey` is set;
- that `model` is forwarded only when set;
- that the extra fields in Laya's full response are ignored;
- that 503, 500, 401, and 422 map to the right categories.

Neither Python nor model weights are needed in CI.

The real server is checked by hand once, as step 1 of the implementation
plan.

## Files that would change

| File | Change |
| --- | --- |
| `packages/classifiers/src/laya.ts` | New: provider and configuration schema. |
| `packages/classifiers/src/systemone.ts` | Make `apiKey` and `model` optional; leave out the header and field when unset. |
| `packages/classifiers/src/index.ts` | Register `layaClassifierProvider`. |
| `packages/classifiers/test/laya.test.ts` | New. |
| `packages/classifiers/package.json` | Description and keywords only. No new dependencies. |
| `packages/proxy/src/index.ts` | Help text: `laya` and the meaning of the existing variables for it. |
| `.env.example`, `docs/environment.md`, `README.md` | Laya setup: run `laya-serve`, then point the router at it. |

There are no changes to `core`, the plugin runtime, or the proxy
configuration code.

## Open decisions for Robert

1. **Where `baseUrl` may point.** Recommended: any HTTPS URL, or HTTP to
   loopback only. This also lets `laya` reach Opper (base URL
   `https://api.opper.ai/v3/compat` plus an Opper `model`). But
   `docs/architecture.md` says a provider name identifies the service, not
   the model, so Opper should get its own `opper` preset if anyone asks for
   it. Alternative: loopback only, which would make `laya` mean strictly "my
   own server" and require a separate preset for a remote `laya-serve`.
2. **The default `baseUrl`.** Recommended: `http://127.0.0.1:8000`,
   `laya-serve`'s default port, so the common setup needs no URL.
   Alternative: require it, which is more explicit but adds one more setting
   every user must write.
3. **State truncation (follow-up, not blocking).** The English checkpoint
   reads about the first 320 tokens of a conversation summary that can reach
   about 6,850 tokens, so tool failures are usually cut. The server can fix
   this without code changes on our side: the multilingual checkpoint
   (selected with `model`) reads more, and `max_len` widens the window.
   Recommended: ship without sending `max_len`, then compare decisions from
   the two checkpoints on real conversations. Laya's model card also says
   the base checkpoints are close to chance on its typed-decisions benchmark
   unless fine-tuned, so this comparison is the real test of whether Laya is
   useful here.

## Implementation plan

1. Run `laya-serve` under `.scratch/` and confirm the documented behavior:
   - the response to our exact request;
   - the 401 for an empty bearer header;
   - the 503 when busy;
   - CPU latency on this host.
2. In `classifiers`, make `apiKey` and `model` optional in `systemone.ts`,
   then add `laya.ts`, its tests, and the registration.
3. Update the proxy help text, `.env.example`, `docs/environment.md`, and
   `README.md`.
4. Classify a few real requests through the proxy and through OpenCode 2.0.x
   against `laya-serve`, and record the latency from the decision log in the
   PR.
