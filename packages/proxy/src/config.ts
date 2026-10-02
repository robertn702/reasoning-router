import { isAbsolute } from "node:path";
import {
  type ClassificationPolicyOptions,
  type ClassifierConfig,
  classificationPolicy,
  type Effort,
  isEffort,
  MODELS,
  supportsEffort,
} from "@reasoning-router/core";

const EFFORTS: readonly string[] = ["low", "medium", "high", "xhigh", "max"];

export interface AppConfig extends ClassificationPolicyOptions {
  port: number;
  upstreamBaseUrl: string;
  upstreamAuth: UpstreamAuth;
  anthropicUpstream?: {
    baseUrl: string;
    auth: { policy: "forward" } | { policy: "key"; apiKey: string };
  };
  baseEffort: Effort | undefined;
  classifierTimeoutMs: number;
  maxRequestBytes: number;
  maxInFlight: number;
  upstreamHeaderTimeoutMs: number;
  upstreamIdleTimeoutMs: number;
  effortCacheEntries: number;
  effortCacheTtlMs: number;
  shutdownGraceMs: number;
  decisionsLogPath?: string;
}

export type UpstreamAuth =
  | { policy: "forward" }
  | { policy: "bearer"; apiKey: string };

/** The `classifier` block from `REASONING_ROUTER_CLASSIFIER*` variables; the provider validates its own fields. */
export function loadClassifierConfig(
  env: Record<string, string | undefined>,
): ClassifierConfig {
  if (env.TYPESAFE_API_KEY !== undefined) {
    throw new Error(
      "TYPESAFE_API_KEY is unsupported; use REASONING_ROUTER_CLASSIFIER_API_KEY",
    );
  }
  if (
    env.JEV_ROUTER_API_KEY !== undefined ||
    env.JEV_ROUTER_BASE_URL !== undefined
  ) {
    throw new Error(
      "JEV_ROUTER_API_KEY and JEV_ROUTER_BASE_URL are unsupported; use REASONING_ROUTER_CLASSIFIER_API_KEY and REASONING_ROUTER_CLASSIFIER_BASE_URL",
    );
  }
  return {
    provider: env.REASONING_ROUTER_CLASSIFIER ?? "jev",
    apiKey: env.REASONING_ROUTER_CLASSIFIER_API_KEY,
    baseUrl: env.REASONING_ROUTER_CLASSIFIER_BASE_URL,
  };
}

function positiveInteger(
  raw: string | undefined,
  fallback: number,
  name: string,
): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function parsePort(raw: string | undefined): number {
  const port = Number.parseInt(raw ?? "4320", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      "REASONING_ROUTER_PORT must be an integer between 1 and 65535",
    );
  }
  return port;
}

function parseTimeout(raw: string | undefined): number {
  const ms = Number.parseInt(raw ?? "4000", 10);
  if (!Number.isInteger(ms) || ms < 1) {
    throw new Error(
      "REASONING_ROUTER_CLASSIFICATION_TIMEOUT_MS must be a positive integer",
    );
  }
  return ms;
}

function parseEffort(raw: string | undefined): Effort | undefined {
  if (raw === undefined) return undefined;
  if (!isEffort(raw) || !MODELS.every((model) => supportsEffort(model, raw))) {
    throw new Error(
      `REASONING_ROUTER_BASE_EFFORT must be one of ${EFFORTS.join(", ")}`,
    );
  }
  return raw;
}

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const classifierPolicy = classificationPolicy({
    maxRetries:
      env.REASONING_ROUTER_MAX_RETRIES === undefined
        ? undefined
        : Number(env.REASONING_ROUTER_MAX_RETRIES),
    fallbackMode: env.REASONING_ROUTER_FALLBACK_MODE,
    fallbackEffort: env.REASONING_ROUTER_FALLBACK_EFFORT,
  });
  for (const name of ["UPSTREAM_MODEL", "UPSTREAM_MODELS", "ALLOWED_MODELS"]) {
    if (env[name] !== undefined)
      throw new Error(
        `${name} is unsupported; select a registered model through request.model`,
      );
  }
  if (
    env.REASONING_ROUTER_DECISIONS_LOG_PATH !== undefined &&
    !isAbsolute(env.REASONING_ROUTER_DECISIONS_LOG_PATH)
  ) {
    throw new Error(
      "REASONING_ROUTER_DECISIONS_LOG_PATH must be an absolute path",
    );
  }
  if (env.UPSTREAM_MODE !== undefined || env.OPENAI_API_KEY !== undefined) {
    throw new Error(
      "UPSTREAM_MODE and OPENAI_API_KEY are unsupported; use REASONING_ROUTER_UPSTREAM_AUTH and REASONING_ROUTER_UPSTREAM_API_KEY",
    );
  }
  const policy = env.REASONING_ROUTER_UPSTREAM_AUTH ?? "forward";
  if (policy !== "forward" && policy !== "bearer") {
    throw new Error("REASONING_ROUTER_UPSTREAM_AUTH must be forward or bearer");
  }
  if (policy === "bearer" && !env.REASONING_ROUTER_UPSTREAM_API_KEY?.trim()) {
    throw new Error(
      "REASONING_ROUTER_UPSTREAM_API_KEY is required when REASONING_ROUTER_UPSTREAM_AUTH=bearer",
    );
  }
  if (
    policy === "forward" &&
    env.REASONING_ROUTER_UPSTREAM_API_KEY !== undefined
  ) {
    throw new Error(
      "REASONING_ROUTER_UPSTREAM_API_KEY requires REASONING_ROUTER_UPSTREAM_AUTH=bearer",
    );
  }

  const upstreamBaseUrl = env.REASONING_ROUTER_UPSTREAM_BASE_URL;
  if (!upstreamBaseUrl?.trim()) {
    throw new Error(
      "REASONING_ROUTER_UPSTREAM_BASE_URL is required; set it to a Responses API-compatible base URL",
    );
  }
  let url: URL;
  try {
    url = new URL(upstreamBaseUrl);
  } catch {
    throw new Error(
      "REASONING_ROUTER_UPSTREAM_BASE_URL must be a valid HTTP(S) URL",
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "REASONING_ROUTER_UPSTREAM_BASE_URL must be an HTTP(S) URL without credentials, query, or fragment",
    );
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (policy === "forward" && !loopback) {
    throw new Error(
      "REASONING_ROUTER_UPSTREAM_AUTH=forward requires a loopback REASONING_ROUTER_UPSTREAM_BASE_URL",
    );
  }
  if (policy === "bearer" && url.protocol !== "https:" && !loopback) {
    throw new Error(
      "REASONING_ROUTER_UPSTREAM_AUTH=bearer requires HTTPS except for loopback endpoints",
    );
  }

  const anthropicBaseUrl = env.REASONING_ROUTER_ANTHROPIC_UPSTREAM_BASE_URL;
  const anthropicKey = env.REASONING_ROUTER_ANTHROPIC_UPSTREAM_API_KEY;
  if (anthropicKey !== undefined && !anthropicBaseUrl?.trim()) {
    throw new Error(
      "REASONING_ROUTER_ANTHROPIC_UPSTREAM_API_KEY requires REASONING_ROUTER_ANTHROPIC_UPSTREAM_BASE_URL",
    );
  }
  if (anthropicBaseUrl !== undefined && !anthropicBaseUrl.trim()) {
    throw new Error(
      "REASONING_ROUTER_ANTHROPIC_UPSTREAM_BASE_URL must be a valid HTTP(S) URL",
    );
  }
  let anthropicUpstream: AppConfig["anthropicUpstream"];
  if (anthropicBaseUrl !== undefined) {
    let anthropicUrl: URL;
    try {
      anthropicUrl = new URL(anthropicBaseUrl);
    } catch {
      throw new Error(
        "REASONING_ROUTER_ANTHROPIC_UPSTREAM_BASE_URL must be a valid HTTP(S) URL",
      );
    }
    if (
      !["http:", "https:"].includes(anthropicUrl.protocol) ||
      !anthropicUrl.hostname ||
      anthropicUrl.username ||
      anthropicUrl.password ||
      anthropicUrl.search ||
      anthropicUrl.hash
    ) {
      throw new Error(
        "REASONING_ROUTER_ANTHROPIC_UPSTREAM_BASE_URL must be an HTTP(S) URL without credentials, query, or fragment",
      );
    }
    const anthropicLoopback = ["127.0.0.1", "localhost", "[::1]"].includes(
      anthropicUrl.hostname,
    );
    if (policy === "forward" && anthropicKey !== undefined) {
      throw new Error(
        "REASONING_ROUTER_ANTHROPIC_UPSTREAM_API_KEY requires REASONING_ROUTER_UPSTREAM_AUTH=bearer",
      );
    }
    if (policy === "forward" && !anthropicLoopback) {
      throw new Error(
        "REASONING_ROUTER_UPSTREAM_AUTH=forward requires a loopback REASONING_ROUTER_ANTHROPIC_UPSTREAM_BASE_URL",
      );
    }
    if (policy === "bearer" && !anthropicKey?.trim()) {
      throw new Error(
        "REASONING_ROUTER_ANTHROPIC_UPSTREAM_API_KEY is required when REASONING_ROUTER_UPSTREAM_AUTH=bearer",
      );
    }
    if (
      policy === "bearer" &&
      anthropicUrl.protocol !== "https:" &&
      !anthropicLoopback
    ) {
      throw new Error(
        "REASONING_ROUTER_UPSTREAM_AUTH=bearer requires HTTPS except for loopback endpoints",
      );
    }
    anthropicUpstream = {
      baseUrl: anthropicBaseUrl,
      auth:
        policy === "forward"
          ? { policy: "forward" }
          : { policy: "key", apiKey: anthropicKey!.trim() },
    };
  }

  return {
    ...classifierPolicy,
    port: parsePort(env.REASONING_ROUTER_PORT),
    upstreamBaseUrl,
    anthropicUpstream,
    upstreamAuth:
      policy === "bearer"
        ? { policy, apiKey: env.REASONING_ROUTER_UPSTREAM_API_KEY!.trim() }
        : { policy },
    baseEffort: parseEffort(env.REASONING_ROUTER_BASE_EFFORT),
    classifierTimeoutMs: parseTimeout(
      env.REASONING_ROUTER_CLASSIFICATION_TIMEOUT_MS,
    ),
    maxRequestBytes: positiveInteger(
      env.REASONING_ROUTER_MAX_REQUEST_BYTES,
      1_048_576,
      "REASONING_ROUTER_MAX_REQUEST_BYTES",
    ),
    maxInFlight: positiveInteger(
      env.REASONING_ROUTER_MAX_IN_FLIGHT,
      32,
      "REASONING_ROUTER_MAX_IN_FLIGHT",
    ),
    upstreamHeaderTimeoutMs: positiveInteger(
      env.REASONING_ROUTER_UPSTREAM_HEADER_TIMEOUT_MS,
      10_000,
      "REASONING_ROUTER_UPSTREAM_HEADER_TIMEOUT_MS",
    ),
    upstreamIdleTimeoutMs: positiveInteger(
      env.REASONING_ROUTER_UPSTREAM_IDLE_TIMEOUT_MS,
      60_000,
      "REASONING_ROUTER_UPSTREAM_IDLE_TIMEOUT_MS",
    ),
    effortCacheEntries: positiveInteger(
      env.REASONING_ROUTER_EFFORT_CACHE_ENTRIES,
      256,
      "REASONING_ROUTER_EFFORT_CACHE_ENTRIES",
    ),
    effortCacheTtlMs: positiveInteger(
      env.REASONING_ROUTER_EFFORT_CACHE_TTL_MS,
      600_000,
      "REASONING_ROUTER_EFFORT_CACHE_TTL_MS",
    ),
    shutdownGraceMs: positiveInteger(
      env.REASONING_ROUTER_SHUTDOWN_GRACE_MS,
      30_000,
      "REASONING_ROUTER_SHUTDOWN_GRACE_MS",
    ),
    decisionsLogPath: env.REASONING_ROUTER_DECISIONS_LOG_PATH,
  };
}
