import {
  type Classifier,
  type ClassifierConfig,
  type ClassifierProvider,
  parseConfig,
} from "@reasoning-router/core";
import { z } from "zod";
import { createSystemOneClassifier, type Fetch } from "./systemone.js";

/** The System One path and the d1 models each supported endpoint serves; the first is the default. */
const LIQUID_ENDPOINTS = new Map([
  [
    "https://api.liquid.ai",
    { path: "/decisions/v1/systemone", models: ["d1", "d1:free"] },
  ],
  [
    "https://ai-gateway.vercel.sh/typesafe",
    { path: "/v1/systemone", models: ["liquid/d1"] },
  ],
]);
const API_KEY_REQUIRED =
  "classifier.apiKey is required for Liquid d1 classification";
const INVALID_URL = "classifier.baseUrl must be a valid HTTPS URL";

const liquidConnectionSchema = z
  .object({
    apiKey: z.string(API_KEY_REQUIRED).trim().min(1, API_KEY_REQUIRED),
    baseUrl: z
      .string(INVALID_URL)
      .default("https://api.liquid.ai")
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
        const endpoint = LIQUID_ENDPOINTS.get(baseURL);
        if (endpoint === undefined) {
          ctx.addIssue(
            "classifier.baseUrl supports only the Liquid direct and Vercel TypeSafe-compatible endpoints",
          );
          return z.NEVER;
        }
        return { baseURL, ...endpoint };
      }),
    model: z
      .string()
      .optional()
      .transform((value) => value?.trim() || undefined),
  })
  .transform(({ apiKey, baseUrl, model }, ctx) => {
    if (model !== undefined && !baseUrl.models.includes(model)) {
      ctx.addIssue(
        `classifier.model must be one of ${baseUrl.models.join(", ")} for ${baseUrl.baseURL}`,
      );
      return z.NEVER;
    }
    return {
      apiKey,
      url: `${baseUrl.baseURL}${baseUrl.path}`,
      model: model ?? baseUrl.models[0]!,
    };
  });

export type LiquidConnection = z.output<typeof liquidConnectionSchema>;

/** Validates a Liquid or Vercel key, the endpoint, and the d1 model that endpoint serves. */
export function resolveLiquidConnection(
  config: Readonly<Record<string, unknown>>,
): LiquidConnection {
  return parseConfig(liquidConnectionSchema, config);
}

/** Liquid d1 over the System One API, at Liquid's API or Vercel AI Gateway. */
export function createLiquidTransport(
  connection: LiquidConnection & { fetch?: Fetch },
): Classifier {
  return createSystemOneClassifier({
    name: "liquid",
    url: connection.url,
    apiKey: connection.apiKey,
    model: connection.model,
    fetch: connection.fetch,
  });
}

/**
 * Selected by `classifier: { provider: "liquid", apiKey, baseUrl, model, timeoutMs }`.
 * An optional `model` must be one the endpoint serves.
 */
export const liquidClassifierProvider: ClassifierProvider = {
  name: "liquid",
  create(config: ClassifierConfig): Classifier {
    return createLiquidTransport(resolveLiquidConnection(config));
  },
};
