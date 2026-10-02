import { describe, expect, it } from "vitest";
import { MODELS, modelsFor } from "../src/models.js";
import { rewriteResponsesRequest } from "../src/rewrite.js";
import { resolveModel } from "../src/wire.js";

describe("registered model isolation", () => {
  it("rejects absent, malformed, unknown and pro IDs", () => {
    for (const model of [
      undefined,
      null,
      1,
      {},
      "",
      "gpt-6-astra-pro",
      "custom",
      " gpt-6-sol",
    ]) {
      expect(() => resolveModel({ model })).toThrow("exact registered model");
    }
  });
  it("freezes profiles and pins independent rewrites", () => {
    for (const model of modelsFor("openai")) {
      expect(Object.isFrozen(model)).toBe(true);
      expect(Object.isFrozen(model.supportedEfforts)).toBe(true);
      const items = [
        { role: "user", content: "test" },
        { type: "function_call_output", call_id: "c", output: "ok" },
      ];
      const body = {
        model: model.id,
        prompt_cache_key: "unchanged",
        input: [
          items[0],
          { type: "configuration_update", reasoning: { effort: "low" } },
          items[1],
        ],
      };
      const result = rewriteResponsesRequest(body, {
        model,
        baseEffort: "medium",
        effort: "high",
      });
      expect(result).toMatchObject({
        model: model.id,
        prompt_cache_key: "unchanged",
        reasoning: { effort: "medium" },
        input: [
          { type: "configuration_update", reasoning: { effort: "high" } },
          items[0],
          { type: "configuration_update", reasoning: { effort: "low" } },
          items[1],
        ],
      });
    }
  });
  it("registers only supported Anthropic profiles with model-specific base efforts", () => {
    expect(modelsFor("openai").map((model) => model.id)).toEqual([
      "gpt-6-astra",
      "gpt-6-luna",
      "gpt-6-sol",
      "gpt-6.1-sol",
    ]);
    expect(
      modelsFor("anthropic").map((model) => [
        model.id,
        model.defaultBaseEffort,
      ]),
    ).toEqual([
      ["claude-fable-5-1", "high"],
      ["claude-mythos-5-1", "high"],
      ["claude-opus-5-5", "medium"],
      ["claude-opus-5", "high"],
      ["claude-sonnet-5-5", "medium"],
    ]);
    for (const model of MODELS) {
      expect(Object.isFrozen(model)).toBe(true);
      expect(Object.isFrozen(model.supportedEfforts)).toBe(true);
      expect(model.fallbackEffort).toBe("medium");
    }
    expect(
      modelsFor("anthropic").every(
        (model) =>
          model.supportedEfforts.join() === "low,medium,high,xhigh,max",
      ),
    ).toBe(true);
  });
});
