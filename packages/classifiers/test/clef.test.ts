import {
  createClassifierSelector,
  createConfiguredSelector,
  MODELS,
} from "@reasoning-router/core";
import { describe, expect, it } from "vitest";
import {
  classifierProviders,
  createClefTransport,
  resolveClefConnection,
} from "../src/index.js";

const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
const state = {
  model: MODELS[0]!.id,
  recent_user_text: "",
  assistant_progress: "",
  tool_results: [],
  failure_state: { failed_count: 0, last_failure_excerpt: "" },
};

const envelope = (result: unknown, success = true) =>
  new Response(JSON.stringify({ result, success, errors: [], messages: [] }), {
    headers: { "content-type": "application/json" },
  });

const answer = (choice: string) => ({
  model: "clef",
  answers: {
    effort: { type: "choice", choice, confidence: 1, probabilities: {} },
  },
  usage: { input_tokens: 1, output_tokens: 1 },
});

function clef(fetch: (url: string, init?: RequestInit) => Promise<Response>) {
  return createClassifierSelector({
    classifier: createClefTransport({
      accountId: ACCOUNT_ID,
      apiKey: "cf-token",
      model: "clef-flash",
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

describe("Clef classifier", () => {
  it("posts the System One request to Workers AI and unwraps the result", async () => {
    let sent: [string, RequestInit | undefined] | undefined;
    const select = clef(async (url, init) => {
      sent = [url, init];
      return envelope(answer("low"));
    });

    expect(await select(args())).toMatchObject({
      effort: "low",
      classifier: "clef",
      fallback: null,
    });
    expect(sent?.[0]).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/@cf/cloudflare/clef-flash`,
    );
    expect(new Headers(sent?.[1]?.headers).get("authorization")).toBe(
      "Bearer cf-token",
    );
    const body = JSON.parse(String(sent?.[1]?.body));
    expect(body.model).toBe("clef-flash");
    expect(body.state.model).toBe(MODELS[0]!.id);
    expect(body.questions.effort).toMatchObject({ type: "choice" });
    expect(Object.keys(body.questions.effort.criteria)).toEqual(
      MODELS[0]!.supportedEfforts,
    );
  });

  it("treats an unsuccessful or unwrapped body as invalid output", async () => {
    for (const response of [
      () => envelope(answer("low"), false),
      () => new Response(JSON.stringify(answer("low"))),
      () => new Response("not json"),
    ]) {
      const decision = await clef(async () => response())(args());
      expect(decision).toMatchObject({
        effort: "medium",
        fallback: "classifier_invalid_output",
      });
    }
  });

  it("maps HTTP statuses to error categories", async () => {
    for (const [status, category] of [
      [401, "http_auth"],
      [403, "http_auth"],
      [429, "http_rate_limit"],
      [400, "http_4xx"],
      [503, "http_5xx"],
    ] as const) {
      const decision = await clef(
        async () => new Response("detail", { status }),
      )(args());
      expect(decision).toMatchObject({
        fallback: "classifier_error",
        classifierErrorCategory: category,
      });
    }
  });

  it("maps fetch failures and reads Retry-After", async () => {
    const transport = (fetch: Parameters<typeof clef>[0]) =>
      createClefTransport({
        accountId: ACCOUNT_ID,
        apiKey: "k",
        model: "clef",
        fetch,
      });
    const classify = (
      fetch: Parameters<typeof clef>[0],
      signal = new AbortController().signal,
    ) => {
      const classifier = transport(fetch);
      return classifier.classify({ state, model: MODELS[0]!, signal }).then(
        () => {
          throw new Error("expected a failure");
        },
        (error: unknown) => ({
          category: classifier.errorCategory(error),
          retryAfterMs: classifier.retryAfterMs?.(error),
        }),
      );
    };

    expect(
      await classify(async () => {
        throw new TypeError("fetch failed");
      }),
    ).toEqual({ category: "connection", retryAfterMs: undefined });
    const aborted = new AbortController();
    aborted.abort();
    expect(
      await classify(async () => {
        throw new DOMException("aborted", "AbortError");
      }, aborted.signal),
    ).toMatchObject({ category: "sdk_abort" });
    expect(
      await classify(
        async () =>
          new Response("", { status: 429, headers: { "retry-after": "2" } }),
      ),
    ).toEqual({ category: "http_rate_limit", retryAfterMs: 2000 });
  });

  it("is selected through the bundled providers", async () => {
    expect(classifierProviders.map((provider) => provider.name)).toEqual([
      "jev",
      "clef",
      "laya",
      "kev",
      "openai-decisions",
      "clm",
    ]);
    expect(() =>
      createConfiguredSelector(
        {
          provider: "clef",
          accountId: ACCOUNT_ID,
          apiKey: "k",
          model: "clef",
        },
        classifierProviders,
        {},
      ),
    ).not.toThrow();
  });
});

describe("Clef connection", () => {
  const valid = { accountId: ACCOUNT_ID, apiKey: " k ", model: "clef" };

  it("trims credentials and keeps the selected model", () => {
    expect(resolveClefConnection(valid)).toEqual({
      accountId: ACCOUNT_ID,
      apiKey: "k",
      model: "clef",
    });
  });

  it.each([
    [{ ...valid, apiKey: " " }, /apiKey is required/],
    [{ ...valid, accountId: undefined }, /accountId must be/],
    [{ ...valid, accountId: "../other" }, /accountId must be/],
    [{ ...valid, model: undefined }, /model must be one of clef, clef-flash/],
    [{ ...valid, model: "jev-latest" }, /model must be one of/],
  ])("rejects %o", (config, message) => {
    expect(() => resolveClefConnection(config)).toThrow(message);
  });
});
