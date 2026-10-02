import type { ServerResponse } from "node:http";
import http from "node:http";
import https from "node:https";
import { buildUpstreamRequestHeaders, pickResponseHeaders } from "./headers.js";
import type { Provider } from "./models.js";
import { type Usage, UsageObserver } from "./usage.js";

export const UPSTREAM_UNAVAILABLE_BODY = JSON.stringify({
  error: "upstream_unavailable",
});
export const UPSTREAM_TIMEOUT_BODY = JSON.stringify({
  error: "upstream_timeout",
});

/** The URL hostname without IPv6 brackets, as `net` and `http` expect. */
export function upstreamHostname(url: URL): string {
  return url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname;
}

export interface UpstreamCall {
  method: string;
  url: URL;
  authorization: string | undefined;
  provider?: Provider;
  extraHeaders?: Record<string, string>;
  body: string | undefined;
  signal: AbortSignal;
  headerTimeoutMs?: number;
  idleTimeoutMs?: number;
  onUsage?: (usage: Usage) => void;
  onResponseStatus?: (statusCode: number) => void;
  onTerminal?: (completed: boolean) => void;
}

export type UpstreamOutcome =
  | "forwarded"
  | "upstream_unavailable"
  | "mid_stream_failure"
  | "client_disconnected"
  | "upstream_timeout";

export function forwardUpstream(
  response: ServerResponse,
  call: UpstreamCall,
): Promise<UpstreamOutcome> {
  return new Promise((resolve) => {
    if (call.signal.aborted) {
      if (!response.writableEnded) {
        response.destroy();
      }
      resolve("client_disconnected");
      return;
    }

    let settled = false;
    let upstreamComplete = false;
    let headersForwarded = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let upstreamRequest: http.ClientRequest;

    const clearDeadline = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const onAbort = (): void => {
      upstreamRequest.destroy();
      if (!response.writableEnded) response.destroy();
      settle("client_disconnected");
    };

    const settle = (outcome: UpstreamOutcome): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearDeadline();
      call.signal.removeEventListener("abort", onAbort);
      resolve(outcome);
    };

    const deadline = (ms: number | undefined): void => {
      clearDeadline();
      if (ms === undefined || settled) return;
      timer = setTimeout(() => {
        if (call.signal.aborted) {
          onAbort();
          return;
        }
        settle("upstream_timeout");
        if (headersForwarded) {
          response.destroy();
        } else {
          response.writeHead(504, { "content-type": "application/json" });
          response.end(UPSTREAM_TIMEOUT_BODY);
        }
        upstreamRequest.destroy();
      }, ms);
    };

    const failMidStream = (): void => {
      response.destroy();
      settle("mid_stream_failure");
    };

    const transport = call.url.protocol === "https:" ? https : http;
    upstreamRequest = transport.request(
      {
        protocol: call.url.protocol,
        hostname: upstreamHostname(call.url),
        port: call.url.port,
        path: `${call.url.pathname}${call.url.search}`,
        method: call.method,
        headers: buildUpstreamRequestHeaders(
          call.authorization,
          call.body,
          call.extraHeaders,
        ),
      },
      (upstreamResponse) => {
        call.onResponseStatus?.(upstreamResponse.statusCode ?? 502);
        const observer = call.onUsage
          ? new UsageObserver(
              String(upstreamResponse.headers["content-type"]).includes(
                "text/event-stream",
              ),
              call.provider ?? "openai",
            )
          : undefined;
        headersForwarded = true;
        deadline(call.idleTimeoutMs);
        response.writeHead(
          upstreamResponse.statusCode ?? 502,
          pickResponseHeaders(upstreamResponse.rawHeaders),
        );

        upstreamResponse.on("data", (chunk: Buffer) => {
          observer?.push(chunk);
          if (!response.write(chunk)) {
            upstreamResponse.pause();
            clearDeadline();
            response.once("drain", () => {
              if (settled) return;
              deadline(call.idleTimeoutMs);
              upstreamResponse.resume();
            });
          } else {
            deadline(call.idleTimeoutMs);
          }
        });

        upstreamResponse.on("end", () => {
          observer?.finish();
          if (observer) call.onUsage?.(observer.usage);
          call.onTerminal?.(observer?.completed ?? false);
          upstreamComplete = true;
          response.end();
          settle(call.signal.aborted ? "client_disconnected" : "forwarded");
        });

        upstreamResponse.on("error", () => {
          failMidStream();
        });

        upstreamResponse.on("close", () => {
          if (!upstreamComplete) {
            failMidStream();
          }
        });
      },
    );

    upstreamRequest.on("error", () => {
      if (settled) return;
      if (headersForwarded) {
        failMidStream();
        return;
      }
      if (call.signal.aborted || response.destroyed) {
        settle("client_disconnected");
        return;
      }
      response.writeHead(502, { "content-type": "application/json" });
      response.end(UPSTREAM_UNAVAILABLE_BODY);
      settle("upstream_unavailable");
    });

    call.signal.addEventListener("abort", onAbort, { once: true });

    deadline(call.headerTimeoutMs);
    upstreamRequest.end(call.body);
  });
}
