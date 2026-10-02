import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { classifierProviders } from "@reasoning-router/classifiers";
import {
  createConfiguredStateSelector,
  createDecisionLogger,
} from "@reasoning-router/core";

import { loadConfig } from "./config.js";
import { createReasoningRouter } from "./router.js";

export { loadConfig, type PiConfig } from "./config.js";
export {
  createReasoningRouter,
  PiRouteError,
  PROVIDER,
  type RouterOptions,
  type RouterState,
} from "./router.js";

/** The Pi extension: configured from `REASONING_ROUTER_*` environment variables. */
export default function reasoningRouter(pi: ExtensionAPI): void {
  let config: ReturnType<typeof loadConfig>;
  let selectEffort: ReturnType<typeof createConfiguredStateSelector>;
  try {
    config = loadConfig(process.env);
    selectEffort = createConfiguredStateSelector(
      config.classifier,
      classifierProviders,
      {
        maxRetries: config.maxRetries,
        fallbackMode: config.fallbackMode,
        fallbackEffort: config.fallbackEffort,
      },
    );
  } catch (error) {
    throw new Error(
      `reasoning-router: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  createReasoningRouter(pi, {
    selectEffort,
    baseEffort: config.baseEffort,
    onEvidence:
      config.decisionsLogPath === undefined
        ? undefined
        : createDecisionLogger(config.decisionsLogPath),
  });
}
