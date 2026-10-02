import { resolveJevConnection } from "@reasoning-router/classifier-jev";
import { expect, it } from "vitest";
import { loadClassifierConfig, loadConfig } from "../src/config.js";

const loadJevConnection = (env: Record<string, string | undefined>) =>
  resolveJevConnection(loadClassifierConfig(env));

it("requires the Jev credential names and ignores old router settings", () => {
  expect(() => loadJevConnection({ JEV_ROUTER_API_KEY: "old" })).toThrow(
    "REASONING_ROUTER_CLASSIFIER_API_KEY",
  );
  expect(() =>
    loadJevConnection({
      REASONING_ROUTER_CLASSIFIER_API_KEY: "key",
      JEV_ROUTER_BASE_URL: "https://api.typesafe.ai",
    }),
  ).toThrow("REASONING_ROUTER_CLASSIFIER_BASE_URL");
  expect(
    loadConfig({
      REASONING_ROUTER_UPSTREAM_BASE_URL: "http://127.0.0.1:8080/v1",
      JEV_PROXY_PORT: "9999",
      BASE_EFFORT: "high",
    }),
  ).toMatchObject({ port: 4320, baseEffort: undefined });
});
it("keeps credential and endpoint selection explicit", () => {
  expect(
    loadJevConnection({ REASONING_ROUTER_CLASSIFIER_API_KEY: "key" }).baseURL,
  ).toBe("https://api.typesafe.ai");
  expect(
    loadJevConnection({
      REASONING_ROUTER_CLASSIFIER_API_KEY: "gateway",
      REASONING_ROUTER_CLASSIFIER_BASE_URL:
        "https://ai-gateway.vercel.sh/typesafe",
    }).model,
  ).toBe("typesafe-ai/jev");
  expect(
    loadConfig({
      REASONING_ROUTER_UPSTREAM_BASE_URL: "http://127.0.0.1:8080/v1",
      REASONING_ROUTER_PORT: "4321",
      REASONING_ROUTER_CLASSIFICATION_TIMEOUT_MS: "10000",
    }),
  ).toMatchObject({ port: 4321, classifierTimeoutMs: 10000 });
});
