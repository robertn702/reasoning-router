import { describe, expect, it } from "vitest";

import reasoningRouter, { loadConfig } from "../src/extension.js";
import { toEffort, toThinkingLevel } from "../src/messages.js";

describe("loadConfig", () => {
  it("uses the proxy's defaults", () => {
    expect(loadConfig({})).toEqual({
      maxRetries: 1,
      fallbackMode: "fixed",
      fallbackEffort: "high",
      baseEffort: undefined,
      decisionsLogPath: undefined,
      classifier: {
        provider: "jev",
        apiKey: undefined,
        baseUrl: undefined,
        accountId: undefined,
        model: undefined,
        timeoutMs: 4000,
      },
    });
  });

  it("reads the proxy's variables", () => {
    expect(
      loadConfig({
        REASONING_ROUTER_CLASSIFIER: "clef",
        REASONING_ROUTER_CLASSIFIER_API_KEY: "key",
        REASONING_ROUTER_CLASSIFIER_ACCOUNT_ID: "account",
        REASONING_ROUTER_CLASSIFIER_MODEL: "clef-flash",
        REASONING_ROUTER_CLASSIFICATION_TIMEOUT_MS: "1500",
        REASONING_ROUTER_MAX_RETRIES: "2",
        REASONING_ROUTER_FALLBACK_MODE: "previous",
        REASONING_ROUTER_FALLBACK_EFFORT: "medium",
        REASONING_ROUTER_BASE_EFFORT: "low",
        REASONING_ROUTER_DECISIONS_LOG_PATH: "/tmp/decisions.jsonl",
      }),
    ).toEqual({
      maxRetries: 2,
      fallbackMode: "previous",
      fallbackEffort: "medium",
      baseEffort: "low",
      decisionsLogPath: "/tmp/decisions.jsonl",
      classifier: {
        provider: "clef",
        apiKey: "key",
        baseUrl: undefined,
        accountId: "account",
        model: "clef-flash",
        timeoutMs: 1500,
      },
    });
  });

  it("reports every invalid variable at once", () => {
    expect(() =>
      loadConfig({
        REASONING_ROUTER_FALLBACK_MODE: "sometimes",
        REASONING_ROUTER_CLASSIFICATION_TIMEOUT_MS: "0",
        REASONING_ROUTER_DECISIONS_LOG_PATH: "relative.jsonl",
      }),
    ).toThrow(
      [
        "fallbackMode must be fixed, previous, or error",
        "REASONING_ROUTER_DECISIONS_LOG_PATH must be an absolute path",
        "REASONING_ROUTER_CLASSIFICATION_TIMEOUT_MS must be a positive integer",
      ].join("\n"),
    );
    expect(() => loadConfig({ TYPESAFE_API_KEY: "key" })).toThrow(
      "TYPESAFE_API_KEY is unsupported",
    );
  });
});

describe("extension", () => {
  it("fails to load with a prefixed error when the classifier is not configured", () => {
    const saved = process.env.REASONING_ROUTER_CLASSIFIER_API_KEY;
    delete process.env.REASONING_ROUTER_CLASSIFIER_API_KEY;
    const pi: any = {};
    try {
      expect(() => reasoningRouter(pi)).toThrow(
        "reasoning-router: classifier.apiKey is required for Jev classification",
      );
    } finally {
      if (saved !== undefined)
        process.env.REASONING_ROUTER_CLASSIFIER_API_KEY = saved;
    }
  });
});

describe("effort mapping", () => {
  it("maps none to off and back, and has no core effort for minimal", () => {
    expect(toThinkingLevel("none")).toBe("off");
    expect(toThinkingLevel("xhigh")).toBe("xhigh");
    expect(toEffort("off")).toBe("none");
    expect(toEffort("max")).toBe("max");
    expect(toEffort("minimal")).toBeUndefined();
    expect(toEffort(undefined)).toBeUndefined();
  });
});
