# @reasoning-router/core

## 0.3.1

### Patch Changes

- f342ad8: Register `gpt-6.2-sol` (efforts low through max, base effort medium), so the OpenCode plugin and the proxy accept it on `/v1/responses` instead of returning a local `400`.

## 0.3.0

### Minor Changes

- e723936: Decision events now record the classifier model as `classifier_model` (the model the preset requested, omitted when the server chooses), alongside `classifier`.

## 0.2.0

### Minor Changes

- ef8932a: Remove `ModelProfile.fallbackEffort`. It was always `medium` and never chose the effort when classification failed; the classification policy's `fallbackEffort` (default `high`) does.

## 0.1.0

### Minor Changes

- 5c88c18: Initial alpha release.
