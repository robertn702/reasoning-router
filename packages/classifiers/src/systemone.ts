import type {
  Classifier,
  ClassifierErrorCategory,
  Effort,
} from "@reasoning-router/core";
import { z } from "zod";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** A failed classifier request; carries only a category and advised delay, never a body or message. */
export class ClassifierRequestError extends Error {
  constructor(
    readonly category: ClassifierErrorCategory,
    readonly retryAfterMs?: number,
  ) {
    super(`classifier request failed: ${category}`);
    this.name = "ClassifierRequestError";
  }
}

function statusCategory(status: number): ClassifierErrorCategory {
  if (status === 401 || status === 403) return "http_auth";
  if (status === 429) return "http_rate_limit";
  if (status >= 400 && status < 500) return "http_4xx";
  if (status >= 500 && status < 600) return "http_5xx";
  return "http_other";
}

function retryAfterMs(headers: Headers): number | undefined {
  const retryAfter = headers.get("retry-after");
  if (!retryAfter) return undefined;
  const seconds = Number(retryAfter);
  return Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(retryAfter) - Date.now();
}

const systemOneSchema = z.object({
  answers: z.object({ effort: z.object({ choice: z.unknown() }) }),
});

const DESCRIPTIONS: Record<Effort, string> = {
  none: "Mechanical work that does not benefit from reasoning.",
  low: "Simple, mechanical, or well-understood work.",
  medium: "Routine engineering work needing some reasoning.",
  high: "Hard problems, debugging, or multi-step reasoning.",
  xhigh: "Deeply complex or ambiguous work.",
  max: "The hardest work where extra thinking clearly helps.",
};

/** POSTs a JSON body; resolves the parsed response, or `undefined` when it is not JSON. */
async function postJson(request: {
  fetch: Fetch | undefined;
  url: string;
  apiKey: string;
  body: unknown;
  signal: AbortSignal;
}): Promise<unknown> {
  const { signal } = request;
  let text: string;
  try {
    const response = await (request.fetch ?? globalThis.fetch)(request.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${request.apiKey}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(request.body),
      redirect: "error",
      signal,
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new ClassifierRequestError(
        statusCategory(response.status),
        retryAfterMs(response.headers),
      );
    }
    text = await response.text();
  } catch (error) {
    if (error instanceof ClassifierRequestError) throw error;
    throw new ClassifierRequestError(
      signal.aborted ? "sdk_abort" : "connection",
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * A classifier for an HTTP endpoint that accepts the System One request (`state`
 * and `questions`): one `effort` choice over the target model's supported
 * efforts, answered at `answers.effort.choice`.
 */
export function createSystemOneClassifier(options: {
  name: string;
  url: string;
  apiKey: string;
  /** The classifier model, sent as the request's `model`. */
  model: string;
  fetch?: Fetch;
  /** Extracts the System One response from a provider envelope. */
  unwrap?: (body: unknown) => unknown;
}): Classifier {
  return {
    name: options.name,
    errorCategory: (error) =>
      error instanceof ClassifierRequestError ? error.category : "unknown",
    retryAfterMs: (error) =>
      error instanceof ClassifierRequestError ? error.retryAfterMs : undefined,
    async classify({ state, model, signal }) {
      const body = await postJson({
        fetch: options.fetch,
        url: options.url,
        apiKey: options.apiKey,
        signal,
        body: {
          model: options.model,
          state,
          questions: {
            effort: {
              type: "choice",
              instructions:
                "Select the reasoning effort for the next model call.",
              criteria: Object.fromEntries(
                model.supportedEfforts.map((effort) => [
                  effort,
                  DESCRIPTIONS[effort],
                ]),
              ),
            },
          },
        },
      });
      const result = systemOneSchema.safeParse(
        options.unwrap ? options.unwrap(body) : body,
      );
      return result.success ? result.data.answers.effort.choice : null;
    },
  };
}
