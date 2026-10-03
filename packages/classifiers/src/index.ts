import type { ClassifierProvider } from "@reasoning-router/core";
import { clefClassifierProvider } from "./clef.js";
import { jevClassifierProvider } from "./jev.js";

export {
  type ClefConnection,
  clefClassifierProvider,
  createClefTransport,
  resolveClefConnection,
} from "./clef.js";
export { loadClassifierConfig } from "./env.js";
export {
  createJevClassifier,
  createJevTransport,
  type JevClassifierOptions,
  type JevConnection,
  jevClassifierProvider,
  resolveJevConnection,
} from "./jev.js";
export { ClassifierRequestError, type Fetch } from "./systemone.js";

/** Every bundled classifier, for `createConfiguredSelector`. */
export const classifierProviders: readonly ClassifierProvider[] = [
  jevClassifierProvider,
  clefClassifierProvider,
];
