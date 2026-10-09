import {
  ClassificationCancelledError,
  createClassifierSelector,
  createConfiguredSelector,
  findModel,
} from "@reasoning-router/core";
import { describe, expect, it } from "vitest";
import {
  classifierProviders,
  createOpenAIDecisionsTransport,
  type OpenAIDecisionsConnection,
  resolveOpenAIDecisionsConnection,
} from "../src/index.js";

type FakeFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** A target model without `none`, so the offered choices differ from Luna's. */
const ASTRA = findModel("gpt-6-astra")!;
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

/** A documented `Decision` with the effort choice among other answers. */
const decision = (answers: unknown[]) =>
  json({
    model: "gpt-6-luna",
    answers,
    usage: {
      input_tokens: 120,
      input_tokens_details: { cache_write_tokens: 0, cached_tokens: 0 },
      output_tokens: 0,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 120,
    },
  });

const choice = (value: unknown, name: unknown = "effort") => ({
  type: "choice",
  name,
  choice: value,
  probabilities: [{ value, probability: 0.9 }],
  confidence: 0.8,
});

function select(
  fetch: FakeFetch,
  options: { timeoutMs?: number; maxRetries?: number } = {},
) {
  return createClassifierSelector({
    classifier: createOpenAIDecisionsTransport({
      ...resolveOpenAIDecisionsConnection({ apiKey: "sk-test" }),
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

async function decide(response: () => Response) {
  return select(async () => response())(args());
}

describe("OpenAI Decisions classifier", () => {
  it("posts one named effort choice over the target model's efforts", async () => {
    let sent: [string, RequestInit | undefined] | undefined;
    const result = await select(async (url, init) => {
      sent = [url, init];
      return decision([choice("low")]);
    })(args());

    expect(result).toMatchObject({
      effort: "low",
      classifier: "openai-decisions",
      fallback: null,
    });
    expect(sent?.[0]).toBe("https://api.openai.com/v1/decisions");
    expect(sent?.[1]).toMatchObject({ method: "POST", redirect: "error" });
    const headers = new Headers(sent?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer sk-test");
    expect(headers.get("content-type")).toBe("application/json");

    const body = JSON.parse(String(sent?.[1]?.body));
    expect(Object.keys(body).sort()).toEqual(["input", "model", "questions"]);
    // The classifier model, independent of the target model in the state.
    expect(body.model).toBe("gpt-6-luna");
    expect(typeof body.input).toBe("string");
    const sentState = JSON.parse(body.input);
    expect(sentState.model).toBe(ASTRA.id);
    expect(sentState.recent_user_text).toContain("fix the flaky test");
    expect(body.questions).toHaveLength(1);
    expect(body.questions[0]).toMatchObject({
      type: "choice",
      name: "effort",
      instructions: expect.any(String),
    });
    expect(body.questions[0].choices).toEqual(
      ASTRA.supportedEfforts.map((value) => ({
        value,
        description: expect.any(String),
      })),
    );
    expect(
      body.questions[0].choices.map((c: { value: string }) => c.value),
    ).not.toContain("none");
  });

  it("matches the answer by name, not position", async () => {
    const result = await decide(() =>
      decision([
        { type: "predicate", name: "other", probability: 0.4 },
        choice("medium", "unrelated"),
        choice("xhigh"),
      ]),
    );
    expect(result).toMatchObject({ effort: "xhigh", fallback: null });
  });

  it.each([
    ["a refusal", [{ type: "refusal", name: "effort" }]],
    ["a refusal with no name", [{ type: "refusal", name: null }]],
    ["a missing answer", [choice("low", "other")]],
    ["an empty answers array", []],
    ["a duplicate answer", [choice("low"), choice("low")]],
    ["a wrong answer type", [{ type: "score", name: "effort", score: 1.2 }]],
    ["a choice the target model lacks", [choice("none")]],
    ["an unoffered choice", [choice("extreme")]],
    ["a boolean choice", [choice(true)]],
    ["a choice with no value", [{ type: "choice", name: "effort" }]],
  ])("treats %s as invalid output", async (_case, answers) => {
    expect(await decide(() => decision(answers))).toMatchObject({
      effort: "medium",
      fallback: "classifier_invalid_output",
    });
  });

  it.each([
    ["non-JSON", () => new Response("not json")],
    ["no answers", () => json({ model: "gpt-6-luna" })],
    ["System One answers", () => json({ answers: { effort: choice("low") } })],
    ["a non-object answer", () => json({ answers: ["low"] })],
  ])("treats a %s body as invalid output", async (_case, response) => {
    expect(await decide(response)).toMatchObject({
      effort: "medium",
      fallback: "classifier_invalid_output",
    });
  });

  it("maps HTTP and auth errors to categories without the response body", async () => {
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
          json({ error: { message: "Incorrect API key sk-test" } }, { status }),
        ),
      ).toMatchObject({
        effort: "medium",
        fallback: "classifier_error",
        classifierErrorCategory: category,
      });
    }

    const classifier = createOpenAIDecisionsTransport({
      ...resolveOpenAIDecisionsConnection({ apiKey: "sk-test" }),
      fetch: async () =>
        json(
          { error: { message: "Incorrect API key sk-test" } },
          { status: 429, headers: { "retry-after": "2" } },
        ),
    });
    const error = await classifier
      .classify({
        state: state,
        model: ASTRA,
        signal: new AbortController().signal,
      })
      .then(
        () => undefined,
        (failure: unknown) => failure,
      );
    expect(classifier.errorCategory(error)).toBe("http_rate_limit");
    expect(classifier.retryAfterMs?.(error)).toBe(2000);
    expect(String(error)).not.toContain("sk-test");
  });

  it("retries a transient failure and honors Retry-After", async () => {
    const calls: number[] = [];
    const result = await select(
      async () => {
        calls.push(Date.now());
        return calls.length === 1
          ? json({}, { status: 503, headers: { "retry-after": "0.05" } })
          : decision([choice("high")]);
      },
      { maxRetries: 1 },
    )(args());

    expect(result).toMatchObject({
      effort: "high",
      fallback: null,
      classifierAttempts: 2,
    });
    expect(calls[1]! - calls[0]!).toBeGreaterThanOrEqual(45);
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

  it("is selected through the bundled providers", () => {
    expect(() =>
      createConfiguredSelector(
        { provider: "openai-decisions", apiKey: "sk-test" },
        classifierProviders,
        {},
      ),
    ).not.toThrow();
    expect(() =>
      createConfiguredSelector(
        { provider: "openai-decisions" },
        classifierProviders,
        {},
      ),
    ).toThrow(/apiKey is required for OpenAI Decisions/);
  });
});

describe("OpenAI Decisions connection", () => {
  it("defaults to the global endpoint and gpt-6-luna", () => {
    expect(resolveOpenAIDecisionsConnection({ apiKey: " sk " })).toEqual({
      apiKey: "sk",
      baseURL: "https://api.openai.com/v1",
      model: "gpt-6-luna",
    } satisfies OpenAIDecisionsConnection);
  });

  it.each([
    "https://api.openai.com/v1/",
    "https://us.api.openai.com/v1",
    "https://eu.api.openai.com/v1",
  ])("accepts %s", async (baseUrl) => {
    const connection = resolveOpenAIDecisionsConnection({
      apiKey: "sk",
      baseUrl,
    });
    expect(connection.baseURL).toBe(baseUrl.replace(/\/$/, ""));
    let url: string | undefined;
    await createOpenAIDecisionsTransport({
      ...connection,
      fetch: async (sent) => {
        url = sent;
        return decision([choice("low")]);
      },
    }).classify({
      state: state,
      model: ASTRA,
      signal: new AbortController().signal,
    });
    expect(url).toBe(`${baseUrl.replace(/\/$/, "")}/decisions`);
  });

  it.each([
    [{ apiKey: " " }, /apiKey is required/],
    [{}, /apiKey is required/],
    [
      { apiKey: "sk", baseUrl: "https://api.typesafe.ai" },
      /baseUrl must be one of https:\/\/api.openai.com\/v1/,
    ],
    [{ apiKey: "sk", baseUrl: "http://api.openai.com/v1" }, /baseUrl/],
    [{ apiKey: "sk", baseUrl: "https://api.openai.com" }, /baseUrl/],
    [{ apiKey: "sk", baseUrl: "" }, /baseUrl/],
    [
      { apiKey: "sk", baseUrl: "https://api.openai.com.evil.com/v1" },
      /baseUrl/,
    ],
    [
      { apiKey: "sk", baseUrl: "https://api.openai.com@evil.com/v1" },
      /baseUrl/,
    ],
    [{ apiKey: "sk", baseUrl: "https://api.openai.com/v1?x=1" }, /baseUrl/],
    [{ apiKey: "sk", baseUrl: "https://API.OPENAI.COM/v1" }, /baseUrl/],
    [{ apiKey: "sk", baseUrl: "https://api.openai.com//v1" }, /baseUrl/],
    [{ apiKey: "sk", model: "clef-flash" }, /model must be gpt-6-luna/],
    [{ apiKey: "sk", model: "gpt-6-astra" }, /model must be gpt-6-luna/],
  ])("rejects %o", (config, message) => {
    expect(() => resolveOpenAIDecisionsConnection(config)).toThrow(message);
  });

  it("does not echo the key in validation errors", () => {
    let message = "";
    try {
      resolveOpenAIDecisionsConnection({ apiKey: "sk-secret", model: "x" });
    } catch (error) {
      message = String(error);
    }
    expect(message).toMatch(/model must be gpt-6-luna/);
    expect(message).not.toContain("sk-secret");
  });
});
