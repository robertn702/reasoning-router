import { randomUUID } from "node:crypto";

import type { Api, Model } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  ModelRoute,
  ModelRouteRequest,
} from "@earendil-works/pi-coding-agent";
import {
  buildEvidence,
  ClassificationCancelledError,
  ClassificationFailedError,
  type Effort,
  type EffortDecision,
  type Evidence,
  isEffort,
  isRecord,
  type ModelProfile,
  modelsFor,
  type StateEffortSelector,
  supportsEffort,
  type Usage,
} from "@reasoning-router/core";

import { classifierState, toEffort, toThinkingLevel } from "./messages.js";

/** The provider the virtual models are listed under. */
export const PROVIDER = "reasoning-router";
/** The provider of the physical models; the router keeps the model and changes only effort. */
const PHYSICAL_PROVIDER = "anthropic";

/** The last classified effort, stored on the session branch for `previous` fallback. */
export interface RouterState {
  effort: Effort;
}

/** A rejection Pi shows to the user as the failed request's error. */
export class PiRouteError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    detail: string,
  ) {
    super(`reasoning-router ${code} (${status}): ${detail}`);
    this.name = "PiRouteError";
  }
}

export interface RouterOptions {
  selectEffort: StateEffortSelector;
  /** Effort for `direct` requests, such as compaction; defaults to the model's base effort. */
  baseEffort?: Effort;
  onEvidence?: (evidence: Evidence) => void;
}

interface Pending {
  model: string;
  decision: EffortDecision;
  previousEffort: Effort | null;
}

function storedEffort(state: unknown, model: ModelProfile): Effort | undefined {
  return isRecord(state) &&
    isEffort(state.effort) &&
    supportsEffort(model, state.effort)
    ? state.effort
    : undefined;
}

/** Pi places effort without breaking the cache only for models with mid-conversation effort. */
function supportsMidConvoEffort(model: Model<Api>): boolean {
  return (
    model.api === "anthropic-messages" &&
    isRecord(model.compat) &&
    model.compat.supportsMidConvoEffort === true
  );
}

/** Registers one virtual model per wrapped Anthropic model, such as `reasoning-router/claude-opus-5-5`. */
export function createReasoningRouter(
  pi: ExtensionAPI,
  options: RouterOptions,
): void {
  const pending = new Map<string, Pending>();
  const emit = (
    { model, decision, previousEffort }: Pending,
    session: string,
    outcome: string,
    usage?: Usage,
  ) =>
    options.onEvidence?.(
      buildEvidence({
        requestId: randomUUID(),
        session,
        usage,
        previousEffort,
        outboundModel: model,
        outboundEffort: decision.effort,
        classifier: decision.classifier,
        classifierLatencyMs: decision.classifierLatencyMs,
        classifierAttempts: decision.classifierAttempts,
        fallback: decision.fallback,
        fallbackSource: decision.fallbackSource,
        classifierErrorCategory: decision.classifierErrorCategory,
        outcome,
      }),
    );

  async function decide(
    request: ModelRouteRequest<RouterState>,
    model: ModelProfile,
    previousEffort: Effort | undefined,
  ): Promise<EffortDecision> {
    const fixed = (effort: Effort): EffortDecision => ({
      effort,
      classifierLatencyMs: 0,
      fallback: null,
    });
    if (request.reason === "direct")
      return fixed(options.baseEffort ?? model.defaultBaseEffort);
    const retried = toEffort(request.failed?.thinkingLevel);
    if (request.reason === "retry" && supportsEffort(model, retried))
      return fixed(retried);
    const signal = request.signal ?? new AbortController().signal;
    if (signal.aborted)
      throw new PiRouteError("cancelled", 499, "request cancelled");
    try {
      return await options.selectEffort({
        model,
        state: classifierState(request.messages),
        signal,
        cacheKey: null,
        previousEffort,
      });
    } catch (error) {
      if (signal.aborted || error instanceof ClassificationCancelledError)
        throw new PiRouteError("cancelled", 499, "request cancelled");
      if (error instanceof ClassificationFailedError) {
        options.onEvidence?.(
          buildEvidence({
            requestId: randomUUID(),
            outboundModel: model.id,
            outboundEffort: "",
            classifier: error.classifier,
            classifierLatencyMs: error.latencyMs,
            classifierAttempts: error.attempts,
            fallback: null,
            outcome: "classification_failed",
          }),
        );
        throw new PiRouteError(
          "classification_failed",
          502,
          "classification_failed",
        );
      }
      throw error;
    }
  }

  for (const model of modelsFor("anthropic")) {
    pi.registerVirtualModel<RouterState>({
      provider: PROVIDER,
      id: model.id,
      name: `${model.name} (reasoning-router)`,
      async route(
        request: ModelRouteRequest<RouterState>,
        ctx: ExtensionContext,
      ): Promise<ModelRoute<RouterState>> {
        const physical = ctx.modelRegistry.find(PHYSICAL_PROVIDER, model.id);
        if (!physical || !supportsMidConvoEffort(physical))
          throw new PiRouteError(
            "unsupported_model",
            400,
            `${PHYSICAL_PROVIDER}/${model.id} is not an Anthropic Messages model with mid-conversation effort in this Pi`,
          );
        const previousEffort = storedEffort(request.state, model);
        const decision = await decide(request, model, previousEffort);
        if (request.signal?.aborted)
          throw new PiRouteError("cancelled", 499, "request cancelled");
        if (request.reason !== "direct") {
          const session = ctx.sessionManager.getSessionId();
          const stale = pending.get(session);
          if (stale) emit(stale, session, "failed");
          pending.set(session, {
            model: model.id,
            decision,
            previousEffort: previousEffort ?? null,
          });
        }
        // Only successful classifications become the `previous` fallback, as in the core cache.
        const classified =
          decision.classifier !== undefined && decision.fallback === null;
        return {
          model: physical,
          thinkingLevel: toThinkingLevel(decision.effort),
          state:
            classified && decision.effort !== previousEffort
              ? { effort: decision.effort }
              : request.state,
        };
      },
    });
  }

  pi.on("message_end", (event, ctx) => {
    const { message } = event;
    if (message.role !== "assistant" || message.provider !== PHYSICAL_PROVIDER)
      return;
    const session = ctx.sessionManager.getSessionId();
    const current = pending.get(session);
    if (!current || current.model !== message.model) return;
    pending.delete(session);
    const { input, output, cacheRead, cacheWrite } = message.usage;
    emit(
      current,
      session,
      message.stopReason === "error" || message.stopReason === "aborted"
        ? "failed"
        : "completed",
      {
        input_tokens: input + cacheRead + cacheWrite,
        cached_input_tokens: cacheRead,
        output_tokens: output,
        cache_creation_input_tokens: cacheWrite,
      },
    );
  });
}
