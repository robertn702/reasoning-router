import { resolveJevConnection } from "@reasoning-router/classifier-jev";
import { upstreamHostname } from "@reasoning-router/core";
import { describe, expect, it } from "vitest";
import { loadClassifierConfig, loadConfig } from "../src/config.js";

const loadJevConnection = (env: Record<string, string | undefined>) =>
  resolveJevConnection(loadClassifierConfig(env));

const upstream = {
  REASONING_ROUTER_UPSTREAM_BASE_URL: "http://127.0.0.1:8080/v1",
};
const load = (env: Record<string, string | undefined>) =>
  loadConfig({ ...upstream, ...env });

describe("Jev connection", () => {
  it("uses the direct endpoint and Jev model by default", () => {
    expect(
      loadJevConnection({
        REASONING_ROUTER_CLASSIFIER_API_KEY: " direct-key ",
      }),
    ).toEqual({
      apiKey: "direct-key",
      baseURL: "https://api.typesafe.ai",
      model: "jev-latest",
    });
  });

  it("selects the Vercel Jev model for its TypeSafe-compatible endpoint", () => {
    expect(
      loadJevConnection({
        REASONING_ROUTER_CLASSIFIER_API_KEY: "gateway-key",
        REASONING_ROUTER_CLASSIFIER_BASE_URL:
          "https://ai-gateway.vercel.sh/typesafe/",
      }),
    ).toEqual({
      apiKey: "gateway-key",
      baseURL: "https://ai-gateway.vercel.sh/typesafe",
      model: "typesafe-ai/jev",
    });
  });

  it("rejects unsupported credentials and endpoints without disclosing values", () => {
    const cases = [
      { TYPESAFE_API_KEY: "legacy-secret" },
      { REASONING_ROUTER_CLASSIFIER_API_KEY: " " },
      {
        REASONING_ROUTER_CLASSIFIER_API_KEY: "secret",
        TYPESAFE_API_KEY: "legacy-secret",
      },
      {
        REASONING_ROUTER_CLASSIFIER_API_KEY: "secret",
        REASONING_ROUTER_CLASSIFIER_BASE_URL: "not-a-url-secret",
      },
      {
        REASONING_ROUTER_CLASSIFIER_API_KEY: "secret",
        REASONING_ROUTER_CLASSIFIER_BASE_URL: "http://api.typesafe.ai",
      },
      {
        REASONING_ROUTER_CLASSIFIER_API_KEY: "secret",
        REASONING_ROUTER_CLASSIFIER_BASE_URL:
          "https://user:password@api.typesafe.ai",
      },
      {
        REASONING_ROUTER_CLASSIFIER_API_KEY: "secret",
        REASONING_ROUTER_CLASSIFIER_BASE_URL:
          "https://api.typesafe.ai?token=secret",
      },
      {
        REASONING_ROUTER_CLASSIFIER_API_KEY: "secret",
        REASONING_ROUTER_CLASSIFIER_BASE_URL: "https://other.example/typesafe",
      },
    ];
    for (const env of cases) {
      let message = "";
      try {
        loadJevConnection(env);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).not.toBe("");
      expect(message).not.toMatch(/secret|password/);
    }
  });
});

describe("resource limit configuration", () => {
  it("uses bounded defaults and accepts positive overrides", () => {
    const defaults = load({});
    expect(defaults.maxRequestBytes).toBe(1_048_576);
    expect(defaults.maxInFlight).toBe(32);
    expect(defaults.upstreamHeaderTimeoutMs).toBe(10_000);
    expect(defaults.upstreamIdleTimeoutMs).toBe(60_000);
    expect(defaults.effortCacheEntries).toBe(256);
    expect(defaults.effortCacheTtlMs).toBe(600_000);
    expect(defaults.shutdownGraceMs).toBe(30_000);
    expect(defaults.decisionsLogPath).toBeUndefined();
    expect(
      load({ REASONING_ROUTER_DECISIONS_LOG_PATH: "/tmp/decisions.jsonl" })
        .decisionsLogPath,
    ).toBe("/tmp/decisions.jsonl");
    expect(() =>
      load({ REASONING_ROUTER_DECISIONS_LOG_PATH: "relative.jsonl" }),
    ).toThrow("REASONING_ROUTER_DECISIONS_LOG_PATH");
    expect(
      load({ REASONING_ROUTER_SHUTDOWN_GRACE_MS: "50" }).shutdownGraceMs,
    ).toBe(50);
    expect(load({ REASONING_ROUTER_MAX_IN_FLIGHT: "1" }).maxInFlight).toBe(1);
  });

  it("rejects invalid values instead of silently accepting partial integers", () => {
    for (const name of [
      "REASONING_ROUTER_MAX_REQUEST_BYTES",
      "REASONING_ROUTER_MAX_IN_FLIGHT",
      "REASONING_ROUTER_UPSTREAM_HEADER_TIMEOUT_MS",
      "REASONING_ROUTER_UPSTREAM_IDLE_TIMEOUT_MS",
      "REASONING_ROUTER_EFFORT_CACHE_ENTRIES",
      "REASONING_ROUTER_EFFORT_CACHE_TTL_MS",
      "REASONING_ROUTER_SHUTDOWN_GRACE_MS",
    ]) {
      for (const value of ["0", "-1", "1.5", "10junk", "Infinity"]) {
        expect(() => load({ [name]: value })).toThrow(name);
      }
    }
  });
  it("validates upstream configuration without exposing credentials", () => {
    expect(() =>
      load({ REASONING_ROUTER_UPSTREAM_BASE_URL: "bad-secret" }),
    ).toThrow("REASONING_ROUTER_UPSTREAM_BASE_URL");
    expect(() =>
      load({
        REASONING_ROUTER_UPSTREAM_BASE_URL:
          "http://user:secret@localhost:8080/v1",
      }),
    ).toThrow("REASONING_ROUTER_UPSTREAM_BASE_URL");
  });
});

describe("upstream configuration", () => {
  it("validates optional Anthropic transport and credentials without leaking values", () => {
    expect(load({}).anthropicUpstream).toBeUndefined();
    expect(
      load({
        REASONING_ROUTER_ANTHROPIC_UPSTREAM_BASE_URL:
          "http://localhost:8080/v1",
      }).anthropicUpstream,
    ).toEqual({
      baseUrl: "http://localhost:8080/v1",
      auth: { policy: "forward" },
    });
    expect(
      load({
        REASONING_ROUTER_UPSTREAM_AUTH: "bearer",
        REASONING_ROUTER_UPSTREAM_API_KEY: "openai-key",
        REASONING_ROUTER_ANTHROPIC_UPSTREAM_BASE_URL:
          "https://api.anthropic.com/v1",
        REASONING_ROUTER_ANTHROPIC_UPSTREAM_API_KEY: " anthropic-key ",
      }).anthropicUpstream,
    ).toEqual({
      baseUrl: "https://api.anthropic.com/v1",
      auth: { policy: "key", apiKey: "anthropic-key" },
    });
    const cases = [
      { REASONING_ROUTER_ANTHROPIC_UPSTREAM_API_KEY: "secret" },
      { REASONING_ROUTER_ANTHROPIC_UPSTREAM_BASE_URL: "" },
      { REASONING_ROUTER_ANTHROPIC_UPSTREAM_BASE_URL: "bad-secret" },
      {
        REASONING_ROUTER_ANTHROPIC_UPSTREAM_BASE_URL:
          "http://user:secret@localhost/v1",
      },
      {
        REASONING_ROUTER_ANTHROPIC_UPSTREAM_BASE_URL:
          "http://localhost/v1?secret=1",
      },
      {
        REASONING_ROUTER_ANTHROPIC_UPSTREAM_BASE_URL:
          "https://api.anthropic.com/v1",
      },
      {
        REASONING_ROUTER_ANTHROPIC_UPSTREAM_BASE_URL: "http://localhost/v1",
        REASONING_ROUTER_ANTHROPIC_UPSTREAM_API_KEY: "secret",
      },
      {
        REASONING_ROUTER_UPSTREAM_AUTH: "bearer",
        REASONING_ROUTER_UPSTREAM_API_KEY: "openai-key",
        REASONING_ROUTER_ANTHROPIC_UPSTREAM_BASE_URL:
          "http://api.anthropic.com/v1",
        REASONING_ROUTER_ANTHROPIC_UPSTREAM_API_KEY: "secret",
      },
      {
        REASONING_ROUTER_UPSTREAM_AUTH: "bearer",
        REASONING_ROUTER_UPSTREAM_API_KEY: "openai-key",
        REASONING_ROUTER_ANTHROPIC_UPSTREAM_BASE_URL:
          "https://api.anthropic.com/v1",
      },
    ];
    for (const env of cases) {
      let message = "";
      try {
        load(env);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).not.toBe("");
      expect(message).not.toContain("secret");
    }
  });

  it("requires an upstream and defaults to forwarding the client credential", () => {
    for (const value of [undefined, "", " "]) {
      expect(() =>
        loadConfig({ REASONING_ROUTER_UPSTREAM_BASE_URL: value }),
      ).toThrow("REASONING_ROUTER_UPSTREAM_BASE_URL is required");
    }
    const config = load({});
    expect(config.upstreamAuth).toEqual({ policy: "forward" });
    expect(config.upstreamBaseUrl).toBe(
      upstream.REASONING_ROUTER_UPSTREAM_BASE_URL,
    );
  });

  it("supports a configured HTTPS upstream with a router-owned bearer key", () => {
    const config = load({
      REASONING_ROUTER_UPSTREAM_BASE_URL: "https://api.openai.com/v1",
      REASONING_ROUTER_UPSTREAM_AUTH: "bearer",
      REASONING_ROUTER_UPSTREAM_API_KEY: "test-key",
    });
    expect(config.upstreamAuth).toEqual({
      policy: "bearer",
      apiKey: "test-key",
    });
    expect(config.upstreamBaseUrl).toBe("https://api.openai.com/v1");
    expect(load({}).baseEffort).toBeUndefined();
    for (const name of [
      "UPSTREAM_MODEL",
      "UPSTREAM_MODELS",
      "ALLOWED_MODELS",
    ]) {
      for (const value of ["", "secret-model"]) {
        expect(() => load({ [name]: value })).toThrow(
          `${name} is unsupported; select a registered model through request.model`,
        );
      }
    }
    expect(() => load({ REASONING_ROUTER_BASE_EFFORT: "none" })).toThrow(
      "REASONING_ROUTER_BASE_EFFORT",
    );
    expect(load({ REASONING_ROUTER_BASE_EFFORT: "high" }).baseEffort).toBe(
      "high",
    );
    expect(
      load({
        REASONING_ROUTER_UPSTREAM_BASE_URL: "http://localhost:8080/v1",
        REASONING_ROUTER_UPSTREAM_AUTH: "bearer",
        REASONING_ROUTER_UPSTREAM_API_KEY: "local-key",
      }).upstreamAuth,
    ).toEqual({ policy: "bearer", apiKey: "local-key" });
    expect(
      load({ REASONING_ROUTER_UPSTREAM_BASE_URL: "http://[::1]:8080/v1" })
        .upstreamAuth,
    ).toEqual({ policy: "forward" });
    expect(upstreamHostname(new URL("http://[::1]:8080/v1"))).toBe("::1");
  });

  it("rejects invalid policies, missing credentials, and credential misrouting", () => {
    expect(() =>
      load({ UPSTREAM_MODE: "other", OPENAI_API_KEY: "test-key" }),
    ).toThrow("UPSTREAM_MODE and OPENAI_API_KEY are unsupported");
    expect(() => load({ OPENAI_API_KEY: "old-key" })).toThrow("unsupported");
    expect(() => load({ REASONING_ROUTER_UPSTREAM_AUTH: "other" })).toThrow(
      "REASONING_ROUTER_UPSTREAM_AUTH must be forward or bearer",
    );
    expect(() => load({ REASONING_ROUTER_UPSTREAM_AUTH: "bearer" })).toThrow(
      "REASONING_ROUTER_UPSTREAM_API_KEY is required when REASONING_ROUTER_UPSTREAM_AUTH=bearer",
    );
    expect(() =>
      load({
        REASONING_ROUTER_UPSTREAM_AUTH: "bearer",
        REASONING_ROUTER_UPSTREAM_API_KEY: "  ",
      }),
    ).toThrow(
      "REASONING_ROUTER_UPSTREAM_API_KEY is required when REASONING_ROUTER_UPSTREAM_AUTH=bearer",
    );
    expect(() => load({ REASONING_ROUTER_UPSTREAM_API_KEY: "secret" })).toThrow(
      "REASONING_ROUTER_UPSTREAM_API_KEY requires REASONING_ROUTER_UPSTREAM_AUTH=bearer",
    );
    expect(() =>
      load({ REASONING_ROUTER_UPSTREAM_BASE_URL: "https://api.openai.com/v1" }),
    ).toThrow("REASONING_ROUTER_UPSTREAM_AUTH=forward requires a loopback");
    expect(() =>
      load({
        REASONING_ROUTER_UPSTREAM_BASE_URL: "https://gateway.example/v1",
      }),
    ).toThrow("REASONING_ROUTER_UPSTREAM_AUTH=forward requires a loopback");
    expect(() =>
      load({
        REASONING_ROUTER_UPSTREAM_BASE_URL: "http://gateway.example/v1",
        REASONING_ROUTER_UPSTREAM_AUTH: "bearer",
        REASONING_ROUTER_UPSTREAM_API_KEY: "secret",
      }),
    ).toThrow("REASONING_ROUTER_UPSTREAM_AUTH=bearer requires HTTPS");
    expect(() =>
      load({
        REASONING_ROUTER_UPSTREAM_BASE_URL:
          "https://user:pass@proxy.example/v1",
      }),
    ).toThrow(
      "REASONING_ROUTER_UPSTREAM_BASE_URL must be an HTTP(S) URL without credentials, query, or fragment",
    );
    expect(() =>
      load({ REASONING_ROUTER_UPSTREAM_BASE_URL: "no-url" }),
    ).toThrow("REASONING_ROUTER_UPSTREAM_BASE_URL must be a valid HTTP(S) URL");
    expect(() => load({ UPSTREAM_MODEL: " gpt-6-astra" })).toThrow(
      "UPSTREAM_MODEL",
    );
    expect(() => load({ UPSTREAM_MODEL: "gpt-6-astra-pro" })).toThrow(
      "UPSTREAM_MODEL is unsupported",
    );
  });
});
