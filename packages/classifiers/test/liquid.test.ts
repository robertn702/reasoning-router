import {
  ClassificationCancelledError,
  createClassifierSelector,
  createConfiguredSelector,
  findModel,
} from "@reasoning-router/core";
import { describe, expect, it } from "vitest";
import {
  classifierProviders,
  createLiquidTransport,
  type LiquidConnection,
  loadClassifierConfig,
  resolveLiquidConnection,
} from "../src/index.js";

type FakeFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** A target model without `none`, so an off-menu `none` is detectable. */
const ASTRA = findModel("gpt-6-astra")!;
const LIQUID = "https://api.liquid.ai";
const VERCEL = "https://ai-gateway.vercel.sh/typesafe";
const CONFIG = { apiKey: "liquid_secret" };
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

/** The documented choice answer: keyed by question name, with probabilities, confidence, and usage. */
const answer = (choice: unknown) =>
  json({
    model: "d1",
    answers: {
      effort: {
        type: "choice",
        choice,
        probabilities: { low: 0.7, medium: 0.2, high: 0.1 },
        confidence: 0.6,
      },
    },
    usage: { input_tokens: 120, output_tokens: 0 },
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
    classifier: createLiquidTransport({
      ...resolveLiquidConnection(options.config ?? CONFIG),
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
  const classifier = createLiquidTransport({
    ...resolveLiquidConnection(CONFIG),
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

describe("Liquid d1 classifier", () => {
  it.each([
    [{}, `${LIQUID}/decisions/v1/systemone`, "d1"],
    [{ model: "d1:free" }, `${LIQUID}/decisions/v1/systemone`, "d1:free"],
    [{ baseUrl: VERCEL }, `${VERCEL}/v1/systemone`, "liquid/d1"],
  ])("posts the System One request for %o", async (config, url, model) => {
    let sent: [string, RequestInit | undefined] | undefined;
    const result = await select(
      async (input, init) => {
        sent = [input, init];
        return answer("low");
      },
      { config: { ...CONFIG, ...config } },
    )(args());

    expect(result).toMatchObject({
      effort: "low",
      classifier: "liquid",
      fallback: null,
    });
    expect(sent?.[0]).toBe(url);
    expect(sent?.[1]).toMatchObject({ method: "POST", redirect: "error" });
    const headers = new Headers(sent?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer liquid_secret");
    expect(headers.get("content-type")).toBe("application/json");

    const body = JSON.parse(String(sent?.[1]?.body));
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
  });

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
    ["a no-answers", () => json({ model: "d1" })],
    ["a missing-effort", () => json({ answers: { team: { choice: "low" } } })],
    ["a string-answer", () => json({ answers: { effort: "low" } })],
    [
      "an error-shaped",
      () => json({ message: "bad request", error_type: "invalid_request" }),
    ],
  ])("treats %s body as invalid output", async (_case, response) => {
    expect(await decide(response)).toMatchObject({
      effort: "medium",
      fallback: "classifier_invalid_output",
    });
  });

  it("maps HTTP and auth errors to categories without the body or key", async () => {
    for (const [status, category] of [
      [400, "http_4xx"],
      [401, "http_auth"],
      [403, "http_auth"],
      [404, "http_4xx"],
      [429, "http_rate_limit"],
      [500, "http_5xx"],
      [503, "http_5xx"],
    ] as const) {
      expect(
        await decide(() =>
          json(
            { message: "bad key liquid_secret", error_type: "unauthorized" },
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
        { message: "bad key liquid_secret" },
        { status: 429, headers: { "retry-after": "2" } },
      ),
    );
    expect(classifier.errorCategory(error)).toBe("http_rate_limit");
    expect(classifier.retryAfterMs?.(error)).toBe(2000);
    expect(String(error)).not.toContain("liquid_secret");
  });

  it("does not retry an auth error", async () => {
    let calls = 0;
    const result = await select(
      async () => {
        calls++;
        return json({}, { status: 401 });
      },
      { maxRetries: 1 },
    )(args());
    expect(calls).toBe(1);
    expect(result).toMatchObject({ classifierErrorCategory: "http_auth" });
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
        { provider: "liquid", ...CONFIG },
        classifierProviders,
        {},
      ),
    ).not.toThrow();
    expect(() =>
      createConfiguredSelector(
        loadClassifierConfig({
          REASONING_ROUTER_CLASSIFIER: "liquid",
          REASONING_ROUTER_CLASSIFIER_BASE_URL: VERCEL,
          REASONING_ROUTER_CLASSIFIER_API_KEY: "vck_secret",
          REASONING_ROUTER_CLASSIFIER_MODEL: "liquid/d1",
        }),
        classifierProviders,
        {},
      ),
    ).not.toThrow();
    expect(() =>
      createConfiguredSelector({ provider: "liquid" }, classifierProviders, {}),
    ).toThrow(/apiKey is required for Liquid d1/);
  });
});

describe("Liquid d1 connection", () => {
  it("defaults to Liquid's API and d1, and trims settings", () => {
    expect(resolveLiquidConnection({ apiKey: " liquid_secret " })).toEqual({
      apiKey: "liquid_secret",
      url: `${LIQUID}/decisions/v1/systemone`,
      model: "d1",
    } satisfies LiquidConnection);
    expect(
      resolveLiquidConnection({
        ...CONFIG,
        baseUrl: `${VERCEL}/`,
        model: " ",
      }),
    ).toEqual({
      apiKey: "liquid_secret",
      url: `${VERCEL}/v1/systemone`,
      model: "liquid/d1",
    });
  });

  it.each([
    [{ apiKey: undefined }, /apiKey is required/],
    [{ apiKey: " " }, /apiKey is required/],
    [{ baseUrl: "not a url" }, /baseUrl must be a valid HTTPS URL/],
    [{ baseUrl: "http://api.liquid.ai" }, /must be an HTTPS URL/],
    [{ baseUrl: "https://u:p@api.liquid.ai" }, /without credentials/],
    [{ baseUrl: `${LIQUID}?x=1` }, /without credentials, query/],
    [{ baseUrl: `${LIQUID}#x` }, /query, or fragment/],
    [{ baseUrl: "https://api.typesafe.ai" }, /supports only the Liquid direct/],
    [{ baseUrl: `${LIQUID}/decisions` }, /supports only the Liquid direct/],
    [{ model: "liquid/d1" }, /model must be one of d1, d1:free/],
    [{ baseUrl: VERCEL, model: "d1" }, /model must be one of liquid\/d1/],
    [{ baseUrl: VERCEL, model: "typesafe-ai/jev" }, /model must be one of/],
  ])("rejects %o", (config, message) => {
    expect(() => resolveLiquidConnection({ ...CONFIG, ...config })).toThrow(
      message,
    );
  });

  it("does not echo the key in errors", () => {
    expect(() =>
      resolveLiquidConnection({ apiKey: "liquid_secret", baseUrl: "x" }),
    ).not.toThrow(/liquid_secret/);
  });
});
