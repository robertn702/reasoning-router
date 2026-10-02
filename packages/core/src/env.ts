import { isAbsolute } from "node:path";
import { z } from "zod";

import { classificationPolicySchema } from "./classification-policy.js";
import type { ClassifierConfig } from "./classifier.js";
import { parseConfig, universalEffort } from "./config.js";

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

/** Parses with `parseInt`, so trailing text after the digits is ignored. */
const leadingInteger = (fallback: string, schema: z.ZodNumber) =>
  z
    .string()
    .default(fallback)
    .transform((raw) => Number.parseInt(raw, 10))
    .pipe(schema);

const EFFORTS: readonly string[] = ["low", "medium", "high", "xhigh", "max"];
const TIMEOUT =
  "REASONING_ROUTER_CLASSIFICATION_TIMEOUT_MS must be a positive integer";

/** Classification policy, base effort, and decision log variables shared by every environment-configured adapter. */
export const routingEnvShape = {
  REASONING_ROUTER_MAX_RETRIES: z
    .string()
    .optional()
    .transform((raw) => (raw === undefined ? undefined : Number(raw)))
    .pipe(classificationPolicySchema.shape.maxRetries),
  REASONING_ROUTER_FALLBACK_MODE: classificationPolicySchema.shape.fallbackMode,
  REASONING_ROUTER_FALLBACK_EFFORT:
    classificationPolicySchema.shape.fallbackEffort,
  REASONING_ROUTER_DECISIONS_LOG_PATH: z
    .string()
    .refine(
      isAbsolute,
      "REASONING_ROUTER_DECISIONS_LOG_PATH must be an absolute path",
    )
    .optional(),
  REASONING_ROUTER_BASE_EFFORT: universalEffort(
    `REASONING_ROUTER_BASE_EFFORT must be one of ${EFFORTS.join(", ")}`,
  ).optional(),
  REASONING_ROUTER_CLASSIFICATION_TIMEOUT_MS: leadingInteger(
    "4000",
    z.int(TIMEOUT).min(1, TIMEOUT),
  ),
};
