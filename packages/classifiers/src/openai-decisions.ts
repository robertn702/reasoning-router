import {
  type Classifier,
  type ClassifierConfig,
  type ClassifierProvider,
  parseConfig,
} from "@reasoning-router/core";
import { z } from "zod";
import {
  ClassifierRequestError,
  DESCRIPTIONS,
  type Fetch,
  postJson,
} from "./systemone.js";

/** The global endpoint, and the regional-processing ones that serve `/v1/decisions`. */
const OPENAI_BASE_URLS = [
  "https://api.openai.com/v1",
  "https://us.api.openai.com/v1",
  "https://eu.api.openai.com/v1",
] as const;
const API_KEY_REQUIRED =
  "classifier.apiKey is required for OpenAI Decisions classification";
const BASE_URL = `classifier.baseUrl must be one of ${OPENAI_BASE_URLS.join(", ")}`;
const MODEL = "classifier.model must be gpt-6-luna";

const openAIDecisionsConnectionSchema = z
  .object({
    apiKey: z.string(API_KEY_REQUIRED).trim().min(1, API_KEY_REQUIRED),
    baseUrl: z
      .string(BASE_URL)
      .trim()
      .transform((raw) => raw.replace(/\/$/, ""))
      .pipe(z.enum(OPENAI_BASE_URLS, BASE_URL))
      .default(OPENAI_BASE_URLS[0]),
    model: z.enum(["gpt-6-luna"], MODEL).default("gpt-6-luna"),
  })
  .transform(({ baseUrl, ...rest }) => ({ baseURL: baseUrl, ...rest }));

export type OpenAIDecisionsConnection = z.output<
  typeof openAIDecisionsConnectionSchema
>;

/** Validates an OpenAI API key, an OpenAI endpoint, and the Decisions model. */
export function resolveOpenAIDecisionsConnection(
  config: Readonly<Record<string, unknown>>,
): OpenAIDecisionsConnection {
  return parseConfig(openAIDecisionsConnectionSchema, config);
}

const decisionSchema = z.object({
  answers: z.array(z.record(z.string(), z.unknown())),
});

/**
 * OpenAI's `POST /v1/decisions` (public beta). The state is sent as JSON text
 * with one `choice` question named `effort`; the answer is matched by name.
 */
export function createOpenAIDecisionsTransport(
  connection: OpenAIDecisionsConnection & { fetch?: Fetch },
): Classifier {
  return {
    name: "openai-decisions",
    errorCategory: (error) =>
      error instanceof ClassifierRequestError ? error.category : "unknown",
    retryAfterMs: (error) =>
      error instanceof ClassifierRequestError ? error.retryAfterMs : undefined,
    async classify({ state, model, signal }) {
      const body = await postJson({
        fetch: connection.fetch,
        url: `${connection.baseURL}/decisions`,
        apiKey: connection.apiKey,
        signal,
        body: {
          model: connection.model,
          input: JSON.stringify(state),
          questions: [
            {
              type: "choice",
              name: "effort",
              instructions:
                "The input is a JSON summary of a coding agent's conversation. Select the reasoning effort for the agent's next model call.",
              choices: model.supportedEfforts.map((effort) => ({
                value: effort,
                description: DESCRIPTIONS[effort],
              })),
            },
          ],
        },
      });
      const result = decisionSchema.safeParse(body);
      if (!result.success) return null;
      const answers = result.data.answers.filter(
        (answer) => answer.name === "effort",
      );
      // A refusal, another answer type, or a missing or repeated name is unusable.
      return answers.length === 1 && answers[0]!.type === "choice"
        ? answers[0]!.choice
        : null;
    },
  };
}

/** Selected by `classifier: { provider: "openai-decisions", apiKey, baseUrl, model, timeoutMs }`. */
export const openAIDecisionsClassifierProvider: ClassifierProvider = {
  name: "openai-decisions",
  create(config: ClassifierConfig): Classifier {
    return createOpenAIDecisionsTransport(
      resolveOpenAIDecisionsConnection(config),
    );
  },
};
