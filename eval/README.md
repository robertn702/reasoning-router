# Evaluations

English | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md)

Does classifier-routed effort keep solve rates while spending less reasoning
than a fixed effort? These reports measure that on real coding tasks from
[SWE-bench Verified](https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified).
Each attempt runs a coding agent in a fresh checkout, then grades the result
with the official SWE-bench test harness.

## Headline result

On the tested GPT-6 Astra task mix, Jev-routed effort and fixed `high` effort
each solved **44/44 attempts**. Jev used **20% fewer input tokens**, **14%
fewer output tokens** (including reasoning), and **9% less time** per attempt.

![Core comparison: both arms solve 44 of 44; Jev averages 20.2% less input, 14.3% less output, and 8.7% less time than fixed high.](results/router-core-comparison.svg)

This is one model, one classifier, and a small task set. It is not a general
workload estimate or a proof of equal solve rates. Read the
[consolidated report](results/router-consolidated-2026-09-25.md) before you
cite these numbers.

## Reports

| Report | What it covers | Takeaway |
| --- | --- | --- |
| [Consolidated Astra evaluation](results/router-consolidated-2026-09-25.md) | All Jev-versus-`high` cohorts combined | The headline result above. **Start here.** |
| [Quota-bounded autoresearch](results/quota-autoresearch-2026-09-24.md) | 6 preselected tasks, 6 attempts per arm, plus a candidate prompt change | Jev and `high` both solved 36/36, with Jev using 16% fewer output tokens. The candidate prompt was not adopted. |
| [pytest #5787](results/astra-pytest-5787.md) | One hard task, 5 attempts per arm across `medium`, `high`, `xhigh`, and Jev | Jev solved 5/5 versus 1/5 at `medium`. Exploratory: the task was chosen after seeing a gap. |
| [pytest #5787, no fallback](results/astra-strict-2026-09-24.md) | The same task with classifier fallback disabled | Jev solved 5/5 with no fallbacks, at about `high`'s cost. |
| [Effort-boundary search](results/astra-boundary-2026-09-24.md) | 5 candidate tasks searched for a `medium`-versus-higher gap | No reliable boundary found. Shows Jev never picked `xhigh` in these runs. |
| [Pilot](results/pilot.md) | First 2-task run on Astra and Sol | Early sanity check, not a benchmark. |

## How to read the results

- **Arms:** each task runs at fixed efforts (such as `medium` and `high`) and
  with classifier-routed effort (labeled `jev`). Model, prompt, base commit,
  timeout, and grader stay fixed across arms.
- **Solved** comes from the SWE-bench grader. **Evidence valid** means the
  attempt's token usage was fully recorded. Token means use only
  evidence-valid attempts, so check denominators before comparing.
- **Output tokens** include reasoning. Cached input is part of input, not an
  extra category. Tokens and time are consumption measurements, not dollar
  costs.
- Only metadata is published. Prompts, patches, traces, and grader logs stayed
  in the harness's ignored `eval/runs/` directory.

## Provenance

All runs used Jev between 2026-09-23 and 2026-09-25, before the router moved
into this repository, so commit hashes and script paths in the reports predate
it. The Jev request, the conversation state it receives, and how the chosen
effort is applied to the model request are unchanged in `reasoning-router`.

## Reproducing

The harness in this directory runs OpenCode with this repository's built
`@reasoning-router/opencode` plugin. Re-running it spends model and
classifier quota; the steps below say which ones do.

### Prerequisites

- Node.js 24 and `npm ci` from the repo root. The run-set driver builds the
  packages itself.
- OpenCode V2 on `PATH` (checked with 2.0.25), or set `EVAL_OPENCODE_BIN`.
- A Python environment with `datasets` and the official
  [SWE-bench harness](https://github.com/SWE-bench/SWE-bench) installed (the
  reports used harness revision `02e7a74ffd0b707aab73d203fe87bdc7c76afc8e`),
  for example `python3 -m venv eval/runs/swebench-venv`.
- Docker, for SWE-bench grading.
- A Responses API endpoint serving GPT-6 Astra or Sol: set
  `REASONING_ROUTER_UPSTREAM_BASE_URL` (default `http://127.0.0.1:8317/v1`)
  and `REASONING_ROUTER_UPSTREAM_API_KEY`. Every arm uses it.
- For routed arms, a classifier: `REASONING_ROUTER_CLASSIFIER_API_KEY` and,
  as needed, `REASONING_ROUTER_CLASSIFIER_BASE_URL`, `_ACCOUNT_ID`, and
  `_MODEL` (see [`docs/environment.md`](../docs/environment.md)). The Jev
  reports used Vercel AI Gateway
  (`REASONING_ROUTER_CLASSIFIER_BASE_URL=https://ai-gateway.vercel.sh/typesafe`).

### Arms

An arm is a fixed effort (`medium`, `high`, `xhigh`) or a classifier
provider (`jev`, `clef`, `laya`, `kev`, `openai-decisions`). Use `jev` to
reproduce these reports. Routed arms run strict: three classifier retries, a
10-second classification deadline, and fallback disabled, so a classifier
failure stops the attempt rather than silently running at a fallback effort.

### Steps

```bash
PY=$PWD/eval/runs/swebench-venv/bin/python
# 1. Generate the pinned dataset and manifest (free; downloads public data).
$PY eval/prepare.py astra
# 2. Check that each unmodified base fails and each reference patch passes
#    (free; Docker). Don't spend model runs on a task that fails this.
$PY eval/preflight.py astra
# 3. Run the matched set (paid: upstream model and classifier calls).
SWE_BENCH_DATASET_PATH=$PWD/eval/runs/swebench-astra.json SWE_BENCH_PYTHON=$PY \
  node eval/run-set.mjs --name astra-2026-10-09 --manifest eval/runs/tasks-astra.json \
  --model gpt-6-astra --arms medium,high,xhigh,jev --rounds 5 --concurrency 2
# 4. Write the metadata-only report to eval/results/astra-2026-10-09.md.
node eval/summarize.mjs --run-set astra-2026-10-09
```

Task sets live in `eval/tasks/`: `pilot`, `xarray`, `candidates`, `astra`,
and `boundary`, each pinned to SWE-bench Verified revision
`78f471bf655a3137b2e8a75af1501690ec009ec3` with a SHA-256 digest of the
selected rows. The grader refuses a dataset that doesn't match its digest.

`run-set.mjs` refuses to reuse a run-set name, records the commit, Node and
OpenCode versions, and the schedule in `eval/runs/NAME/schedule.json`,
rotates the arm order each round, and never replaces a failed attempt.
`summarize.mjs` refuses an incomplete or duplicated set. For a single
attempt, run `node eval/run.mjs --manifest PATH --task ID --model MODEL --arm
ARM`; add `--prepare-only` to create the checkout and config without
OpenCode, upstream, or classifier calls. Set `EVAL_AGENT_IMAGE` (built from
`agent.Dockerfile`) with an absolute `EVAL_OPENCODE_BIN` to run the agent in
a container.

### Evidence

Each attempt gets a fresh detached worktree and a new OpenCode session with
project config disabled. Its ignored `eval/runs/<run-id>/` directory holds
`result.json` (metadata), `decisions.jsonl` (`ReasoningDecision` events),
`opencode.json`, `output.jsonl`, `session.json` (the exported session),
`patch.diff`, and grader logs. **Raw output, sessions, and patches contain
task content; publish only `eval/results/` summaries.**

The agent runs as the same user as the grader and can read the upstream and
classifier keys from its environment, so a model could echo them into its
output, session, or patch. Use keys scoped to the eval, and treat
`eval/runs/` as sensitive. The grader receives neither key. This harness
assumes a non-adversarial agent and is not sandboxed against deliberate
benchmark gaming; with internet access, it could also find public fixes.

An attempt is evidence-valid only if every assistant message (model call) in
the exported session has exactly one decision matching its time window and
exact usage, in order, with no extra decisions, and every decision completed
on the expected model and arm. Otherwise token totals are withheld. The
plugin logs only agent-loop requests, so totals exclude title and compaction
calls. The historical reports' upstream totals included one auxiliary
request; their agent-step totals are the comparable figure.

### Tests

`npm test` runs the harness tests in `eval/test/` with the package tests.
They use a fake `opencode` and grader, make no network calls, and set
`EVAL_SKIP_BUILD=1` so they never rewrite `dist/` under a live run set.
