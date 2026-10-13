# @reasoning-router/classifiers

## 0.6.0

### Minor Changes

- aec682a: Add the SGLang classifier (`provider: "sglang"`), which calls an SGLang server you run at `{baseUrl}/v1/systemone` (default `http://127.0.0.1:30000`) with an optional bearer key. SGLang requires a `model` it otherwise ignores, so an unset `model` is sent as `default`. Only API compatibility is verified, against SGLang v0.5.21's source with mocked tests; effort-decision quality is unvalidated.

## 0.5.0

### Minor Changes

- 1c449e2: Accept `clef-omni` as a Clef `model`, alongside `clef` and `clef-flash`. It calls `@cf/cloudflare/clef-omni` on Workers AI with the same request and envelope.
- a359865: Add the Liquid d1 classifier (`provider: "liquid"`), which calls Liquid AI's d1 decision model with the System One request at Liquid's API (`https://api.liquid.ai/decisions/v1/systemone`, the default; model `d1` or `d1:free`) or Vercel AI Gateway (`baseUrl: "https://ai-gateway.vercel.sh/typesafe"`; model `liquid/d1`). `apiKey` is required.
- dbdc499: Add the Microsoft-Decision-1 classifier (`provider: "microsoft-decision"`), which calls a Microsoft Foundry deployment at `{baseUrl}/providers/microsoft/v1/systemone` with the System One request. `baseUrl` (the HTTPS resource endpoint), `apiKey` (sent in an `api-key` header), and `model` (the deployment name) are required.

## 0.4.0

### Minor Changes

- 42f6f60: Add the CLM classifier (`provider: "clm"`), which calls a `clm-serve` server you run at `{baseUrl}/v1/systemone` (default `http://127.0.0.1:8700`), with Laya's connection rules. The optional `model` selects the CLM head (`clm-latest` by default). The proxy's `--help` text lists it.

## 0.3.0

### Minor Changes

- 7adde1f: Add the OpenAI Decisions classifier (`provider: "openai-decisions"`), which calls OpenAI's public-beta `POST /v1/decisions` with model `gpt-6-luna`. Base URLs are limited to the global, `us.`, and `eu.` OpenAI API roots. The proxy's `--help` lists the new provider.

## 0.2.0

### Minor Changes

- 0aebbf3: Add the Kev classifier (`provider: "kev"`), which calls a `kev.serve` server you run at `{baseUrl}/v1/systemone` (default `http://127.0.0.1:8008`), with Laya's connection rules. The proxy's `--help` text lists it.

## 0.1.1

### Patch Changes

- Updated dependencies [ef8932a]
  - @reasoning-router/core@0.2.0

## 0.1.0

### Minor Changes

- 5c88c18: Initial alpha release.

### Patch Changes

- Updated dependencies [5c88c18]
  - @reasoning-router/core@0.1.0
