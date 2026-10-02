import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  close,
  fakeAnthropicUpstream,
  fakeJevProxy,
  listen,
  packWorkspaces,
  run,
  sleep,
} from "./smoke-helpers.mjs";

// Runs the packed extension in a real Pi against loopback fakes. Set PI_BIN to
// test another Pi; it defaults to the pinned devDependency.
const VERSION = "1.0.0";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = "@reasoning-router/pi";
const pi =
  process.env.PI_BIN ??
  join(
    root,
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "dist",
    "bundle",
    "cli.js",
  );

const observed = {};
let anthropic;
let proxy;
let tls;
let child;
let temp;
try {
  temp = await mkdtemp(join(tmpdir(), "reasoning-router-pi-"));
  const dirs = Object.fromEntries(
    ["home", "agent", "ca", "project", "install"].map((name) => [
      name,
      join(temp, name),
    ]),
  );
  await Promise.all(
    Object.values(dirs).map((dir) => mkdir(dir, { recursive: true })),
  );

  const tarballs = packWorkspaces(
    root,
    [PACKAGE, "@reasoning-router/core", "@reasoning-router/classifiers"],
    temp,
    process.argv.slice(2),
  );
  assert.ok(tarballs.has(PACKAGE), `${PACKAGE} was not packed`);
  // Pi provides its own packages to extensions, so peers are not installed.
  run(
    "npm",
    [
      "install",
      "--prefix",
      dirs.install,
      "--omit=dev",
      "--omit=peer",
      "--no-audit",
      "--no-fund",
      ...tarballs.values(),
    ],
    { stdio: "ignore" },
  );
  const installed = join(dirs.install, "node_modules", PACKAGE);

  anthropic = fakeAnthropicUpstream(observed);
  const anthropicPort = await listen(anthropic);
  const fake = await fakeJevProxy(dirs.ca, observed, "low");
  ({ proxy, tls } = fake);
  const decisionsLogPath = join(temp, "decisions.jsonl");
  await writeFile(
    join(dirs.agent, "models.json"),
    JSON.stringify({
      providers: {
        anthropic: {
          baseUrl: `http://127.0.0.1:${anthropicPort}`,
          apiKey: "fake-anthropic-key",
        },
      },
    }),
  );

  const env = {
    HOME: dirs.home,
    PI_CODING_AGENT_DIR: dirs.agent,
    PI_OFFLINE: "1",
    PI_SKIP_VERSION_CHECK: "1",
    PI_TELEMETRY: "0",
    HTTPS_PROXY: `http://127.0.0.1:${fake.port}`,
    HTTP_PROXY: `http://127.0.0.1:${fake.port}`,
    NO_PROXY: "127.0.0.1,localhost",
    no_proxy: "127.0.0.1,localhost",
    NODE_EXTRA_CA_CERTS: fake.cert,
    REASONING_ROUTER_CLASSIFIER_API_KEY: "fake-jev-key",
    REASONING_ROUTER_DECISIONS_LOG_PATH: decisionsLogPath,
    PATH: process.env.PATH,
    LANG: "C",
    TERM: "dumb",
  };
  const piRun = async (args) => {
    child = spawn(process.execPath, [pi, ...args], {
      cwd: dirs.project,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    const exit = await new Promise((resolve) => child.once("exit", resolve));
    assert.equal(exit, 0, `pi ${args.join(" ")} failed:\n${output}`);
    return output;
  };

  assert.equal((await piRun(["--version"])).trim(), VERSION);
  await piRun(["install", installed]);
  const output = await piRun([
    "--print",
    "--no-session",
    "--no-tools",
    "--model",
    "reasoning-router/claude-opus-5-5",
    "Reply with smoke.",
  ]);
  assert.match(output, /smoke/, "Pi did not consume the fake Messages SSE");

  assert.ok(observed.jev, "the fake Jev classifier received no request");
  assert.match(observed.jev.authorization ?? "", /fake-jev-key/);
  assert.equal(observed.jev.body.state.model, "claude-opus-5-5");
  assert.match(observed.jev.body.state.recent_user_text, /Reply with smoke/);
  assert.equal(observed.anthropicCount, 1);
  const { url, headers, body } = observed.anthropic;
  assert.match(url, /^\/v1\/messages(\?|$)/);
  assert.equal(headers["x-api-key"], "fake-anthropic-key");
  assert.match(
    headers["anthropic-beta"] ?? "",
    /mid-conversation-output-config/,
  );
  assert.equal(body.model, "claude-opus-5-5");
  assert.equal(body.thinking?.type, "adaptive");
  assert.equal(body.output_config?.effort, "high", "Pi pins the base effort");
  const efforts = body.messages
    .filter((message) => message.role === "system")
    .map((message) => message.output_config?.effort);
  assert.deepEqual(efforts, ["low"], "missing the classified effort message");

  const events = (await readFile(decisionsLogPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "ReasoningDecision");
  assert.equal(events[0].model, "claude-opus-5-5");
  assert.equal(events[0].effort, "low");
  assert.equal(events[0].classifier, "jev");
  assert.equal(events[0].outcome, "completed");
  assert.doesNotMatch(
    JSON.stringify(events),
    /fake-jev-key|fake-anthropic-key|Reply with smoke/,
    "decision log leaked a credential or prompt",
  );
  assert.equal(
    observed.blocked,
    undefined,
    `blocked non-fake outbound hosts: ${observed.blocked}`,
  );
  console.log(
    `PASS Pi ${VERSION} packaged extension smoke: classified low effort placed as an effort-only system message on Claude Messages.`,
  );
} finally {
  if (child && child.exitCode === null) child.kill("SIGTERM");
  if (child && child.exitCode === null)
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      sleep(2_000),
    ]);
  if (anthropic) await close(anthropic);
  if (proxy) await close(proxy);
  if (tls) await close(tls);
  if (temp) await rm(temp, { recursive: true, force: true });
}
