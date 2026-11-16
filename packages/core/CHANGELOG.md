# @reasoning-router/core

## 0.3.0

### Minor Changes

- e723936: Decision events now record the classifier model as `classifier_model` (the model the preset requested, omitted when the server chooses), alongside `classifier`.

## 0.2.0

### Minor Changes

- ef8932a: Remove `ModelProfile.fallbackEffort`. It was always `medium` and never chose the effort when classification failed; the classification policy's `fallbackEffort` (default `high`) does.

## 0.1.0

### Minor Changes

- 5c88c18: Initial alpha release.
