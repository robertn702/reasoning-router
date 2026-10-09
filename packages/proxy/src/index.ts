#!/usr/bin/env node
import { existsSync } from "node:fs";
import { connect } from "node:net";
import {
  classifierProviders,
  loadClassifierConfig,
} from "@reasoning-router/classifiers";
import {
  createConfiguredSelector,
  createDecisionLogger,
  formatEvidence,
  upstreamHostname,
} from "@reasoning-router/core";
import { loadConfig } from "./config.js";
import { createAppServer, shutdownAppServer } from "./server.js";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage: reasoning-router [--help]

Start the local adaptive-reasoning Responses and Messages API proxy.

Environment:
  REASONING_ROUTER_CLASSIFIER           Classifier provider: jev (default), clef, laya, kev, or openai-decisions
  REASONING_ROUTER_CLASSIFIER_API_KEY   Classifier key (separate from upstream/client keys);
                                        required for jev, clef, and openai-decisions, optional for laya and kev
  REASONING_ROUTER_CLASSIFIER_BASE_URL  jev API root (default: https://api.typesafe.ai)
                                        Vercel: https://ai-gateway.vercel.sh/typesafe
                                        laya: your Laya server (default: http://127.0.0.1:8000)
                                        kev: your kev.serve server (default: http://127.0.0.1:8008)
                                        openai-decisions: https://api.openai.com/v1 (default), or us./eu. regional endpoint
  REASONING_ROUTER_CLASSIFIER_ACCOUNT_ID  clef: Cloudflare account ID (required)
  REASONING_ROUTER_CLASSIFIER_MODEL     clef: clef or clef-flash (required)
                                        laya: optional checkpoint, e.g. english or multilingual
                                        kev: optional; echoed only (checkpoint is set by kev.serve --run)
                                        openai-decisions: gpt-6-luna (default, only value)
  REASONING_ROUTER_PORT     Listening port (default: 4320)
  REASONING_ROUTER_UPSTREAM_BASE_URL  Required Responses API-compatible base URL, e.g. https://api.openai.com/v1
  REASONING_ROUTER_UPSTREAM_AUTH      forward (default, loopback only) or bearer
  REASONING_ROUTER_UPSTREAM_API_KEY   Required for bearer policy; replaces the client's bearer key
  REASONING_ROUTER_ANTHROPIC_UPSTREAM_BASE_URL  Optional Anthropic Messages API base URL, e.g. https://api.anthropic.com/v1
  REASONING_ROUTER_ANTHROPIC_UPSTREAM_API_KEY   Required with Anthropic base URL under bearer policy; sent as x-api-key
  REASONING_ROUTER_BASE_EFFORT        Optional base effort override supported by every model
  REASONING_ROUTER_CLASSIFICATION_TIMEOUT_MS     Classifier timeout in milliseconds (default: 4000)
  REASONING_ROUTER_MAX_RETRIES      Additional transient-error attempts (default: 1)
  REASONING_ROUTER_FALLBACK_MODE    fixed (default), previous, or error
  REASONING_ROUTER_FALLBACK_EFFORT  Backup effort (default: high)
  REASONING_ROUTER_DECISIONS_LOG_PATH  Optional absolute path for local decision JSONL
  REASONING_ROUTER_MAX_REQUEST_BYTES  Maximum POST body bytes (default: 1048576)
  REASONING_ROUTER_MAX_IN_FLIGHT      Maximum active proxy requests (default: 32)
  REASONING_ROUTER_UPSTREAM_HEADER_TIMEOUT_MS  Upstream header deadline (default: 10000)
  REASONING_ROUTER_UPSTREAM_IDLE_TIMEOUT_MS    Upstream response idle deadline (default: 60000)
  REASONING_ROUTER_EFFORT_CACHE_ENTRIES        Previous-effort cache capacity (default: 256)
  REASONING_ROUTER_EFFORT_CACHE_TTL_MS         Previous-effort expiry (default: 600000)
  REASONING_ROUTER_SHUTDOWN_GRACE_MS           Drain deadline (default: 30000)`);
  process.exit(0);
}

if (process.argv.length > 2) {
  console.error(
    `Unknown argument: ${process.argv[2]}. Run with --help for usage.`,
  );
  process.exit(1);
}

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

let config: ReturnType<typeof loadConfig>;
let selectEffort: ReturnType<typeof createConfiguredSelector>;
try {
  config = loadConfig(process.env);
  selectEffort = createConfiguredSelector(
    {
      ...loadClassifierConfig(process.env),
      timeoutMs: config.classifierTimeoutMs,
    },
    classifierProviders,
    {
      maxRetries: config.maxRetries,
      fallbackMode: config.fallbackMode,
      fallbackEffort: config.fallbackEffort,
      cacheEntries: config.effortCacheEntries,
      cacheTtlMs: config.effortCacheTtlMs,
    },
  );
} catch (error) {
  console.error(
    JSON.stringify({
      event: "startup_failed",
      reason: "invalid_configuration",
      message: error instanceof Error ? error.message : "invalid configuration",
    }),
  );
  process.exit(1);
}

const logDecision = config.decisionsLogPath
  ? createDecisionLogger(config.decisionsLogPath)
  : undefined;

const server = createAppServer({
  upstreamBaseUrl: config.upstreamBaseUrl,
  upstreamAuth: config.upstreamAuth,
  anthropicUpstream: config.anthropicUpstream,
  baseEffort: config.baseEffort,
  maxRequestBytes: config.maxRequestBytes,
  maxInFlight: config.maxInFlight,
  upstreamHeaderTimeoutMs: config.upstreamHeaderTimeoutMs,
  upstreamIdleTimeoutMs: config.upstreamIdleTimeoutMs,
  probeDependency: (signal) =>
    new Promise<boolean>((resolve) => {
      const url = new URL(config.upstreamBaseUrl);
      const socket = connect({
        host: upstreamHostname(url),
        port: Number(url.port) || (url.protocol === "https:" ? 443 : 80),
      });
      const finish = (available: boolean): void => {
        socket.destroy();
        resolve(available);
      };
      socket.once("connect", () => finish(true));
      socket.once("error", () => finish(false));
      signal.addEventListener("abort", () => finish(false), { once: true });
    }),
  selectEffort,
  onEvidence: (evidence) => {
    console.log(formatEvidence(evidence));
    logDecision?.(evidence);
  },
});

server.on("error", () => {
  console.error(JSON.stringify({ event: "startup_failed" }));
  process.exitCode = 1;
});

let stopping = false;
const stop = (): void => {
  if (stopping) return;
  stopping = true;
  console.log(JSON.stringify({ event: "shutdown_started" }));
  void shutdownAppServer(server, config.shutdownGraceMs, () => {
    console.log(JSON.stringify({ event: "shutdown_deadline" }));
  }).then(
    () => {
      console.log(JSON.stringify({ event: "shutdown_complete" }));
    },
    () => {
      console.error(JSON.stringify({ event: "shutdown_failed" }));
      process.exitCode = 1;
    },
  );
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

server.listen(config.port, "127.0.0.1", () => {
  console.log(`reasoning-router listening on http://127.0.0.1:${config.port}`);
});
