import {
  ClassificationCancelledError,
  createClassifierSelector,
  createConfiguredSelector,
  findModel,
} from "@reasoning-router/core";
import { describe, expect, it } from "vitest";
import {
  classifierProviders,
  createMicrosoftDecisionTransport,
  loadClassifierConfig,
  type MicrosoftDecisionConnection,
  resolveMicrosoftDecisionConnection,
} from "../src/index.js";

type FakeFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** A target model without `none`, so an off-menu `none` is detectable. */
const ASTRA = findModel("gpt-6-astra")!;
const ENDPOINT = "https://contoso.services.ai.azure.com";
const CONFIG = {
  baseUrl: ENDPOINT,
  apiKey: "az-secret",
  model: "my-decision-deployment",
};
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

/** The documented response: answers keyed by question name, the underlying model, and usage. */
const answer = (choice: unknown) =>
  json({
    model: "microsoft-decision-1",
    answers: {
      effort: {
        type: "choice",
        choice,
        probabilities: { low: 0.7, medium: 0.2, high: 0.1 },
      },
    },
    usage: { input_tokens: 120, output_tokens: 0 },
  });

function select(
  fetch: FakeFetch,
  options: { timeoutMs?: number; maxRetries?: number } = {},
) {
  return createClassifierSelector({
    classifier: createMicrosoftDecisionTransport({
      ...resolveMicrosoftDecisionConnection(CONFIG),
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
  const classifier = createMicrosoftDecisionTransport({
    ...resolveMicrosoftDecisionConnection(CONFIG),
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

describe("Microsoft-Decision-1 classifier", () => {
  it("posts the System One request to the Foundry endpoint with an api-key header", async () => {
    let sent: [string, RequestInit | undefined] | undefined;
    const result = await select(async (url, init) => {
      sent = [url, init];
      return answer("low");
    })(args());

    expect(result).toMatchObject({
      effort: "low",
      classifier: "microsoft-decision",
      fallback: null,
    });
    expect(sent?.[0]).toBe(`${ENDPOINT}/providers/microsoft/v1/systemone`);
    expect(sent?.[1]).toMatchObject({ method: "POST", redirect: "error" });
    const headers = new Headers(sent?.[1]?.headers);
    expect(headers.get("api-key")).toBe("az-secret");
    expect(headers.has("authorization")).toBe(false);
    expect(headers.get("content-type")).toBe("application/json");

    const body = JSON.parse(String(sent?.[1]?.body));
    expect(Object.keys(body).sort()).toEqual(["model", "questions", "state"]);
    // The deployment name, independent of the target model in the state.
    expect(body.model).toBe("my-decision-deployment");
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
    expect(body.questions.effort.criteria).not.toHaveProperty("none");
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
    ["a no-answers", () => json({ model: "microsoft-decision-1" })],
    ["a missing-effort", () => json({ answers: { team: { choice: "low" } } })],
    ["an array-answers", () => json({ answers: [{ choice: "low" }] })],
    ["a string-answer", () => json({ answers: { effort: "low" } })],
    ["an error-envelope", () => json({ error: { code: "BadRequest" } })],
  ])("treats %s body as invalid output", async (_case, response) => {
    expect(await decide(response)).toMatchObject({
      effort: "medium",
      fallback: "classifier_invalid_output",
    });
  });

  it("maps documented HTTP and auth errors to categories without the body or key", async () => {
    for (const [status, category] of [
      [400, "http_4xx"],
      [401, "http_auth"],
      [403, "http_auth"],
      [404, "http_4xx"],
      [422, "http_4xx"],
      [429, "http_rate_limit"],
      [500, "http_5xx"],
      [503, "http_5xx"],
    ] as const) {
      expect(
        await decide(() =>
          json(
            { error: { code: "Unauthorized", message: "bad key az-secret" } },
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
        { error: { message: "bad key az-secret" } },
        { status: 429, headers: { "retry-after": "2" } },
      ),
    );
    expect(classifier.errorCategory(error)).toBe("http_rate_limit");
    expect(classifier.retryAfterMs?.(error)).toBe(2000);
    expect(String(error)).not.toContain("az-secret");
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
        { provider: "microsoft-decision", ...CONFIG },
        classifierProviders,
        {},
      ),
    ).not.toThrow();
    expect(() =>
      createConfiguredSelector(
        loadClassifierConfig({
          REASONING_ROUTER_CLASSIFIER: "microsoft-decision",
          REASONING_ROUTER_CLASSIFIER_BASE_URL: ENDPOINT,
          REASONING_ROUTER_CLASSIFIER_API_KEY: "az-secret",
          REASONING_ROUTER_CLASSIFIER_MODEL: "my-decision-deployment",
        }),
        classifierProviders,
        {},
      ),
    ).not.toThrow();
    expect(() =>
      createConfiguredSelector(
        { provider: "microsoft-decision" },
        classifierProviders,
        {},
      ),
    ).toThrow(/apiKey is required for Microsoft-Decision-1/);
  });
});

describe("Microsoft-Decision-1 connection", () => {
  it("trims settings and the endpoint's trailing slash", () => {
    expect(
      resolveMicrosoftDecisionConnection({
        baseUrl: ` ${ENDPOINT}/ `,
        apiKey: " az-secret ",
        model: " my-decision-deployment ",
      }),
    ).toEqual({
      baseURL: ENDPOINT,
      apiKey: "az-secret",
      model: "my-decision-deployment",
    } satisfies MicrosoftDecisionConnection);
  });

  it.each([
    "https://contoso.services.ai.azure.com",
    "https://contoso.cognitiveservices.azure.com/",
    "https://gateway.example.com/foundry",
  ])("accepts %s", (baseUrl) => {
    expect(
      resolveMicrosoftDecisionConnection({ ...CONFIG, baseUrl }).baseURL,
    ).toBe(baseUrl.replace(/\/$/, ""));
  });

  it.each([
    [{ ...CONFIG, apiKey: undefined }, /apiKey is required/],
    [{ ...CONFIG, apiKey: " " }, /apiKey is required/],
    [{ ...CONFIG, model: undefined }, /model must be your .* deployment name/],
    [{ ...CONFIG, model: "" }, /model must be your .* deployment name/],
    [{ ...CONFIG, baseUrl: undefined }, /baseUrl must be your .* endpoint/],
    [{ ...CONFIG, baseUrl: " " }, /baseUrl must be your .* endpoint/],
    [{ ...CONFIG, baseUrl: "not a url" }, /baseUrl must be a valid URL/],
    [
      { ...CONFIG, baseUrl: "http://contoso.services.ai.azure.com" },
      /must be an HTTPS URL/,
    ],
    [{ ...CONFIG, baseUrl: "http://localhost:8000" }, /must be an HTTPS URL/],
    [
      { ...CONFIG, baseUrl: "https://u:p@contoso.services.ai.azure.com" },
      /without credentials/,
    ],
    [
      { ...CONFIG, baseUrl: `${ENDPOINT}?api-version=2024-10-21` },
      /without credentials, query/,
    ],
    [{ ...CONFIG, baseUrl: `${ENDPOINT}#x` }, /query, or fragment/],
  ])("rejects %o", (config, message) => {
    expect(() => resolveMicrosoftDecisionConnection(config)).toThrow(message);
  });

  it("reports every problem at once without echoing the key", () => {
    let message = "";
    try {
      resolveMicrosoftDecisionConnection({ apiKey: "az-secret" });
    } catch (error) {
      message = String(error);
    }
    expect(message).toMatch(/baseUrl/);
    expect(message).toMatch(/model/);
    expect(message).not.toContain("az-secret");
  });
});
