import { isAbsolute } from "node:path";
import { z } from "zod";

import { classificationPolicySchema } from "./classification-policy.js";
import { universalEffort } from "./config.js";

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
