# Router environment namespace

The standalone proxy (`@reasoning-router/proxy`, command `reasoning-router`) reads only `REASONING_ROUTER_*`
variables; `.env.example` lists the supported names. The `JEV_ROUTER_*`,
`JEV_API_KEY`, and `JEV_BASE_URL` names used by `opencode-jev-router` are not
carried over. `TYPESAFE_API_KEY`, `JEV_ROUTER_API_KEY`, and
`JEV_ROUTER_BASE_URL` are rejected at startup with a message naming the
replacement.

## Classifier

| Variable | Default | Purpose |
| --- | --- | --- |
| `REASONING_ROUTER_CLASSIFIER` | `jev` | Classifier provider: `jev`, `clef`, `laya`, `kev`, `openai-decisions`, or `clm`. |
| `REASONING_ROUTER_CLASSIFIER_API_KEY` | none | Classifier credential. Required for `jev`, `clef`, and `openai-decisions`; optional for `laya`, `kev`, and `clm`. |
| `REASONING_ROUTER_CLASSIFIER_BASE_URL` | provider default | Jev endpoint, the Laya server (default `http://127.0.0.1:8000`), the Kev server (default `http://127.0.0.1:8008`), an OpenAI regional endpoint, or the CLM server (default `http://127.0.0.1:8700`). Ignored by `clef`. |
| `REASONING_ROUTER_CLASSIFIER_ACCOUNT_ID` | none | Clef: Cloudflare account ID. Required for `clef`. |
| `REASONING_ROUTER_CLASSIFIER_MODEL` | none | Clef: `clef` or `clef-flash`. Required for `clef`. Laya: optional checkpoint. Kev: optional, echoed only. OpenAI Decisions: `gpt-6-luna`. CLM: optional head, server default `clm-latest`. |
| `REASONING_ROUTER_CLASSIFICATION_TIMEOUT_MS` | `4000` | Total classification budget, including retries. |

For `jev`, the key is a TypeSafe credential when the base URL is omitted
(default `https://api.typesafe.ai`). A Vercel Gateway credential also requires
`REASONING_ROUTER_CLASSIFIER_BASE_URL=https://ai-gateway.vercel.sh/typesafe`.
No key inspection or automatic endpoint detection occurs.

For `clef`, the key is a Cloudflare API token with Workers AI permissions,
used with the account ID to call Workers AI
(`https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/run/@cf/cloudflare/{model}`).

For `laya`, the router calls a Laya server that you run, such as `laya-serve`,
at `{baseUrl}/v1/systemone`. The base URL must be HTTPS, or plain HTTP to a
loopback host (`localhost`, `127.0.0.0/8`, `[::1]`). Set the key only when
the server sets `LAYA_API_KEY`; it is sent as a bearer token, and a blank key
counts as unset. `model` selects a checkpoint (`english`, `multilingual`,
`typed-decisions`); when unset, the server chooses by the language of the
state.

For `kev`, the router calls a `kev.serve` server that you run, at
`{baseUrl}/v1/systemone`, with the same base URL and key rules as `laya`.
Set the key only when the server sets `KEV_API_KEY`. The checkpoint is
chosen when the server starts (`--run`); `model` is only echoed back. See
[proposals/kev.md](proposals/kev.md).

For `openai-decisions`, the key is an OpenAI API key with Decisions access,
used at `{baseUrl}/decisions`. The base URL defaults to
`https://api.openai.com/v1`; `https://us.api.openai.com/v1` and
`https://eu.api.openai.com/v1` select OpenAI regional processing, and no
other value is accepted. `model` is the classifier model, `gpt-6-luna` (the
default and only value), not the model being routed. See
[the classifiers README](../packages/classifiers/README.md) for the beta,
privacy, and cost notes.

For `clm`, the router calls a `clm-serve` server that you run, at
`{baseUrl}/v1/systemone`, with the same base URL and key rules as `laya`. The
base URL defaults to `http://127.0.0.1:8700`. Set the key only when the
server sets `CLM_API_KEY`. `model` is optional and selects the CLM head: when
unset the server uses `clm-latest`, and `clm-raw` or a head loaded with
`--model NAME=PATH` is also accepted. `clm-serve` needs a separate pooling
backend (Qwen3-8B embeddings) that you also run. See
[CLM findings](classifiers/clm.md).

The OpenCode plugin takes the same settings as its `classifier` option
(`provider`, `apiKey`, `baseUrl`, `accountId`, `model`, `timeoutMs`). Each
omitted setting except `timeoutMs` falls back to its environment variable
above. Empty `REASONING_ROUTER_CLASSIFIER_ACCOUNT_ID` and
`REASONING_ROUTER_CLASSIFIER_MODEL` values count as unset. `jev` accepts a
`model` only when it matches its endpoint's model, so unset
`REASONING_ROUTER_CLASSIFIER_MODEL` when switching from `clef` to `jev`.

## Anthropic upstream

The optional `POST /v1/messages` route needs
`REASONING_ROUTER_ANTHROPIC_UPSTREAM_BASE_URL` (for example
`https://api.anthropic.com/v1`); without it the route returns 404. In
`REASONING_ROUTER_UPSTREAM_AUTH=bearer` mode also set
`REASONING_ROUTER_ANTHROPIC_UPSTREAM_API_KEY` (sent as `x-api-key`). In `forward`
mode only a loopback Anthropic upstream is allowed; client `x-api-key` and/or
`authorization` are forwarded. The plugin instead wraps an existing Anthropic
model via `wrap.anthropic` and reuses its provider's route and key.

## Migrating from opencode-jev-router

| opencode-jev-router | reasoning-router |
| --- | --- |
| `JEV_API_KEY` | `REASONING_ROUTER_CLASSIFIER_API_KEY` |
| `JEV_BASE_URL` | `REASONING_ROUTER_CLASSIFIER_BASE_URL` |
| `JEV_ROUTER_<NAME>` | `REASONING_ROUTER_<NAME>` |
| plugin `jevApiKey`, `jevBaseUrl`, `jevTimeoutMs` | plugin `classifier.apiKey`, `classifier.baseUrl`, `classifier.timeoutMs` |
