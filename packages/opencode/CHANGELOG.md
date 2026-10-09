# @reasoning-router/opencode

## 0.1.6

### Patch Changes

- ebb839b: Raise the default request-body limit (`maxRequestBytes` and `REASONING_ROUTER_MAX_REQUEST_BYTES`) from 1 MiB to 32 MiB. Agent sessions that read several images exceeded 1 MiB and failed with `413 request_too_large` before reaching the provider.

## 0.1.5

### Patch Changes

- Updated dependencies [42f6f60]
  - @reasoning-router/classifiers@0.4.0

## 0.1.4

### Patch Changes

- Updated dependencies [7adde1f]
  - @reasoning-router/classifiers@0.3.0

## 0.1.3

### Patch Changes

- Updated dependencies [0aebbf3]
  - @reasoning-router/classifiers@0.2.0

## 0.1.2

### Patch Changes

- Updated dependencies [ef8932a]
  - @reasoning-router/core@0.2.0
  - @reasoning-router/classifiers@0.1.1

## 0.1.1

### Patch Changes

- 538a874: Log the caller's `x-reasoning-router-turn-id` (or `x-opencode-turn-id`) header as `turn_id` on primary requests, falling back to a random UUID only when the header is missing or not a UUID.

## 0.1.0

### Minor Changes

- 5c88c18: Initial alpha release.

### Patch Changes

- Updated dependencies [5c88c18]
  - @reasoning-router/core@0.1.0
  - @reasoning-router/classifiers@0.1.0
