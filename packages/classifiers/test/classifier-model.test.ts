import { describe, expect, it } from "vitest";
import { classifierProviders } from "../src/index.js";

const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";

/** The `model` a preset's classifier reports, which decision events record as `classifier_model`. */
function modelOf(
  config: { provider: string } & Record<string, unknown>,
): string | undefined {
  const provider = classifierProviders.find(
    (candidate) => candidate.name === config.provider,
  );
  return provider!.create(config).model;
}

describe("classifier model", () => {
  it("is the model each preset requests", () => {
    const key = { apiKey: "k" };
    expect(modelOf({ provider: "jev", ...key })).toBe("jev-latest");
    expect(
      modelOf({
        provider: "jev",
        ...key,
        baseUrl: "https://ai-gateway.vercel.sh/typesafe",
      }),
    ).toBe("typesafe-ai/jev");
    expect(
      modelOf({
        provider: "clef",
        ...key,
        accountId: ACCOUNT_ID,
        model: "clef-flash",
      }),
    ).toBe("clef-flash");
    expect(modelOf({ provider: "liquid", ...key })).toBe("d1");
    expect(modelOf({ provider: "liquid", ...key, model: "d1:free" })).toBe(
      "d1:free",
    );
    expect(modelOf({ provider: "openai-decisions", ...key })).toBe(
      "gpt-6-luna",
    );
    expect(modelOf({ provider: "gemini-decision", ...key })).toBe(
      "google/gemini-decision-1",
    );
    expect(
      modelOf({
        provider: "microsoft-decision",
        ...key,
        baseUrl: "https://example.services.ai.azure.com",
        model: "my-deployment",
      }),
    ).toBe("my-deployment");
  });

  it("is the configured model for server presets, and unset when the server chooses", () => {
    for (const provider of ["laya", "kev", "clm", "sglang"]) {
      expect(modelOf({ provider, model: "checkpoint-a" })).toBe("checkpoint-a");
      expect(modelOf({ provider })).toBeUndefined();
      expect(modelOf({ provider, model: "  " })).toBeUndefined();
    }
  });
});
