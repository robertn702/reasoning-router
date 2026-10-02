import type { ClassifierState } from "./classifier.js";
import { excerpt } from "./wire-openai.js";

/** A message from a harness that exposes a normalized conversation instead of a wire body. */
export type ConversationMessage =
  | { role: "user" | "assistant"; text: string }
  | { role: "tool"; name: string; ok: boolean; text: string };

/** Builds the same bounded state as the wire builders, from normalized messages. */
export function buildConversationClassifierState(
  messages: readonly ConversationMessage[],
): ClassifierState {
  let recentUserText = "";
  let assistantProgress = "";
  const toolResults: ClassifierState["tool_results"] = [];
  for (const message of messages) {
    if (message.role === "tool") {
      toolResults.push({
        name: message.name,
        ok: message.ok,
        excerpt: excerpt(message.text),
      });
      if (toolResults.length > 8) toolResults.shift();
    } else if (message.text.length > 0) {
      if (message.role === "user") recentUserText = excerpt(message.text, 2000);
      else assistantProgress = excerpt(message.text, 2000);
    }
  }
  const failures = toolResults.filter((result) => !result.ok);
  return {
    recent_user_text: recentUserText,
    assistant_progress: assistantProgress,
    tool_results: toolResults,
    failure_state: {
      failed_count: failures.length,
      last_failure_excerpt: failures.at(-1)?.excerpt ?? "",
    },
  };
}
