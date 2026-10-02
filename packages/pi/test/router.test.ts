import {
  type Classifier,
  createStateSelector,
  type EffortDecision,
  type Evidence,
  modelsFor,
  type StateEffortSelector,
} from "@reasoning-router/core";
import { describe, expect, it } from "vitest";

import {
  createReasoningRouter,
  PROVIDER,
  type RouterOptions,
} from "../src/router.js";

const usage = {
  input: 10,
  output: 5,
  cacheRead: 900,
  cacheWrite: 20,
  totalTokens: 935,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const conversation: any[] = [
  { role: "system", content: "SECRET_SYSTEM_PROMPT" },
  { role: "user", content: "fix the failing test", timestamp: 0 },
  {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "SECRET_THINKING" },
      { type: "text", text: "Running the tests." },
      {
        type: "toolCall",
        id: "call_1",
        name: "bash",
        arguments: { command: "SECRET_ARGUMENTS" },
      },
    ],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-opus-5-5",
    usage,
    stopReason: "toolUse",
    timestamp: 0,
  },
  {
    role: "toolResult",
    toolCallId: "call_1",
    toolName: "bash",
    content: [{ type: "text", text: "1 failed" }],
    isError: true,
    timestamp: 0,
  },
];

const physical = (id: string, supportsMidConvoEffort = true) => ({
  provider: "anthropic",
  id,
  api: "anthropic-messages",
  compat: { supportsMidConvoEffort },
});

const classified = (effort: EffortDecision["effort"]): EffortDecision => ({
  effort,
  classifier: "fake",
  classifierLatencyMs: 3,
  classifierAttempts: 1,
  fallback: null,
});

function host(
  options: Partial<RouterOptions> = {},
  catalog: Record<string, unknown> = {
    "anthropic/claude-opus-5-5": physical("claude-opus-5-5"),
  },
) {
  const definitions = new Map<string, any>();
  const handlers = new Map<string, (event: any, ctx: any) => void>();
  const pi: any = {
    registerVirtualModel(definition: any) {
      definitions.set(`${definition.provider}/${definition.id}`, definition);
    },
    on(event: string, handler: (event: any, ctx: any) => void) {
      handlers.set(event, handler);
      return () => {};
    },
  };
  const calls: Parameters<StateEffortSelector>[0][] = [];
  const evidence: Evidence[] = [];
  createReasoningRouter(pi, {
    selectEffort: async (args) => {
      calls.push(args);
      return classified("low");
    },
    onEvidence: (event) => evidence.push(event),
    ...options,
  });
  const ctx: any = {
    modelRegistry: {
      find: (provider: string, id: string) => catalog[`${provider}/${id}`],
    },
    sessionManager: { getSessionId: () => "session-1" },
  };
  const route = (
    request: Record<string, unknown> = {},
    id = "claude-opus-5-5",
  ) =>
    definitions.get(`${PROVIDER}/${id}`).route(
      {
        model: { provider: PROVIDER, id },
        thinkingLevel: "off",
        reason: "user",
        messages: conversation,
        ...request,
      },
      ctx,
    );
  const end = (message: Record<string, unknown>) =>
    handlers.get("message_end")!(
      {
        type: "message_end",
        message: {
          role: "assistant",
          provider: "anthropic",
          model: "claude-opus-5-5",
          usage,
          stopReason: "stop",
          ...message,
        },
      },
      ctx,
    );
  return { definitions, calls, evidence, route, end };
}

/** A real core selector around a scripted classifier. */
function policySelector(
  outcome: "ok" | "error" | "hang",
  policy: Record<string, unknown> = {},
) {
  const classifier: Classifier = {
    name: "fake",
    async classify({ signal }) {
      if (outcome === "error") throw new Error("boom");
      if (outcome === "hang")
        await new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason)),
        );
      return "xhigh";
    },
    errorCategory: () => "http_4xx",
  };
  return createStateSelector({ classifier, timeoutMs: 1_000, ...policy });
}

describe("registration", () => {
  it("registers one virtual model per Anthropic model in the core registry", () => {
    const { definitions } = host();
    expect([...definitions.keys()]).toEqual(
      modelsFor("anthropic").map((model) => `${PROVIDER}/${model.id}`),
    );
    expect(definitions.get(`${PROVIDER}/claude-opus-5-5`)).toMatchObject({
      name: "Claude Opus 5.5 (reasoning-router)",
    });
  });
});

describe("route", () => {
  it("classifies user requests and keeps the physical model", async () => {
    const { route, calls } = host();
    const result = await route();
    expect(result).toEqual({
      model: physical("claude-opus-5-5"),
      thinkingLevel: "low",
      state: { effort: "low" },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      model: { id: "claude-opus-5-5" },
      cacheKey: null,
      previousEffort: undefined,
    });
  });

  it("builds the classifier state from Pi messages without system or thinking text", async () => {
    const { route, calls } = host();
    await route();
    expect(calls[0]!.state).toEqual({
      recent_user_text: "fix the failing test",
      assistant_progress: "Running the tests.",
      tool_results: [{ name: "bash", ok: false, excerpt: "1 failed" }],
      failure_state: { failed_count: 1, last_failure_excerpt: "1 failed" },
    });
    expect(JSON.stringify(calls[0]!.state)).not.toMatch(/SECRET/);
  });

  it("classifies continuations", async () => {
    const { route, calls } = host();
    await route({ reason: "continuation", state: { effort: "high" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.previousEffort).toBe("high");
  });

  it("reuses the failed thinking level on retry", async () => {
    const { route, calls } = host();
    const result = await route({
      reason: "retry",
      failed: { thinkingLevel: "xhigh" },
      state: { effort: "medium" },
    });
    expect(result.thinkingLevel).toBe("xhigh");
    expect(result.state).toEqual({ effort: "medium" });
    expect(calls).toHaveLength(0);
  });

  it("classifies a retry without a usable failed level", async () => {
    const { route, calls } = host();
    expect((await route({ reason: "retry" })).thinkingLevel).toBe("low");
    await route({ reason: "retry", failed: { thinkingLevel: "minimal" } });
    expect(calls).toHaveLength(2);
  });

  it("uses the base effort for direct requests", async () => {
    const defaults = host();
    expect(await defaults.route({ reason: "direct" })).toMatchObject({
      thinkingLevel: "medium",
    });
    const configured = host({ baseEffort: "max" });
    expect(await configured.route({ reason: "direct" })).toMatchObject({
      thinkingLevel: "max",
    });
    expect(defaults.calls).toHaveLength(0);
    expect(configured.calls).toHaveLength(0);
  });

  it("maps the core none effort to Pi's off level", async () => {
    const { route } = host({ selectEffort: async () => classified("none") });
    expect((await route()).thinkingLevel).toBe("off");
  });

  it("rejects a model Pi lacks or cannot place effort for, before classifying", async () => {
    const { route, calls } = host(
      {},
      {
        "anthropic/claude-opus-5": physical("claude-opus-5", false),
        "anthropic/claude-sonnet-5-5": {
          ...physical("claude-sonnet-5-5"),
          api: "openai-responses",
        },
      },
    );
    for (const id of [
      "claude-mythos-5-1",
      "claude-opus-5",
      "claude-sonnet-5-5",
    ])
      await expect(route({}, id)).rejects.toThrow(
        `reasoning-router unsupported_model (400): anthropic/${id}`,
      );
    expect(calls).toHaveLength(0);
  });
});

describe("state", () => {
  it("keeps the stored state when the effort is unchanged", async () => {
    const { route } = host();
    const state = { effort: "low" };
    expect((await route({ state })).state).toBe(state);
  });

  it("ignores stored state the model does not support", async () => {
    const { route, calls } = host();
    await route({ state: { effort: "none" } });
    await route({ state: "garbage" });
    expect(calls.map((call) => call.previousEffort)).toEqual([
      undefined,
      undefined,
    ]);
  });
});

describe("fallback", () => {
  it("falls back to the stored effort in previous mode without changing state", async () => {
    const { route } = host({
      selectEffort: policySelector("error", { fallbackMode: "previous" }),
    });
    const state = { effort: "medium" };
    const result = await route({ state });
    expect(result.thinkingLevel).toBe("medium");
    expect(result.state).toBe(state);
  });

  it("falls back to the fixed effort without stored state", async () => {
    const { route } = host({
      selectEffort: policySelector("error", { fallbackMode: "previous" }),
    });
    const result = await route();
    expect(result.thinkingLevel).toBe("high");
    expect(result.state).toBeUndefined();
  });

  it("throws a visible error in error mode and logs classification_failed", async () => {
    const { route, evidence } = host({
      selectEffort: policySelector("error", {
        fallbackMode: "error",
        maxRetries: 0,
      }),
    });
    await expect(route()).rejects.toThrow(
      "reasoning-router classification_failed (502): classification_failed",
    );
    expect(evidence).toMatchObject([
      {
        outcome: "classification_failed",
        model: "claude-opus-5-5",
        effort: "",
        classifier: "fake",
        classifier_attempts: 1,
      },
    ]);
  });
});

describe("abort", () => {
  it("aborts on client cancellation and never falls back", async () => {
    const { route, evidence } = host({ selectEffort: policySelector("hang") });
    const controller = new AbortController();
    const routed = route({ signal: controller.signal });
    controller.abort();
    await expect(routed).rejects.toThrow(
      "reasoning-router cancelled (499): request cancelled",
    );
    expect(evidence).toEqual([]);
  });

  it("does not classify an already aborted request", async () => {
    const { route, calls } = host();
    const controller = new AbortController();
    controller.abort();
    await expect(route({ signal: controller.signal })).rejects.toThrow(
      "cancelled (499)",
    );
    expect(calls).toHaveLength(0);
  });
});

describe("decision events", () => {
  it("logs one metadata-only event per response with cacheRead usage", async () => {
    const { route, end, evidence } = host({
      selectEffort: policySelector("ok"),
    });
    await route({ state: { effort: "low" } });
    end({ model: "claude-sonnet-5-5" });
    end({ role: "user" });
    expect(evidence).toEqual([]);
    end({});
    end({});
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      session: "session-1",
      model: "claude-opus-5-5",
      effort: "xhigh",
      previous_effort: "low",
      classifier: "fake",
      classifier_attempts: 1,
      fallback: null,
      input_tokens: 930,
      cached_input_tokens: 900,
      cache_creation_input_tokens: 20,
      output_tokens: 5,
      lineage_status: null,
      outcome: "completed",
    });
    expect(JSON.stringify(evidence)).not.toMatch(/SECRET|failing test/);
  });

  it("records failed responses and replaced decisions as failed", async () => {
    const { route, end, evidence } = host();
    await route();
    await route({ reason: "continuation" });
    end({ stopReason: "error" });
    expect(evidence.map((event) => event.outcome)).toEqual([
      "failed",
      "failed",
    ]);
  });

  it("does not log direct requests", async () => {
    const { route, end, evidence } = host();
    await route({ reason: "direct" });
    end({});
    expect(evidence).toEqual([]);
  });
});
