# Findings: SemIf as an effort classifier

Status: blocked on upstream
([#22](https://github.com/robertn702/reasoning-router/issues/22)). There is
no `semif` preset and no supported SemIf configuration. SemIf's released
code has no HTTP server, and this repo does not run models.

[SemIf](https://github.com/TheoLeeCJ/SemIf-OpenJev) (formerly OpenJev)
reproduces Jev's interface pattern with frozen open models. It reads the
probability of each supplied option directly from a model's next-token
logits, and it fits per-workload temperatures to calibrate those
probabilities.

## Version checked

Checked on 2026-10-09 through the GitHub API, not by running anything:

- **Repository:** `TheoLeeCJ/SemIf-OpenJev`, MIT license, 4,714 stars.
  `github.com/TheoLeeCJ/SemIf`, which the README's links use, redirects
  (301) to the same repository ID.
- **Version:** `master` at
  [`23cf1f3`](https://github.com/TheoLeeCJ/SemIf-OpenJev/commit/23cf1f39fc9534fe81437200959b6dfc7106e45a)
  (2026-09-23, "Add explicit Torch CPU scoring"). The Python package is
  `semif-phase1` 0.1.0. There are no tags and no releases.
- **Models:** pinned in `manifests/models.json`. The reference model for
  direct option logits is `Qwen/Qwen3.5-4B` at revision
  `851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a` (BF16). Backends: Torch
  (CUDA, MPS, CPU), MLX, and llama.cpp (GGUF).

## The blocker: no HTTP contract

The only entry point is `semif-score`, a batch command. It loads a model
in-process, reads a JSONL file of rows with this shape, writes one
result per row to a new file, and exits:

```json
{ "id": "…", "state": "string, object, or array", "question": "…",
  "options": [{ "id": "…", "description": "…" }] }
```

Nothing on `master` listens on a port: no `/v1/systemone` endpoint, no
server dependency, no auth, and no error contract. Under this repo's
rules (AGENTS.md, `docs/architecture.md`), the router reaches every
classifier over HTTP and never runs a model, its weights, or its runtime.
Wrapping `semif-score` would mean shelling out to a Python model runtime
from the router, which those rules rule out. The fix belongs upstream.

Upstream status of a server:

- [PR #27](https://github.com/TheoLeeCJ/SemIf-OpenJev/pull/27), "Add
  semif-serve: a Jev-compatible HTTP layer" (open, unreviewed, by a
  contributor, head `arielshad/SemIf@27bbe96`).
- [PR #14](https://github.com/TheoLeeCJ/SemIf-OpenJev/pull/14), "Add a
  System One-compatible API server" (closed without merging).
- [Issue #38](https://github.com/TheoLeeCJ/SemIf-OpenJev/issues/38) asks
  whether a TypeSafe-compatible server is planned. It has no maintainer
  reply.
- [PR #55](https://github.com/TheoLeeCJ/SemIf-OpenJev/pull/55) adds an
  SGLang backend to `semif-score`. SGLang would be the scoring backend
  behind SemIf, not a System One endpoint, so it doesn't help here.

## Upstream prerequisite

To unblock, upstream needs to release a server the user runs that serves
`POST /v1/systemone` with the System One request and a bare
`{ model, answers, usage }` response, such as PR #27 merged to `master`.
Once that lands, the smallest change on our side is a `semif` preset that
reuses `createSystemOneClassifier`, as the `laya` preset does: a base URL
(HTTPS or loopback HTTP), an optional bearer key, and a required `model`.
Add it with mocked-transport tests, and verify it against the released
server before documenting it as supported.

## The PR #27 contract, unreleased

The following is read from PR #27's source and docs at `27bbe96`. None of
it has been run against a live server, and all of it may change before a
merge:

- **Endpoint:** `POST /v1/systemone` and `GET /v1/models`, plus
  `GET /healthz`. Binds `127.0.0.1:8471` by default.
- **Auth:** none unless `SEMIF_API_KEY` is set, in which case
  `Authorization: Bearer <key>` is required (401 otherwise). Binding to a
  non-loopback address requires a key.
- **Request:** `state`, `questions`, and `model` are all **required**.
  `model` must be the served ID, `semif-latest`, or (by default) a Jev
  alias such as `jev-latest`. Our transport omits `model` unless one is
  configured, so a future preset must require it or default it to
  `semif-latest`. A `choice` question needs `instructions` and a
  `criteria` object, whose keys become the options in order. We already
  send both.
- **Response:** `{ model, answers, usage }`, unwrapped.
  `answers.effort.choice` is the argmax option ID, with `probabilities`,
  `confidence`, and an extra `semif` block, which our parser ignores.
- **Errors:** `{ "error": { type, code, message, param? } }` with 401
  (auth), 404 (path), 422 (invalid body, unknown model, more than 16
  options), 500 (`backend_failed`), and 503 (still loading, with
  `Retry-After: 2`). With our shared policy, 401 and 422 fall back
  immediately, while 500 and 503 are retried once within the deadline and
  then fall back.
- **Limits:** a Choice question can have at most 16 options. Our questions
  have at most six (`none` to `max`). The server handles one request at a
  time, per process, and queues the rest. Each question has a token budget
  (`SEMIF_MAX_INPUT_TOKENS`, default 4096) that is enforced, never
  truncated. A prompt over budget becomes a `ValueError`, which the server
  returns as 500.

### Why our state would need a larger budget

The state we would send is the bounded summary described in
[`docs/architecture.md`](../architecture.md#classifiers): the last user
text (≤ 2,000 characters), the assistant's progress (≤ 2,000), up to 8 tool
results (≤ 1,600 each, with name and error flag), a failure summary (≤ 1,600),
and the target model ID. That is roughly 18,400 characters at most before
JSON overhead. That can exceed SemIf's 4,096-token default. Each over-budget
step would cost a 500, a retry, and then the fallback effort. Operators
would need to raise `SEMIF_MAX_INPUT_TOKENS` (8192 should cover it, but this
is unmeasured), at a cost in latency. No prompts or tool output reach our
logs either way; decision events stay metadata-only.

## API compatibility versus decision quality

These are separate questions, and only the first one is partly answered:

- **API compatibility:** unverified. If PR #27 merges as written, our
  System One request maps onto it with no transformation except a
  required `model`. Until it is released and tested, there is nothing to
  configure.
- **Effort-decision quality:** there is no evidence. SemIf's published
  results cover general decision fixtures, not reasoning-effort selection.
  According to its README, Qwen3.5-4B (BF16, direct logits) scores 0.813
  balanced accuracy on its own 144 authored decisions. On the 102 TypeSafe
  evaluation rows that could be aligned from public artifacts, its
  agreement is 0.845, against 0.883 for Jev. Its probabilities are
  uncalibrated by default, and the fitted temperatures (1.23–2.50) are
  per-workload; none was fitted for effort routing.
  [Issue #59](https://github.com/TheoLeeCJ/SemIf-OpenJev/issues/59)
  (opened 2026-10-07, no reply), titled "It is always picking option A as
  the answer", shows screenshots from before and after the options were
  reordered. The report is unconfirmed. Our efforts are always sent in
  ascending order, so a bias toward the first option would bias toward the
  lowest effort. Before any recommendation, measure option-order
  sensitivity and agreement with Jev on recorded effort decisions.
