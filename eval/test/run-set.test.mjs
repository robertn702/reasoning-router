import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { fakeOpencode, gitFixture } from "./fixtures.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const runs = join(root, "eval/runs");

test("a matched run set rotates arms, refuses reuse, and summarizes metadata only", async () => {
  const temp = await mkdtemp(join(tmpdir(), "rr-eval-set-"));
  const name = `test-${randomUUID()}`;
  const repo = join(temp, "repo");
  const bin = join(temp, "bin");
  const flag = join(temp, "evidence-on");
  const manifest = join(temp, "manifest.json");
  const out = join(temp, "report.md");
  try {
    const commit = await gitFixture(repo);
    await fakeOpencode(bin, flag);
    await writeFile(flag, "yes");
    await writeFile(
      manifest,
      JSON.stringify({
        tasks: [
          {
            id: "set-task",
            repo,
            commit,
            prompt: "Secret prompt text",
            grade: [process.execPath, "--version"],
          },
        ],
      }),
    );
    const env = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => !/^(REASONING_ROUTER_|EVAL_|SWE_BENCH_)/.test(key),
        ),
      ),
      EVAL_SKIP_BUILD: "1",
      PATH: `${bin}:${process.env.PATH}`,
      REASONING_ROUTER_UPSTREAM_API_KEY: "offline",
    };
    const args = [
      "eval/run-set.mjs",
      "--name",
      name,
      "--manifest",
      manifest,
      "--model",
      "gpt-6-sol",
      "--arms",
      "medium,high",
      "--rounds",
      "2",
      "--concurrency",
      "2",
    ];
    execFileSync(process.execPath, args, { cwd: root, env, stdio: "pipe" });
    const plan = JSON.parse(
      await readFile(join(runs, name, "schedule.json"), "utf8"),
    );
    assert.deepEqual(
      plan.schedule.map(({ round, arm }) => `${round}${arm}`),
      ["1medium", "1high", "2high", "2medium"],
    );
    assert.equal(plan.opencode, "opencode v0.0.0-fake");
    assert.equal(
      spawnSync(process.execPath, args, { cwd: root, env }).status,
      1,
      "an existing run set must not be rerun",
    );

    execFileSync(
      process.execPath,
      ["eval/summarize.mjs", "--run-set", name, "--out", out],
      { cwd: root },
    );
    const report = await readFile(out, "utf8");
    assert.match(report, /\| medium \| 2\/2 \| 2 \| 2\/2 \|/);
    assert.match(report, /\| high \| 2\/2 \| 2 \| 2\/2 \|/);
    assert.doesNotMatch(report, /Secret prompt text/);

    const [attempt] = (await readdir(runs)).filter((entry) =>
      entry.startsWith("set-task-"),
    );
    await rm(join(runs, attempt), { recursive: true, force: true });
    const incomplete = spawnSync(
      process.execPath,
      ["eval/summarize.mjs", "--run-set", name, "--out", out],
      { cwd: root, encoding: "utf8" },
    );
    assert.notEqual(incomplete.status, 0);
    assert.match(incomplete.stderr, /Incomplete run set/);
  } finally {
    for (const entry of await readdir(runs).catch(() => []))
      if (entry === name || entry.startsWith("set-task-"))
        await rm(join(runs, entry), { recursive: true, force: true });
    await rm(temp, { recursive: true, force: true });
  }
}, 60_000);
