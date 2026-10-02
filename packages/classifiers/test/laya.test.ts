import {
  createClassifierSelector,
  createConfiguredSelector,
  MODELS,
} from "@reasoning-router/core";
import { describe, expect, it } from "vitest";
import {
  classifierProviders,
  createLayaTransport,
  type LayaConnection,
  resolveLayaConnection,
} from "../src/index.js";

const state = {
  model: MODELS[0]!.id,
  recent_user_text: "",
  assistant_progress: "",
  tool_results: [],
  failure_state: { failed_count: 0, last_failure_excerpt: "" },
};

/** The full (non-strict) `laya-serve` response shape, with fields our parser ignores. */
const answer = (choice: string) =>
  new Response(
    JSON.stringify({
      model: "laya-english",
      answers: {
        effort: {
          type: "choice",
          choice,
          confidence: 0.4,
          probabilities: { low: 0.4, medium: 0.3, high: 0.3 },
          answer_confidence: { abstain: false },
          action: "proceed",
        },
      },
      usage: { input_tokens: 120, output_tokens: 1, truncated: false },
      routing: { checkpoint: "english", reason: "language" },
    }),
    { headers: { "content-type": "application/json" } },
  );

type FakeFetch = (url: string, init?: RequestInit) => Promise<Response>;

function laya(fetch: FakeFetch, config: Record<string, unknown> = {}) {
  return createClassifierSelector({
    classifier: createLayaTransport({
      ...resolveLayaConnection(config),
      fetch,
    }),
    timeoutMs: 1000,
    maxRetries: 0,
    fallbackEffort: "medium",
  });
}

const args = () => ({
  model: MODELS[0]!,
  body: { model: MODELS[0]!.id, input: [{ role: "user", content: "hi" }] },
  signal: new AbortController().signal,
});

async function request(config: Record<string, unknown> = {}) {
  let sent: [string, RequestInit | undefined] | undefined;
  const decision = await laya(async (url, init) => {
    sent = [url, init];
    return answer("low");
  }, config)(args());
  return {
    decision,
    url: sent?.[0],
    headers: new Headers(sent?.[1]?.headers),
    body: JSON.parse(String(sent?.[1]?.body)),
  };
}

describe("Laya classifier", () => {
  it("posts the System One request to the local default server", async () => {
    const { decision, url, headers, body } = await request();

    expect(decision).toMatchObject({
      effort: "low",
      classifier: "laya",
      fallback: null,
    });
    expect(url).toBe("http://127.0.0.1:8000/v1/systemone");
    expect(headers.has("authorization")).toBe(false);
    expect(body).not.toHaveProperty("model");
    expect(body).not.toHaveProperty("max_len");
    expect(body.state.model).toBe(MODELS[0]!.id);
    expect(body.questions.effort).toMatchObject({ type: "choice" });
    expect(Object.keys(body.questions.effort.criteria)).toEqual(
      MODELS[0]!.supportedEfforts,
    );
  });

  it("sends the key and checkpoint only when they are set", async () => {
    const { url, headers, body } = await request({
      baseUrl: "https://laya.example.com/prefix/",
      apiKey: " secret ",
      model: "multilingual",
    });

    expect(url).toBe("https://laya.example.com/prefix/v1/systemone");
    expect(headers.get("authorization")).toBe("Bearer secret");
    expect(body.model).toBe("multilingual");
  });

  it("treats a non-System One body as invalid output", async () => {
    for (const response of [
      () => new Response(JSON.stringify({ result: {}, success: true })),
      () => new Response("not json"),
    ]) {
      const decision = await laya(async () => response())(args());
      expect(decision).toMatchObject({
        effort: "medium",
        fallback: "classifier_invalid_output",
      });
    }
  });

  it("maps laya-serve statuses and connection failures to error categories", async () => {
    for (const [status, category] of [
      [401, "http_auth"],
      [400, "http_4xx"],
      [413, "http_4xx"],
      [422, "http_4xx"],
      [500, "http_5xx"],
      [503, "http_5xx"],
    ] as const) {
      const decision = await laya(
        async () => new Response("detail", { status }),
      )(args());
      expect(decision).toMatchObject({
        fallback: "classifier_error",
        classifierErrorCategory: category,
      });
    }

    const classifier = createLayaTransport({
      ...resolveLayaConnection({}),
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const error = await classifier
      .classify({
        state,
        model: MODELS[0]!,
        signal: new AbortController().signal,
      })
      .then(
        () => undefined,
        (failure: unknown) => failure,
      );
    expect(classifier.errorCategory(error)).toBe("connection");
  });

  it("reads Retry-After from a busy server", async () => {
    const classifier = createLayaTransport({
      ...resolveLayaConnection({}),
      fetch: async () =>
        new Response("", { status: 503, headers: { "retry-after": "1" } }),
    });
    const error = await classifier
      .classify({
        state,
        model: MODELS[0]!,
        signal: new AbortController().signal,
      })
      .then(
        () => undefined,
        (failure: unknown) => failure,
      );
    expect(classifier.errorCategory(error)).toBe("http_5xx");
    expect(classifier.retryAfterMs?.(error)).toBe(1000);
  });

  it("is selected through the bundled providers with no settings", () => {
    expect(classifierProviders.map((provider) => provider.name)).toContain(
      "laya",
    );
    expect(() =>
      createConfiguredSelector({ provider: "laya" }, classifierProviders, {}),
    ).not.toThrow();
  });
});

describe("Laya connection", () => {
  it("defaults to laya-serve's local address and leaves blank settings unset", () => {
    expect(resolveLayaConnection({ apiKey: " ", model: "" })).toEqual({
      baseURL: "http://127.0.0.1:8000",
      apiKey: undefined,
      model: undefined,
    } satisfies LayaConnection);
  });

  it.each([
    "https://laya.example.com",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://127.1.2.3",
    "http://[::1]:8000",
  ])("accepts %s", (baseUrl) => {
    expect(resolveLayaConnection({ baseUrl }).baseURL).toBe(
      baseUrl.replace(/\/$/, ""),
    );
  });

  it.each([
    ["http://laya.example.com", /HTTP URL to a loopback host/],
    ["http://192.168.1.5:8000", /HTTP URL to a loopback host/],
    ["http://localhost.example.com", /HTTP URL to a loopback host/],
    ["https://user:pass@laya.example.com", /without credentials/],
    ["https://laya.example.com?x=1", /without credentials, query/],
    ["https://laya.example.com#x", /without credentials, query, or fragment/],
    ["ftp://localhost", /HTTPS URL/],
    ["not a url", /must be a valid URL/],
  ])("rejects baseUrl %s", (baseUrl, message) => {
    expect(() => resolveLayaConnection({ baseUrl })).toThrow(message);
  });
});
