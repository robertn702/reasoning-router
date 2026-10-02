import { createJevClassifier as createClassifier } from "@reasoning-router/classifier-jev";

import { findModel } from "@reasoning-router/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { once } from "node:events";
import { createAppServer } from "../src/server.js";
import { portOf } from "./port.js";

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

const cacheBody = (promptCacheKey: unknown) => ({
  model: "gpt-6-astra",
  prompt_cache_key: promptCacheKey,
  input: [{ role: "user", content: "hi" }],
});

describe("Jev classifier", () => {
  it("ignores late results after the fallback selection and starts no duplicate generation", async () => {
    let attempts = 0;
    const upstreamRequests: string[] = [];
    const { select } = createJevClassifier({
      apiKey: "k",
      timeoutMs: 30,
      fetch: async () => {
        attempts += 1;
        await new Promise((resolve) => setTimeout(resolve, 120));
        return okResponse("max");
      },
    });

    // Point at a stub upstream that records requests.
    const stub = await (async () => {
      const http = await import("node:http");
      const stubServer = http.createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          upstreamRequests.push(Buffer.concat(chunks).toString("utf8"));
          response.writeHead(200, { "content-type": "application/json" });
          response.end("{}");
        });
      });
      stubServer.listen(0, "127.0.0.1");
      await once(stubServer, "listening");
      return stubServer;
    })();
    const stubPort = portOf(stub);

    const app = createAppServer({
      upstreamBaseUrl: `http://127.0.0.1:${stubPort}/v1`,
      upstreamAuth: { policy: "forward" },
      baseEffort: "medium",
      selectEffort: select,
    });
    app.listen(0, "127.0.0.1");
    await once(app, "listening");
    const appPort = portOf(app);

    const response = await fetch(`http://127.0.0.1:${appPort}/v1/responses`, {
      method: "POST",
      body: JSON.stringify(cacheBody("late-key")),
    });
    expect(response.status).toBe(200);

    // Wait past the late classification result.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(upstreamRequests).toHaveLength(1);
    expect(JSON.parse(upstreamRequests[0]!)).toMatchObject({
      input: expect.arrayContaining([
        expect.objectContaining({ reasoning: { effort: "medium" } }),
      ]),
    });
    expect(attempts).toBe(1);

    // The late result must not have been stored as a prior effort.
    const after = await select({
      body: cacheBody("late-key"),
      signal: new AbortController().signal,
    });
    expect(after.effort).toBe("medium");

    app.closeAllConnections();
    stub.closeAllConnections();
    const appClosed = once(app, "close");
    const stubClosed = once(stub, "close");
    app.close();
    stub.close();
    await appClosed;
    await stubClosed;
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
    process.env.TYPESAFE_LOG_LEVEL = "debug";
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
    delete process.env.TYPESAFE_LOG_LEVEL;
    console.log = originals.log;
    console.info = originals.info;
    console.warn = originals.warn;
    console.error = originals.error;
    console.debug = originals.debug;
    process.stdout.write = originals.stdout;
    process.stderr.write = originals.stderr;
  });

  it("emits metadata restricted to the explicit allowlist", async () => {
    const evidence: Array<Record<string, unknown>> = [];
    let failJev = false;
    const { select } = createJevClassifier({
      apiKey: "k",
      timeoutMs: 500,
      fetch: async () =>
        failJev
          ? new Response("secret server detail", { status: 503 })
          : okResponse("high"),
    });

    const upstream = await (async () => {
      const http = await import("node:http");
      const server = http.createServer((_request, response) => {
        response.end("{}");
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      return server;
    })();
    const upstreamPort = portOf(upstream);

    const app = createAppServer({
      upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
      upstreamAuth: { policy: "forward" },
      baseEffort: "medium",
      selectEffort: select,
      onEvidence: (record) => evidence.push({ ...record }),
    });
    app.listen(0, "127.0.0.1");
    await once(app, "listening");
    const appPort = portOf(app);

    await fetch(`http://127.0.0.1:${appPort}/v1/responses`, {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-6-astra",
        prompt_cache_key: `key-${MARKERS[2]}`,
        input: [{ role: "user", content: `please ${MARKERS[0]}` }],
      }),
    });

    expect(evidence).toHaveLength(1);
    expect(Object.keys(evidence[0]!).sort()).toEqual([
      "cached_input_tokens",
      "classifier",
      "classifier_attempts",
      "classifier_error_category",
      "classifier_latency_ms",
      "effort",
      "fallback",
      "history_updates_replayed",
      "input_tokens",
      "lineage_status",
      "model",
      "outcome",
      "output_tokens",
      "previous_effort",
      "request_id",
      "session",
      "turn_id",
    ]);
    expect(evidence[0]).toMatchObject({
      model: "gpt-6-astra",
      effort: "high",
      fallback: null,
      outcome: "completed",
      session: null,
      turn_id: null,
    });
    for (const marker of MARKERS) {
      expect(JSON.stringify(evidence[0])).not.toContain(marker);
    }

    failJev = true;
    await fetch(`http://127.0.0.1:${appPort}/v1/responses`, {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-6-astra",
        input: [{ role: "user", content: "hi" }],
      }),
    });
    expect(evidence[1]).toMatchObject({
      fallback: "classifier_error",
      classifier_error_category: "http_5xx",
    });
    expect(JSON.stringify(evidence[1])).not.toContain("secret server detail");

    app.closeAllConnections();
    upstream.closeAllConnections();
    const appClosed = once(app, "close");
    const upstreamClosed = once(upstream, "close");
    app.close();
    upstream.close();
    await appClosed;
    await upstreamClosed;
  });
});
