import type { Message, ModelThinkingLevel } from "@earendil-works/pi-ai";
import {
  buildConversationClassifierState,
  type ClassifierState,
  type ConversationMessage,
  type Effort,
  isEffort,
} from "@reasoning-router/core";

/** Pi calls the core's `none` effort `off`; Pi's `minimal` has no core effort. */
export function toThinkingLevel(effort: Effort): ModelThinkingLevel {
  return effort === "none" ? "off" : effort;
}

export function toEffort(
  level: ModelThinkingLevel | undefined,
): Effort | undefined {
  if (level === "off") return "none";
  return isEffort(level) ? level : undefined;
}

function text(content: Message["content"]): string {
  if (typeof content === "string") return content;
  return content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n");
}

/** System messages, which carry the prompt, never reach the classifier. */
export function classifierState(messages: readonly Message[]): ClassifierState {
  return buildConversationClassifierState(
    messages.flatMap((message): ConversationMessage[] => {
      switch (message.role) {
        case "user":
        case "assistant":
          return [{ role: message.role, text: text(message.content) }];
        case "toolResult":
          return [
            {
              role: "tool",
              name: message.toolName,
              ok: !message.isError,
              text: text(message.content),
            },
          ];
        default:
          return [];
      }
    }),
  );
}
