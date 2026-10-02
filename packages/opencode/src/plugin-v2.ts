import { randomUUID } from "node:crypto";
import type { Plugin } from "@opencode/plugin";
import type { ProviderEditor } from "@opencode/plugin/promise/provider";
import type {
  SessionHttpRequest,
  SessionHttpResponse,
} from "@opencode/plugin/promise/session";

import {
  MODELS,
  modelsFor,
  type Provider,
  parseConfig,
} from "@reasoning-router/core";
import { z } from "zod";
import {
  createPluginRuntime,
  type Exchange,
  PluginRequestError,
  SESSION,
  valid,
} from "./plugin-runtime.js";

type ProviderInput = Parameters<ProviderEditor["add"]>[0];
type ModelInput = ProviderInput["models"][number];
type ModelID = ModelInput["id"];
type ProviderID = ProviderInput["info"]["id"];
/**
 * OpenCode's model and provider IDs are `Schema.String` brands with no other
 * checks, so this is the check `ID.make` performs, without importing the SDK
 * at runtime.
 */
const isID = <ID extends ModelID | ProviderID>(value: string): value is ID =>
  typeof value === "string";
const toID = <ID extends ModelID | ProviderID>(value: string): ID => {
  if (isID<ID>(value)) return value;
  throw new TypeError(`reasoning-router: invalid OpenCode ID ${value}`);
};
/** The part of the plugin context the router uses. */
export type Host = Pick<Plugin.Context, "options"> & {
  readonly provider: Pick<Plugin.Context["provider"], "transform">;
  readonly model: Pick<Plugin.Context["model"], "transform">;
  readonly integration: Pick<Plugin.Context["integration"], "connection">;
  readonly session: Pick<Plugin.Context["session"], "hook">;
};
type Alias = {
  group: Provider;
  providerID: string;
  integrationID: string;
  authHeader: "authorization" | "x-api-key";
};

export const PROVIDER_ID = "reasoning-router";
export const PROVIDER_PACKAGE = "@opencode/ai/providers/openai/responses";
const PACKAGES = {
  openai: PROVIDER_PACKAGE,
  anthropic: "@opencode/ai/providers/anthropic",
};

const rejection = (cause: unknown): Error =>
  cause instanceof PluginRequestError
    ? new Error(
        `reasoning-router ${cause.code} (${cause.status}): ${cause.message}`,
      )
    : new Error(
        "reasoning-router upstream_unavailable (502): upstream_unavailable",
      );

const removed = (key: string) =>
  z
    .never(`reasoning-router: ${key} was removed; configure wrap instead`)
    .optional();

const wrapRefs = (group: Provider) => {
  const array = `reasoning-router: wrap.${group} must be a nonempty array of provider/model refs`;
  const ref = `reasoning-router: wrap.${group} requires provider/model refs from another provider`;
  return z
    .array(
      z
        .string(ref)
        .regex(/^[^/\s]+\/[^/\s]+$/, ref)
        .refine((value) => !value.startsWith(`${PROVIDER_ID}/`), ref),
      array,
    )
    .min(1, array)
    .optional();
};

const WRAP =
  "reasoning-router: wrap must be a nonempty object of openai/anthropic model refs";

const wrapOptionsSchema = z.object({
  upstreamBaseURL: removed("upstreamBaseURL"),
  upstreamApiKey: removed("upstreamApiKey"),
  anthropicUpstreamBaseURL: removed("anthropicUpstreamBaseURL"),
  anthropicUpstreamApiKey: removed("anthropicUpstreamApiKey"),
  wrap: z
    .strictObject(
      { openai: wrapRefs("openai"), anthropic: wrapRefs("anthropic") },
      {
        error: (issue) =>
          issue.code === "unrecognized_keys"
            ? `reasoning-router: unknown wrap group ${issue.keys.join(", ")}`
            : WRAP,
      },
    )
    .refine((wrap) => wrap.openai || wrap.anthropic, WRAP),
});

function parseWrap(
  options: unknown,
): { group: Provider; providerID: string; modelID: string; ref: string }[] {
  const { wrap } = parseConfig(wrapOptionsSchema, options);
  return (["openai", "anthropic"] as const).flatMap((group) =>
    (wrap[group] ?? []).map((ref) => {
      const slash = ref.indexOf("/");
      return {
        group,
        providerID: ref.slice(0, slash),
        modelID: ref.slice(slash + 1),
        ref,
      };
    }),
  );
}

export async function setupV2(ctx: Host): Promise<() => void> {
  const refs = parseWrap(ctx.options);
  const runtime = createPluginRuntime(ctx.options);
  const exchanges = new WeakMap<Request, Exchange>();
  let aliases = new Map<string, Alias>();
  let validationError: string | undefined;

  await ctx.provider.transform((editor) => {
    const models = [...new Set(refs.map((ref) => ref.group))].flatMap((group) =>
      modelsFor(group).map(
        (profile): ModelInput => ({
          id: toID<ModelID>(profile.id),
          modelID: toID<ModelID>(profile.id),
          providerID: toID<ProviderID>(PROVIDER_ID),
          name: profile.name,
          package: PACKAGES[group],
          settings: { baseURL: "http://127.0.0.1:1/v1" },
          capabilities: {
            tools: true,
            input: ["text", "image"],
            output: ["text"],
          },
          variants: [],
          time: { released: 0 },
          cost: [],
          status: "active",
          enabled: true,
          limit: { context: 200_000, output: 32_000 },
        }),
      ),
    );
    editor.add({
      info: {
        id: toID<ProviderID>(PROVIDER_ID),
        name: "Reasoning Router",
        activation: "enabled",
        package: PROVIDER_PACKAGE,
        settings: { transport: "http" },
      },
      models,
    });
  });

  await ctx.model.transform((editor) => {
    const next = new Map<string, Alias>();
    const errors: string[] = [];
    for (const { group, providerID, modelID, ref } of refs) {
      const source = editor.get(providerID, modelID);
      const provider = editor.provider.get(providerID)?.provider;
      const apiID = source?.modelID ?? source?.id ?? modelID;
      const profile = MODELS.find(
        (model) => model.id === apiID && model.provider === group,
      );
      const sourcePackage = source?.package ?? provider?.package;
      const supported =
        group === "openai"
          ? sourcePackage === PROVIDER_PACKAGE ||
            sourcePackage === "@opencode/ai/providers/openai"
          : sourcePackage === PACKAGES[group];
      const error =
        !source || !provider
          ? `reasoning-router: source model ${ref} not found; check wrap`
          : !profile
            ? `reasoning-router: ${ref} API model ${apiID} is not a registered ${group} profile`
            : !supported
              ? `reasoning-router: ${ref} requires package ${PACKAGES[group]}${group === "openai" ? " or @opencode/ai/providers/openai" : ""}`
              : next.has(profile.id)
                ? `reasoning-router: duplicate wrap profile ${profile.id}`
                : undefined;
      if (error) errors.push(error);
      if (!profile) continue;
      const id = profile.id;
      if (next.has(id)) continue;
      next.set(id, {
        group,
        providerID,
        integrationID: provider?.integrationID ?? providerID,
        authHeader: group === "openai" ? "authorization" : "x-api-key",
      });
      if (error) continue;
      const resolved = provider!;
      const settings = { ...resolved.settings, ...source!.settings };
      delete settings.transport;
      editor.update(PROVIDER_ID, id, (alias) =>
        Object.assign(alias, {
          ...source,
          id,
          modelID: apiID,
          providerID: PROVIDER_ID,
          package: source!.package ?? resolved.package,
          name: profile!.name,
          transport: "http",
          settings,
          headers: { ...resolved.headers, ...source!.headers },
          body: { ...resolved.body, ...source!.body },
          variants: [],
        }),
      );
    }
    if (!errors.length)
      for (const profile of MODELS)
        if (!next.has(profile.id)) editor.remove(PROVIDER_ID, profile.id);
    aliases = next;
    validationError = errors.length ? errors.join("; ") : undefined;
  });

  const onRequest = async (event: SessionHttpRequest) => {
    if (validationError) throw new Error(validationError);
    const alias = aliases.get(event.model.id);
    if (!alias)
      throw new Error(
        `reasoning-router: alias ${event.model.id} is not configured in wrap`,
      );
    const incoming = event.request;
    const authHeader = alias.authHeader;
    if (!incoming.headers.get(authHeader)) {
      const connection = await ctx.integration.connection.active(
        alias.integrationID,
      );
      const credential =
        connection && (await ctx.integration.connection.resolve(connection));
      if (credential?.type === "oauth")
        throw new Error(
          `reasoning-router: ${alias.providerID} uses OAuth, which wrap does not support yet; use an API key`,
        );
      if (credential?.type === "key")
        incoming.headers.set(
          authHeader,
          alias.group === "openai"
            ? `Bearer ${credential.key}`
            : credential.key,
        );
    }
    if (!incoming.headers.get(authHeader))
      throw new Error(
        `reasoning-router: ${alias.providerID} has no API key; configure a source provider API key`,
      );
    if (event.kind !== "primary") return;
    const pathname = new URL(incoming.url).pathname;
    if (
      !pathname.endsWith(alias.group === "openai" ? "/responses" : "/messages")
    )
      throw new Error(
        `reasoning-router invalid_request (400): alias requires ${alias.group === "openai" ? "/responses" : "/messages"}`,
      );
    let exchange: Exchange;
    try {
      exchange = await runtime.start(
        incoming,
        { session: valid(event.sessionID, SESSION), turnId: randomUUID() },
        alias.group,
      );
    } catch (cause) {
      throw rejection(cause);
    }
    const outgoing = new Headers(exchange.headers);
    outgoing.delete("content-length");
    const request = new Request(exchange.url, {
      method: "POST",
      headers: outgoing,
      body: exchange.body,
      signal: exchange.signal,
      ...(alias.group === "anthropic" ? { redirect: "manual" as const } : {}),
    });
    incoming.signal.addEventListener("abort", () => exchange.cancel(), {
      once: true,
    });
    exchanges.set(request, exchange);
    event.request = request;
  };

  const onResponse = (event: SessionHttpResponse) => {
    const exchange = exchanges.get(event.request);
    if (exchange === undefined) return;
    exchanges.delete(event.request);
    try {
      event.response = exchange.respond(event.response);
    } catch (cause) {
      throw rejection(cause);
    }
  };
  await ctx.session.hook("http.request", onRequest, {
    providerID: PROVIDER_ID,
  });
  await ctx.session.hook("http.response", onResponse, {
    providerID: PROVIDER_ID,
  });
  try {
    await ctx.session.hook(
      "experimental.ws.handshake",
      () => {
        throw new Error(
          'reasoning-router requires transport: http; remove providers["reasoning-router"].settings.transport',
        );
      },
      { providerID: PROVIDER_ID },
    );
  } catch {
    /* Older hosts may not expose the experimental hook. */
  }

  return () => runtime.dispose();
}
