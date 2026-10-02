import { describe, expect, it, vi } from "vitest";

import type { ClassifierState } from "../src/classifier.js";
import { buildClassifierState } from "../src/wire-openai.js";

const USER_LIMIT = 2000;
const ASSISTANT_LIMIT = 2000;
const EXCERPT_LIMIT = 1600;
const MAX_TOOL_RESULTS = 8;

const MARKERS = {
  dev: "SECRET_DEV_MARKER_5c1e",
  user: "SECRET_USER_MARKER_5c1e",
  tool: "SECRET_TOOL_MARKER_5c1e",
  tooldef: "SECRET_TOOLDEF_MARKER_5c1e",
  output: "SECRET_OUTPUT_MARKER_5c1e",
};

type LogMethod = "log" | "info" | "warn" | "error" | "debug";
const METHODS: LogMethod[] = ["log", "info", "warn", "error", "debug"];

function captureLogs<T>(fn: () => T): { result: T; logs: string } {
  const chunks: string[] = [];
  const capture = (chunk: unknown, ...rest: unknown[]): boolean => {
    if (typeof chunk === "string") {
      chunks.push(chunk);
    } else if (chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk).toString("utf8"));
    } else {
      chunks.push(String(chunk));
    }
    const [callback] = rest;
    if (typeof callback === "function") {
      callback();
    }
    return true;
  };
  const spies = [
    ...METHODS.map((m) => vi.spyOn(console, m).mockImplementation(capture)),
    vi.spyOn(process.stdout, "write").mockImplementation(capture),
    vi.spyOn(process.stderr, "write").mockImplementation(capture),
  ];
  try {
    return { result: fn(), logs: chunks.join("") };
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
}

function expectBounded(state: ClassifierState): void {
  expect(state.recent_user_text.length).toBeLessThanOrEqual(USER_LIMIT);
  expect(state.assistant_progress.length).toBeLessThanOrEqual(ASSISTANT_LIMIT);
  expect(state.tool_results.length).toBeLessThanOrEqual(MAX_TOOL_RESULTS);
  for (const result of state.tool_results) {
    expect(result.excerpt.length).toBeLessThanOrEqual(EXCERPT_LIMIT);
  }
  expect(state.failure_state.last_failure_excerpt.length).toBeLessThanOrEqual(
    EXCERPT_LIMIT,
  );
}

describe("bounded state builder on gate-1 request shapes", () => {
  it("builds state from a developer string message and user input_text parts", () => {
    const input = [
      {
        role: "developer",
        content: `system rules ${MARKERS.dev}`,
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: `what is in the log? ${MARKERS.user}` },
        ],
      },
    ];
    const { result: built, logs } = captureLogs(() =>
      buildClassifierState(input),
    );
    expectBounded(built);
    expect(built.recent_user_text).toContain(MARKERS.user);
    expect(JSON.stringify(built)).not.toContain(MARKERS.dev);
    expect(logs).not.toContain(MARKERS.dev);
    expect(logs).not.toContain(MARKERS.user);
  });

  it("tracks tool-call and tool-result continuations with failure state", () => {
    const input = [
      {
        role: "user",
        content: [
          { type: "input_text", text: `read the config ${MARKERS.user}` },
        ],
      },
      {
        type: "function_call",
        call_id: "call_1",
        name: "read",
        arguments: '{"path":"a.txt"}',
      },
      {
        type: "function_call_output",
        call_id: "call_1",
        output: `ok ${MARKERS.output}`,
      },
      {
        type: "function_call",
        call_id: "call_2",
        name: "read",
        arguments: '{"path":"b.txt"}',
      },
      {
        type: "function_call_output",
        call_id: "call_2",
        output: `boom ${MARKERS.output}`,
        status: "failed",
      },
    ];
    const { result: built, logs } = captureLogs(() =>
      buildClassifierState(input),
    );
    expectBounded(built);
    expect(built.tool_results).toHaveLength(2);
    expect(built.tool_results[0]).toMatchObject({ name: "read", ok: true });
    expect(built.tool_results[1]).toMatchObject({ name: "read", ok: false });
    expect(built.failure_state.failed_count).toBe(1);
    expect(built.failure_state.last_failure_excerpt).toContain("boom");
    expect(logs).not.toContain(MARKERS.output);
    expect(logs).not.toContain(MARKERS.user);
  });

  it("ignores opaque typed items and non-text parts even when they mimic messages or tool results", () => {
    const secret = "OPAQUE_PAYLOAD_MARKER";
    const state = buildClassifierState([
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "real question" },
          { type: "input_image", text: secret },
        ],
      },
      {
        type: "future_tool_result",
        role: "user",
        content: secret,
        output: secret,
        call_id: "c",
        name: secret,
      },
      {
        type: "web_search_call",
        role: "assistant",
        content: [{ type: "output_text", text: secret }],
        output: secret,
      },
      {
        type: "computer_call_output",
        role: "user",
        content: secret,
        output: { text: secret },
        status: "failed",
      },
      { type: "item_reference", role: "assistant", content: secret, id: "i1" },
      { type: "function_call", call_id: "c", name: "read", arguments: secret },
      { type: "function_call_output", call_id: "c", output: "real result" },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "real progress" }],
      },
    ]);
    expect(state).toEqual({
      recent_user_text: "real question",
      assistant_progress: "real progress",
      tool_results: [{ name: "read", ok: true, excerpt: "real result" }],
      failure_state: { failed_count: 0, last_failure_excerpt: "" },
    });
    expect(JSON.stringify(state)).not.toContain(secret);
  });

  it("preserves function and custom tool continuation excerpts, including untyped output text parts", () => {
    const state = buildClassifierState([
      { type: "function_call", call_id: "f", name: "read" },
      {
        type: "function_call_output",
        call_id: "f",
        output: [{ text: "file contents" }],
      },
      { type: "custom_tool_call", call_id: "c", name: "shell" },
      {
        type: "custom_tool_call_output",
        call_id: "c",
        output: "failed",
        status: "failed",
      },
    ]);
    expect(state.tool_results).toEqual([
      { name: "read", ok: true, excerpt: "file contents" },
      { name: "shell", ok: false, excerpt: "failed" },
    ]);
    expect(state.failure_state).toEqual({
      failed_count: 1,
      last_failure_excerpt: "failed",
    });
  });

  it("treats error-named tool outputs as failures", () => {
    const state = buildClassifierState([
      { type: "function_call", call_id: "c1", name: "grep", arguments: "{}" },
      {
        type: "function_call_output",
        call_id: "c1",
        output: "nope",
        error: "denied",
      },
    ]);
    expectBounded(state);
    expect(state.tool_results[0]).toMatchObject({ name: "grep", ok: false });
    expect(state.failure_state.failed_count).toBe(1);
  });

  it("keeps only the most recent eight tool results and bounds every excerpt", () => {
    const bigOutput = `${MARKERS.output} ${"x".repeat(5000)}`;
    const input: unknown[] = [
      { role: "user", content: `run tools ${MARKERS.user}` },
    ];
    for (let i = 0; i < 12; i += 1) {
      input.push({
        type: "function_call",
        call_id: `call_${i}`,
        name: `tool_${i}`,
        arguments: "{}",
      });
      input.push({
        type: "function_call_output",
        call_id: `call_${i}`,
        output: bigOutput,
      });
    }
    const { result: built, logs } = captureLogs(() =>
      buildClassifierState(input),
    );
    expectBounded(built);
    expect(built.tool_results).toHaveLength(MAX_TOOL_RESULTS);
    expect(built.tool_results.map((r) => r.name)).toEqual([
      "tool_4",
      "tool_5",
      "tool_6",
      "tool_7",
      "tool_8",
      "tool_9",
      "tool_10",
      "tool_11",
    ]);
    expect(logs).not.toContain(MARKERS.output);
    expect(logs).not.toContain(MARKERS.user);
  });

  it("truncates oversized user and assistant text", () => {
    const state = buildClassifierState([
      { role: "assistant", content: `${MARKERS.tool} ${"a".repeat(50_000)}` },
      {
        role: "user",
        content: [
          { type: "input_text", text: `${MARKERS.user} ${"u".repeat(50_000)}` },
        ],
      },
    ]);
    expectBounded(state);
    expect(state.recent_user_text.length).toBeLessThanOrEqual(USER_LIMIT);
    expect(state.assistant_progress.length).toBeLessThanOrEqual(
      ASSISTANT_LIMIT,
    );
  });

  it("never logs prompt or tool-definition content for a full gate-1 shaped request", () => {
    const toolDefinition = {
      type: "function",
      name: "read",
      description: `reads files ${MARKERS.tooldef}`,
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        strict: true,
      },
      strict: true,
    };
    const input = [
      { role: "developer", content: `developer preamble ${MARKERS.dev}` },
      toolDefinition,
      {
        role: "user",
        content: [{ type: "input_text", text: `question ${MARKERS.user}` }],
      },
      {
        type: "function_call",
        call_id: "call_1",
        name: "read",
        arguments: `{"path":"${MARKERS.tool}"}`,
      },
      {
        type: "function_call_output",
        call_id: "call_1",
        output: `file body ${MARKERS.output}`,
      },
      { role: "assistant", content: `progress note ${MARKERS.tool}` },
    ];
    const { result: built, logs } = captureLogs(() =>
      buildClassifierState(input),
    );
    expectBounded(built);
    const stateJson = JSON.stringify(built);
    expect(stateJson).not.toContain(MARKERS.tooldef);
    for (const marker of Object.values(MARKERS)) {
      expect(logs).not.toContain(marker);
    }
  });
});

describe("classifier state bounds", () => {
  it("builds bounded state from user text, assistant progress, tool results, and failures", () => {
    const state = buildClassifierState([
      { role: "user", content: "U".repeat(5000) },
      { role: "assistant", content: "A".repeat(5000) },
      { type: "function_call", call_id: "c1", name: "read", arguments: "{}" },
      {
        type: "function_call_output",
        call_id: "c1",
        output: "T".repeat(5000),
        status: "failed",
      },
      { type: "function_call", call_id: "c2", name: "write", arguments: "{}" },
      {
        type: "function_call_output",
        call_id: "c2",
        output: "ok",
        status: "completed",
      },
    ]);

    expect(state.recent_user_text.length).toBeLessThanOrEqual(2000);
    expect(state.assistant_progress.length).toBeLessThanOrEqual(2000);
    expect(state.tool_results).toHaveLength(2);
    expect(state.tool_results[0]).toMatchObject({ name: "read", ok: false });
    expect(state.tool_results[1]).toMatchObject({ name: "write", ok: true });
    expect(state.tool_results[0]!.excerpt.length).toBeLessThanOrEqual(1600);
    expect(state.failure_state.failed_count).toBe(1);
  });

  it("caps retained tool results at eight", () => {
    const input = [];
    for (let i = 0; i < 12; i += 1) {
      input.push({
        type: "function_call",
        call_id: `c${i}`,
        name: `t${i}`,
        arguments: "{}",
      });
      input.push({
        type: "function_call_output",
        call_id: `c${i}`,
        output: "ok",
        status: "completed",
      });
    }
    const state = buildClassifierState(input);
    expect(state.tool_results).toHaveLength(8);
  });
});
