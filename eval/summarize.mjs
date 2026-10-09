// Publish metadata only: a Markdown report for one complete run set.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const name = option("--run-set");
if (!/^[a-zA-Z0-9_-]+$/.test(name ?? ""))
  throw new Error("Usage: node eval/summarize.mjs --run-set NAME [--out PATH]");
const runs = join(root, "runs");
const plan = JSON.parse(
  await readFile(join(runs, name, "schedule.json"), "utf8"),
);
const key = (round, task, arm) => `r${round}/${task}/${arm}`;
const scheduled = new Set(
  plan.schedule.map(({ round, task, arm }) => key(round, task, arm)),
);
const rows = [];
for (const entry of await readdir(runs)) {
  let result;
  try {
    result = JSON.parse(
      await readFile(join(runs, entry, "result.json"), "utf8"),
    );
  } catch {
    continue;
  }
  const round = result.run_set?.startsWith(`${name}-r`)
    ? Number(result.run_set.slice(name.length + 2))
    : null;
  if (!round || result.model !== plan.model) continue;
  const id = key(round, result.task, result.arm);
  if (!scheduled.has(id) || rows.some((row) => row.id === id))
    throw new Error(`Unexpected or duplicate attempt: ${id}`);
  rows.push({ ...result, id, round });
}
const missing = [...scheduled].filter(
  (id) => !rows.some((row) => row.id === id),
);
if (missing.length)
  throw new Error(`Incomplete run set ${name}: missing ${missing.join(", ")}`);
rows.sort(
  (a, b) =>
    a.round - b.round ||
    a.task.localeCompare(b.task) ||
    plan.arms.indexOf(a.arm) - plan.arms.indexOf(b.arm),
);

const cell = (value) =>
  value === null || value === undefined ? "—" : String(value);
const mean = (group, field) => {
  const values = group
    .map((row) => row[field])
    .filter((value) => Number.isFinite(value));
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
};
const round1 = (value) => (value === null ? "—" : value.toFixed(1));
const lines = [
  `# Run set \`${name}\``,
  "",
  `Model \`${plan.model}\`; arms ${plan.arms.map((arm) => `\`${arm}\``).join(", ")}; ${plan.rounds} round(s) with rotated arm order; concurrency ${plan.concurrency}. Router commit \`${plan.commit}\`${plan.dirty ? " (uncommitted changes)" : ""}; Node \`${plan.node}\`; \`${plan.opencode}\`; manifest SHA-256 \`${plan.manifest_sha256}\`.`,
  "",
  "Routed arms (named by classifier) ran with three classifier retries, a 10-second classification deadline, and fallback disabled. All initiated attempts are included; none were replaced.",
];
for (const task of plan.tasks) {
  lines.push(
    "",
    `## ${task}`,
    "",
    "| Arm | Solved / initiated | Graded | Evidence valid | Mean seconds | Mean input | Mean cached input | Mean output |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const arm of plan.arms) {
    const group = rows.filter((row) => row.task === task && row.arm === arm);
    const valid = group.filter((row) => row.evidence_valid);
    const seconds = mean(group, "elapsed_ms");
    lines.push(
      `| ${arm} | ${group.filter((row) => row.grade_passed === true).length}/${group.length} | ${group.filter((row) => row.grade_passed !== null).length} | ${valid.length}/${group.length} | ${round1(seconds === null ? null : seconds / 1000)} | ${round1(mean(valid, "input_tokens"))} | ${round1(mean(valid, "cached_input_tokens"))} | ${round1(mean(valid, "output_tokens"))} |`,
    );
  }
}
const routed = rows.filter(
  (row) => !["medium", "high", "xhigh"].includes(row.arm),
);
if (routed.length) {
  lines.push("", "## Routing", "");
  for (const arm of plan.arms.filter((arm) =>
    routed.some((row) => row.arm === arm),
  )) {
    const valid = routed.filter((row) => row.arm === arm && row.evidence_valid);
    const counts = new Map();
    for (const row of valid)
      for (const effort of row.efforts)
        counts.set(effort, (counts.get(effort) ?? 0) + 1);
    lines.push(
      `- \`${arm}\`, across ${valid.length} evidence-valid attempts: ${[...counts].map(([effort, count]) => `${effort} ${count}`).join(", ") || "no decisions"}. Fallbacks: ${valid.reduce((sum, row) => sum + row.fallbacks, 0)}. Classifier retries: ${valid.reduce((sum, row) => sum + (row.classifier_retries ?? 0), 0)}.`,
    );
  }
}
lines.push(
  "",
  "## Individual attempts",
  "",
  "| Round | Task | Arm | Solved | Agent error | Classification errors | Timeout | Grader error | Evidence valid | Seconds | Output tokens | Run ID |",
  "| ---: | --- | --- | --- | --- | ---: | --- | --- | --- | ---: | ---: | --- |",
);
for (const row of rows) {
  lines.push(
    `| ${row.round} | ${row.task} | ${row.arm} | ${cell(row.grade_passed)} | ${cell(row.agent_error)} | ${cell(row.classification_errors)} | ${cell(row.timed_out)} | ${cell(row.grader_error)} | ${cell(row.evidence_valid)} | ${row.elapsed_ms === null ? "—" : (row.elapsed_ms / 1000).toFixed(1)} | ${cell(row.output_tokens)} | ${row.run_id} |`,
  );
}
lines.push(
  "",
  "## Reading this report",
  "",
  "Solved comes from the grader; a grader error is infrastructure, not a failed solution. Time means include every initiated attempt; token means include only evidence-valid attempts, so compare denominators. Tokens cover routed agent-loop requests only (not title or compaction calls). Cached input is part of input; output includes reasoning. These are consumption measurements, not dollar costs. Raw prompts, patches, traces, and grader logs stay in ignored `eval/runs/`.",
);
const out = resolve(option("--out") ?? join(root, "results", `${name}.md`));
await writeFile(out, `${lines.join("\n")}\n`);
console.log(out);
