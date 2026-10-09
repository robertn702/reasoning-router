// Run a matched set: every task × arm, for several rounds, with the arm order
// rotated each round. Initiated attempts are never replaced or rerun.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CLASSIFIERS, EFFORTS, MODELS } from "./arms.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const name = option("--name");
const manifestPath = option("--manifest");
const model = option("--model");
const arms = option("--arms")?.split(",") ?? [];
const rounds = Number(option("--rounds") ?? 1);
const concurrency = Number(option("--concurrency") ?? 1);
if (
  !/^[a-zA-Z0-9_-]+$/.test(name ?? "") ||
  !manifestPath ||
  !MODELS.includes(model) ||
  !arms.length ||
  new Set(arms).size !== arms.length ||
  !arms.every((arm) => EFFORTS.includes(arm) || CLASSIFIERS.includes(arm)) ||
  !Number.isSafeInteger(rounds) ||
  rounds < 1 ||
  !Number.isSafeInteger(concurrency) ||
  concurrency < 1
) {
  throw new Error(
    "Usage: node eval/run-set.mjs --name NAME --manifest PATH --model MODEL --arms medium,high,jev [--tasks ID,ID] [--rounds N] [--concurrency N]",
  );
}
const manifestText = await readFile(resolve(manifestPath), "utf8");
const manifest = JSON.parse(manifestText).tasks;
const tasks = option("--tasks")?.split(",") ?? manifest.map((task) => task.id);
if (
  new Set(tasks).size !== tasks.length ||
  !tasks.every((id) => manifest.some((task) => task.id === id))
)
  throw new Error("--tasks must name distinct tasks from the manifest");
const output = (command, argv) => {
  const result = spawnSync(command, argv, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(`${command} ${argv.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
};
// Check grading inputs before any paid attempt; attempts are never replaced.
const graded = manifest.filter(
  (task) => tasks.includes(task.id) && task.grade === "swebench",
);
if (graded.length) {
  const dataset = process.env.SWE_BENCH_DATASET_PATH;
  const rows = dataset
    ? JSON.parse(await readFile(resolve(dataset), "utf8"))
    : [];
  if (
    !graded.every((task) =>
      rows.some(
        (row) => row.instance_id === task.id && row.base_commit === task.commit,
      ),
    )
  )
    throw new Error(
      "SWE_BENCH_DATASET_PATH must contain every SWE-bench task at its base commit",
    );
  output(process.env.SWE_BENCH_PYTHON ?? "python3", ["-c", "import swebench"]);
}
if (
  !process.env.REASONING_ROUTER_UPSTREAM_API_KEY ||
  (arms.some((arm) => ["jev", "clef", "openai-decisions"].includes(arm)) &&
    !process.env.REASONING_ROUTER_CLASSIFIER_API_KEY)
)
  throw new Error(
    "Missing REASONING_ROUTER_UPSTREAM_API_KEY or REASONING_ROUTER_CLASSIFIER_API_KEY",
  );
// Build now so the evaluated plugin matches the recorded commit. The harness
// tests skip it so they never rewrite dist/ under a live run set.
if (!process.env.EVAL_SKIP_BUILD) output("npm", ["run", "build"]);
const directory = join(root, "eval/runs", name);
await mkdir(join(root, "eval/runs"), { recursive: true });
await mkdir(directory); // Never silently repeat an existing run set.
const schedule = [];
for (let round = 1; round <= rounds; round++) {
  const shift = (round - 1) % arms.length;
  const order = [...arms.slice(shift), ...arms.slice(0, shift)];
  for (const task of tasks)
    for (const arm of order) schedule.push({ round, task, arm });
}
await writeFile(
  join(directory, "schedule.json"),
  `${JSON.stringify(
    {
      run_set: name,
      model,
      arms,
      tasks,
      rounds,
      concurrency,
      manifest: resolve(manifestPath),
      manifest_sha256: createHash("sha256").update(manifestText).digest("hex"),
      commit: output("git", ["rev-parse", "HEAD"]),
      dirty: output("git", ["status", "--porcelain"]) !== "",
      node: process.version,
      opencode: output(process.env.EVAL_OPENCODE_BIN ?? "opencode", [
        "--version",
      ]),
      schedule,
    },
    null,
    2,
  )}\n`,
);

const attempt = ({ round, task, arm }) =>
  new Promise((done) => {
    const log = join(directory, `r${round}-${task}-${arm}.log`);
    console.log(`START r${round} ${task} ${arm}`);
    const child = spawn(
      process.execPath,
      [
        join(root, "eval/run.mjs"),
        "--manifest",
        resolve(manifestPath),
        "--task",
        task,
        "--model",
        model,
        "--arm",
        arm,
      ],
      {
        cwd: root,
        env: { ...process.env, EVAL_RUN_SET: `${name}-r${round}` },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    child.on("error", (error) => chunks.push(Buffer.from(`${error.stack}\n`)));
    child.on("close", async (code) => {
      await writeFile(log, Buffer.concat(chunks));
      console.log(`DONE  r${round} ${task} ${arm} exit=${code}`);
      done({ round, task, arm, exit_code: code });
    });
  });
const queue = [...schedule];
const completed = [];
await Promise.all(
  Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) completed.push(await attempt(queue.shift()));
  }),
);
await writeFile(
  join(directory, "completed.json"),
  `${JSON.stringify(completed, null, 2)}\n`,
);
console.log(`COMPLETE ${name}: node eval/summarize.mjs --run-set ${name}`);
