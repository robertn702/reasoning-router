import { describe, expect, it } from "vitest";

import { type Classifier, createStateSelector } from "../src/classifier.js";
import { buildConversationClassifierState } from "../src/conversation.js";
import { modelsFor } from "../src/models.js";
import { anthropicWire } from "../src/wire-anthropic.js";
import { openaiWire } from "../src/wire-openai.js";

describe("buildConversationClassifierState", () => {
  it("keeps the latest text and the last eight tool results, bounded", () => {
    const tools = Array.from({ length: 10 }, (_, index) => ({
      role: "tool" as const,
      name: `tool${index}`,
      ok: index !== 7,
      text: index === 7 ? "x".repeat(5000) : `result ${index}`,
    }));
    const state = buildConversationClassifierState([
      { role: "user", text: "first" },
      { role: "assistant", text: "a".repeat(3000) },
      ...tools,
      { role: "user", text: "second" },
      { role: "assistant", text: "" },
    ]);
    expect(state.recent_user_text).toBe("second");
    expect(state.assistant_progress.length).toBeLessThanOrEqual(2000);
    expect(state.tool_results.map((result) => result.name)).toEqual(
      tools.slice(2).map((tool) => tool.name),
    );
    expect(state.failure_state.failed_count).toBe(1);
    expect(state.failure_state.last_failure_excerpt.length).toBeLessThan(5000);
  });
});

describe("classifier state parity", () => {
  const long = "a".repeat(3000);
  const output = "x".repeat(5000);
  const forms: [string, () => unknown][] = [
    [
      "OpenAI",
      () =>
        openaiWire.classifierState({
          input: [
            { type: "message", role: "user", content: "fix the test" },
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "Running it." }],
            },
            {
              type: "function_call",
              call_id: "call_1",
              name: "bash",
              arguments: "{}",
            },
            { type: "function_call_output", call_id: "call_1", output },
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: long }],
            },
          ],
        }),
    ],
    [
      "Anthropic",
      () =>
        anthropicWire.classifierState({
          messages: [
            { role: "user", content: "fix the test" },
            {
              role: "assistant",
              content: [
                { type: "text", text: "Running it." },
                { type: "tool_use", id: "call_1", name: "bash", input: {} },
              ],
            },
            {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "call_1",
                  content: output,
                  is_error: false,
                },
              ],
            },
            { role: "assistant", content: [{ type: "text", text: long }] },
          ],
        }),
    ],
  ];

  it.each(forms)("%s wire matches the neutral builder", (_name, build) => {
    expect(build()).toEqual(
      buildConversationClassifierState([
        { role: "user", text: "fix the test" },
        { role: "assistant", text: "Running it." },
        { role: "tool", name: "bash", ok: true, text: output },
        { role: "assistant", text: long },
      ]),
    );
  });
});

describe("createStateSelector", () => {
  const model = modelsFor("anthropic")[0]!;
  const failing: Classifier = {
    name: "fake",
    async classify() {
      throw new Error("boom");
    },
    errorCategory: () => "http_4xx",
  };
  const working: Classifier = { ...failing, classify: async () => "low" };
  const args = {
    model,
    state: buildConversationClassifierState([]),
    signal: new AbortController().signal,
  };

  it("prefers the harness's previous effort over the cache for previous fallback", async () => {
    const select = createStateSelector({
      classifier: failing,
      timeoutMs: 1000,
      fallbackMode: "previous",
    });
    expect(
      await select({ ...args, cacheKey: null, previousEffort: "max" }),
    ).toMatchObject({ effort: "max", fallbackSource: "previous" });
    expect(await select({ ...args, cacheKey: null })).toMatchObject({
      effort: "high",
      fallbackSource: "fixed",
    });
  });

  it("caches successful efforts only under a cache key", async () => {
    let classifier = working;
    const select = createStateSelector({
      classifier: {
        name: "fake",
        classify: (input) => classifier.classify(input),
        errorCategory: () => "http_4xx",
      },
      timeoutMs: 1000,
      fallbackMode: "previous",
    });
    await select({ ...args, cacheKey: "k" });
    classifier = failing;
    expect(await select({ ...args, cacheKey: "k" })).toMatchObject({
      effort: "low",
    });
  });
});
