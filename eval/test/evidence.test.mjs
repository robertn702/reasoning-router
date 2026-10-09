import assert from "node:assert/strict";
import { test } from "vitest";
import { reconcileEvidence } from "../evidence.mjs";

const tokens = {
  input: 3,
  output: 2,
  reasoning: 0,
  cache: { read: 0, write: 0 },
};
const step = (created, completed, extra = {}) => ({
  type: "assistant",
  time: { created, completed },
  tokens,
  ...extra,
});
const decision = (timestamp, extra = {}) => ({
  ts: new Date(timestamp).toISOString(),
  input_tokens: 3,
  cached_input_tokens: 0,
  output_tokens: 2,
  ...extra,
});
const messages = [
  { type: "user", time: { created: 900 } },
  step(1000, 2000),
  step(3000, 4000),
  { type: "idle", time: { created: 4100 } },
];
const valid = { input_tokens: 6, cached_input_tokens: 0, output_tokens: 4 };

test("each agent step needs exactly one ordered, usage-matched decision", () => {
  assert.deepEqual(
    reconcileEvidence([decision(1500), decision(3500)], messages),
    valid,
  );
  // Small serialization slack before a step starts, none after it ends.
  assert.deepEqual(
    reconcileEvidence([decision(950), decision(4000)], messages),
    valid,
  );
  assert.equal(
    reconcileEvidence([decision(1500), decision(4001)], messages),
    null,
  );
  // Unlogged or extra requests.
  assert.equal(reconcileEvidence([decision(1500)], messages), null);
  assert.equal(
    reconcileEvidence(
      [decision(500), decision(1500), decision(3500)],
      messages,
    ),
    null,
  );
  // Two decisions in one step leave the other unmatched.
  assert.equal(
    reconcileEvidence([decision(1500), decision(1600)], messages),
    null,
  );
  // Usage must match exactly, including cached input and reasoning.
  assert.equal(
    reconcileEvidence(
      [decision(1500), decision(3500, { output_tokens: 3 })],
      messages,
    ),
    null,
  );
  assert.equal(
    reconcileEvidence(
      [decision(1500), decision(3500, { cached_input_tokens: null })],
      messages,
    ),
    null,
  );
  assert.equal(
    reconcileEvidence(
      [decision(1500), { ...decision(3500), ts: "not a time" }],
      messages,
    ),
    null,
  );
});

test("incomplete or unreadable sessions fail closed", () => {
  assert.equal(reconcileEvidence([], []), null);
  assert.equal(reconcileEvidence([decision(1500)], []), null);
  assert.equal(
    reconcileEvidence(
      [decision(1500)],
      [{ type: "assistant", time: { created: 1000 }, tokens }],
    ),
    null,
  );
  assert.equal(
    reconcileEvidence(
      [decision(1500)],
      [step(1000, 2000, { tokens: { input: 3, output: 2 } })],
    ),
    null,
  );
  assert.equal(reconcileEvidence([decision(1500)], [step(2000, 1000)]), null);
});

test("reasoning and cache tokens are reconciled into normalized usage", () => {
  const detailed = {
    input: 10,
    output: 4,
    reasoning: 6,
    cache: { read: 20, write: 5 },
  };
  assert.deepEqual(
    reconcileEvidence(
      [
        decision(1500, {
          input_tokens: 35,
          cached_input_tokens: 20,
          output_tokens: 10,
        }),
      ],
      [step(1000, 2000, { tokens: detailed })],
    ),
    { input_tokens: 35, cached_input_tokens: 20, output_tokens: 10 },
  );
});
