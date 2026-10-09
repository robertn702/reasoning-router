import {
  createClassifierSelector,
  createConfiguredSelector,
  MODELS,
} from "@reasoning-router/core";
import { describe, expect, it } from "vitest";
import {
  classifierProviders,
  createKevTransport,
  type KevConnection,
  loadClassifierConfig,
  resolveKevConnection,
} from "../src/index.js";

/** A `kev.serve` (Kev 1.0) choice answer, with the fields our parser ignores. */
const answer = (choice: unknown) =>
  new Response(
    JSON.stringify({
      model: "kev-latest",
      answers: {
        effort: {
          type: "choice",
          choice,
          confidence: 0.21,
          probabilities: { low: 0.47, medium: 0.28, high: 0.25 },
        },
      },
      usage: { input_tokens: 101, output_tokens: 40 },
      latency_ms: 41.5,
    }),
    {
      headers: {
        "content-type": "application/json",
        "x-typesafe-request-id": "abc",
      },
    },
  );

type FakeFetch = (url: string, init?: RequestInit) => Promise<Response>;

function kev(
  fetch: FakeFetch,
  config: Record<string, unknown> = {},
  timeoutMs = 1000,
  maxRetries = 0,
) {
  return createClassifierSelector({
    classifier: createKevTransport({ ...resolveKevConnection(config), fetch }),
    timeoutMs,
    maxRetries,
    fallbackEffort: "medium",
  });
}

const args = (signal = new AbortController().signal) => ({
  model: MODELS[0]!,
  body: { model: MODELS[0]!.id, input: [{ role: "user", content: "hi" }] },
  signal,
});

/** A fetch that never answers and rejects when its request is aborted. */
const hanging =
  (onAbort: () => void = () => {}): FakeFetch =>
  (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => {
          onAbort();
          reject(new DOMException("aborted", "AbortError"));
        },
        { once: true },
      );
    });

async function request(config: Record<string, unknown> = {}) {
  let sent: [string, RequestInit | undefined] | undefined;
  const decision = await kev(async (url, init) => {
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

describe("Kev classifier", () => {
  it("posts the System One request to kev.serve's default address", async () => {
    const { decision, url, headers, body } = await request();

    expect(decision).toMatchObject({
      effort: "low",
      classifier: "kev",
      fallback: null,
    });
    expect(url).toBe("http://127.0.0.1:8008/v1/systemone");
    expect(headers.has("authorization")).toBe(false);
    expect(body).not.toHaveProperty("model");
    expect(body.state.model).toBe(MODELS[0]!.id);
    expect(body.questions.effort).toMatchObject({
      type: "choice",
      instructions: expect.any(String),
    });
    expect(Object.keys(body.questions.effort.criteria)).toEqual(
      MODELS[0]!.supportedEfforts,
    );
  });

  it("sends the bearer key and model only when set", async () => {
    const { url, headers, body } = await request({
      baseUrl: "https://kev.example.com/",
      apiKey: " secret ",
      model: "kev-latest",
    });

    expect(url).toBe("https://kev.example.com/v1/systemone");
    expect(headers.get("authorization")).toBe("Bearer secret");
    expect(body.model).toBe("kev-latest");
  });

  it("rejects an answer outside the supported efforts or a malformed body", async () => {
    for (const response of [
      () => answer("ultra"),
      () => answer(3),
      () => new Response(JSON.stringify({ answers: {} })),
      () => new Response("not json"),
    ]) {
      const decision = await kev(async () => response())(args());
      expect(decision).toMatchObject({
        effort: "medium",
        fallback: "classifier_invalid_output",
      });
    }
  });

  it("maps kev.serve statuses and connection failures to error categories", async () => {
    for (const [status, category] of [
      [401, "http_auth"],
      [422, "http_4xx"],
      [500, "http_5xx"],
      [503, "http_5xx"],
    ] as const) {
      const decision = await kev(
        async () =>
          new Response(JSON.stringify({ detail: "secret detail" }), {
            status,
          }),
        { apiKey: "kev-key-123" },
      )(args());
      expect(decision).toMatchObject({
        fallback: "classifier_error",
        classifierErrorCategory: category,
      });
      expect(JSON.stringify(decision)).not.toContain("secret detail");
      expect(JSON.stringify(decision)).not.toContain("kev-key-123");
    }

    const decision = await kev(async () => {
      throw new TypeError("fetch failed");
    })(args());
    expect(decision).toMatchObject({
      fallback: "classifier_error",
      classifierErrorCategory: "connection",
    });
  });

  it("retries a 503 after Retry-After but not a 401", async () => {
    for (const [status, expected] of [
      [503, 2],
      [401, 1],
    ] as const) {
      let attempts = 0;
      const decision = await kev(
        async () => {
          attempts += 1;
          return attempts === 1
            ? new Response("", { status, headers: { "retry-after": "0" } })
            : answer("high");
        },
        {},
        1000,
        1,
      )(args());
      expect(attempts).toBe(expected);
      expect(decision.fallback).toBe(
        status === 503 ? null : "classifier_error",
      );
    }
  });

  it("aborts the request at the deadline and falls back", async () => {
    let aborted = false;
    const decision = await kev(
      hanging(() => {
        aborted = true;
      }),
      {},
      30,
    )(args());

    expect(decision.fallback).toBe("classifier_timeout");
    expect(aborted).toBe(true);
  });

  it("propagates client cancellation instead of falling back", async () => {
    const controller = new AbortController();
    const pending = kev(hanging())(args(controller.signal));
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelled/);
  });

  it("is selected from the shared REASONING_ROUTER_CLASSIFIER_* variables", () => {
    const config = loadClassifierConfig({ REASONING_ROUTER_CLASSIFIER: "kev" });
    expect(() =>
      createConfiguredSelector(config, classifierProviders, {}),
    ).not.toThrow();
    expect(resolveKevConnection(config)).toEqual({
      baseURL: "http://127.0.0.1:8008",
      apiKey: undefined,
      model: undefined,
    } satisfies KevConnection);
    expect(
      resolveKevConnection(
        loadClassifierConfig({
          REASONING_ROUTER_CLASSIFIER: "kev",
          REASONING_ROUTER_CLASSIFIER_BASE_URL: "http://localhost:8009",
        }),
      ).baseURL,
    ).toBe("http://localhost:8009");
  });
});

describe("Kev connection", () => {
  it.each([
    ["http://kev.example.com", /HTTP URL to a loopback host/],
    ["http://0.0.0.0:8008", /HTTP URL to a loopback host/],
    ["https://user:pass@kev.example.com", /without credentials/],
    ["https://kev.example.com?key=x", /without credentials, query/],
    ["", /must be a valid URL/],
  ])("rejects baseUrl %s", (baseUrl, message) => {
    expect(() => resolveKevConnection({ baseUrl })).toThrow(message);
  });
});
