import { describe, expect, it } from "vitest";
import { classifierProviders } from "../src/index.js";

describe("classifierProviders", () => {
  // Selection finds the first provider with a name, so a duplicate would be unreachable.
  it("names every provider uniquely", () => {
    const names = classifierProviders.map((provider) => provider.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
