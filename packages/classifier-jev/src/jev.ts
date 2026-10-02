import {
  type ClassificationPolicyOptions,
  type Classifier,
  type ClassifierConfig,
  type ClassifierErrorCategory,
  type ClassifierProvider,
  createClassifierSelector,
  type Effort,
  type EffortSelector,
} from "@reasoning-router/core";
import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  choice,
  type Fetch,
  TypeSafeClient,
} from "@typesafe-ai/sdk";

function errorCategory(error: unknown): ClassifierErrorCategory {
  if (error instanceof APIError) {
    if (error.status === 401 || error.status === 403) return "http_auth";
    if (error.status === 429) return "http_rate_limit";
    if (error.status >= 400 && error.status < 500) return "http_4xx";
    if (error.status >= 500 && error.status < 600) return "http_5xx";
    return "http_other";
  }
  if (error instanceof APITimeoutError) return "sdk_timeout";
  if (error instanceof APIConnectionError) return "connection";
  if (error instanceof APIUserAbortError) return "sdk_abort";
  return "unknown";
}

function retryAfterMs(error: unknown): number | undefined {
  if (!(error instanceof APIError)) return undefined;
  const retryAfter = error.headers?.get("retry-after");
  if (!retryAfter) return undefined;
  const seconds = Number(retryAfter);
  return Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(retryAfter) - Date.now();
}

const DESCRIPTIONS: Record<Effort, string> = {
  none: "Mechanical work that does not benefit from reasoning.",
  low: "Simple, mechanical, or well-understood work.",
  medium: "Routine engineering work needing some reasoning.",
  high: "Hard problems, debugging, or multi-step reasoning.",
  xhigh: "Deeply complex or ambiguous work.",
  max: "The hardest work where extra thinking clearly helps.",
};

export interface JevConnection {
  apiKey: string;
  baseURL: string;
  model: string;
}

/** Validates a Jev key and endpoint, and selects the Jev model that endpoint serves. */
export function resolveJevConnection(
  config: Readonly<Record<string, unknown>>,
): JevConnection {
  const apiKey = typeof config.apiKey === "string" ? config.apiKey : "";
  if (!apiKey.trim())
    throw new Error("classifier.apiKey is required for Jev classification");
  let url: URL;
  try {
    url = new URL(
      typeof config.baseUrl === "string"
        ? config.baseUrl
        : config.baseUrl === undefined
          ? "https://api.typesafe.ai"
          : "",
    );
  } catch {
    throw new Error("classifier.baseUrl must be a valid HTTPS URL");
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "classifier.baseUrl must be an HTTPS URL without credentials, query, or fragment",
    );
  const baseURL = url.href.replace(/\/$/, "");
  const model =
    baseURL === "https://api.typesafe.ai"
      ? "jev-latest"
      : baseURL === "https://ai-gateway.vercel.sh/typesafe"
        ? "typesafe-ai/jev"
        : null;
  if (model === null)
    throw new Error(
      "classifier.baseUrl supports only the TypeSafe direct and Vercel TypeSafe-compatible endpoints",
    );
  return { apiKey: apiKey.trim(), baseURL, model };
}

/** The Jev `system_one` transport: one `effort` choice over the target model's supported efforts. */
export function createJevTransport(
  connection: JevConnection & { fetch?: Fetch },
): Classifier & { client: TypeSafeClient } {
  const client = new TypeSafeClient({
    apiKey: connection.apiKey,
    baseURL: connection.baseURL,
    defaultModel: connection.model,
    retry: { maxRetries: 0 },
    logLevel: "off",
    ...(connection.fetch ? { fetch: connection.fetch } : {}),
  });
  return {
    name: "jev",
    client,
    errorCategory,
    retryAfterMs,
    async classify({ state, model, signal }) {
      const questions = {
        effort: choice(
          "Select the reasoning effort for the next model call.",
          Object.fromEntries(
            model.supportedEfforts.map((effort) => [
              effort,
              DESCRIPTIONS[effort],
            ]),
          ),
        ),
      };
      const result: unknown = await client.systemOne(
        { state, questions },
        { signal },
      );
      if (!isRecord(result) || !isRecord(result.answers)) return null;
      const answer = result.answers.effort;
      return isRecord(answer) ? answer.choice : null;
    },
  };
}

export interface JevClassifierOptions
  extends ClassificationPolicyOptions,
    JevConnection {
  timeoutMs: number;
  fetch?: Fetch;
  cacheEntries?: number;
  cacheTtlMs?: number;
}

export interface JevClassifier {
  select: EffortSelector;
  client: TypeSafeClient;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createJevClassifier(
  options: JevClassifierOptions,
): JevClassifier {
  const classifier = createJevTransport(options);
  return {
    select: createClassifierSelector({ ...options, classifier }),
    client: classifier.client,
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
