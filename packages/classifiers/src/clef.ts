import {
  type Classifier,
  type ClassifierConfig,
  type ClassifierProvider,
  parseConfig,
} from "@reasoning-router/core";
import { z } from "zod";
import { createSystemOneClassifier, type Fetch } from "./systemone.js";

const envelopeSchema = z.object({
  success: z.literal(true),
  result: z.unknown(),
});

const API_KEY_REQUIRED =
  "classifier.apiKey is required for Clef classification";
const ACCOUNT_ID =
  "classifier.accountId must be a 32-character Cloudflare account ID";
const MODEL = "classifier.model must be one of clef, clef-flash";

const clefConnectionSchema = z.object({
  accountId: z
    .string(ACCOUNT_ID)
    .trim()
    .regex(/^[0-9a-f]{32}$/i, ACCOUNT_ID),
  apiKey: z.string(API_KEY_REQUIRED).trim().min(1, API_KEY_REQUIRED),
  model: z.enum(["clef", "clef-flash"], MODEL),
});

export type ClefConnection = z.output<typeof clefConnectionSchema>;

/** Validates a Workers AI account ID, API token, and Clef model. */
export function resolveClefConnection(
  config: Readonly<Record<string, unknown>>,
): ClefConnection {
  return parseConfig(clefConnectionSchema, config);
}

/**
 * Clef on Workers AI. The REST API wraps the System One response in
 * `{ result, success, errors, messages }`.
 */
export function createClefTransport(
  connection: ClefConnection & { fetch?: Fetch },
): Classifier {
  return createSystemOneClassifier({
    name: "clef",
    url: `https://api.cloudflare.com/client/v4/accounts/${connection.accountId}/ai/run/@cf/cloudflare/${connection.model}`,
    apiKey: connection.apiKey,
    model: connection.model,
    fetch: connection.fetch,
    unwrap: (body) => {
      const envelope = envelopeSchema.safeParse(body);
      return envelope.success ? envelope.data.result : null;
    },
  });
}

/** Selected by `classifier: { provider: "clef", accountId, apiKey, model, timeoutMs }`. */
export const clefClassifierProvider: ClassifierProvider = {
  name: "clef",
  create(config: ClassifierConfig): Classifier {
    return createClefTransport(resolveClefConnection(config));
  },
};
