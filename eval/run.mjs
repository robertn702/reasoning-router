import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CLASSIFIERS, EFFORTS, MODELS } from "./arms.mjs";
import { reconcileEvidence } from "./evidence.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KEYLESS = ["laya", "kev"];
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const prepareOnly = args.includes("--prepare-only");
const manifestPath = option("--manifest");
const taskId = option("--task");
const model = option("--model");
const arm = option("--arm");
const routed = CLASSIFIERS.includes(arm);
const containerImage = process.env.EVAL_AGENT_IMAGE;
const opencode = process.env.EVAL_OPENCODE_BIN ?? "opencode";
let activeContainer = null;
const activeChildren = new Set();
process.on("SIGTERM", () => {
  for (const child of activeChildren) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      /* exited */
    }
  }
  if (activeContainer)
    spawn("docker", ["rm", "-f", activeContainer], { stdio: "ignore" }).on(
      "close",
      () => process.exit(143),
    );
  else process.exit(143);
});
if (
  !manifestPath ||
  !taskId ||
  !MODELS.includes(model) ||
  !(EFFORTS.includes(arm) || routed)
) {
  throw new Error(
    `Usage: node eval/run.mjs --manifest PATH --task ID --model ${MODELS.join("|")} --arm ${[...EFFORTS, ...CLASSIFIERS].join("|")} [--prepare-only]`,
  );
}
if (containerImage && !isAbsolute(opencode)) {
  throw new Error("EVAL_AGENT_IMAGE requires an absolute EVAL_OPENCODE_BIN");
}
const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8"));
const task = manifest.tasks.find((item) => item.id === taskId);
const remote =
  typeof task?.repo === "string" &&
  /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\.git$/.test(
    task.repo,
  );
const grader =
  task?.grade === "swebench"
    ? [process.execPath, join(root, "eval/grade-swebench.mjs"), task.id]
    : task?.grade;
if (
  !task ||
  !/^[a-zA-Z0-9_-]+$/.test(task.id) ||
  !/^\w{40}$/.test(task.commit) ||
  typeof task.repo !== "string" ||
  !(task.repo.startsWith("/") || remote) ||
  typeof task.prompt !== "string" ||
  !task.prompt.trim() ||
  !Array.isArray(grader) ||
  !grader.length ||
  !grader.every((v) => typeof v === "string" && v.length > 0) ||
  !grader[0].startsWith("/") ||
  grader.some((arg) => arg === task.repo || arg.startsWith(`${task.repo}/`)) ||
  resolve(task.repo) === root ||
  root.startsWith(`${resolve(task.repo)}/`) ||
  (task.agentTimeoutMinutes !== undefined &&
    (!Number.isSafeInteger(task.agentTimeoutMinutes) ||
      task.agentTimeoutMinutes < 1 ||
      task.agentTimeoutMinutes > 60))
) {
  throw new Error(
    "Task missing or invalid: require pinned repo, commit, prompt, independent absolute grader argv",
  );
}
const runId = `${task.id}-${model}-${arm}-${randomUUID()}`;
const dir = join(root, "eval/runs", runId);
const worktree = join(dir, "worktree");
const taskRepo = remote ? join(dir, "source.git") : task.repo;
await mkdir(dir, { recursive: true, mode: 0o700 });
await chmod(dir, 0o700);
const save = async (name, contents) =>
  writeFile(join(dir, name), contents, { mode: 0o600 });
const run = (command, argv, opts = {}) =>
  new Promise((done, reject) => {
    const child = spawn(command, argv, {
      cwd: opts.cwd ?? root,
      env: opts.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    activeChildren.add(child);
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (part) => stdout.push(part));
    child.stderr.on("data", (part) => stderr.push(part));
    let timedOut = false;
    const stop = () => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* exited */
      }
    };
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          stop();
        }, opts.timeoutMs)
      : null;
    child.on("error", (error) => {
      activeChildren.delete(child);
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      activeChildren.delete(child);
      if (timer) clearTimeout(timer);
      done({
        code,
        timedOut,
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
      });
    });
  });
const git = (argv, cwd) => run("git", argv, { cwd });
const parseLines = (text) =>
  text
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
if (remote) {
  const initialized = await git(["init", "--bare", taskRepo]);
  if (initialized.code !== 0)
    throw new Error(`Failed to initialize task source: ${initialized.stderr}`);
  const fetched = await git([
    "-C",
    taskRepo,
    "fetch",
    "--depth=1",
    "--no-tags",
    task.repo,
    task.commit,
  ]);
  if (fetched.code !== 0)
    throw new Error(`Failed to fetch pinned task commit: ${fetched.stderr}`);
}
const checkout = await git([
  "-C",
  taskRepo,
  "worktree",
  "add",
  "--detach",
  worktree,
  task.commit,
]);
if (checkout.code !== 0)
  throw new Error(`Failed to create worktree: ${checkout.stderr}`);

const result = {
  run_id: runId,
  run_set: process.env.EVAL_RUN_SET ?? null,
  task: task.id,
  model,
  arm,
  commit: task.commit,
  prepared: false,
  grade_passed: null,
  grader_error: false,
  elapsed_ms: null,
  exit_code: null,
  timed_out: false,
  requests: 0,
  efforts: [],
  fallbacks: 0,
  classifier_retries: 0,
  input_tokens: null,
  cached_input_tokens: null,
  output_tokens: null,
};
try {
  const classifier = { provider: arm, timeoutMs: 10_000 };
  for (const [key, name] of [
    ["baseUrl", "REASONING_ROUTER_CLASSIFIER_BASE_URL"],
    ["accountId", "REASONING_ROUTER_CLASSIFIER_ACCOUNT_ID"],
    ["model", "REASONING_ROUTER_CLASSIFIER_MODEL"],
  ]) {
    if (process.env[name]) classifier[key] = process.env[name];
  }
  if (process.env.REASONING_ROUTER_CLASSIFIER_API_KEY)
    classifier.apiKey = "{env:REASONING_ROUTER_CLASSIFIER_API_KEY}";
  // OpenCode does not load a local plugin directory whose entry is in a
  // subdirectory such as dist/, so a root-level shim re-exports the build.
  await mkdir(join(dir, "plugin"), { mode: 0o700 });
  await save(
    "plugin/package.json",
    `${JSON.stringify({ name: "reasoning-router-eval", private: true, type: "module", exports: { ".": { default: "./index.js" } } })}\n`,
  );
  await save(
    "plugin/index.js",
    `export { default } from ${JSON.stringify(join(containerImage ? "/router" : root, "packages/opencode/dist/plugin.js"))};\n`,
  );
  const config = {
    $schema: "https://opencode.ai/config.json",
    plugins: [
      {
        package: join(dir, "plugin"),
        options: {
          // Routed arms fail closed: no fallback effort can rescue an attempt.
          ...(routed
            ? { classifier, maxRetries: 3, fallbackMode: "error" }
            : { fixedEffort: arm }),
          wrap: { openai: [`upstream/${model}`] },
          decisionsLogPath: join(dir, "decisions.jsonl"),
        },
      },
    ],
    providers: {
      upstream: {
        package: "@opencode/ai/providers/openai/responses",
        settings: {
          baseURL:
            process.env.REASONING_ROUTER_UPSTREAM_BASE_URL ??
            "http://127.0.0.1:8317/v1",
          apiKey: "{env:REASONING_ROUTER_UPSTREAM_API_KEY}",
        },
        models: { [model]: { name: model } },
      },
    },
    model: `reasoning-router/${model}`,
    autoupdate: false,
    share: "disabled",
  };
  await save("opencode.json", `${JSON.stringify(config, null, 2)}\n`);
  result.prepared = true;
  if (!prepareOnly) {
    if (
      !process.env.REASONING_ROUTER_UPSTREAM_API_KEY ||
      (routed &&
        !KEYLESS.includes(arm) &&
        !process.env.REASONING_ROUTER_CLASSIFIER_API_KEY)
    )
      throw new Error(
        "Missing REASONING_ROUTER_UPSTREAM_API_KEY or REASONING_ROUTER_CLASSIFIER_API_KEY",
      );
    const home = join(dir, "home");
    await mkdir(home, { mode: 0o700 });
    for (const name of ["config", "data", "cache", "state"])
      await mkdir(join(home, name), { mode: 0o700 });
    const secrets = ["REASONING_ROUTER_UPSTREAM_API_KEY"];
    if (routed && process.env.REASONING_ROUTER_CLASSIFIER_API_KEY)
      secrets.push("REASONING_ROUTER_CLASSIFIER_API_KEY");
    const agentEnv = {
      // A container keeps its image PATH; /usr/local/bin holds the mounted opencode.
      ...(containerImage ? {} : { PATH: process.env.PATH }),
      HOME: home,
      XDG_CONFIG_HOME: join(home, "config"),
      XDG_DATA_HOME: join(home, "data"),
      XDG_CACHE_HOME: join(home, "cache"),
      XDG_STATE_HOME: join(home, "state"),
      OPENCODE_CONFIG: join(dir, "opencode.json"),
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      ...Object.fromEntries(secrets.map((name) => [name, process.env[name]])),
    };
    const opencodeArgs = [
      "run",
      "--standalone",
      "--model",
      `reasoning-router/${model}`,
      "--format",
      "json",
      task.prompt,
    ];
    const containerName = `reasoning-router-agent-${randomUUID()}`;
    activeContainer = containerImage ? containerName : null;
    // Secrets are passed by name so their values stay out of docker's argv.
    const dockerArgs = [
      "run",
      "--rm",
      "--name",
      containerName,
      "--network",
      "host",
      "--user",
      `${process.getuid()}:${process.getgid()}`,
      "--mount",
      `type=bind,src=${dir},dst=${dir}`,
      "--mount",
      `type=bind,src=${join(root, "packages")},dst=/router/packages,readonly`,
      "--mount",
      `type=bind,src=${join(root, "node_modules")},dst=/router/node_modules,readonly`,
      "--mount",
      `type=bind,src=${opencode},dst=/usr/local/bin/opencode,readonly`,
      "--tmpfs",
      "/tmp:rw,nosuid,nodev,size=512m",
      "--workdir",
      worktree,
      ...Object.entries(agentEnv).flatMap(([key, value]) => [
        "--env",
        secrets.includes(key) ? key : `${key}=${value}`,
      ]),
      containerImage,
      "opencode",
      ...opencodeArgs,
    ];
    const start = performance.now();
    let oc;
    try {
      oc = await run(
        containerImage ? "docker" : opencode,
        containerImage ? dockerArgs : opencodeArgs,
        {
          cwd: worktree,
          timeoutMs: (task.agentTimeoutMinutes ?? 15) * 60_000,
          env: containerImage ? process.env : agentEnv,
        },
      );
    } finally {
      if (containerImage)
        await run("docker", ["rm", "-f", containerName], { timeoutMs: 15_000 });
      activeContainer = null;
    }
    result.elapsed_ms = Math.round(performance.now() - start);
    result.exit_code = oc.code;
    result.timed_out = oc.timedOut;
    await save("output.jsonl", oc.stdout);
    await save("stderr.log", oc.stderr);
    // Intent-to-add captures new agent files without staging their contents.
    const added = await git(["add", "-N", "."], worktree);
    if (added.code !== 0)
      throw new Error(`Failed to capture new files: ${added.stderr}`);
    const patch = await git(["diff", "--binary", task.commit], worktree);
    if (patch.code !== 0)
      throw new Error(`Failed to capture patch: ${patch.stderr}`);
    await save("patch.diff", patch.stdout);
    const output = parseLines(oc.stdout);
    const agentError = output.some((event) => event.type === "error");
    result.agent_error = agentError;
    let classificationErrors = 0;
    try {
      classificationErrors = parseLines(
        await readFile(join(dir, "decisions.jsonl"), "utf8"),
      ).filter((e) => e.outcome === "classification_failed").length;
    } catch {
      /* Missing evidence is rejected during reconciliation below. */
    }
    result.classification_errors = classificationErrors;
    if (oc.code === 0 && !oc.timedOut && !agentError && !classificationErrors) {
      // The grader runs outside the agent-writable checkout and receives only
      // its patch and pinned source. An adapter must apply the patch to a fresh
      // checkout and use tests that are not taken from agent-modified files.
      const dockerEnv = Object.fromEntries(
        [
          "DOCKER_HOST",
          "DOCKER_CONFIG",
          "DOCKER_CERT_PATH",
          "DOCKER_TLS_VERIFY",
        ]
          .filter((key) => process.env[key])
          .map((key) => [key, process.env[key]]),
      );
      // A grader that cannot start is infrastructure, not a failed solution.
      const grade = await run(grader[0], grader.slice(1), {
        cwd: dir,
        timeoutMs: task.grade === "swebench" ? 30 * 60_000 : 120_000,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          ...dockerEnv,
          ...Object.fromEntries(
            [
              "SWE_BENCH_DATASET_PATH",
              "SWE_BENCH_PYTHON",
              "EVAL_DATASET_DIGEST_FILE",
            ]
              .filter((key) => process.env[key])
              // The grader runs in the attempt directory, so pin relative paths.
              .map((key) => [
                key,
                key === "SWE_BENCH_PYTHON" && !process.env[key].includes("/")
                  ? process.env[key]
                  : resolve(process.env[key]),
              ]),
          ),
          EVAL_PATCH_PATH: join(dir, "patch.diff"),
          EVAL_TASK_REPO: taskRepo,
          EVAL_TASK_COMMIT: task.commit,
        },
      }).catch((error) => ({
        code: null,
        timedOut: false,
        stdout: "",
        stderr: `Grader failed to start: ${error.message}\n`,
      }));
      result.grader_error =
        grade.timedOut || (grade.code !== 0 && grade.code !== 1);
      result.grade_passed = result.grader_error ? null : grade.code === 0;
      await save("grade.log", grade.stdout + grade.stderr);
    } // An incomplete agent run was not submitted to the benchmark grader.
    // Steps come from the stored session, which records each model call's
    // time and usage whether or not OpenCode streamed step events.
    let messages = [];
    const sessionID = output.find(
      (event) =>
        typeof event.sessionID === "string" &&
        /^ses_[a-zA-Z0-9]+$/.test(event.sessionID),
    )?.sessionID;
    if (sessionID) {
      const exported = await run(
        opencode,
        ["session", "export", "--standalone", sessionID],
        {
          cwd: worktree,
          env: { ...agentEnv, PATH: process.env.PATH },
          timeoutMs: 120_000,
        },
      );
      if (exported.code === 0) {
        await save("session.json", exported.stdout);
        try {
          messages = JSON.parse(exported.stdout).messages ?? [];
        } catch {
          /* An unreadable export is rejected during reconciliation below. */
        }
      }
    }
    // Decision logging is asynchronous; allow the queue to flush after OpenCode exits.
    let evidence = "";
    let stable = 0;
    for (let i = 0; i < 30; i++) {
      await new Promise((done) => setTimeout(done, 100));
      let next = "";
      try {
        next = await readFile(join(dir, "decisions.jsonl"), "utf8");
      } catch {
        /* no decisions yet */
      }
      stable = next && next === evidence ? stable + 1 : 0;
      evidence = next;
      if (stable >= 3) break;
    }
    const lines = evidence.trim().split("\n").filter(Boolean);
    const events = parseLines(evidence);
    result.requests = events.length;
    result.efforts = events.map((e) => e.effort);
    result.fallbacks = events.filter((e) => e.fallback).length;
    result.classifier_retries = events.reduce(
      (sum, e) => sum + Math.max(0, (e.classifier_attempts ?? 1) - 1),
      0,
    );
    const usage = reconcileEvidence(events, messages);
    result.evidence_valid =
      usage !== null &&
      events.length === lines.length &&
      events.every(
        (e) =>
          e.event === "ReasoningDecision" &&
          e.model === model &&
          e.outcome === "completed" &&
          e.fallback === null &&
          (routed ? e.classifier === arm : e.effort === arm),
      );
    for (const field of [
      "input_tokens",
      "cached_input_tokens",
      "output_tokens",
    ])
      result[field] = result.evidence_valid ? usage[field] : null;
  }
} finally {
  await save("result.json", `${JSON.stringify(result, null, 2)}\n`);
  const removed = await git([
    "-C",
    taskRepo,
    "worktree",
    "remove",
    "--force",
    worktree,
  ]);
  if (removed.code !== 0)
    console.error(`Worktree cleanup failed: ${removed.stderr}`);
  if (remote) await rm(taskRepo, { recursive: true, force: true });
}
console.log(join(dir, "result.json"));
