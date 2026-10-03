import { describe, expect, it } from "vitest";

import { loadClassifierConfig } from "../src/env.js";

describe("classifier configuration", () => {
  it("passes the Clef settings through and treats empty ones as unset", () => {
    expect(
      loadClassifierConfig({
        REASONING_ROUTER_CLASSIFIER: "clef",
        REASONING_ROUTER_CLASSIFIER_API_KEY: "token",
        REASONING_ROUTER_CLASSIFIER_ACCOUNT_ID: "account",
        REASONING_ROUTER_CLASSIFIER_MODEL: "clef-flash",
      }),
    ).toMatchObject({
      provider: "clef",
      apiKey: "token",
      accountId: "account",
      model: "clef-flash",
    });
    expect(
      loadClassifierConfig({
        REASONING_ROUTER_CLASSIFIER_ACCOUNT_ID: "",
        REASONING_ROUTER_CLASSIFIER_MODEL: "",
      }),
    ).toMatchObject({
      provider: "jev",
      accountId: undefined,
      model: undefined,
    });
  });

  it("defaults to Jev and rejects the legacy variables", () => {
    expect(loadClassifierConfig({})).toMatchObject({ provider: "jev" });
    expect(() => loadClassifierConfig({ TYPESAFE_API_KEY: "old" })).toThrow(
      "TYPESAFE_API_KEY is unsupported; use REASONING_ROUTER_CLASSIFIER_API_KEY",
    );
    expect(() => loadClassifierConfig({ JEV_ROUTER_API_KEY: "old" })).toThrow(
      "JEV_ROUTER_API_KEY and JEV_ROUTER_BASE_URL are unsupported",
    );
    expect(() =>
      loadClassifierConfig({ JEV_ROUTER_BASE_URL: "https://api.typesafe.ai" }),
    ).toThrow("REASONING_ROUTER_CLASSIFIER_BASE_URL");
  });
});
