import {
  type Classifier,
  type ClassifierConfig,
  type ClassifierProvider,
  parseConfig,
} from "@reasoning-router/core";
import { z } from "zod";
import { createSystemOneClassifier, type Fetch } from "./systemone.js";

/** Only Vercel's TypeSafe-compatible endpoint serves this preset. */
const GEMINI_ENDPOINT = "https://ai-gateway.vercel.sh/typesafe";
const GEMINI_MODEL = "google/gemini-decision-1";
const API_KEY_REQUIRED =
  "classifier.apiKey is required for Gemini Decision 1 classification";
const INVALID_URL = "classifier.baseUrl must be a valid HTTPS URL";

const geminiDecisionConnectionSchema = z
  .object({
    apiKey: z.string(API_KEY_REQUIRED).trim().min(1, API_KEY_REQUIRED),
    baseUrl: z
      .string(INVALID_URL)
      .default(GEMINI_ENDPOINT)
      .transform((raw, ctx) => {
        let url: URL;
        try {
          url = new URL(raw);
        } catch {
          ctx.addIssue(INVALID_URL);
          return z.NEVER;
        }
        if (
          url.protocol !== "https:" ||
          !url.hostname ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        ) {
          ctx.addIssue(
            "classifier.baseUrl must be an HTTPS URL without credentials, query, or fragment",
          );
          return z.NEVER;
        }
        const baseURL = url.href.replace(/\/$/, "");
        if (baseURL !== GEMINI_ENDPOINT) {
          ctx.addIssue(
            "classifier.baseUrl supports only the Vercel TypeSafe-compatible endpoint",
          );
          return z.NEVER;
        }
        return baseURL;
      }),
    model: z
      .string()
      .optional()
      .transform((value) => value?.trim() || undefined),
  })
  .transform(({ apiKey, baseUrl, model }, ctx) => {
    if (model !== undefined && model !== GEMINI_MODEL) {
      ctx.addIssue("classifier.model must be google/gemini-decision-1");
      return z.NEVER;
    }
    return {
      apiKey,
      url: `${baseUrl}/v1/systemone`,
      model: GEMINI_MODEL,
    };
  });

export type GeminiDecisionConnection = z.output<
  typeof geminiDecisionConnectionSchema
>;

/** Validates the Gateway key, fixed endpoint, and Gemini Decision 1 model. */
export function resolveGeminiDecisionConnection(
  config: Readonly<Record<string, unknown>>,
): GeminiDecisionConnection {
  return parseConfig(geminiDecisionConnectionSchema, config);
}

/** Gemini Decision 1 over the existing System One transport, through Vercel AI Gateway. */
export function createGeminiDecisionTransport(
  connection: GeminiDecisionConnection & { fetch?: Fetch },
): Classifier {
  return createSystemOneClassifier({
    name: "gemini-decision",
    url: connection.url,
    apiKey: connection.apiKey,
    model: connection.model,
    fetch: connection.fetch,
  });
}

/**
 * Selected by `classifier: { provider: "gemini-decision", apiKey, baseUrl, model, timeoutMs }`.
 * An optional `model` must be one the endpoint serves.
 */
export const geminiDecisionClassifierProvider: ClassifierProvider = {
  name: "gemini-decision",
  create(config: ClassifierConfig): Classifier {
    return createGeminiDecisionTransport(
      resolveGeminiDecisionConnection(config),
    );
  },
};
