---
name: run-evals
description: Run, re-run, or extend the SWE-bench Verified evaluations of reasoning-router (classifier-routed effort versus fixed effort) with the harness in eval/, and publish metadata-only reports to eval/results/. Use whenever the task is to reproduce an eval report, compare a classifier (Jev, Clef, Laya, Kev, OpenAI Decisions) against fixed medium/high/xhigh effort, measure solve rate or token use on coding tasks, add a task set, or summarize eval runs, even if the user doesn't name this skill. Not for unit-testing the router or the plugin smoke tests.
---

# Run evals

The harness in `eval/` runs OpenCode with this repo's built
`@reasoning-router/opencode` plugin on pinned SWE-bench Verified tasks,
grades each patch with the official Docker harness, and checks that the
router's decision log accounts for every model call. `eval/README.md` is the
reference; if it and this skill disagree, the README and the scripts win.

## Ground rules

- **Live runs cost money.** Every agent attempt calls the upstream model;
  routed arms also call the classifier. Preparing, preflighting, `--prepare-only`,
  summarizing, and `npm test` do not. Confirm the run set's size
  (tasks × arms × rounds) and the user's quota before starting one.
- **Never replace an attempt.** A failed, timed-out, or ungraded attempt is
  data. Don't delete its directory or rerun it under the same run-set name;
  `run-set.mjs` refuses to reuse a name for this reason.
- **Publish metadata only.** `eval/runs/` holds prompts, patches, sessions,
  and grader logs and is ignored. Commit only `eval/results/*.md`.
- **Keep the arms matched.** Same model, task commit, prompt, timeout,
  grader, and router commit across arms. Don't change any of them mid-set.

## Prerequisites

Check these before spending anything (details in `eval/README.md`):

- Node 24 and `npm ci`; OpenCode V2 on `PATH` (`opencode --version`) or
  `EVAL_OPENCODE_BIN`.
- A Python venv with `datasets` and `swebench` (for example
  `eval/runs/swebench-venv`), and a working Docker daemon.
- `REASONING_ROUTER_UPSTREAM_BASE_URL` and
  `REASONING_ROUTER_UPSTREAM_API_KEY` for a Responses endpoint serving the
  model.
- For a routed arm, the classifier settings from `docs/environment.md`.
  `jev` needs `REASONING_ROUTER_CLASSIFIER_API_KEY` (plus
  `REASONING_ROUTER_CLASSIFIER_BASE_URL=https://ai-gateway.vercel.sh/typesafe`
  for a Gateway key); `laya` and `kev` need a server the user runs. Unset
  `REASONING_ROUTER_CLASSIFIER_MODEL` left over from another provider.

If a credential is missing, stop and ask; never print or log one.

## 1. Pick or add a task set

Task sets are `eval/tasks/<set>.json` (id, repo, base commit, `"grade":
"swebench"`, optional `agentTimeoutMinutes`) with a matching
`<set>.sha256` over the selected dataset rows in file order. To add one,
write the selection, compute the digest once from the pinned revision, and
commit both. Choose tasks before seeing results; if you select a task
because of an observed gap, say so in the report.

## 2. Prepare and preflight

```bash
PY=$PWD/eval/runs/swebench-venv/bin/python
$PY eval/prepare.py <set>     # writes eval/runs/swebench-<set>.json and tasks-<set>.json
$PY eval/preflight.py <set>   # base must fail, reference patch must pass
```

Drop any task that fails preflight; don't run agents against it. A quick
`node eval/run.mjs --manifest eval/runs/tasks-<set>.json --task ID --model
gpt-6-astra --arm jev --prepare-only` confirms the generated config without
calling anything.

## 3. Run a matched run set

```bash
SWE_BENCH_DATASET_PATH=$PWD/eval/runs/swebench-<set>.json SWE_BENCH_PYTHON=$PY \
  node eval/run-set.mjs --name <set>-<date> --manifest eval/runs/tasks-<set>.json \
  --model gpt-6-astra --arms medium,high,xhigh,jev --rounds 5 --concurrency 2
```

- An arm is a fixed effort or a classifier name; `jev` is the default
  classifier. Routed arms run with fallback disabled, so every decision
  is the classifier's.
- Commit first: `schedule.json` records the commit and flags a dirty tree,
  and the driver builds the packages before the first attempt.
- Start small (one or two rounds) to screen tasks, then decide which tasks
  merit a full set. Prefer tasks where fixed arms disagree; an all-pass or
  all-fail task can't show a difference.
- Long sets: run in the background and check the per-attempt logs in
  `eval/runs/<name>/`. If the driver dies, don't restart it under the same
  name; summarize what finished or start a new, disclosed run set.

## 4. Summarize into `eval/results/`

```bash
node eval/summarize.mjs --run-set <set>-<date>
```

It fails on a missing or duplicate attempt. Then:

- Review `eval/results/<name>.md`. Report solved counts with denominators,
  evidence-valid counts, and the routed arms' effort distribution and
  fallbacks. Token means use evidence-valid attempts only.
- Add interpretation and scope limits by hand (selection bias, small
  samples, concurrency effects on latency). Don't claim savings or equal
  solve rates the numbers don't support.
- Add a row to the Reports table in `eval/README.md`.
- Check the report contains no prompt, patch, or credential.

## Cost and quota cautions

- Size before running: tasks × arms × rounds attempts, each up to the task's
  agent timeout (15 minutes by default) plus up to 30 minutes of grading.
- Subscription upstreams (such as a CLIProxyAPI account) have rolling quota
  windows. Check remaining quota first and leave headroom for concurrent
  attempts; an attempt cut off by quota still counts as initiated.
- Concurrency above two shares upstream rate limits and skews latency.
- Classifier calls are billed per request on Jev, Clef, and OpenAI
  Decisions; local Laya or Kev servers are not.

## Verify harness changes

Changes to `eval/*.mjs` must keep `npm run check` passing; it runs
`eval/test/` with fake `opencode` and grader binaries. Those tests prove the
harness logic, not that a live model, classifier, or grader accepts it. Say
which parts you verified live.
