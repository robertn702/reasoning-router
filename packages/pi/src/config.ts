import { loadClassifierConfig } from "@reasoning-router/classifiers";
import {
  type ClassificationPolicy,
  type ClassifierConfig,
  type Effort,
  parseConfig,
  routingEnvShape,
} from "@reasoning-router/core";
import { z } from "zod";

export interface PiConfig extends ClassificationPolicy {
  classifier: ClassifierConfig;
  baseEffort: Effort | undefined;
  decisionsLogPath: string | undefined;
}

const envSchema = z.object(routingEnvShape);

/** Reads the proxy's `REASONING_ROUTER_*` classifier, policy, and logging variables. */
export function loadConfig(env: Record<string, string | undefined>): PiConfig {
  const parsed = parseConfig(envSchema, env);
  return {
    maxRetries: parsed.REASONING_ROUTER_MAX_RETRIES,
    fallbackMode: parsed.REASONING_ROUTER_FALLBACK_MODE,
    fallbackEffort: parsed.REASONING_ROUTER_FALLBACK_EFFORT,
    baseEffort: parsed.REASONING_ROUTER_BASE_EFFORT,
    decisionsLogPath: parsed.REASONING_ROUTER_DECISIONS_LOG_PATH,
    classifier: {
      ...loadClassifierConfig(env),
      timeoutMs: parsed.REASONING_ROUTER_CLASSIFICATION_TIMEOUT_MS,
    },
  };
}
