import {
  type Classifier,
  type ClassifierConfig,
  type ClassifierProvider,
  parseConfig,
} from "@reasoning-router/core";
import { z } from "zod";
import { createSystemOneClassifier, type Fetch } from "./systemone.js";

const INVALID_URL = "classifier.baseUrl must be a valid URL";
const BASE_URL_RULES =
  "classifier.baseUrl must be an HTTPS URL, or an HTTP URL to a loopback host, without credentials, query, or fragment";

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    /^127\.\d+\.\d+\.\d+$/.test(hostname)
  );
}

/** An unset or blank optional string. */
const optional = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined);

const layaConnectionSchema = z
  .object({
    baseUrl: z
      .string(INVALID_URL)
      .default("http://127.0.0.1:8000")
      .transform((raw, ctx) => {
        let url: URL;
        try {
          url = new URL(raw);
        } catch {
          ctx.addIssue(INVALID_URL);
          return z.NEVER;
        }
        if (
          !(
            url.protocol === "https:" ||
            (url.protocol === "http:" && isLoopback(url.hostname))
          ) ||
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
    apiKey: optional,
    model: optional,
  })
  .transform(({ baseUrl, ...rest }) => ({ baseURL: baseUrl, ...rest }));

export type LayaConnection = z.output<typeof layaConnectionSchema>;

/** Validates the Laya server URL, and an optional bearer key and checkpoint. */
export function resolveLayaConnection(
  config: Readonly<Record<string, unknown>>,
): LayaConnection {
  return parseConfig(layaConnectionSchema, config);
}

/** A Laya server the user runs, such as `laya-serve`, over the Jev `POST /v1/systemone` API. */
export function createLayaTransport(
  connection: LayaConnection & { fetch?: Fetch },
): Classifier {
  return createSystemOneClassifier({
    name: "laya",
    url: `${connection.baseURL}/v1/systemone`,
    apiKey: connection.apiKey,
    model: connection.model,
    fetch: connection.fetch,
  });
}

/** Selected by `classifier: { provider: "laya", baseUrl, apiKey, model, timeoutMs }`; all optional. */
export const layaClassifierProvider: ClassifierProvider = {
  name: "laya",
  create(config: ClassifierConfig): Classifier {
    return createLayaTransport(resolveLayaConnection(config));
  },
};
