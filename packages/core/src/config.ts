import { z } from "zod";

import { EFFORTS, MODELS, supportsEffort } from "./models.js";

/** Parses configuration, throwing one error that lists every distinct issue. */
export function parseConfig<T extends z.ZodType>(
  schema: T,
  value: unknown,
): z.output<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const messages = new Set(result.error.issues.map((issue) => issue.message));
  throw new Error([...messages].join("\n"));
}

/** An effort that every registered model supports. */
export const universalEffort = (message: string) =>
  z
    .enum(EFFORTS, message)
    .refine(
      (effort) => MODELS.every((model) => supportsEffort(model, effort)),
      message,
    );
