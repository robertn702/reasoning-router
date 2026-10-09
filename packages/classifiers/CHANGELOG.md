# @reasoning-router/classifiers

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
