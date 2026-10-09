import { execFileSync } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function gitFixture(repo) {
  execFileSync("git", ["init", "-q", repo]);
  await writeFile(join(repo, "file.txt"), "before\n");
  execFileSync("git", ["-C", repo, "add", "file.txt"]);
  execFileSync("git", [
    "-C",
    repo,
    "-c",
    "user.name=Eval",
    "-c",
    "user.email=eval@example.test",
    "commit",
    "-qm",
    "fixture",
  ]);
  return execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

// A fake `opencode` that edits file.txt, makes one model call, logs one
// matching decision when `evidenceFlag` exists, and exports the session.
export async function fakeOpencode(bin, evidenceFlag) {
  await mkdir(bin, { recursive: true });
  const path = join(bin, "opencode");
  await writeFile(
    path,
    `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
const session = require("node:path").join(process.env.XDG_DATA_HOME ?? "/nonexistent", "session.json");
if (args[0] === "--version") { console.log("opencode v0.0.0-fake"); process.exit(0); }
if (args[0] === "session" && args[1] === "export") { process.stdout.write(fs.readFileSync(session)); process.exit(0); }
fs.writeFileSync("file.txt", "after\\n");
const start = Date.now() - 100;
const tokens = { input: 3, output: 2, reasoning: 0, cache: { read: 0, write: 0 } };
fs.writeFileSync(session, JSON.stringify({ info: {}, messages: [
  { type: "user", time: { created: start - 10 } },
  { type: "assistant", time: { created: start, completed: start + 100 }, tokens },
] }));
console.log(JSON.stringify({ type: "text", sessionID: "ses_fake1", part: {} }));
if (fs.existsSync(${JSON.stringify(evidenceFlag)})) {
  const options = JSON.parse(fs.readFileSync(process.env.OPENCODE_CONFIG)).plugins[0].options;
  const routed = options.classifier !== undefined;
  fs.writeFileSync(options.decisionsLogPath, JSON.stringify({ ts: new Date(start + 50).toISOString(), event: "ReasoningDecision",
    model: args[args.indexOf("--model") + 1].split("/")[1], effort: routed ? "medium" : options.fixedEffort,
    ...(routed ? { classifier: options.classifier.provider, classifier_attempts: 2 } : {}), fallback: null,
    outcome: "completed", input_tokens: 3, cached_input_tokens: 0, output_tokens: 2 }) + "\\n");
}
`,
  );
  await chmod(path, 0o755);
}
