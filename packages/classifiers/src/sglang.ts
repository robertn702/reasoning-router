import type {
  ClassifierConfig,
  ClassifierProvider,
} from "@reasoning-router/core";
import { createServerPreset, type ServerConnection } from "./server.js";
import type { Fetch } from "./systemone.js";

/** An SGLang server the user runs (`sglang.launch_server`), at its default port on loopback. */
const sglang = createServerPreset("sglang", "http://127.0.0.1:30000");

export type SglangConnection = ServerConnection;
export const resolveSglangConnection = sglang.resolve;

/**
 * SGLang's `/v1/systemone` requires `model` but only echoes the served model,
 * so an unset `model` is sent as `default`.
 */
export const createSglangTransport = (
  connection: SglangConnection & { fetch?: Fetch },
) =>
  sglang.createTransport({
    ...connection,
    model: connection.model ?? "default",
  });

/** Selected by `classifier: { provider: "sglang", baseUrl, apiKey, model, timeoutMs }`. */
export const sglangClassifierProvider: ClassifierProvider = {
  name: "sglang",
  create: (config: ClassifierConfig) =>
    createSglangTransport(resolveSglangConnection(config)),
};
