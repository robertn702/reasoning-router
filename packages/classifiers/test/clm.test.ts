import {
  ClassificationCancelledError,
  createClassifierSelector,
  createConfiguredSelector,
  MODELS,
} from "@reasoning-router/core";
import { describe, expect, it } from "vitest";
import {
  classifierProviders,
  createLayaTransport,
  resolveLayaConnection,
} from "../src/index.js";

// CLM's `clm-serve` (Contrastive-LM/CLM d5f9ef0) speaks the same
// `POST /v1/systemone` contract as Laya, so it is configured through the
// `laya` preset; see docs/classifiers/clm.md.
const CLM = { baseUrl: "http://127.0.0.1:8700", model: "clm-latest" };

/** A `clm-serve` response, as built by `clm.schema.answer_from_probs`. */
const answer = (choice: unknown) =>
  new Response(
    JSON.stringify({
      model: "clm-latest",
      answers: {
        effort: {
          type: "choice",
          choice,
          confidence: 0.31,
          probabilities: { low: 0.2, medium: 0.5, high: 0.3 },
        },
      },
      usage: { billing_units: 1, input_tokens: 412, output_tokens: 0 },
    }),
    {
      headers: {
        "content-type": "application/json",
        "x-clm-latency-ms": "21.4",
      },
    },
  );

type FakeFetch = (url: string, init?: RequestInit) => Promise<Response>;

function clm(
  fetch: FakeFetch,
  config: Record<string, unknown> = {},
  policy: { timeoutMs?: number; maxRetries?: number } = {},
) {
  return createClassifierSelector({
    classifier: createLayaTransport({
      ...resolveLayaConnection({ ...CLM, ...config }),
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

/** Never settles until aborted, like a `clm-serve` stuck on its pooling backend. */
const hanging: FakeFetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener(
      "abort",
      () => reject(new DOMException("aborted", "AbortError")),
      { once: true },
    );
  });

describe("CLM through the laya preset", () => {
  it("posts a System One choice request with clm-latest and a bearer key", async () => {
    let sent: [string, RequestInit | undefined] | undefined;
    const decision = await clm(
      async (url, init) => {
        sent = [url, init];
        return answer("high");
      },
      { apiKey: "clm-key" },
    )(args());

    expect(decision).toMatchObject({
      effort: "high",
      classifier: "laya",
      fallback: null,
    });
    expect(sent?.[0]).toBe("http://127.0.0.1:8700/v1/systemone");
    expect(new Headers(sent?.[1]?.headers).get("authorization")).toBe(
      "Bearer clm-key",
    );
    const body = JSON.parse(String(sent?.[1]?.body));
    // clm-serve requires `state` and a `questions` object; `model` picks the head.
    expect(body.model).toBe("clm-latest");
    expect(body.state.model).toBe(MODELS[0]!.id);
    expect(body).not.toHaveProperty("temperature");
    expect(body.questions.effort.type).toBe("choice");
    expect(Object.keys(body.questions.effort.criteria)).toEqual(
      MODELS[0]!.supportedEfforts,
    );
    // CLM embeds each option's description, so every criterion is non-empty.
    for (const text of Object.values(body.questions.effort.criteria))
      expect(text).toEqual(expect.stringMatching(/\S/));
  });

  it("omits the authorization header when clm-serve runs without CLM_API_KEY", async () => {
    let headers: Headers | undefined;
    await clm(async (_url, init) => {
      headers = new Headers(init?.headers);
      return answer("low");
    })(args());
    expect(headers?.has("authorization")).toBe(false);
  });

  it("falls back on choices the target model does not support or malformed bodies", async () => {
    for (const response of [
      () => answer("ultra"),
      () => answer(3),
      () => new Response(JSON.stringify({ detail: "ok" })),
      () => new Response(JSON.stringify({ answers: { effort: {} } })),
      () => new Response("<html>playground</html>"),
    ]) {
      const decision = await clm(async () => response())(args());
      expect(decision).toMatchObject({
        effort: "medium",
        fallback: "classifier_invalid_output",
      });
    }
  });

  it("maps clm-serve errors: 401 bad key, 422 bad request or model, 502 pooling backend down", async () => {
    for (const [status, category] of [
      [401, "http_auth"],
      [422, "http_4xx"],
      [502, "http_5xx"],
    ] as const) {
      const decision = await clm(
        async () =>
          new Response(JSON.stringify({ detail: "embedder unreachable" }), {
            status,
          }),
      )(args());
      expect(decision).toMatchObject({
        effort: "medium",
        fallback: "classifier_error",
        classifierErrorCategory: category,
      });
    }
  });

  it("retries a 502 once under the shared policy, but not a 401", async () => {
    for (const [status, expected] of [
      [502, 2],
      [401, 1],
    ] as const) {
      let calls = 0;
      const decision = await clm(
        async () => {
          calls++;
          return calls === 1 ? new Response("", { status }) : answer("low");
        },
        {},
        { maxRetries: 1, timeoutMs: 2000 },
      )(args());
      expect(calls).toBe(expected);
      expect(decision.fallback).toBe(
        status === 502 ? null : "classifier_error",
      );
    }
  });

  it("falls back at the deadline when clm-serve hangs", async () => {
    const decision = await clm(hanging, {}, { timeoutMs: 30 })(args());
    expect(decision).toMatchObject({
      effort: "medium",
      fallback: "classifier_timeout",
    });
  });

  it("aborts the request and never falls back when the client cancels", async () => {
    const controller = new AbortController();
    let aborted = false;
    const pending = clm(async (url, init) => {
      init?.signal?.addEventListener("abort", () => {
        aborted = true;
      });
      return hanging(url, init);
    })(args(controller.signal));
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toBeInstanceOf(ClassificationCancelledError);
    expect(aborted).toBe(true);
  });

  it("accepts CLM's address and model as a laya configuration", () => {
    expect(() =>
      createConfiguredSelector(
        { provider: "laya", ...CLM },
        classifierProviders,
        {},
      ),
    ).not.toThrow();
  });

  it("rejects plaintext HTTP to a remote clm-serve", () => {
    expect(() =>
      resolveLayaConnection({ baseUrl: "http://gpu-box.example.com:8700" }),
    ).toThrow(/HTTP URL to a loopback host/);
  });
});
