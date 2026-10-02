import {
  type ClassificationPolicyOptions,
  type Classifier,
  type ClassifierConfig,
  type ClassifierProvider,
  createClassifierSelector,
  type EffortSelector,
  parseConfig,
} from "@reasoning-router/core";
import { z } from "zod";
import { createSystemOneClassifier, type Fetch } from "./systemone.js";

export interface JevConnection {
  apiKey: string;
  baseURL: string;
  model: string;
}

/** The Jev model each supported endpoint serves. */
const JEV_MODELS = new Map([
  ["https://api.typesafe.ai", "jev-latest"],
  ["https://ai-gateway.vercel.sh/typesafe", "typesafe-ai/jev"],
]);
const API_KEY_REQUIRED = "classifier.apiKey is required for Jev classification";
const INVALID_URL = "classifier.baseUrl must be a valid HTTPS URL";

const jevConnectionSchema = z
  .object({
    apiKey: z.string(API_KEY_REQUIRED).trim().min(1, API_KEY_REQUIRED),
    baseUrl: z
      .string(INVALID_URL)
      .default("https://api.typesafe.ai")
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
        const model = JEV_MODELS.get(baseURL);
        if (model === undefined) {
          ctx.addIssue(
            "classifier.baseUrl supports only the TypeSafe direct and Vercel TypeSafe-compatible endpoints",
          );
          return z.NEVER;
        }
        return { baseURL, model };
      }),
  })
  .transform(({ apiKey, baseUrl }): JevConnection => ({ apiKey, ...baseUrl }));

/** Validates a Jev key and endpoint, and selects the Jev model that endpoint serves. */
export function resolveJevConnection(
  config: Readonly<Record<string, unknown>>,
): JevConnection {
  return parseConfig(jevConnectionSchema, config);
}

/** The Jev `POST /v1/systemone` transport. */
export function createJevTransport(
  connection: JevConnection & { fetch?: Fetch },
): Classifier {
  return createSystemOneClassifier({
    name: "jev",
    url: `${connection.baseURL}/v1/systemone`,
    apiKey: connection.apiKey,
    model: connection.model,
    fetch: connection.fetch,
  });
}

export interface JevClassifierOptions
  extends ClassificationPolicyOptions,
    JevConnection {
  timeoutMs: number;
  fetch?: Fetch;
  cacheEntries?: number;
  cacheTtlMs?: number;
}

export function createJevClassifier(options: JevClassifierOptions): {
  select: EffortSelector;
} {
  return {
    select: createClassifierSelector({
      ...options,
      classifier: createJevTransport(options),
    }),
  };
}

/**
 * Selected by `classifier: { provider: "jev", apiKey, baseUrl, timeoutMs }`.
 * An optional `model` must match the model the endpoint serves.
 */
export const jevClassifierProvider: ClassifierProvider = {
  name: "jev",
  create(config: ClassifierConfig): Classifier {
    const connection = resolveJevConnection(config);
    if (config.model !== undefined && config.model !== connection.model)
      throw new Error(
        "classifier.model must match the configured Jev endpoint",
      );
    return createJevTransport(connection);
  },
};
