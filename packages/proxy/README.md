# @reasoning-router/proxy

A standalone HTTP proxy that asks a classifier how much reasoning each request
needs, then applies that effort to the outgoing Responses (`POST
/v1/responses`) or Anthropic Messages (`POST /v1/messages`) request without
breaking the prompt cache. Requires Node.js 24.x.

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
npx @reasoning-router/proxy
curl --fail http://127.0.0.1:4320/ready
```

Run `reasoning-router --help` for every variable. See
[`.env.example`](../../.env.example) for defaults,
[`docs/environment.md`](../../docs/environment.md) for the classifier settings,
and [`docs/behavior.md`](../../docs/behavior.md) for probes, shutdown, limits,
and forwarding.

## License

[MIT](LICENSE)
