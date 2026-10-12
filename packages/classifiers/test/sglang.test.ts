import {
  ClassificationCancelledError,
  createClassifierSelector,
  createConfiguredSelector,
  MODELS,
} from "@reasoning-router/core";
import { describe, expect, it } from "vitest";
import {
  classifierProviders,
  createSglangTransport,
  loadClassifierConfig,
  resolveSglangConnection,
  type SglangConnection,
} from "../src/index.js";

// SGLang v0.5.21 (e00930c) serves the System One request at
// `POST /v1/systemone`; see docs/classifiers/sglang.md.

/** An SGLang response, as built by `SystemOneServing` for a chat model. */
const answer = (choice: unknown) =>
  new Response(
    JSON.stringify({
      model: "Qwen/Qwen3.8-27B",
      answers: {
        effort: {
          type: "choice",
          choice,
          confidence: 0.4,
          probabilities: { low: 0.15, medium: 0.6, high: 0.25 },
          x_label_mass: 0.93,
        },
      },
      usage: { input_tokens: 512, output_tokens: 0 },
    }),
    { headers: { "content-type": "application/json" } },
  );

type FakeFetch = (url: string, init?: RequestInit) => Promise<Response>;

function sglang(
  fetch: FakeFetch,
  config: Record<string, unknown> = {},
  policy: { timeoutMs?: number; maxRetries?: number } = {},
) {
  return createClassifierSelector({
    classifier: createSglangTransport({
      ...resolveSglangConnection(config),
      fetch,
    }),
    timeoutMs: policy.timeoutMs ?? 1000,
    maxRetries: policy.maxRetries ?? 0,
    fallbackEffort: "medium",
  });
}

const args = (signal = new AbortController().signal) => ({
  model: MODELS[0]!,
  body: { model: MODELS[0]!.id, input: [{ role: "user", content: "hi" }] },
  signal,
});

/** Never settles until aborted, like a server busy with a long prefill. */
const hanging: FakeFetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener(
      "abort",
      () => reject(new DOMException("aborted", "AbortError")),
      { once: true },
    );
  });

describe("SGLang classifier", () => {
  it("posts a System One choice request with a model and a bearer key", async () => {
    let sent: [string, RequestInit | undefined] | undefined;
    const decision = await sglang(
      async (url, init) => {
        sent = [url, init];
        return answer("high");
      },
      { apiKey: "sglang-key" },
    )(args());

    expect(decision).toMatchObject({
      effort: "high",
      classifier: "sglang",
      fallback: null,
    });
    expect(sent?.[0]).toBe("http://127.0.0.1:30000/v1/systemone");
    expect(new Headers(sent?.[1]?.headers).get("authorization")).toBe(
      "Bearer sglang-key",
    );
    expect(new Headers(sent?.[1]?.headers).get("content-type")).toBe(
      "application/json",
    );
    const body = JSON.parse(String(sent?.[1]?.body));
    // SGLang's SystemOneRequest requires `model` and refuses `temperature`.
    expect(body.model).toBe("default");
    expect(body).not.toHaveProperty("temperature");
    expect(body.state.model).toBe(MODELS[0]!.id);
    expect(body.questions.effort.type).toBe("choice");
    expect(Object.keys(body.questions.effort.criteria)).toEqual(
      MODELS[0]!.supportedEfforts,
    );
  });

  it("sends a configured model and omits the key when the server has no --api-key", async () => {
    let sent: RequestInit | undefined;
    await sglang(
      async (_url, init) => {
        sent = init;
        return answer("low");
      },
      { model: "Qwen/Qwen3.8-27B", apiKey: " " },
    )(args());
    expect(new Headers(sent?.headers).has("authorization")).toBe(false);
    expect(JSON.parse(String(sent?.body)).model).toBe("Qwen/Qwen3.8-27B");
  });

  it("sends a blank model as default, because SGLang requires one", async () => {
    let body: Record<string, unknown> | undefined;
    await sglang(
      async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return answer("low");
      },
      { model: " " },
    )(args());
    expect(body?.model).toBe("default");
  });

  it("falls back on choices the target model does not support or malformed bodies", async () => {
    for (const response of [
      () => answer("ultra"),
      () => answer(0),
      () => new Response(JSON.stringify({ detail: [] })),
      () => new Response(JSON.stringify({ answers: { effort: {} } })),
      () => new Response("not json"),
    ]) {
      const decision = await sglang(async () => response())(args());
      expect(decision).toMatchObject({
        effort: "medium",
        fallback: "classifier_invalid_output",
      });
    }
  });

  it("maps SGLang errors: 401 bad key, 400 refusal, 422 invalid body, 500 scoring fault", async () => {
    for (const [status, category] of [
      [401, "http_auth"],
      [400, "http_4xx"],
      [422, "http_4xx"],
      [500, "http_5xx"],
    ] as const) {
      const decision = await sglang(
        async () =>
          new Response(JSON.stringify({ message: "refused" }), { status }),
      )(args());
      expect(decision).toMatchObject({
        effort: "medium",
        fallback: "classifier_error",
        classifierErrorCategory: category,
      });
    }
  });

  it("retries a 500 once under the shared policy, but not a 400 or 401", async () => {
    for (const [status, expected] of [
      [500, 2],
      [400, 1],
      [401, 1],
    ] as const) {
      let calls = 0;
      const decision = await sglang(
        async () => {
          calls++;
          return calls === 1 ? new Response("", { status }) : answer("low");
        },
        {},
        { maxRetries: 1, timeoutMs: 2000 },
      )(args());
      expect(calls).toBe(expected);
      expect(decision.fallback).toBe(
        status === 500 ? null : "classifier_error",
      );
    }
  });

  it("falls back at the deadline when the server hangs", async () => {
    const decision = await sglang(hanging, {}, { timeoutMs: 30 })(args());
    expect(decision).toMatchObject({
      effort: "medium",
      fallback: "classifier_timeout",
    });
  });

  it("aborts the request and never falls back when the client cancels", async () => {
    const controller = new AbortController();
    let aborted = false;
    const pending = sglang(async (url, init) => {
      init?.signal?.addEventListener("abort", () => {
        aborted = true;
      });
      return hanging(url, init);
    })(args(controller.signal));
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toBeInstanceOf(ClassificationCancelledError);
    expect(aborted).toBe(true);
  });

  it("is selected from the shared REASONING_ROUTER_CLASSIFIER_* variables", () => {
    const config = loadClassifierConfig({
      REASONING_ROUTER_CLASSIFIER: "sglang",
    });
    expect(() =>
      createConfiguredSelector(config, classifierProviders, {}),
    ).not.toThrow();
    expect(resolveSglangConnection(config)).toEqual({
      baseURL: "http://127.0.0.1:30000",
      apiKey: undefined,
      model: undefined,
    } satisfies SglangConnection);
    expect(
      resolveSglangConnection(
        loadClassifierConfig({
          REASONING_ROUTER_CLASSIFIER: "sglang",
          REASONING_ROUTER_CLASSIFIER_BASE_URL: "https://sglang.example.com/",
          REASONING_ROUTER_CLASSIFIER_MODEL: "pplx-decider",
        }),
      ),
    ).toMatchObject({
      baseURL: "https://sglang.example.com",
      model: "pplx-decider",
    });
  });
});

describe("SGLang connection", () => {
  it.each([
    ["http://gpu-box.example.com:30000", /HTTP URL to a loopback host/],
    ["http://0.0.0.0:30000", /HTTP URL to a loopback host/],
    ["https://user:pass@sglang.example.com", /without credentials/],
    ["https://sglang.example.com?key=x", /without credentials, query/],
    ["", /must be a valid URL/],
  ])("rejects baseUrl %s", (baseUrl, message) => {
    expect(() => resolveSglangConnection({ baseUrl })).toThrow(message);
  });
});
