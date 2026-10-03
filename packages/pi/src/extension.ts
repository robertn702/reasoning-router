import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { classifierProviders } from "@reasoning-router/classifiers";
import {
  createConfiguredStateSelector,
  createDecisionLogger,
} from "@reasoning-router/core";

import { loadConfig } from "./config.js";
import { createReasoningRouter } from "./router.js";

/**
 * The Pi extension: configured from `REASONING_ROUTER_*` environment variables.
 * The virtual models register at load; the configuration is read on the first
 * route, so a configuration error fails that request instead of Pi's startup.
 */
export default function reasoningRouter(pi: ExtensionAPI): void {
  createReasoningRouter(pi, () => {
    const config = loadConfig(process.env);
    return {
      selectEffort: createConfiguredStateSelector(
        config.classifier,
        classifierProviders,
        {
          maxRetries: config.maxRetries,
          fallbackMode: config.fallbackMode,
          fallbackEffort: config.fallbackEffort,
        },
      ),
      baseEffort: config.baseEffort,
      onEvidence:
        config.decisionsLogPath === undefined
          ? undefined
          : createDecisionLogger(config.decisionsLogPath),
    };
  });
}
