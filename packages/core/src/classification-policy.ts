import { z } from "zod";

import { parseConfig, universalEffort } from "./config.js";

const MAX_RETRIES = "maxRetries must be an integer from 0 to 10";

export const classificationPolicySchema = z.object({
  maxRetries: z
    .int(MAX_RETRIES)
    .min(0, MAX_RETRIES)
    .max(10, MAX_RETRIES)
    .default(1),
  fallbackMode: z
    .enum(
      ["fixed", "previous", "error"],
      "fallbackMode must be fixed, previous, or error",
    )
    .default("fixed"),
  fallbackEffort: universalEffort(
    "fallbackEffort must be supported by every model",
  ).default("high"),
});

export type ClassificationPolicyOptions = z.input<
  typeof classificationPolicySchema
>;
export type ClassificationPolicy = z.output<typeof classificationPolicySchema>;

/** Validates policy options, which may come from untyped configuration. */
export function classificationPolicy(options: unknown): ClassificationPolicy {
  return parseConfig(classificationPolicySchema, options);
}

export class ClassificationFailedError extends Error {
  constructor(
    readonly reason: string,
    readonly attempts: number,
    readonly latencyMs: number,
    readonly classifier?: string,
  ) {
    super("classification_failed");
  }
}
