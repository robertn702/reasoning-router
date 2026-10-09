# Evaluations

English | [简体中文](README_CN.md) | [日本語](README_JA.md)

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

The eval harness is not in this repository yet, so these results can't be
re-run from here.
