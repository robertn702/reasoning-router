import {
  type Classifier,
  type ClassifierConfig,
  type ClassifierProvider,
  parseConfig,
} from "@reasoning-router/core";
import { z } from "zod";
import { createSystemOneClassifier, type Fetch } from "./systemone.js";

const API_KEY_REQUIRED =
  "classifier.apiKey is required for OpenRouter classification";
const MODEL_REQUIRED =
  "classifier.model is required for OpenRouter classification (an OpenRouter decision model ID)";

const openRouterConnectionSchema = z.object({
  apiKey: z.string(API_KEY_REQUIRED).trim().min(1, API_KEY_REQUIRED),
  model: z.string(MODEL_REQUIRED).trim().min(1, MODEL_REQUIRED),
});

export type OpenRouterConnection = z.output<typeof openRouterConnectionSchema>;

/** Validates an OpenRouter key and a decision model ID; the catalog is not checked. */
export function resolveOpenRouterConnection(
  config: Readonly<Record<string, unknown>>,
): OpenRouterConnection {
  return parseConfig(openRouterConnectionSchema, config);
}

/** OpenRouter's Decisions API, which takes the System One request for every decision model it lists. */
export function createOpenRouterTransport(
  connection: OpenRouterConnection & { fetch?: Fetch },
): Classifier {
  return createSystemOneClassifier({
    name: "openrouter",
    url: "https://openrouter.ai/api/alpha/decisions",
    apiKey: connection.apiKey,
    model: connection.model,
    fetch: connection.fetch,
  });
}

/** Selected by `classifier: { provider: "openrouter", apiKey, model, timeoutMs }`. */
export const openRouterClassifierProvider: ClassifierProvider = {
  name: "openrouter",
  create(config: ClassifierConfig): Classifier {
    return createOpenRouterTransport(resolveOpenRouterConnection(config));
  },
};
