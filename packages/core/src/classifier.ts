import { setTimeout as delay } from "node:timers/promises";

import {
  ClassificationFailedError,
  type ClassificationPolicyOptions,
  classificationPolicy,
} from "./classification-policy.js";
import { EffortCache } from "./effort-cache.js";
import { type Effort, type ModelProfile, supportsEffort } from "./models.js";
import type { EffortDecision, EffortSelector } from "./router.js";
import { wireFor } from "./wire.js";

/** The bounded, metadata-limited conversation summary a classifier receives. */
export type ClassifierState = {
  recent_user_text: string;
  assistant_progress: string;
  tool_results: Array<{ name: string; ok: boolean; excerpt: string }>;
  failure_state: { failed_count: number; last_failure_excerpt: string };
};

export type ClassifierErrorCategory = NonNullable<
  EffortDecision["classifierErrorCategory"]
>;

/** Provider-specific transport for one classification attempt. */
export interface Classifier {
  /** Recorded in decision events as `classifier`. */
  readonly name: string;
  /** Resolves the chosen effort, or any other value when the output is unusable. */
  classify(request: {
    state: ClassifierState & { model: string };
    model: ModelProfile;
    signal: AbortSignal;
  }): Promise<unknown>;
  /** Maps a thrown error to a fixed category; transient categories are retried. */
  errorCategory(error: unknown): ClassifierErrorCategory;
  /** A server-advised retry delay, when the error carries one. */
  retryAfterMs?(error: unknown): number | undefined;
}

export interface ClassifierSelectorOptions extends ClassificationPolicyOptions {
  classifier: Classifier;
  timeoutMs: number;
  cacheEntries?: number;
  cacheTtlMs?: number;
}

/** The `classifier` configuration block; `provider` selects a registered classifier. */
export interface ClassifierConfig {
  readonly provider: string;
  readonly timeoutMs?: number;
  readonly [option: string]: unknown;
}

export interface ClassifierProvider {
  readonly name: string;
  create(config: ClassifierConfig): Classifier;
}

export class ClassificationCancelledError extends Error {
  constructor() {
    super("effort classification cancelled");
    this.name = "ClassificationCancelledError";
  }
}

const RETRYABLE: readonly ClassifierErrorCategory[] = [
  "http_5xx",
  "http_rate_limit",
  "connection",
  "sdk_timeout",
];

function usableCacheKey(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** Selects an effort for a prebuilt classifier state, for harnesses that expose messages rather than a wire body. */
export type StateEffortSelector = (args: {
  model: ModelProfile;
  state: ClassifierState;
  signal: AbortSignal;
  /** Keys the in-memory previous-effort cache; null disables it. */
  cacheKey: string | null;
  /** The effort for `previous` fallback when the harness stores it; takes precedence over the cache. */
  previousEffort?: Effort;
}) => Promise<EffortDecision>;

/** Applies the classification policy (deadline, retries, fallback, previous-effort cache) to a classifier. */
export function createClassifierSelector(
  options: ClassifierSelectorOptions,
): EffortSelector {
  const select = createStateSelector(options);
  return async ({
    body,
    signal,
    model,
    cacheScope,
    cacheKey: selectedCacheKey,
  }) => {
    if (signal.aborted) throw new ClassificationCancelledError();
    const key =
      selectedCacheKey !== undefined
        ? selectedCacheKey
        : usableCacheKey(body.prompt_cache_key);
    // A provider instance may serve multiple OpenCode credentials. Keep fallback
    // state tenant-scoped even though prompt text never enters the cache.
    return select({
      model,
      signal,
      state: wireFor(model.provider).classifierState(body),
      cacheKey:
        key === null ? null : JSON.stringify([cacheScope ?? "", model.id, key]),
    });
  };
}

/** Like `createClassifierSelector`, for a classifier state the harness built. */
export function createStateSelector(
  options: ClassifierSelectorOptions,
): StateEffortSelector {
  const policy = classificationPolicy(options);
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1)
    throw new Error("timeoutMs must be a positive integer");
  const { classifier } = options;
  const previousEfforts = new EffortCache(
    options.cacheEntries ?? 256,
    options.cacheTtlMs ?? 600_000,
  );

  return async ({
    state: classifierState,
    signal,
    model,
    cacheKey,
    previousEffort,
  }) => {
    if (signal.aborted) throw new ClassificationCancelledError();
    const startedAt = performance.now();
    const latency = (): number => Math.round(performance.now() - startedAt);
    const state = { ...classifierState, model: model.id };

    const deadline = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => {
        deadline.abort();
        resolve("timeout");
      }, options.timeoutMs);
    });
    const combined = AbortSignal.any([signal, deadline.signal]);

    let attempts = 0;
    const call = (async () => {
      for (;;) {
        if (combined.aborted)
          return { kind: "error" as const, category: "sdk_abort" as const };
        attempts++;
        try {
          return {
            kind: "result" as const,
            result: await classifier.classify({
              state,
              model,
              signal: combined,
            }),
          };
        } catch (error) {
          const category = classifier.errorCategory(error);
          const retryable = RETRYABLE.includes(category);
          if (!retryable || attempts > policy.maxRetries || combined.aborted)
            return { kind: "error" as const, category };
          let waitMs =
            Math.min(2000, 200 * 2 ** (attempts - 1)) *
            (0.75 + Math.random() * 0.5);
          const advised = classifier.retryAfterMs?.(error);
          if (advised !== undefined && Number.isFinite(advised))
            waitMs = Math.max(waitMs, advised);
          try {
            await delay(Math.min(waitMs, options.timeoutMs), undefined, {
              signal: combined,
            });
          } catch {
            return { kind: "error" as const, category: "sdk_abort" as const };
          }
        }
      }
    })();

    try {
      const outcome = await Promise.race([call, timeoutPromise]);

      if (signal.aborted) {
        throw new ClassificationCancelledError();
      }

      const fallback = (
        code:
          | "classifier_timeout"
          | "classifier_error"
          | "classifier_invalid_output",
      ): EffortDecision => {
        if (policy.fallbackMode === "error")
          throw new ClassificationFailedError(
            code,
            attempts,
            latency(),
            classifier.name,
          );
        const previous =
          policy.fallbackMode !== "previous"
            ? undefined
            : (previousEffort ??
              (cacheKey ? previousEfforts.get(cacheKey) : undefined));
        const usePrevious = supportsEffort(model, previous);
        return {
          effort: usePrevious ? previous : policy.fallbackEffort,
          classifier: classifier.name,
          classifierLatencyMs: latency(),
          classifierAttempts: attempts,
          fallbackSource: usePrevious ? "previous" : "fixed",
          fallback: code,
        };
      };

      if (outcome === "timeout") {
        return fallback("classifier_timeout");
      }
      if (outcome.kind === "error") {
        return {
          ...fallback("classifier_error"),
          classifierErrorCategory: outcome.category,
        };
      }

      const effort = outcome.result;
      if (!supportsEffort(model, effort)) {
        return fallback("classifier_invalid_output");
      }

      if (cacheKey !== null) {
        previousEfforts.set(cacheKey, effort);
      }
      return {
        effort,
        classifier: classifier.name,
        classifierLatencyMs: latency(),
        classifierAttempts: attempts,
        fallback: null,
      };
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  };
}

/** Creates the selector for a `classifier` configuration block from the installed providers. */
export function createConfiguredSelector(
  config: ClassifierConfig,
  providers: readonly ClassifierProvider[],
  options: Omit<ClassifierSelectorOptions, "classifier" | "timeoutMs">,
): EffortSelector {
  return createClassifierSelector(configured(config, providers, options));
}

/** Like `createConfiguredSelector`, for a classifier state the harness built. */
export function createConfiguredStateSelector(
  config: ClassifierConfig,
  providers: readonly ClassifierProvider[],
  options: Omit<ClassifierSelectorOptions, "classifier" | "timeoutMs">,
): StateEffortSelector {
  return createStateSelector(configured(config, providers, options));
}

function configured(
  config: ClassifierConfig,
  providers: readonly ClassifierProvider[],
  options: Omit<ClassifierSelectorOptions, "classifier" | "timeoutMs">,
): ClassifierSelectorOptions {
  const provider = providers.find(
    (candidate) => candidate.name === config.provider,
  );
  if (!provider)
    throw new Error(
      `classifier.provider must be one of ${providers.map((candidate) => candidate.name).join(", ")}`,
    );
  return {
    ...options,
    classifier: provider.create(config),
    timeoutMs: config.timeoutMs ?? 4_000,
  };
}
