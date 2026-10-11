import {
  ClassificationCancelledError,
  createClassifierSelector,
  createConfiguredSelector,
  findModel,
} from "@reasoning-router/core";
import { describe, expect, it } from "vitest";
import {
  classifierProviders,
  createOpenRouterTransport,
  loadClassifierConfig,
  type OpenRouterConnection,
  resolveOpenRouterConnection,
} from "../src/index.js";

type FakeFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** A target model without `none`, so an off-menu `none` is detectable. */
const ASTRA = findModel("gpt-6-astra")!;
const URL = "https://openrouter.ai/api/alpha/decisions";
const CONFIG = { apiKey: "sk-or-secret", model: "typesafe/jev-1.13" };
const state = {
  model: ASTRA.id,
  recent_user_text: "",
  assistant_progress: "",
  tool_results: [],
  failure_state: { failed_count: 0, last_failure_excerpt: "" },
};

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });

/** The documented Decisions response: answers keyed by question ID, plus the build, provider, and usage. */
const answer = (choice: unknown) =>
  json({
    id: "gen-dec-1790265859-EaXKST7hul1Wcqots1ZK",
    model: "typesafe/jev-1.13-20260917",
    provider: "TypeSafe",
    answers: {
      effort: {
        type: "choice",
        choice,
        probabilities: { low: 0.7, medium: 0.2, high: 0.1 },
        confidence: 0.6,
      },
    },
    usage: { input_tokens: 120, output_tokens: 0, cost: 0.000005 },
  });

function select(
  fetch: FakeFetch,
  options: {
    config?: Record<string, unknown>;
    timeoutMs?: number;
    maxRetries?: number;
  } = {},
) {
  return createClassifierSelector({
    classifier: createOpenRouterTransport({
      ...resolveOpenRouterConnection(options.config ?? CONFIG),
      fetch,
    }),
    timeoutMs: options.timeoutMs ?? 1000,
    maxRetries: options.maxRetries ?? 0,
    fallbackEffort: "medium",
  });
}

const args = (signal = new AbortController().signal) => ({
  model: ASTRA,
  body: {
    model: ASTRA.id,
    input: [{ role: "user", content: "fix the flaky test" }],
  },
  signal,
});

const decide = (response: () => Response) =>
  select(async () => response())(args());

async function failure(response: () => Response) {
  const classifier = createOpenRouterTransport({
    ...resolveOpenRouterConnection(CONFIG),
    fetch: async () => response(),
  });
  const error = await classifier
    .classify({ state, model: ASTRA, signal: new AbortController().signal })
    .then(
      () => undefined,
      (caught: unknown) => caught,
    );
  return { classifier, error };
}

describe("OpenRouter classifier", () => {
  it.each([
    "typesafe/jev-1.13",
    "togethercomputer/tev1-4b-experimental",
    "inception/mercury-decide:free",
  ])(
    "posts the System One request to the Decisions API for %s",
    async (model) => {
      let sent: [string, RequestInit | undefined] | undefined;
      const result = await select(
        async (input, init) => {
          sent = [input, init];
          return answer("low");
        },
        { config: { ...CONFIG, model } },
      )(args());

      expect(result).toMatchObject({
        effort: "low",
        classifier: "openrouter",
        fallback: null,
      });
      expect(sent?.[0]).toBe(URL);
      expect(sent?.[1]).toMatchObject({ method: "POST", redirect: "error" });
      const headers = new Headers(sent?.[1]?.headers);
      expect(headers.get("authorization")).toBe("Bearer sk-or-secret");
      expect(headers.get("content-type")).toBe("application/json");

      const body = JSON.parse(String(sent?.[1]?.body));
      // No `provider`, `trace`, `session_id`, or `user`.
      expect(Object.keys(body).sort()).toEqual(["model", "questions", "state"]);
      expect(body.model).toBe(model);
      expect(body.state.model).toBe(ASTRA.id);
      expect(body.state.recent_user_text).toContain("fix the flaky test");
      expect(Object.keys(body.questions)).toEqual(["effort"]);
      expect(body.questions.effort).toMatchObject({
        type: "choice",
        instructions: expect.any(String),
      });
      expect(Object.keys(body.questions.effort.criteria)).toEqual(
        ASTRA.supportedEfforts,
      );
    },
  );

  it.each(ASTRA.supportedEfforts)("accepts the choice %s", async (effort) => {
    expect(await decide(() => answer(effort))).toMatchObject({
      effort,
      fallback: null,
    });
  });

  it.each([
    ["a choice the target model lacks", answer("none")],
    ["an unoffered choice", answer("extreme")],
    ["a non-string choice", answer(2)],
    ["a null choice", answer(null)],
  ])("treats %s as invalid output", async (_case, response) => {
    expect(await decide(() => response)).toMatchObject({
      effort: "medium",
      fallback: "classifier_invalid_output",
    });
  });

  it.each([
    ["non-JSON", () => new Response("not json")],
    ["an empty", () => new Response("")],
    ["a no-answers", () => json({ model: "typesafe/jev-1.13-20260917" })],
    ["a missing-effort", () => json({ answers: { team: { choice: "low" } } })],
    ["a string-answer", () => json({ answers: { effort: "low" } })],
    [
      "a noul-answer",
      () => json({ answers: { effort: { type: "noul", noul: 0.9 } } }),
    ],
    [
      "an error-shaped",
      () => json({ error: { code: 400, message: "Invalid model" } }),
    ],
  ])("treats %s body as invalid output", async (_case, response) => {
    expect(await decide(response)).toMatchObject({
      effort: "medium",
      fallback: "classifier_invalid_output",
    });
  });

  it("maps HTTP, auth, credit, and rate-limit errors to categories without the body or key", async () => {
    for (const [status, category] of [
      [400, "http_4xx"],
      [401, "http_auth"],
      [402, "http_4xx"],
      [403, "http_auth"],
      [404, "http_4xx"],
      [429, "http_rate_limit"],
      [500, "http_5xx"],
      [502, "http_5xx"],
      [503, "http_5xx"],
    ] as const) {
      expect(
        await decide(() =>
          json(
            { error: { code: status, message: "bad key sk-or-secret" } },
            { status },
          ),
        ),
      ).toMatchObject({
        effort: "medium",
        fallback: "classifier_error",
        classifierErrorCategory: category,
      });
    }

    const { classifier, error } = await failure(() =>
      json(
        { error: { code: 429, message: "bad key sk-or-secret" } },
        { status: 429, headers: { "retry-after": "2" } },
      ),
    );
    expect(classifier.errorCategory(error)).toBe("http_rate_limit");
    expect(classifier.retryAfterMs?.(error)).toBe(2000);
    expect(String(error)).not.toContain("sk-or-secret");
  });

  it.each([
    [401, "http_auth"],
    [402, "http_4xx"],
  ])("does not retry a %i", async (status, category) => {
    let calls = 0;
    const result = await select(
      async () => {
        calls++;
        return json({}, { status });
      },
      { maxRetries: 1 },
    )(args());
    expect(calls).toBe(1);
    expect(result).toMatchObject({ classifierErrorCategory: category });
  });

  it.each([429, 503])("retries a %i once", async (status) => {
    let calls = 0;
    const result = await select(
      async () => {
        calls++;
        return calls === 1 ? json({}, { status }) : answer("high");
      },
      { maxRetries: 1 },
    )(args());
    expect(calls).toBe(2);
    expect(result).toMatchObject({ effort: "high", fallback: null });
  });

  it("maps fetch failures to connection errors", async () => {
    expect(
      await decide(() => {
        throw new TypeError("fetch failed");
      }),
    ).toMatchObject({
      fallback: "classifier_error",
      classifierErrorCategory: "connection",
    });
  });

  it("falls back at the total deadline and aborts the request", async () => {
    let aborted = false;
    const hang: FakeFetch = (_url, init) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("aborted", "AbortError"));
        }),
      );

    expect(await select(hang, { timeoutMs: 20 })(args())).toMatchObject({
      effort: "medium",
      fallback: "classifier_timeout",
    });
    expect(aborted).toBe(true);
  });

  it("propagates client cancellation without falling back", async () => {
    const controller = new AbortController();
    const pending = select(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
          controller.abort();
        }),
    )(args(controller.signal));
    await expect(pending).rejects.toBeInstanceOf(ClassificationCancelledError);
  });

  it("is selected through the bundled providers and REASONING_ROUTER_CLASSIFIER* variables", () => {
    expect(() =>
      createConfiguredSelector(
        { provider: "openrouter", ...CONFIG },
        classifierProviders,
        {},
      ),
    ).not.toThrow();
    expect(() =>
      createConfiguredSelector(
        loadClassifierConfig({
          REASONING_ROUTER_CLASSIFIER: "openrouter",
          REASONING_ROUTER_CLASSIFIER_API_KEY: "sk-or-secret",
          REASONING_ROUTER_CLASSIFIER_MODEL: "cloudflare/clef",
        }),
        classifierProviders,
        {},
      ),
    ).not.toThrow();
    expect(() =>
      createConfiguredSelector(
        { provider: "openrouter", model: CONFIG.model },
        classifierProviders,
        {},
      ),
    ).toThrow(/apiKey is required for OpenRouter/);
  });
});

describe("OpenRouter connection", () => {
  it("trims the key and model", () => {
    expect(
      resolveOpenRouterConnection({
        apiKey: " sk-or-secret ",
        model: " ~typesafe/jev-latest ",
      }),
    ).toEqual({
      apiKey: "sk-or-secret",
      model: "~typesafe/jev-latest",
    } satisfies OpenRouterConnection);
  });

  it.each([
    [{ apiKey: undefined }, /apiKey is required/],
    [{ apiKey: " " }, /apiKey is required/],
    [{ model: undefined }, /model is required/],
    [{ model: " " }, /model is required/],
    [{ model: 1 }, /model is required/],
  ])("rejects %o", (config, message) => {
    expect(() => resolveOpenRouterConnection({ ...CONFIG, ...config })).toThrow(
      message,
    );
  });

  it("does not echo the key in errors", () => {
    expect(() =>
      resolveOpenRouterConnection({ apiKey: "sk-or-secret" }),
    ).not.toThrow(/sk-or-secret/);
  });
});
