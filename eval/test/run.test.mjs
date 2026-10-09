import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { fakeOpencode, gitFixture } from "./fixtures.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// Host eval settings must not leak into the fixtures.
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !/^(REASONING_ROUTER_|EVAL_|SWE_BENCH_)/.test(key),
  ),
);
const runEval = (args, env = {}) =>
  execFileSync(process.execPath, ["eval/run.mjs", ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...cleanEnv, ...env },
    stdio: "pipe",
  }).trim();
const worktrees = (repo) =>
  execFileSync("git", ["-C", repo, "worktree", "list", "--porcelain"], {
    encoding: "utf8",
  }).match(/worktree /g)?.length;

test("prepare-only creates an isolated checkout and config without credentials or model calls", async () => {
  const temp = await mkdtemp(join(tmpdir(), "rr-eval-prepare-"));
  const repo = join(temp, "repo");
  const manifest = join(temp, "manifest.json");
  try {
    const commit = await gitFixture(repo);
    await writeFile(
      manifest,
      JSON.stringify({
        tasks: [
          {
            id: "offline-fixture",
            repo,
            commit,
            prompt: "Make a change",
            grade: [process.execPath, "--version"],
          },
        ],
      }),
    );
    for (const arm of ["high", "xhigh"]) {
      const path = runEval([
        "--manifest",
        manifest,
        "--task",
        "offline-fixture",
        "--model",
        "gpt-6-sol",
        "--arm",
        arm,
        "--prepare-only",
      ]);
      const dir = dirname(path);
      const result = JSON.parse(await readFile(path, "utf8"));
      const config = JSON.parse(
        await readFile(join(dir, "opencode.json"), "utf8"),
      );
      assert.equal(result.prepared, true);
      assert.equal(result.grade_passed, null);
      assert.equal(config.model, "reasoning-router/gpt-6-sol");
      assert.equal(config.plugins[0].package, join(dir, "plugin"));
      assert.equal(config.plugins[0].options.fixedEffort, arm);
      assert.equal(config.plugins[0].options.classifier, undefined);
      assert.match(
        await readFile(join(dir, "plugin/index.js"), "utf8"),
        /packages\/opencode\/dist\/plugin\.js/,
      );
      assert.deepEqual((await readdir(dir)).sort(), [
        "opencode.json",
        "plugin",
        "result.json",
      ]);
      assert.equal(worktrees(repo), 1);
      await rm(dir, { recursive: true, force: true });
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}, 60_000);

test("routed preparation selects the classifier, fails closed, and references the key by name", async () => {
  const temp = await mkdtemp(join(tmpdir(), "rr-eval-routed-"));
  const repo = join(temp, "repo");
  const manifest = join(temp, "manifest.json");
  try {
    const commit = await gitFixture(repo);
    await writeFile(
      manifest,
      JSON.stringify({
        tasks: [
          {
            id: "routed",
            repo,
            commit,
            prompt: "Fix issue",
            grade: [process.execPath, "--version"],
          },
        ],
      }),
    );
    const path = runEval(
      [
        "--manifest",
        manifest,
        "--task",
        "routed",
        "--model",
        "gpt-6-astra",
        "--arm",
        "jev",
        "--prepare-only",
      ],
      {
        EVAL_RUN_SET: "routed-check",
        REASONING_ROUTER_CLASSIFIER_API_KEY: "secret-classifier-key",
        REASONING_ROUTER_CLASSIFIER_BASE_URL:
          "https://ai-gateway.vercel.sh/typesafe",
      },
    );
    const result = JSON.parse(await readFile(path, "utf8"));
    const text = await readFile(join(dirname(path), "opencode.json"), "utf8");
    const options = JSON.parse(text).plugins[0].options;
    assert.equal(result.run_set, "routed-check");
    assert.deepEqual(options.classifier, {
      provider: "jev",
      timeoutMs: 10_000,
      baseUrl: "https://ai-gateway.vercel.sh/typesafe",
      apiKey: "{env:REASONING_ROUTER_CLASSIFIER_API_KEY}",
    });
    assert.equal(options.maxRetries, 3);
    assert.equal(options.fallbackMode, "error");
    assert.equal(options.fixedEffort, undefined);
    assert.doesNotMatch(text, /secret-classifier-key/);
    await rm(dirname(path), { recursive: true, force: true });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}, 60_000);

test("offline agent attempt grades an immutable patch and rejects missing router evidence", async () => {
  const temp = await mkdtemp(join(tmpdir(), "rr-eval-offline-"));
  const repo = join(temp, "repo");
  const bin = join(temp, "bin");
  const flag = join(temp, "evidence-on");
  const manifest = join(temp, "manifest.json");
  const grader = join(temp, "grader.mjs");
  try {
    const commit = await gitFixture(repo);
    await fakeOpencode(bin, flag);
    await writeFile(
      grader,
      "import {readFileSync} from 'node:fs'; if (Object.keys(process.env).some((k) => k.startsWith('REASONING_ROUTER_') || k === 'UNRELATED_HOST_SECRET')) process.exit(2); if (!readFileSync(process.env.EVAL_PATCH_PATH, 'utf8').includes('+after')) process.exit(1);",
    );
    await writeFile(
      manifest,
      JSON.stringify({
        tasks: [
          {
            id: "fake-agent",
            repo,
            commit,
            prompt: "Change file",
            grade: [process.execPath, grader],
          },
        ],
      }),
    );
    const env = {
      PATH: `${bin}:${process.env.PATH}`,
      REASONING_ROUTER_UPSTREAM_API_KEY: "offline",
      UNRELATED_HOST_SECRET: "must-not-reach-grader",
    };
    const attempt = (arm, extra = {}) =>
      runEval(
        [
          "--manifest",
          manifest,
          "--task",
          "fake-agent",
          "--model",
          "gpt-6-sol",
          "--arm",
          arm,
        ],
        { ...env, ...extra },
      );
    for (const withEvidence of [true, false]) {
      if (withEvidence) await writeFile(flag, "yes");
      else await rm(flag);
      const path = attempt("high");
      const result = JSON.parse(await readFile(path, "utf8"));
      assert.equal(result.grade_passed, true);
      assert.equal(result.evidence_valid, withEvidence);
      assert.equal(result.output_tokens, withEvidence ? 2 : null);
      assert.equal(result.input_tokens, withEvidence ? 3 : null);
      assert.ok(
        (await readFile(join(dirname(path), "patch.diff"), "utf8")).includes(
          "+after",
        ),
      );
      assert.ok(
        (await readdir(dirname(path))).includes("session.json"),
        "the session export is saved",
      );
      assert.equal(worktrees(repo), 1);
      await rm(dirname(path), { recursive: true, force: true });
    }

    // A routed arm is valid only when its own classifier decided.
    await writeFile(flag, "yes");
    const routed = JSON.parse(
      await readFile(
        attempt("laya", {
          REASONING_ROUTER_CLASSIFIER_BASE_URL: "http://127.0.0.1:9",
        }),
        "utf8",
      ),
    );
    assert.equal(routed.evidence_valid, true);
    assert.deepEqual(routed.efforts, ["medium"]);
    assert.equal(routed.classifier_retries, 1);
    await rm(join(root, "eval/runs", routed.run_id), {
      recursive: true,
      force: true,
    });
    assert.throws(() => attempt("jev"), /REASONING_ROUTER_CLASSIFIER_API_KEY/);

    // The built-in SWE-bench grader starts; without a dataset it reports
    // infrastructure failure while evidence is still reconciled.
    const swebench = join(temp, "swebench.json");
    await writeFile(
      swebench,
      JSON.stringify({
        tasks: [
          {
            id: "fake-agent",
            repo,
            commit,
            prompt: "Change file",
            grade: "swebench",
          },
        ],
      }),
    );
    const swebenchResult = JSON.parse(
      await readFile(
        runEval(
          [
            "--manifest",
            swebench,
            "--task",
            "fake-agent",
            "--model",
            "gpt-6-sol",
            "--arm",
            "high",
          ],
          env,
        ),
        "utf8",
      ),
    );
    assert.equal(swebenchResult.grader_error, true);
    assert.equal(swebenchResult.grade_passed, null);
    assert.equal(swebenchResult.evidence_valid, true);
    assert.match(
      await readFile(
        join(root, "eval/runs", swebenchResult.run_id, "grade.log"),
        "utf8",
      ),
      /SWE_BENCH_DATASET_PATH/,
    );

    await writeFile(grader, "process.exit(2);");
    const erroredPath = attempt("high");
    const ungraded = JSON.parse(await readFile(erroredPath, "utf8"));
    assert.equal(ungraded.grade_passed, null);
    assert.equal(ungraded.grader_error, true);
    await rm(dirname(erroredPath), { recursive: true, force: true });
  } finally {
    for (const entry of await readdir(join(root, "eval/runs")).catch(() => []))
      if (entry.startsWith("fake-agent-"))
        await rm(join(root, "eval/runs", entry), {
          recursive: true,
          force: true,
        });
    await rm(temp, { recursive: true, force: true });
  }
}, 60_000);

test("SWE-bench grader rejects an unpinned dataset before running the harness", async () => {
  const temp = await mkdtemp(join(tmpdir(), "rr-eval-digest-"));
  try {
    const patch = join(temp, "patch.diff");
    await writeFile(patch, "");
    const grade = (dataset) =>
      spawnSync(
        process.execPath,
        ["eval/grade-swebench.mjs", "pallets__flask-5014"],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            ...cleanEnv,
            SWE_BENCH_DATASET_PATH: dataset,
            EVAL_PATCH_PATH: patch,
            EVAL_TASK_COMMIT: "7ee9ceb71e868944a46e1ff00b506772a53a4f1d",
          },
        },
      );
    // The name selects the committed eval/tasks/pilot.sha256 digest.
    const changed = join(temp, "swebench-pilot.json");
    await writeFile(
      changed,
      JSON.stringify([
        {
          instance_id: "pallets__flask-5014",
          base_commit: "7ee9ceb71e868944a46e1ff00b506772a53a4f1d",
        },
      ]),
    );
    const mismatch = grade(changed);
    assert.equal(mismatch.status, 2);
    assert.match(mismatch.stderr, /digest mismatch/);
    const missing = grade(join(temp, "swebench-missing.json"));
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /grader error/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}, 60_000);
