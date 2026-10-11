import {
  type Classifier,
  type ClassifierConfig,
  type ClassifierProvider,
  parseConfig,
} from "@reasoning-router/core";
import { z } from "zod";
import { createSystemOneClassifier, type Fetch } from "./systemone.js";

const API_KEY_REQUIRED =
  "classifier.apiKey is required for Microsoft-Decision-1 classification";
const MODEL_REQUIRED =
  "classifier.model must be your Microsoft-Decision-1 deployment name";
const BASE_URL_REQUIRED =
  "classifier.baseUrl must be your Microsoft Foundry resource endpoint";
const BASE_URL_RULES =
  "classifier.baseUrl must be an HTTPS URL without credentials, query, or fragment";

const microsoftDecisionConnectionSchema = z
  .object({
    baseUrl: z
      .string(BASE_URL_REQUIRED)
      .trim()
      .min(1, BASE_URL_REQUIRED)
      .transform((raw, ctx) => {
        let url: URL;
        try {
          url = new URL(raw);
        } catch {
          ctx.addIssue("classifier.baseUrl must be a valid URL");
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
          ctx.addIssue(BASE_URL_RULES);
          return z.NEVER;
        }
        return url.href.replace(/\/$/, "");
      }),
    apiKey: z.string(API_KEY_REQUIRED).trim().min(1, API_KEY_REQUIRED),
    model: z.string(MODEL_REQUIRED).trim().min(1, MODEL_REQUIRED),
  })
  .transform(({ baseUrl, ...rest }) => ({ baseURL: baseUrl, ...rest }));

export type MicrosoftDecisionConnection = z.output<
  typeof microsoftDecisionConnectionSchema
>;

/** Validates a Foundry resource endpoint, an API key, and a deployment name. */
export function resolveMicrosoftDecisionConnection(
  config: Readonly<Record<string, unknown>>,
): MicrosoftDecisionConnection {
  return parseConfig(microsoftDecisionConnectionSchema, config);
}

/**
 * Microsoft-Decision-1 on Microsoft Foundry, over the System One API at
 * `POST {endpoint}/providers/microsoft/v1/systemone`. Foundry takes the key in
 * an `api-key` header; `model` is the deployment name.
 */
export function createMicrosoftDecisionTransport(
  connection: MicrosoftDecisionConnection & { fetch?: Fetch },
): Classifier {
  return createSystemOneClassifier({
    name: "microsoft-decision",
    url: `${connection.baseURL}/providers/microsoft/v1/systemone`,
    apiKey: connection.apiKey,
    keyScheme: "api-key",
    model: connection.model,
    fetch: connection.fetch,
  });
}

/** Selected by `classifier: { provider: "microsoft-decision", baseUrl, apiKey, model, timeoutMs }`. */
export const microsoftDecisionClassifierProvider: ClassifierProvider = {
  name: "microsoft-decision",
  create(config: ClassifierConfig): Classifier {
    return createMicrosoftDecisionTransport(
      resolveMicrosoftDecisionConnection(config),
    );
  },
};
