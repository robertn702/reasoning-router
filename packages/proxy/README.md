# @reasoning-router/proxy

English | [简体中文](README_CN.md) | [日本語](README_JA.md)

A standalone HTTP proxy that asks a classifier how much reasoning each request
needs, then applies that effort to the outgoing Responses (`POST
/v1/responses`) or Anthropic Messages (`POST /v1/messages`) request without
breaking the prompt cache. Requires Node.js 24.x.

> **Alpha.** For trusted local use only; read the
> [trust model](#trust-model) first.

## Install

```bash
npm install -g @reasoning-router/proxy   # installs the reasoning-router command
```

Or run it without installing: `npx @reasoning-router/proxy`.

## Usage

Create a `.env` in the directory you run from (or export the variables):

```dotenv
REASONING_ROUTER_CLASSIFIER_API_KEY=your-jev-key
# REASONING_ROUTER_CLASSIFIER_BASE_URL=https://ai-gateway.vercel.sh/typesafe   # Vercel keys only
REASONING_ROUTER_UPSTREAM_BASE_URL=https://api.openai.com/v1
REASONING_ROUTER_UPSTREAM_AUTH=bearer
REASONING_ROUTER_UPSTREAM_API_KEY=your-endpoint-key
```

Then start it and point your client at `http://127.0.0.1:4320/v1`:

```bash
reasoning-router
curl --fail http://127.0.0.1:4320/ready
```

Run `reasoning-router --help` for every variable. See
[`.env.example`](../../.env.example) for defaults,
[`docs/environment.md`](../../docs/environment.md) for the classifier settings,
and [`docs/behavior.md`](../../docs/behavior.md) for probes, shutdown, limits,
and forwarding.

## Trust model

The proxy is for a single trusted machine. It listens only on `127.0.0.1`
and has no caller authentication: any local process that can reach the port
can send requests, and with `REASONING_ROUTER_UPSTREAM_AUTH=bearer` those
requests use your configured upstream key.

Every request must carry a `Host` of `127.0.0.1:<port>` or `localhost:<port>`
for the port the proxy listens on; anything else gets a `400` before the body
is read, classified, or forwarded. This blocks DNS-rebinding attacks from web
pages. It is not authentication, and it does not stop a web page from sending
requests to `http://127.0.0.1:<port>` directly. Do not expose the port
through a tunnel or reverse proxy; a forward or container mapping to a
different port also gets `400 invalid_host`.

## Codex CLI

Start the proxy as above, then add a custom provider to
`~/.codex/config.toml`:

```toml
model = "gpt-6.1-sol"
model_provider = "reasoning-router"

[model_providers.reasoning-router]
name = "reasoning-router"
base_url = "http://127.0.0.1:4320/v1"
wire_api = "responses"
```

Codex sends no credential; the proxy adds
`REASONING_ROUTER_UPSTREAM_API_KEY` (`REASONING_ROUTER_UPSTREAM_AUTH=bearer`).
Leave `supports_websockets` unset, since the proxy serves HTTP only.

- Only OpenAI API keys work. ChatGPT-subscription login is not supported.
- Use `gpt-6-astra`, `gpt-6-luna`, `gpt-6-sol`, or `gpt-6.1-sol`. Other models
  get a local `400`.
- The classifier picks the effort. Codex's `model_reasoning_effort` and
  `/model` effort are ignored, though Codex still displays them.
- Codex 0.159.0 does not know `gpt-6.1-sol` and runs it with generic metadata
  unless you supply `model_catalog_json`.
- The proxy closes an upstream stream after 60 seconds without data. Raise
  `REASONING_ROUTER_UPSTREAM_IDLE_TIMEOUT_MS` if long turns are cut off.

See [`docs/harnesses/codex.md`](../../docs/harnesses/codex.md) for details.

## License

[MIT](LICENSE)
