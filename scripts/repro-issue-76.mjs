// Reproduces issue 76 on a real OpenCode V2 host, isolated under /tmp/opencode:
// a session step that runs while OpenCode re-activates plugins sees the router
// alias or its wrap source missing. See docs/investigations/issue-76.md.
//
// Usage: npm run build && node scripts/repro-issue-76.mjs [before|after] [delayMs]
//   before: a plugin listed before the router reloads, so the router is
//           disposed too (`Model unavailable: reasoning-router/...`).
//   after:  a plugin listed after the router reloads, so OpenCode's
//           config-provider plugin is disposed (`source model ... not found`).
// OPENCODE_BIN selects the OpenCode binary (default: opencode on PATH).
// Exits 0 if the session completes and 1 if the failure reproduces.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { close, exists, listen, run, sleep } from "./smoke-helpers.mjs";

const order = process.argv[2] ?? "before";
const delayMs = Number(process.argv[3] ?? 3000);
assert.ok(["before", "after"].includes(order), "order must be before|after");
const opencode = process.env.OPENCODE_BIN ?? "opencode";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const routerDist = join(root, "packages/opencode/dist/plugin.js");
assert.ok(await exists(routerDist), "run npm run build first");
assert.ok(await exists("/tmp/opencode"), "/tmp/opencode must exist");

const temp = await mkdtemp("/tmp/opencode/reasoning-router-issue-76-");
const dirs = Object.fromEntries(
  ["home", "config", "data", "cache", "state", "project", "router", "slow"].map(
    (name) => [name, join(temp, name)],
  ),
);
await Promise.all(
  Object.values(dirs).map((dir) => mkdir(dir, { recursive: true })),
);
const events = join(temp, "events.log");
const mark = (event) => appendFileSync(events, `${Date.now()} ${event}\n`);
const markSource = `(e) => appendFileSync(${JSON.stringify(events)}, Date.now() + " " + e + "\\n")`;

// OpenCode loads a configured plugin directory from <dir>/index. Both wrappers
// record setup and disposal so the timeline shows the reload window.
for (const dir of [dirs.router, dirs.slow])
  await writeFile(join(dir, "package.json"), '{"type":"module"}');
await writeFile(
  join(dirs.router, "index.js"),
  `import { appendFileSync } from "node:fs";
import plugin from ${JSON.stringify(routerDist)};
const mark = ${markSource};
export default { id: plugin.id, async setup(ctx) {
  mark("router.setup.start");
  const dispose = await plugin.setup(ctx);
  mark("router.setup.end");
  return () => { mark("router.dispose"); return dispose(); };
} };
`,
);
// Rewriting a local plugin module makes OpenCode re-activate every plugin from
// it onward. Revision 1 widens the reload window with a slow setup.
const writeSlow = (revision) =>
  writeFile(
    join(dirs.slow, "index.js"),
    `import { appendFileSync } from "node:fs";
const mark = ${markSource};
export default { id: "issue-76-slow", async setup(ctx) {
  mark("slow${revision}.setup.start");
  if (${revision} > 0) await new Promise((r) => setTimeout(r, ctx.options.delayMs));
  mark("slow${revision}.setup.end");
  return () => mark("slow${revision}.dispose");
} };
`,
  );
await writeSlow(0);

const sse = (blocks, stop) =>
  [
    {
      type: "message_start",
      message: {
        id: "msg_issue_76",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    },
    ...blocks,
    {
      type: "message_delta",
      delta: { stop_reason: stop, stop_sequence: null },
      usage: { output_tokens: 1 },
    },
    { type: "message_stop" },
  ]
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
// Step 1 asks for a one-second shell command; step 2 starts after it, inside
// the reload window.
const toolCall = sse(
  [
    {
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "tool_use",
        id: "toolu_issue_76",
        name: "shell",
        input: {},
      },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: {
        type: "input_json_delta",
        partial_json: JSON.stringify({ command: "sleep 1" }),
      },
    },
    { type: "content_block_stop", index: 0 },
  ],
  "tool_use",
);
const text = sse(
  [
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "issue-76-done" },
    },
    { type: "content_block_stop", index: 0 },
  ],
  "end_turn",
);

let primaries = 0;
const upstream = createServer(async (request, response) => {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  const primary = (JSON.parse(raw).tools?.length ?? 0) > 0;
  mark(`upstream.${primary ? "primary" : "auxiliary"}`);
  response.writeHead(200, { "content-type": "text/event-stream" });
  if (primary && ++primaries === 1) {
    await writeSlow(1);
    response.end(toolCall);
    return;
  }
  response.end(text);
});
const port = await listen(upstream);

const slow = { package: dirs.slow, options: { delayMs } };
const router = {
  package: dirs.router,
  options: {
    fixedEffort: "high",
    wrap: { anthropic: ["src/claude-opus-5-5"] },
  },
};
await writeFile(
  join(dirs.project, "opencode.json"),
  JSON.stringify({
    plugins: order === "before" ? [slow, router] : [router, slow],
    providers: {
      src: {
        package: "@opencode/ai/providers/anthropic",
        settings: { baseURL: `http://127.0.0.1:${port}/v1`, apiKey: "fake" },
        models: {
          "claude-opus-5-5": {
            name: "Opus",
            limit: { context: 200000, output: 32000 },
          },
        },
      },
    },
    autoupdate: false,
    share: "disabled",
  }),
);

const env = {
  HOME: dirs.home,
  XDG_CONFIG_HOME: dirs.config,
  XDG_DATA_HOME: dirs.data,
  XDG_CACHE_HOME: dirs.cache,
  XDG_STATE_HOME: dirs.state,
  // Refuse every non-loopback connection; only the fake upstream is reachable.
  HTTPS_PROXY: "http://127.0.0.1:9",
  HTTP_PROXY: "http://127.0.0.1:9",
  NO_PROXY: "127.0.0.1,localhost",
  no_proxy: "127.0.0.1,localhost",
  PATH: process.env.PATH,
  LANG: "C",
  TERM: "dumb",
};
let child;
try {
  const version = run(opencode, ["--version"], { env }).trim();
  child = spawn(
    opencode,
    [
      "run",
      "--standalone",
      "--auto",
      "--format",
      "json",
      "--model",
      "reasoning-router/claude-opus-5-5",
      "Run the tool, then answer.",
    ],
    { cwd: dirs.project, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const exit = await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(60_000).then(() => "timeout"),
  ]);
  const lines = (await readFile(events, "utf8")).trim().split("\n");
  const start = Number(lines[0].split(" ")[0]);
  const errors = [
    ...new Set(
      output.match(
        /Model unavailable: [\w./-]+|reasoning-router: source model [^;"\\]+/g,
      ) ?? [],
    ),
  ];
  const completed = exit === 0 && output.includes("issue-76-done");
  console.log(
    JSON.stringify(
      {
        version,
        order,
        delayMs,
        exit,
        completed,
        errors,
        timeline: lines.map((line) => {
          const [time, event] = line.split(" ");
          return `+${Number(time) - start}ms ${event}`;
        }),
      },
      null,
      2,
    ),
  );
  process.exitCode = completed ? 0 : 1;
} finally {
  if (child && child.exitCode === null) child.kill("SIGTERM");
  await close(upstream);
  await rm(temp, { recursive: true, force: true });
}
