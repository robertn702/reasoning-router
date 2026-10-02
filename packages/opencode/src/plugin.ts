import { setupV2 } from "./plugin-v2.js";

export type { PluginOptions } from "./plugin-runtime.js";

const plugin = {
  id: "reasoning-router",
  setup: setupV2,
};

export default plugin;
