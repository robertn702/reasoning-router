import type { ClassifierProvider } from "@reasoning-router/core";
import { clefClassifierProvider } from "./clef.js";
import { clmClassifierProvider } from "./clm.js";
import { jevClassifierProvider } from "./jev.js";
import { kevClassifierProvider } from "./kev.js";
import { layaClassifierProvider } from "./laya.js";
import { openAIDecisionsClassifierProvider } from "./openai-decisions.js";

export {
  type ClefConnection,
  clefClassifierProvider,
  createClefTransport,
  resolveClefConnection,
} from "./clef.js";
export {
  type ClmConnection,
  clmClassifierProvider,
  createClmTransport,
  resolveClmConnection,
} from "./clm.js";
export { loadClassifierConfig } from "./env.js";
export {
  createJevClassifier,
  createJevTransport,
  type JevClassifierOptions,
  type JevConnection,
  jevClassifierProvider,
  resolveJevConnection,
} from "./jev.js";
export {
  createKevTransport,
  type KevConnection,
  kevClassifierProvider,
  resolveKevConnection,
} from "./kev.js";
export {
  createLayaTransport,
  type LayaConnection,
  layaClassifierProvider,
  resolveLayaConnection,
} from "./laya.js";
export {
  createOpenAIDecisionsTransport,
  type OpenAIDecisionsConnection,
  openAIDecisionsClassifierProvider,
  resolveOpenAIDecisionsConnection,
} from "./openai-decisions.js";
export { ClassifierRequestError, type Fetch } from "./systemone.js";

/** Every bundled classifier, for `createConfiguredSelector`. */
export const classifierProviders: readonly ClassifierProvider[] = [
  jevClassifierProvider,
  clefClassifierProvider,
  layaClassifierProvider,
  kevClassifierProvider,
  openAIDecisionsClassifierProvider,
  clmClassifierProvider,
];
