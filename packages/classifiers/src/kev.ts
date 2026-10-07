import type {
  Classifier,
  ClassifierConfig,
  ClassifierProvider,
} from "@reasoning-router/core";
import { type LayaConnection, resolveLayaConnection } from "./laya.js";
import { createSystemOneClassifier, type Fetch } from "./systemone.js";

/** `kev.serve`'s default `--host` and `--port`. */
const KEV_BASE_URL = "http://127.0.0.1:8008";

export type KevConnection = LayaConnection;

/** Validates the Kev server URL, and an optional bearer key and `model`, by the same rules as Laya. */
export function resolveKevConnection(
  config: Readonly<Record<string, unknown>>,
): KevConnection {
  return resolveLayaConnection({
    ...config,
    baseUrl: config.baseUrl ?? KEV_BASE_URL,
  });
}

/** A Kev server the user runs (`python -m kev.serve`), over the Jev `POST /v1/systemone` API. */
export function createKevTransport(
  connection: KevConnection & { fetch?: Fetch },
): Classifier {
  return createSystemOneClassifier({
    name: "kev",
    url: `${connection.baseURL}/v1/systemone`,
    apiKey: connection.apiKey,
    model: connection.model,
    fetch: connection.fetch,
  });
}

/** Selected by `classifier: { provider: "kev", baseUrl, apiKey, model, timeoutMs }`; all optional. */
export const kevClassifierProvider: ClassifierProvider = {
  name: "kev",
  create(config: ClassifierConfig): Classifier {
    return createKevTransport(resolveKevConnection(config));
  },
};
