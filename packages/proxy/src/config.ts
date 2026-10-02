import {
  type ClassificationPolicy,
  type Effort,
  parseConfig,
  routingEnvShape,
} from "@reasoning-router/core";
import { z } from "zod";

export { loadClassifierConfig } from "@reasoning-router/core";

export interface AppConfig extends ClassificationPolicy {
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

/** A variable that must be unset. */
const unsupported = (message: string) => z.never(message).optional();

const positiveInteger = (name: string, fallback: number) => {
  const message = `${name} must be a positive integer`;
  return z.coerce
    .number(message)
    .int(message)
    .min(1, message)
    .default(fallback);
};

/** Parses with `parseInt`, so trailing text after the digits is ignored. */
const leadingInteger = (fallback: string, schema: z.ZodNumber) =>
  z
    .string()
    .default(fallback)
    .transform((raw) => Number.parseInt(raw, 10))
    .pipe(schema);

const PORT = "REASONING_ROUTER_PORT must be an integer between 1 and 65535";
const UPSTREAM = "REASONING_ROUTER_UPSTREAM_BASE_URL";
const ANTHROPIC_UPSTREAM = "REASONING_ROUTER_ANTHROPIC_UPSTREAM_BASE_URL";
const REQUIRED = `${UPSTREAM} is required; set it to a Responses API-compatible base URL`;

const upstreamUrl = (name: string) =>
  z.string().transform((raw, ctx) => {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      ctx.addIssue(`${name} must be a valid HTTP(S) URL`);
      return z.NEVER;
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      ctx.addIssue(
        `${name} must be an HTTP(S) URL without credentials, query, or fragment`,
      );
      return z.NEVER;
    }
    return {
      baseUrl: raw,
      https: url.protocol === "https:",
      loopback: ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname),
    };
  });

const unsupportedModel = (name: string) =>
  unsupported(
    `${name} is unsupported; select a registered model through request.model`,
  );
const UNSUPPORTED_UPSTREAM =
  "UPSTREAM_MODE and OPENAI_API_KEY are unsupported; use REASONING_ROUTER_UPSTREAM_AUTH and REASONING_ROUTER_UPSTREAM_API_KEY";

const envSchema = z
  .object({
    ...routingEnvShape,
    UPSTREAM_MODEL: unsupportedModel("UPSTREAM_MODEL"),
    UPSTREAM_MODELS: unsupportedModel("UPSTREAM_MODELS"),
    ALLOWED_MODELS: unsupportedModel("ALLOWED_MODELS"),
    UPSTREAM_MODE: unsupported(UNSUPPORTED_UPSTREAM),
    OPENAI_API_KEY: unsupported(UNSUPPORTED_UPSTREAM),
    REASONING_ROUTER_UPSTREAM_AUTH: z
      .enum(
        ["forward", "bearer"],
        "REASONING_ROUTER_UPSTREAM_AUTH must be forward or bearer",
      )
      .default("forward"),
    REASONING_ROUTER_UPSTREAM_API_KEY: z.string().optional(),
    REASONING_ROUTER_UPSTREAM_BASE_URL: z
      .string(REQUIRED)
      .refine((raw) => raw.trim().length > 0, REQUIRED)
      .pipe(upstreamUrl(UPSTREAM)),
    REASONING_ROUTER_ANTHROPIC_UPSTREAM_BASE_URL:
      upstreamUrl(ANTHROPIC_UPSTREAM).optional(),
    REASONING_ROUTER_ANTHROPIC_UPSTREAM_API_KEY: z.string().optional(),
    REASONING_ROUTER_PORT: leadingInteger(
      "4320",
      z.int(PORT).min(1, PORT).max(65_535, PORT),
    ),
    REASONING_ROUTER_MAX_REQUEST_BYTES: positiveInteger(
      "REASONING_ROUTER_MAX_REQUEST_BYTES",
      1_048_576,
    ),
    REASONING_ROUTER_MAX_IN_FLIGHT: positiveInteger(
      "REASONING_ROUTER_MAX_IN_FLIGHT",
      32,
    ),
    REASONING_ROUTER_UPSTREAM_HEADER_TIMEOUT_MS: positiveInteger(
      "REASONING_ROUTER_UPSTREAM_HEADER_TIMEOUT_MS",
      10_000,
    ),
    REASONING_ROUTER_UPSTREAM_IDLE_TIMEOUT_MS: positiveInteger(
      "REASONING_ROUTER_UPSTREAM_IDLE_TIMEOUT_MS",
      60_000,
    ),
    REASONING_ROUTER_EFFORT_CACHE_ENTRIES: positiveInteger(
      "REASONING_ROUTER_EFFORT_CACHE_ENTRIES",
      256,
    ),
    REASONING_ROUTER_EFFORT_CACHE_TTL_MS: positiveInteger(
      "REASONING_ROUTER_EFFORT_CACHE_TTL_MS",
      600_000,
    ),
    REASONING_ROUTER_SHUTDOWN_GRACE_MS: positiveInteger(
      "REASONING_ROUTER_SHUTDOWN_GRACE_MS",
      30_000,
    ),
  })
  .transform((env, ctx): AppConfig => {
    const policy = env.REASONING_ROUTER_UPSTREAM_AUTH;
    const apiKey = env.REASONING_ROUTER_UPSTREAM_API_KEY;
    const upstream = env.REASONING_ROUTER_UPSTREAM_BASE_URL;
    const anthropic = env.REASONING_ROUTER_ANTHROPIC_UPSTREAM_BASE_URL;
    const anthropicKey = env.REASONING_ROUTER_ANTHROPIC_UPSTREAM_API_KEY;
    const issues: string[] = [];
    if (policy === "bearer" && !apiKey?.trim())
      issues.push(
        "REASONING_ROUTER_UPSTREAM_API_KEY is required when REASONING_ROUTER_UPSTREAM_AUTH=bearer",
      );
    if (policy === "forward" && apiKey !== undefined)
      issues.push(
        "REASONING_ROUTER_UPSTREAM_API_KEY requires REASONING_ROUTER_UPSTREAM_AUTH=bearer",
      );
    if (anthropicKey !== undefined && anthropic === undefined)
      issues.push(
        `REASONING_ROUTER_ANTHROPIC_UPSTREAM_API_KEY requires ${ANTHROPIC_UPSTREAM}`,
      );
    for (const [name, target] of [
      [UPSTREAM, upstream],
      [ANTHROPIC_UPSTREAM, anthropic],
    ] as const) {
      if (target === undefined) continue;
      if (policy === "forward" && !target.loopback)
        issues.push(
          `REASONING_ROUTER_UPSTREAM_AUTH=forward requires a loopback ${name}`,
        );
      if (policy === "bearer" && !target.https && !target.loopback)
        issues.push(
          "REASONING_ROUTER_UPSTREAM_AUTH=bearer requires HTTPS except for loopback endpoints",
        );
    }
    if (
      anthropic !== undefined &&
      policy === "forward" &&
      anthropicKey !== undefined
    )
      issues.push(
        "REASONING_ROUTER_ANTHROPIC_UPSTREAM_API_KEY requires REASONING_ROUTER_UPSTREAM_AUTH=bearer",
      );
    if (anthropic !== undefined && policy === "bearer" && !anthropicKey?.trim())
      issues.push(
        "REASONING_ROUTER_ANTHROPIC_UPSTREAM_API_KEY is required when REASONING_ROUTER_UPSTREAM_AUTH=bearer",
      );
    if (issues.length) {
      for (const issue of issues) ctx.addIssue(issue);
      return z.NEVER;
    }
    return {
      maxRetries: env.REASONING_ROUTER_MAX_RETRIES,
      fallbackMode: env.REASONING_ROUTER_FALLBACK_MODE,
      fallbackEffort: env.REASONING_ROUTER_FALLBACK_EFFORT,
      port: env.REASONING_ROUTER_PORT,
      upstreamBaseUrl: upstream.baseUrl,
      anthropicUpstream:
        anthropic === undefined
          ? undefined
          : {
              baseUrl: anthropic.baseUrl,
              auth:
                policy === "forward"
                  ? { policy: "forward" }
                  : { policy: "key", apiKey: anthropicKey?.trim() ?? "" },
            },
      upstreamAuth:
        policy === "bearer"
          ? { policy, apiKey: apiKey?.trim() ?? "" }
          : { policy },
      baseEffort: env.REASONING_ROUTER_BASE_EFFORT,
      classifierTimeoutMs: env.REASONING_ROUTER_CLASSIFICATION_TIMEOUT_MS,
      maxRequestBytes: env.REASONING_ROUTER_MAX_REQUEST_BYTES,
      maxInFlight: env.REASONING_ROUTER_MAX_IN_FLIGHT,
      upstreamHeaderTimeoutMs: env.REASONING_ROUTER_UPSTREAM_HEADER_TIMEOUT_MS,
      upstreamIdleTimeoutMs: env.REASONING_ROUTER_UPSTREAM_IDLE_TIMEOUT_MS,
      effortCacheEntries: env.REASONING_ROUTER_EFFORT_CACHE_ENTRIES,
      effortCacheTtlMs: env.REASONING_ROUTER_EFFORT_CACHE_TTL_MS,
      shutdownGraceMs: env.REASONING_ROUTER_SHUTDOWN_GRACE_MS,
      decisionsLogPath: env.REASONING_ROUTER_DECISIONS_LOG_PATH,
    };
  });

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  return parseConfig(envSchema, env);
}
