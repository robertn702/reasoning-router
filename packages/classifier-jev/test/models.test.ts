import { MODELS } from "@reasoning-router/core";
import { describe, expect, it } from "vitest";
import { createJevClassifier } from "../src/jev.js";

describe("registered model isolation", () => {
  it("uses model-specific choices and globally bounded model-local fallback history", async () => {
    let answer = "high";
    const requests: any[] = [];
    const classifier = createJevClassifier({
      apiKey: "test",
      baseURL: "https://api.typesafe.ai",
      model: "jev-latest",
      timeoutMs: 1000,
      cacheEntries: 2,
      fallbackMode: "previous",
      fallbackEffort: "medium",
      fetch: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            model: "jev-latest",
            answers: {
              effort: {
                type: "choice",
                choice: answer,
                confidence: 1,
                probabilities: {},
              },
            },
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
    });
    const run = (index: number, key: unknown = "shared") =>
      classifier.select({
        model: MODELS[index]!,
        body: { prompt_cache_key: key, input: [] },
        signal: new AbortController().signal,
      });
    expect((await run(0)).effort).toBe("high");
    answer = "invalid";
    expect((await run(1)).effort).toBe("medium");
    expect((await run(0)).effort).toBe("high");
    answer = "none";
    expect((await run(1)).effort).toBe("none");
    expect((await run(0)).fallback).toBe("classifier_invalid_output");
    expect(JSON.stringify(requests[0])).not.toContain('"none"');
    expect(JSON.stringify(requests[1])).toContain('"none"');
    expect(JSON.stringify(requests[1])).toContain("gpt-6-luna");
    answer = "max";
    await run(2);
    answer = "invalid";
    expect((await run(1)).effort).toBe("medium");
    expect((await run(0)).effort).toBe("high");
    expect(
      (
        await classifier.select({
          model: MODELS[0]!,
          body: { input: [] },
          signal: new AbortController().signal,
        })
      ).effort,
    ).toBe("medium");
    expect((await run(0, "")).effort).toBe("medium");
  });
});
