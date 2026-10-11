# @reasoning-router/proxy

English | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md)

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

Start the proxy as above, then create a Codex profile at
`~/.codex/reasoning-router.config.toml`. It keeps the model name and changes only the
provider, so your default Codex setup is untouched:

```toml
model = "gpt-6-astra"
model_provider = "reasoning-router"

[model_providers.reasoning-router]
name = "reasoning-router"
base_url = "http://127.0.0.1:4320/v1"
wire_api = "responses"
```

Run `codex -p reasoning-router` to route through the proxy; plain `codex` is
unchanged. `-p` names the profile file, not the provider; both are called
`reasoning-router` here. The profile is not tied to one model: pick another
with `-m`, for example `codex -p reasoning-router -m gpt-6-sol`. Profiles (`-p`) need Codex 0.161.0 or later. On older versions, put
the same lines in `~/.codex/config.toml` instead.

Codex sends no credential; the proxy adds
`REASONING_ROUTER_UPSTREAM_API_KEY` (`REASONING_ROUTER_UPSTREAM_AUTH=bearer`).
Leave `supports_websockets` unset, since the proxy serves HTTP only.

- Keep the real model ID. Codex reads model metadata by name, and the proxy
  has no aliases, so a made-up name like `astra-rr` would get generic
  metadata from Codex and a local `400` from the proxy.
- Use `gpt-6-astra`, `gpt-6-luna`, `gpt-6-sol`, or `gpt-6.1-sol`. Other models
  get a local `400`.
- The classifier picks the effort. Codex's `model_reasoning_effort` and
  `/model` effort are ignored, though Codex still displays them.
- The proxy closes an upstream stream after 60 seconds without data. Raise
  `REASONING_ROUTER_UPSTREAM_IDLE_TIMEOUT_MS` if long turns are cut off.

### ChatGPT subscription through CLIProxyAPI

The proxy cannot use a ChatGPT login directly. To use a subscription, run
[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) with a Codex login
and put it behind the proxy:

```text
codex -p reasoning-router → reasoning-router (127.0.0.1:4320) → CLIProxyAPI (127.0.0.1:8317) → ChatGPT
```

Start the proxy in `forward` mode against CLIProxyAPI, with no upstream key:

```dotenv
REASONING_ROUTER_UPSTREAM_BASE_URL=http://127.0.0.1:8317/v1
REASONING_ROUTER_UPSTREAM_AUTH=forward
```

Then add `env_key` to the profile's provider block so Codex sends your
CLIProxyAPI client key, which the proxy forwards unchanged:

```toml
env_key = "CLIPROXY_KEY"   # environment variable holding a CLIProxyAPI api-key
```

CLIProxyAPI passes `configuration_update` through for GPT-6 models on Codex
Plus, Pro, and Team plans; on the Free plan it strips it for every model
except `gpt-6-luna`, so routing has no effect there. Verified with Codex
0.161.0 and CLIProxyAPI 8.0.23: the backend accepted effort changes and kept
the prompt cache across them.

See [`docs/harnesses/codex.md`](../../docs/harnesses/codex.md) for details.

## License

[MIT](LICENSE)
