import type { Provider } from "./models.js";
import { isRecord } from "./wire.js";
export interface Usage {
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_input_tokens?: number | null;
}
const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;

// Bounded observer. Oversized events are skipped, not buffered indefinitely.
export class UsageObserver {
  usage: Usage = {
    input_tokens: null,
    cached_input_tokens: null,
    output_tokens: null,
  };
  completed = false;
  private buffer = "";
  private eventData = "";
  private dropping = false;
  private decoder = new TextDecoder();
  private anthropicCounts: {
    input_tokens: number | null;
    cache_read_input_tokens: number | null;
    cache_creation_input_tokens: number | null;
    output_tokens: number | null;
  } = {
    input_tokens: null,
    cache_read_input_tokens: null,
    cache_creation_input_tokens: null,
    output_tokens: null,
  };
  constructor(
    private streaming: boolean,
    private provider: Provider = "openai",
  ) {}
  private mergeAnthropicUsage(usage: unknown) {
    if (!isRecord(usage)) return;
    for (const key of [
      "input_tokens",
      "cache_read_input_tokens",
      "cache_creation_input_tokens",
      "output_tokens",
    ] as const) {
      this.anthropicCounts[key] =
        count(usage[key]) ?? this.anthropicCounts[key];
    }
    const {
      input_tokens,
      cache_read_input_tokens,
      cache_creation_input_tokens,
      output_tokens,
    } = this.anthropicCounts;
    this.usage = {
      input_tokens:
        input_tokens === null
          ? null
          : count(
              input_tokens +
                (cache_read_input_tokens ?? 0) +
                (cache_creation_input_tokens ?? 0),
            ),
      cached_input_tokens: cache_read_input_tokens,
      output_tokens,
      cache_creation_input_tokens,
    };
  }
  private parseAnthropic(text: string) {
    try {
      const value: unknown = JSON.parse(text);
      if (!isRecord(value)) return;
      if (this.streaming) {
        if (value.type === "error") {
          this.completed = false;
          return;
        }
        if (value.type === "message_stop") this.completed = true;
        if (value.type === "message_start" && isRecord(value.message))
          this.mergeAnthropicUsage(value.message.usage);
        if (value.type === "message_delta")
          this.mergeAnthropicUsage(value.usage);
      } else if (value.type === "message") {
        this.completed = typeof value.stop_reason === "string";
        this.mergeAnthropicUsage(value.usage);
      }
    } catch {
      /* observation must not affect forwarding */
    }
  }
  private parse(text: string) {
    if (this.provider === "anthropic") {
      this.parseAnthropic(text);
      return;
    }
    try {
      const value: unknown = JSON.parse(text);
      if (!isRecord(value)) return;
      const response = isRecord(value.response) ? value.response : undefined;
      if (
        value.type === "response.completed" ||
        value.status === "completed" ||
        response?.status === "completed"
      )
        this.completed = true;
      const usage = (
        value.response === undefined || value.response === null
          ? value
          : response
      )?.usage;
      if (!isRecord(usage)) return;
      this.usage = {
        input_tokens: count(usage.input_tokens),
        cached_input_tokens: count(
          isRecord(usage.input_tokens_details)
            ? usage.input_tokens_details.cached_tokens
            : undefined,
        ),
        output_tokens: count(usage.output_tokens),
      };
    } catch {
      /* observation must not affect forwarding */
    }
  }
  push(chunk: Uint8Array) {
    const text = this.decoder.decode(chunk, { stream: true });
    if (!this.streaming) {
      if (!this.dropping) this.buffer += text;
      if (this.buffer.length > 1_048_576) {
        this.buffer = "";
        this.dropping = true;
      }
      return;
    }
    for (const char of text) {
      if (!this.dropping) this.buffer += char;
      if (this.buffer.length > 1_048_576 || this.eventData.length > 1_048_576) {
        this.buffer = "";
        this.eventData = "";
        this.dropping = true;
      }
      if (char !== "\n") continue;
      const line = this.buffer.endsWith("\r\n")
        ? this.buffer.slice(0, -2)
        : this.buffer.slice(0, -1);
      this.buffer = "";
      if (line === "") {
        if (!this.dropping && this.eventData !== "") this.parse(this.eventData);
        this.eventData = "";
        this.dropping = false;
      } else if (!this.dropping && line.startsWith("data:")) {
        this.eventData += `${line.slice(5).trimStart()}\n`;
      }
    }
  }
  finish() {
    if (!this.streaming && !this.dropping)
      this.parse(this.buffer + this.decoder.decode());
  }
}
