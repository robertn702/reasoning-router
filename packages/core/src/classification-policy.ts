import { type Effort, isEffort, MODELS, supportsEffort } from "./models.js";

export interface ClassificationPolicyOptions {
  maxRetries?: number;
  fallbackMode?: "fixed" | "previous" | "error";
  fallbackEffort?: Effort;
}

/** Validates policy options, which may come from untyped configuration. */
export function classificationPolicy(
  options: {
    readonly [K in keyof ClassificationPolicyOptions]?: unknown;
  },
): Required<ClassificationPolicyOptions> {
  const maxRetries = options.maxRetries ?? 1;
  const fallbackMode = options.fallbackMode ?? "fixed";
  const fallbackEffort = options.fallbackEffort ?? "high";
  if (
    typeof maxRetries !== "number" ||
    !Number.isSafeInteger(maxRetries) ||
    maxRetries < 0 ||
    maxRetries > 10
  )
    throw new Error("maxRetries must be an integer from 0 to 10");
  if (
    fallbackMode !== "fixed" &&
    fallbackMode !== "previous" &&
    fallbackMode !== "error"
  )
    throw new Error("fallbackMode must be fixed, previous, or error");
  if (
    !isEffort(fallbackEffort) ||
    !MODELS.every((model) => supportsEffort(model, fallbackEffort))
  )
    throw new Error("fallbackEffort must be supported by every model");
  return { maxRetries, fallbackMode, fallbackEffort };
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
