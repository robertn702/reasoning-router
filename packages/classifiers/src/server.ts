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

const serverConnectionSchema = z
  .object({
    baseUrl: z.string(INVALID_URL).transform((raw, ctx) => {
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

/** A server URL (HTTPS, or HTTP to loopback), and an optional bearer key and `model`. */
export type ServerConnection = z.output<typeof serverConnectionSchema>;

export interface ServerPreset {
  resolve(config: Readonly<Record<string, unknown>>): ServerConnection;
  createTransport(connection: ServerConnection & { fetch?: Fetch }): Classifier;
  provider: ClassifierProvider;
}

/**
 * A System One server the user runs, called at `{baseUrl}/v1/systemone`.
 * Selected by `classifier: { provider: name, baseUrl, apiKey, model, timeoutMs }`; all optional.
 */
export function createServerPreset(
  name: string,
  defaultBaseUrl: string,
): ServerPreset {
  const resolve = (config: Readonly<Record<string, unknown>>) =>
    parseConfig(serverConnectionSchema, {
      ...config,
      baseUrl: config.baseUrl ?? defaultBaseUrl,
    });
  const createTransport = (connection: ServerConnection & { fetch?: Fetch }) =>
    createSystemOneClassifier({
      name,
      url: `${connection.baseURL}/v1/systemone`,
      apiKey: connection.apiKey,
      model: connection.model,
      fetch: connection.fetch,
    });
  return {
    resolve,
    createTransport,
    provider: {
      name,
      create: (config: ClassifierConfig) => createTransport(resolve(config)),
    },
  };
}
