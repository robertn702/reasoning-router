import {
  createClassifierSelector,
  createConfiguredSelector,
  MODELS,
} from "@reasoning-router/core";
import { describe, expect, it } from "vitest";
import {
  classifierProviders,
  createSemifTransport,
  loadClassifierConfig,
  resolveSemifConnection,
  type SemifConnection,
} from "../src/index.js";

const state = {
  model: MODELS[0]!.id,
  recent_user_text: "",
  assistant_progress: "",
  tool_results: [],
  failure_state: { failed_count: 0, last_failure_excerpt: "" },
};

/** A `semif-serve` (PR #27) response, with the fields our parser ignores. */
const answer = (choice: unknown) =>
  new Response(
    JSON.stringify({
      model: "semif/Qwen3.5-4B@851bf6e806ef+mlx-bf16",
      answers: {
        effort: {
          type: "choice",
          choice,
          confidence: 0.31,
          probabilities: { low: 0.4, medium: 0.35, high: 0.25 },
          semif: { backend: "mlx", temperature: 1.23 },
        },
      },
      usage: { input_tokens: 180, output_tokens: 1 },
    }),
    { headers: { "content-type": "application/json" } },
  );

/** The `semif-serve` error envelope; it must never reach a decision. */
const failure = (status: number, headers: Record<string, string> = {}) =>
  new Response(
    JSON.stringify({
      error: {
        type: "server_error",
        code: "backend_failed",
        message: "secret detail",
      },
    }),
    { status, headers },
  );

type FakeFetch = (url: string, init?: RequestInit) => Promise<Response>;

function semif(
  fetch: FakeFetch,
  config: Record<string, unknown> = {},
  timeoutMs = 1000,
  maxRetries = 0,
) {
  return createClassifierSelector({
    classifier: createSemifTransport({
      ...resolveSemifConnection(config),
      fetch,
    }),
    timeoutMs,
    maxRetries,
    fallbackEffort: "medium",
  });
}

const args = (model = MODELS[0]!, signal = new AbortController().signal) => ({
  model,
  body: { model: model.id, input: [{ role: "user", content: "hi" }] },
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

async function request(
  config: Record<string, unknown> = {},
  model = MODELS[0]!,
) {
  let sent: [string, RequestInit | undefined] | undefined;
  const decision = await semif(async (url, init) => {
    sent = [url, init];
    return answer("low");
  }, config)(args(model));
  return {
    decision,
    url: sent?.[0],
    init: sent?.[1],
    headers: new Headers(sent?.[1]?.headers),
    body: JSON.parse(String(sent?.[1]?.body)),
  };
}

/** The error a transport throws for one fake response, and what it reports about it. */
async function failureOf(response: () => Response) {
  const classifier = createSemifTransport({
    ...resolveSemifConnection({}),
    fetch: async () => response(),
  });
  const error = await classifier
    .classify({
      state,
      model: MODELS[0]!,
      signal: new AbortController().signal,
    })
    .then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
  return {
    category: classifier.errorCategory(error),
    retryAfterMs: classifier.retryAfterMs?.(error),
  };
}

describe("SemIf classifier", () => {
  it("posts the System One request to semif-serve's default address", async () => {
    const { decision, url, init, headers, body } = await request();

    expect(decision).toMatchObject({
      effort: "low",
      classifier: "semif",
      fallback: null,
    });
    expect(url).toBe("http://127.0.0.1:8471/v1/systemone");
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.has("authorization")).toBe(false);
    expect(body.state.model).toBe(MODELS[0]!.id);
    expect(body.questions.effort).toMatchObject({
      type: "choice",
      instructions: expect.any(String),
    });
  });

  it("always sends a model, defaulting to semif-latest", async () => {
    expect((await request()).body.model).toBe("semif-latest");
    expect((await request({ model: " " })).body.model).toBe("semif-latest");
    expect(
      (await request({ model: "semif/Qwen3.5-4B@851bf6e806ef+mlx-bf16" })).body
        .model,
    ).toBe("semif/Qwen3.5-4B@851bf6e806ef+mlx-bf16");
    expect((await request({ model: " jev-latest " })).body.model).toBe(
      "jev-latest",
    );
  });

  it("sends the bearer key only when it is set", async () => {
    const { url, headers } = await request({
      baseUrl: "https://semif.example.com/prefix/",
      apiKey: " secret ",
    });

    expect(url).toBe("https://semif.example.com/prefix/v1/systemone");
    expect(headers.get("authorization")).toBe("Bearer secret");
    expect((await request({ apiKey: "  " })).headers.has("authorization")).toBe(
      false,
    );
  });

  it("offers only the target model's supported efforts", async () => {
    for (const model of [MODELS[0]!, MODELS[1]!]) {
      const { body } = await request({}, model);
      expect(Object.keys(body.questions.effort.criteria)).toEqual(
        model.supportedEfforts,
      );
    }
    expect(MODELS[0]!.supportedEfforts).not.toContain("none");
    expect(MODELS[1]!.supportedEfforts).toContain("none");
  });

  it("uses the answered choice and ignores the extra fields", async () => {
    for (const choice of MODELS[0]!.supportedEfforts) {
      const decision = await semif(async () => answer(choice))(args());
      expect(decision).toMatchObject({
        effort: choice,
        classifier: "semif",
        fallback: null,
      });
    }
  });

  it("rejects an answer outside the supported efforts or a malformed body", async () => {
    for (const response of [
      () => answer("ultra"),
      () => answer("none"),
      () => answer(3),
      () => answer(undefined),
      () => new Response(JSON.stringify({ answers: {} })),
      () => new Response(JSON.stringify({ result: {}, success: true })),
      () => new Response("not json"),
    ]) {
      const decision = await semif(async () => response())(args());
      expect(decision).toMatchObject({
        effort: "medium",
        fallback: "classifier_invalid_output",
      });
    }
  });

  it("maps semif-serve statuses to error categories without leaking bodies or keys", async () => {
    for (const [status, category] of [
      [401, "http_auth"],
      [404, "http_4xx"],
      [422, "http_4xx"],
      [500, "http_5xx"],
      [503, "http_5xx"],
    ] as const) {
      const decision = await semif(async () => failure(status), {
        apiKey: "semif-key-123",
      })(args());
      expect(decision).toMatchObject({
        fallback: "classifier_error",
        classifierErrorCategory: category,
      });
      expect(JSON.stringify(decision)).not.toContain("secret detail");
      expect(JSON.stringify(decision)).not.toContain("backend_failed");
      expect(JSON.stringify(decision)).not.toContain("semif-key-123");
    }
  });

  it("reports a network failure as a connection error", async () => {
    const decision = await semif(async () => {
      throw new TypeError("fetch failed");
    })(args());
    expect(decision).toMatchObject({
      fallback: "classifier_error",
      classifierErrorCategory: "connection",
    });
  });

  it("reads Retry-After from a loading server", async () => {
    expect(await failureOf(() => failure(503, { "retry-after": "2" }))).toEqual(
      { category: "http_5xx", retryAfterMs: 2000 },
    );
    expect(await failureOf(() => failure(401))).toEqual({
      category: "http_auth",
      retryAfterMs: undefined,
    });
  });

  it("retries a 503 after Retry-After but not a 401 or 422", async () => {
    for (const [status, expected] of [
      [503, 2],
      [401, 1],
      [422, 1],
    ] as const) {
      let attempts = 0;
      const decision = await semif(
        async () => {
          attempts += 1;
          return attempts === 1
            ? failure(status, { "retry-after": "0" })
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
    const decision = await semif(
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
    const pending = semif(hanging())(args(MODELS[0]!, controller.signal));
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelled/);
  });

  it("is selected through the bundled providers with no settings", () => {
    expect(classifierProviders.map((provider) => provider.name)).toContain(
      "semif",
    );
    expect(() =>
      createConfiguredSelector({ provider: "semif" }, classifierProviders, {}),
    ).not.toThrow();
  });

  it("is selected from the shared REASONING_ROUTER_CLASSIFIER_* variables", () => {
    const config = loadClassifierConfig({
      REASONING_ROUTER_CLASSIFIER: "semif",
    });
    expect(() =>
      createConfiguredSelector(config, classifierProviders, {}),
    ).not.toThrow();
    expect(resolveSemifConnection(config)).toEqual({
      baseURL: "http://127.0.0.1:8471",
      apiKey: undefined,
      model: "semif-latest",
    } satisfies SemifConnection);
    expect(
      resolveSemifConnection(
        loadClassifierConfig({
          REASONING_ROUTER_CLASSIFIER: "semif",
          REASONING_ROUTER_CLASSIFIER_BASE_URL: "http://localhost:8472",
          REASONING_ROUTER_CLASSIFIER_API_KEY: "k",
          REASONING_ROUTER_CLASSIFIER_MODEL: "jev-latest",
        }),
      ),
    ).toEqual({
      baseURL: "http://localhost:8472",
      apiKey: "k",
      model: "jev-latest",
    });
  });
});

describe("SemIf connection", () => {
  it("defaults to semif-serve's local address and model, and leaves a blank key or model unset", () => {
    expect(resolveSemifConnection({})).toEqual({
      baseURL: "http://127.0.0.1:8471",
      apiKey: undefined,
      model: "semif-latest",
    } satisfies SemifConnection);
    expect(resolveSemifConnection({ apiKey: " ", model: "" })).toEqual({
      baseURL: "http://127.0.0.1:8471",
      apiKey: undefined,
      model: "semif-latest",
    } satisfies SemifConnection);
  });

  it.each([
    "https://semif.example.com",
    "http://localhost:8471",
    "http://127.0.0.1:8471",
    "http://127.1.2.3",
    "http://[::1]:8471",
  ])("accepts %s", (baseUrl) => {
    expect(resolveSemifConnection({ baseUrl }).baseURL).toBe(
      baseUrl.replace(/\/$/, ""),
    );
  });

  it.each([
    ["http://semif.example.com", /HTTP URL to a loopback host/],
    ["http://192.168.1.5:8471", /HTTP URL to a loopback host/],
    ["http://0.0.0.0:8471", /HTTP URL to a loopback host/],
    ["http://localhost.example.com", /HTTP URL to a loopback host/],
    ["https://user:pass@semif.example.com", /without credentials/],
    ["https://semif.example.com?key=x", /without credentials, query/],
    ["https://semif.example.com#x", /without credentials, query, or fragment/],
    ["ftp://localhost", /HTTPS URL/],
    ["not a url", /must be a valid URL/],
    ["", /must be a valid URL/],
  ])("rejects baseUrl %s", (baseUrl, message) => {
    expect(() => resolveSemifConnection({ baseUrl })).toThrow(message);
  });
});
