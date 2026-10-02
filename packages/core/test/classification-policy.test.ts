import { describe, expect, it } from "vitest";
import { classificationPolicy } from "../src/classification-policy.js";

describe("classification policy", () => {
  it("defaults to one retry and fixed high; rejects invalid configuration", () => {
    expect(classificationPolicy({})).toEqual({
      maxRetries: 1,
      fallbackMode: "fixed",
      fallbackEffort: "high",
    });
    for (const maxRetries of [-1, 1.5, NaN, 11])
      expect(() => classificationPolicy({ maxRetries })).toThrow();
    expect(() => classificationPolicy({ fallbackMode: "bad" })).toThrow();
    expect(() => classificationPolicy({ fallbackEffort: "none" })).toThrow();
  });
});
