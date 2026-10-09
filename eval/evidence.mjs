// Match each agent step with exactly one router decision by time and exact
// upstream usage. Steps are the assistant messages of an exported OpenCode
// session: one model call each. The plugin logs only primary (agent-loop)
// requests, so title and compaction calls have no decision and no step.
// Returns the summed decision usage, or null when any step or decision lacks
// a unique, ordered match.
export function reconcileEvidence(events, messages) {
  const steps = [];
  for (const message of messages) {
    if (message?.type !== "assistant") continue;
    const start = message.time?.created;
    const end = message.time?.completed;
    const tokens = message.tokens;
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end < start ||
      !Number.isFinite(tokens?.input) ||
      !Number.isFinite(tokens.output) ||
      !Number.isFinite(tokens.reasoning) ||
      !Number.isFinite(tokens.cache?.read) ||
      !Number.isFinite(tokens.cache?.write)
    )
      return null;
    steps.push({ start, end, tokens });
  }
  if (!steps.length || events.length !== steps.length) return null;
  const candidates = steps.map(() => []);
  for (const [eventIndex, event] of events.entries()) {
    const time = Date.parse(event.ts);
    if (!Number.isFinite(time)) return null;
    for (const [index, { start, end, tokens }] of steps.entries()) {
      // Allow a small log/step serialization difference, but never match by
      // usage alone across unrelated steps.
      if (time < start - 100 || time > end) continue;
      if (
        event.input_tokens ===
          tokens.input + tokens.cache.read + tokens.cache.write &&
        event.cached_input_tokens === tokens.cache.read &&
        event.output_tokens === tokens.output + tokens.reasoning
      ) {
        candidates[index].push(eventIndex);
      }
    }
  }
  if (candidates.some((matches) => matches.length !== 1)) return null;
  const matched = candidates.map(([index]) => index);
  if (matched.some((index, i) => i > 0 && index <= matched[i - 1])) return null;
  const usage = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 };
  for (const event of events)
    for (const field of Object.keys(usage)) usage[field] += event[field];
  return usage;
}
