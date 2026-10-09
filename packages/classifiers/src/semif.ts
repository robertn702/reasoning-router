import type {
  Classifier,
  ClassifierConfig,
  ClassifierProvider,
} from "@reasoning-router/core";
import { type LayaConnection, resolveLayaConnection } from "./laya.js";
import { createSystemOneClassifier, type Fetch } from "./systemone.js";

/** `semif-serve`'s default bind address. */
const SEMIF_BASE_URL = "http://127.0.0.1:8471";
/** `semif-serve` requires `model`; this alias selects whatever checkpoint it serves. */
const SEMIF_MODEL = "semif-latest";

export type SemifConnection = Omit<LayaConnection, "model"> & {
  model: string;
};

/** Validates the SemIf server URL, and an optional bearer key, by the same rules as Laya; `model` defaults to `semif-latest`. */
export function resolveSemifConnection(
  config: Readonly<Record<string, unknown>>,
): SemifConnection {
  const { model, ...connection } = resolveLayaConnection({
    ...config,
    baseUrl: config.baseUrl ?? SEMIF_BASE_URL,
  });
  return { ...connection, model: model ?? SEMIF_MODEL };
}

/** A SemIf server the user runs (`semif-serve`), over the Jev `POST /v1/systemone` API. */
export function createSemifTransport(
  connection: SemifConnection & { fetch?: Fetch },
): Classifier {
  return createSystemOneClassifier({
    name: "semif",
    url: `${connection.baseURL}/v1/systemone`,
    apiKey: connection.apiKey,
    model: connection.model,
    fetch: connection.fetch,
  });
}

/** Selected by `classifier: { provider: "semif", baseUrl, apiKey, model, timeoutMs }`; all optional. */
export const semifClassifierProvider: ClassifierProvider = {
  name: "semif",
  create(config: ClassifierConfig): Classifier {
    return createSemifTransport(resolveSemifConnection(config));
  },
};
