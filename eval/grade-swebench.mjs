#!/usr/bin/env node
// Submit the saved patch to the official SWE-bench Docker harness; never run agent-written tests.
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Any unexpected adapter failure is infrastructure, never a failed solution.
process.on("uncaughtException", (error) => {
  console.error(`SWE-bench grader error: ${error.message}`);
  process.exit(2);
});

const id = process.argv[2];
const dir = process.cwd();
const dataset = process.env.SWE_BENCH_DATASET_PATH;
const root = dirname(fileURLToPath(import.meta.url));
if (
  !/^[a-zA-Z0-9_-]+$/.test(id ?? "") ||
  !dataset ||
  !process.env.EVAL_PATCH_PATH
) {
  console.error(
    "Expected instance ID, SWE_BENCH_DATASET_PATH, and EVAL_PATCH_PATH",
  );
  process.exit(2);
}
const contents = readFileSync(dataset);
// eval/prepare.py writes runs/swebench-<set>.json; its pinned digest is tasks/<set>.sha256.
const set = basename(dataset).match(/^swebench-([a-z0-9-]+)\.json$/)?.[1];
const digestFile =
  process.env.EVAL_DATASET_DIGEST_FILE ??
  (set ? join(root, "tasks", `${set}.sha256`) : undefined);
if (!digestFile) {
  console.error(
    "Name the dataset swebench-<set>.json or set EVAL_DATASET_DIGEST_FILE",
  );
  process.exit(2);
}
const expected = readFileSync(digestFile, "utf8").trim();
if (createHash("sha256").update(contents).digest("hex") !== expected) {
  console.error("Pinned SWE-bench dataset digest mismatch");
  process.exit(2);
}
const rows = JSON.parse(contents.toString("utf8"));
const row = rows.find((item) => item.instance_id === id);
if (!row || row.base_commit !== process.env.EVAL_TASK_COMMIT) {
  console.error("Instance or base commit does not match the pinned dataset");
  process.exit(2);
}
const patch = readFileSync(process.env.EVAL_PATCH_PATH, "utf8");
if (!patch.trim()) {
  console.log(
    JSON.stringify({ instance_id: id, resolved: false, reason: "empty_patch" }),
  );
  process.exit(1);
}
const modelName = "reasoning-router-eval";
const predictions = join(dir, "prediction.jsonl");
writeFileSync(
  predictions,
  `${JSON.stringify({ instance_id: id, model_name_or_path: modelName, model_patch: patch })}\n`,
  { mode: 0o600 },
);
const runId = `eval-${randomUUID()}`;
const run = spawnSync(
  process.env.SWE_BENCH_PYTHON ?? "python3",
  [
    "-m",
    "swebench.harness.run_evaluation",
    "--dataset_name",
    dataset,
    "--predictions_path",
    predictions,
    "--instance_ids",
    id,
    "--max_workers",
    "1",
    "--run_id",
    runId,
  ],
  {
    cwd: dir,
    encoding: "utf8",
    timeout: 28 * 60_000,
    maxBuffer: 10 * 1024 * 1024,
  },
);
if (run.stdout) process.stdout.write(run.stdout);
if (run.stderr) process.stderr.write(run.stderr);
if (run.error || run.status !== 0) {
  console.error(run.error?.message ?? `SWE-bench harness exited ${run.status}`);
  process.exit(2);
}
let report;
try {
  report = JSON.parse(
    readFileSync(
      join(dir, "logs/evaluation", runId, modelName, id, "report.json"),
      "utf8",
    ),
  );
} catch (error) {
  console.error(`SWE-bench report unavailable: ${error.message}`);
  process.exit(2);
}
if (typeof report[id]?.resolved !== "boolean") {
  console.error("SWE-bench report missing resolved status");
  process.exit(2);
}
console.log(JSON.stringify({ instance_id: id, resolved: report[id].resolved }));
process.exit(report[id].resolved ? 0 : 1);
