import { findModel } from "@reasoning-router/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJevClassifier as createClassifier } from "../src/jev.js";

function createJevClassifier(
  options: Omit<Parameters<typeof createClassifier>[0], "baseURL" | "model"> &
    Partial<Pick<Parameters<typeof createClassifier>[0], "baseURL" | "model">>,
) {
  const classifier = createClassifier({
    baseURL: "https://api.typesafe.ai",
    model: "jev-latest",
    maxRetries: 0,
    fallbackMode: "previous",
    fallbackEffort: "medium",
    ...options,
  });
  return {
    ...classifier,
    select: (args: Omit<Parameters<typeof classifier.select>[0], "model">) =>
      classifier.select({
        ...args,
        model: findModel(args.body.model ?? "gpt-6-astra")!,
      }),
  };
}

type FetchArgs = [input: string, init?: RequestInit];

function okResponse(choice: string): Response {
  return new Response(
    JSON.stringify({
      model: "jev-latest",
      answers: {
        effort: {
          type: "choice",
          choice,
          confidence: 0.9,
          probabilities: {},
        },
      },
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function hangingFetch(
  onAbort: () => void,
): (input: string, init?: RequestInit) => Promise<Response> {
  return (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => {
          onAbort();
          reject(new DOMException("aborted", "AbortError"));
        },
        { once: true },
      );
    });
}

const cacheBody = (promptCacheKey: unknown) => ({
  model: "gpt-6-astra",
  prompt_cache_key: promptCacheKey,
  input: [{ role: "user", content: "hi" }],
});

describe("Jev classifier", () => {
  it("sends the direct TypeSafe model and classifier credential", async () => {
    let sent: FetchArgs | undefined;
    const { select } = createJevClassifier({
      apiKey: "direct-key",
      timeoutMs: 1000,
      fetch: async (input, init) => {
        sent = [input, init];
        return okResponse("medium");
      },
    });
    await select({
      body: cacheBody("direct"),
      signal: new AbortController().signal,
    });
    expect(sent?.[0]).toBe("https://api.typesafe.ai/v1/systemone");
    expect(new Headers(sent?.[1]?.headers).get("authorization")).toBe(
      "Bearer direct-key",
    );
    expect(JSON.parse(String(sent?.[1]?.body)).model).toBe("jev-latest");
  });

  it("returns the validated effort from a successful classification", async () => {
    const seen: FetchArgs[] = [];
    const { select } = createJevClassifier({
      apiKey: "k",
      baseURL: "https://ai-gateway.vercel.sh/typesafe",
      model: "typesafe-ai/jev",
      timeoutMs: 1000,
      fetch: async (input: string, init?: RequestInit) => {
        seen.push([input, init]);
        return okResponse("high");
      },
    });

    const decision = await select({
      body: cacheBody("k1"),
      signal: new AbortController().signal,
    });

    expect(decision).toEqual({
      effort: "high",
      classifier: "jev",
      classifierLatencyMs: expect.any(Number),
      classifierAttempts: 1,
      fallback: null,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]![0]).toBe(
      "https://ai-gateway.vercel.sh/typesafe/v1/systemone",
    );
    expect(new Headers(seen[0]![1]?.headers).get("authorization")).toBe(
      "Bearer k",
    );
    expect(JSON.parse(String(seen[0]![1]?.body)).model).toBe("typesafe-ai/jev");
  });

  it("reuses the previous effort for the same usable cache key on invalid output, errors, and timeout", async () => {
    let mode: "ok" | "invalid" | "error" | "hang" = "ok";
    let attempts = 0;
    const { select } = createJevClassifier({
      apiKey: "k",
      timeoutMs: 40,
      fetch: async (_input: string, init?: RequestInit) => {
        attempts += 1;
        if (mode === "ok") return okResponse("xhigh");
        if (mode === "invalid") return okResponse("extreme");
        if (mode === "error") {
          return new Response(JSON.stringify({ error: "boom" }), {
            status: 500,
          });
        }
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        });
      },
    });
    const signal = new AbortController().signal;

    const first = await select({ body: cacheBody("k1"), signal });
    expect(first.effort).toBe("xhigh");
    expect(first.fallback).toBeNull();

    mode = "invalid";
    const invalid = await select({ body: cacheBody("k1"), signal });
    expect(invalid.effort).toBe("xhigh");
    expect(invalid.fallback).toBe("classifier_invalid_output");

    mode = "error";
    const errored = await select({ body: cacheBody("k1"), signal });
    expect(errored.effort).toBe("xhigh");
    expect(errored.fallback).toBe("classifier_error");
    expect(errored.classifierErrorCategory).toBe("http_5xx");

    mode = "hang";
    const timedOut = await select({ body: cacheBody("k1"), signal });
    expect(timedOut.effort).toBe("xhigh");
    expect(timedOut.fallback).toBe("classifier_timeout");

    mode = "error";
    const otherKey = await select({ body: cacheBody("k2"), signal });
    expect(otherKey.effort).toBe("medium");
    expect(otherKey.fallback).toBe("classifier_error");
    expect(otherKey.classifierErrorCategory).toBe("http_5xx");
  });

  it("categorizes HTTP and connection errors without retaining their messages", async () => {
    let response: Response | null = null;
    const { select } = createJevClassifier({
      apiKey: "k",
      timeoutMs: 1000,
      fetch: async () => {
        if (response) return response;
        throw new Error("secret connection detail");
      },
    });
    const signal = new AbortController().signal;
    const decide = () => select({ body: cacheBody("k1"), signal });
    expect((await decide()).classifierErrorCategory).toBe("connection");
    response = new Response("secret auth detail", { status: 401 });
    expect((await decide()).classifierErrorCategory).toBe("http_auth");
    response = new Response("secret rate limit detail", { status: 429 });
    expect((await decide()).classifierErrorCategory).toBe("http_rate_limit");
  });

  it("yields medium for missing or unusable cache keys and keys without prior values", async () => {
    const { select } = createJevClassifier({
      apiKey: "k",
      timeoutMs: 40,
      fetch: async () =>
        new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
    });
    const signal = new AbortController().signal;

    for (const key of [undefined, "", "   ", null, 42]) {
      const decision = await select({ body: cacheBody(key), signal });
      expect(decision.effort).toBe("medium");
      expect(decision.fallback).toBe("classifier_error");
    }
  });

  it("aborts a hanging classifier at the total deadline with exactly one attempt", async () => {
    let attempts = 0;
    let aborted = false;
    const { select } = createJevClassifier({
      apiKey: "k",
      timeoutMs: 30,
      fetch: async (_input: string, init?: RequestInit) => {
        attempts += 1;
        return hangingFetch(() => {
          aborted = true;
        })(_input, init);
      },
    });

    const decision = await select({
      body: cacheBody("k1"),
      signal: new AbortController().signal,
    });

    expect(decision.fallback).toBe("classifier_timeout");
    expect(attempts).toBe(1);
    expect(aborted).toBe(true);
  });

  it("makes no retries on retryable failures", async () => {
    let attempts = 0;
    const { select } = createJevClassifier({
      apiKey: "k",
      timeoutMs: 1000,
      fetch: async () => {
        attempts += 1;
        return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
      },
    });

    const decision = await select({
      body: cacheBody("k1"),
      signal: new AbortController().signal,
    });

    expect(decision.fallback).toBe("classifier_error");
    expect(attempts).toBe(1);
  });

  it("never fails open into generation for a cancelled client", async () => {
    const { select } = createJevClassifier({
      apiKey: "k",
      timeoutMs: 1000,
      fetch: async (_input: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        });
      },
    });

    const controller = new AbortController();
    const pending = select({
      body: cacheBody("k1"),
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toThrow(/cancelled/);
  });
});

describe("evidence privacy under inherited debug logging", () => {
  const MARKERS = [
    "SECRET_PROMPT_MARKER",
    "SECRET_TOOL_MARKER",
    "SECRET_CACHE_MARKER",
    "SECRET_ERROR_MARKER",
  ];

  let captured: string[] = [];
  const originals = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
    stdout: process.stdout.write,
    stderr: process.stderr.write,
  };

  beforeEach(() => {
    captured = [];
    for (const name of ["log", "info", "warn", "error", "debug"] as const) {
      console[name] = (...args: unknown[]) => {
        captured.push(
          args
            .map((arg) =>
              typeof arg === "string"
                ? arg
                : (JSON.stringify(arg) ?? String(arg)),
            )
            .join(" "),
        );
      };
    }
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      captured.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      captured.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    console.log = originals.log;
    console.info = originals.info;
    console.warn = originals.warn;
    console.error = originals.error;
    console.debug = originals.debug;
    process.stdout.write = originals.stdout;
    process.stderr.write = originals.stderr;
  });

  it("leaks no prompt, tool, cache-key, credential, or raw error content on success or error", async () => {
    const body = {
      prompt_cache_key: `key-${MARKERS[2]}`,
      input: [
        { role: "user", content: `please ${MARKERS[0]}` },
        { type: "function_call", call_id: "c1", name: "read", arguments: "{}" },
        {
          type: "function_call_output",
          call_id: "c1",
          output: `tool says ${MARKERS[1]}`,
          status: "completed",
        },
      ],
    };

    let mode: "ok" | "error" = "ok";
    const { select } = createJevClassifier({
      apiKey: `sk-${MARKERS[3]}`,
      timeoutMs: 500,
      fetch: async (_input: string, init?: RequestInit) => {
        if (mode === "ok") return okResponse("high");
        void init;
        return new Response(
          JSON.stringify({ error: `upstream ${MARKERS[3]}` }),
          { status: 500 },
        );
      },
    });

    const signal = new AbortController().signal;
    await select({ body, signal });
    mode = "error";
    await select({ body, signal });

    for (const marker of MARKERS) {
      for (const line of captured) {
        expect(line).not.toContain(marker);
      }
    }
  });
});
