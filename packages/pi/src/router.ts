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
  type Provider,
  type StateEffortSelector,
  supportsEffort,
  type Usage,
} from "@reasoning-router/core";

import { classifierState, toEffort, toThinkingLevel } from "./messages.js";

/** The provider the virtual models are listed under. */
export const PROVIDER = "reasoning-router";
/** The API each physical provider must use for Pi to place effort without breaking the cache. */
const PHYSICAL_API: Record<Provider, { api: Api; name: string }> = {
  anthropic: { api: "anthropic-messages", name: "Anthropic Messages" },
  openai: { api: "openai-responses", name: "OpenAI Responses" },
};

/** The last classified effort, stored on the session branch for `previous` fallback. */
export interface RouterState {
  effort: Effort;
}

/**
 * A rejection Pi shows to the user as the failed request's error. The message
 * carries no HTTP status or transport wording: Pi retries errors that match
 * its provider-error pattern, which would reclassify the request.
 */
export class PiRouteError extends Error {
  constructor(
    readonly code: string,
    detail: string,
  ) {
    super(`reasoning-router ${code}: ${detail}`);
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
  provider: Provider;
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
function supportsMidConvoEffort(model: Model<Api>, api: Api): boolean {
  return (
    model.api === api &&
    isRecord(model.compat) &&
    model.compat.supportsMidConvoEffort === true
  );
}

/** Registers one virtual model per wrapped model, such as `reasoning-router/claude-opus-5-5`. */
export function createReasoningRouter(
  pi: ExtensionAPI,
  loadOptions: () => RouterOptions,
): void {
  let resolved: RouterOptions | undefined;
  /** Builds the options on the first route and caches them; a failure is shown at route time and retried on the next. */
  function resolve(): RouterOptions {
    if (resolved) return resolved;
    try {
      resolved = loadOptions();
    } catch (error) {
      throw new PiRouteError(
        "invalid_config",
        error instanceof Error ? error.message : String(error),
      );
    }
    return resolved;
  }
  const pending = new Map<string, Pending>();
  const emit = (
    { model, decision, previousEffort }: Pending,
    session: string,
    outcome: string,
    usage?: Usage,
  ) =>
    resolved?.onEvidence?.(
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
    options: RouterOptions,
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
      throw new PiRouteError("cancelled", "request cancelled");
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
        throw new PiRouteError("cancelled", "request cancelled");
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
          "the classifier did not return an effort",
        );
      }
      throw error;
    }
  }

  for (const model of [...modelsFor("anthropic"), ...modelsFor("openai")]) {
    const { api, name } = PHYSICAL_API[model.provider];
    pi.registerVirtualModel<RouterState>({
      provider: PROVIDER,
      id: model.id,
      name: `${model.name} (reasoning-router)`,
      async route(
        request: ModelRouteRequest<RouterState>,
        ctx: ExtensionContext,
      ): Promise<ModelRoute<RouterState>> {
        const physical = ctx.modelRegistry.find(model.provider, model.id);
        if (!physical || !supportsMidConvoEffort(physical, api))
          throw new PiRouteError(
            "unsupported_model",
            `${model.provider}/${model.id} is not an ${name} model with mid-conversation effort in this Pi`,
          );
        // Pi sends request-level effort with Sign in with ChatGPT, so every change would miss the cache.
        if (
          model.provider === "openai" &&
          ctx.modelRegistry.isUsingOAuth(physical)
        )
          throw new PiRouteError(
            "unsupported_model",
            `${model.provider}/${model.id} with Sign in with ChatGPT gets no mid-conversation effort in Pi; use an OpenAI API key`,
          );
        const options = resolve();
        const previousEffort = storedEffort(request.state, model);
        const decision = await decide(options, request, model, previousEffort);
        if (request.signal?.aborted)
          throw new PiRouteError("cancelled", "request cancelled");
        if (request.reason !== "direct") {
          const session = ctx.sessionManager.getSessionId();
          const stale = pending.get(session);
          if (stale) emit(stale, session, "failed");
          pending.set(session, {
            provider: model.provider,
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
    if (message.role !== "assistant") return;
    const session = ctx.sessionManager.getSessionId();
    const current = pending.get(session);
    if (
      !current ||
      current.provider !== message.provider ||
      current.model !== message.model
    )
      return;
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
