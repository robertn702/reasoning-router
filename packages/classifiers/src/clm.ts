import type {
  Classifier,
  ClassifierConfig,
  ClassifierProvider,
} from "@reasoning-router/core";
import { type LayaConnection, resolveLayaConnection } from "./laya.js";
import { createSystemOneClassifier, type Fetch } from "./systemone.js";

/** `clm-serve`'s default port, on loopback. */
const CLM_BASE_URL = "http://127.0.0.1:8700";

export type ClmConnection = LayaConnection;

/** Validates the `clm-serve` URL, and an optional bearer key and `model`, by the same rules as Laya. */
export function resolveClmConnection(
  config: Readonly<Record<string, unknown>>,
): ClmConnection {
  return resolveLayaConnection({
    ...config,
    baseUrl: config.baseUrl ?? CLM_BASE_URL,
  });
}

/** A CLM server the user runs (`clm-serve`), over the Jev `POST /v1/systemone` API. */
export function createClmTransport(
  connection: ClmConnection & { fetch?: Fetch },
): Classifier {
  return createSystemOneClassifier({
    name: "clm",
    url: `${connection.baseURL}/v1/systemone`,
    apiKey: connection.apiKey,
    model: connection.model,
    fetch: connection.fetch,
  });
}

/** Selected by `classifier: { provider: "clm", baseUrl, apiKey, model, timeoutMs }`; all optional. */
export const clmClassifierProvider: ClassifierProvider = {
  name: "clm",
  create(config: ClassifierConfig): Classifier {
    return createClmTransport(resolveClmConnection(config));
  },
};
