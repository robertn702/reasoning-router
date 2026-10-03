import { type ClassifierConfig, parseConfig } from "@reasoning-router/core";
import { z } from "zod";

/** A variable that must be unset. */
const unsupported = (message: string) => z.never(message).optional();

const UNSUPPORTED_JEV =
  "JEV_ROUTER_API_KEY and JEV_ROUTER_BASE_URL are unsupported; use REASONING_ROUTER_CLASSIFIER_API_KEY and REASONING_ROUTER_CLASSIFIER_BASE_URL";

const classifierEnvSchema = z
  .object({
    TYPESAFE_API_KEY: unsupported(
      "TYPESAFE_API_KEY is unsupported; use REASONING_ROUTER_CLASSIFIER_API_KEY",
    ),
    JEV_ROUTER_API_KEY: unsupported(UNSUPPORTED_JEV),
    JEV_ROUTER_BASE_URL: unsupported(UNSUPPORTED_JEV),
    REASONING_ROUTER_CLASSIFIER: z.string().default("jev"),
    REASONING_ROUTER_CLASSIFIER_API_KEY: z.string().optional(),
    REASONING_ROUTER_CLASSIFIER_BASE_URL: z.string().optional(),
    REASONING_ROUTER_CLASSIFIER_ACCOUNT_ID: z.string().optional(),
    REASONING_ROUTER_CLASSIFIER_MODEL: z.string().optional(),
  })
  .transform(
    (env): ClassifierConfig => ({
      provider: env.REASONING_ROUTER_CLASSIFIER,
      apiKey: env.REASONING_ROUTER_CLASSIFIER_API_KEY,
      baseUrl: env.REASONING_ROUTER_CLASSIFIER_BASE_URL,
      accountId: env.REASONING_ROUTER_CLASSIFIER_ACCOUNT_ID || undefined,
      model: env.REASONING_ROUTER_CLASSIFIER_MODEL || undefined,
    }),
  );

/** The `classifier` block from `REASONING_ROUTER_CLASSIFIER*` variables; the provider validates its own fields. */
export function loadClassifierConfig(
  env: Record<string, string | undefined>,
): ClassifierConfig {
  return parseConfig(classifierEnvSchema, env);
}
