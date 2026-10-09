---
name: add-classifier
description: Add a new reasoning-effort classifier (decision model) to reasoning-router as a preset in @reasoning-router/classifiers, wired through the registry, tests, docs, env examples, proxy help, and a changeset. Use whenever the task is to support, integrate, or add a classifier or decision-model provider (for example "add a classifier for <service>", "support <model> as a decision model", "make X selectable via classifier.provider" or REASONING_ROUTER_CLASSIFIER), even if the user doesn't say "preset" or name this skill. Not for changing classification policy (retries, fallback) or adding a harness.
---

# Add a classifier

A classifier is a preset in `packages/classifiers`, selected by name through
`classifier.provider` (plugin) or `REASONING_ROUTER_CLASSIFIER` (proxy and Pi).

This skill is guidance, not a template. The steps describe how the existing
presets (Jev, Clef, Laya) were built, and those all happen to speak some form
of the System One API with similar settings. A new classifier may not: it may
take different settings, authenticate differently, ask a different question,
or answer in a different shape. Treat the repo rules below as fixed, and the
steps as a starting point to adapt. When a step doesn't fit, follow its
purpose rather than its letter, and say in your summary where and why you
departed from it.

## Repo rules

These come from `AGENTS.md` and `docs/architecture.md` and apply to every
classifier.

- **No new package.** Add the preset to `packages/classifiers`. Core stays
  provider-neutral; put no provider-specific code or dependency in
  `packages/core`.
- **HTTP only.** Reach the classifier with the injected `fetch`. If it runs a
  local model, it is a server the user runs. Never install, download, load,
  or start a model, its weights, or its runtime, and add no runtime
  dependency.
- **Protect the credential and the conversation summary.** Constrain where
  the request can go: Jev allows only its known endpoints, and Laya allows
  HTTPS or plain HTTP to loopback only, with no credentials, query, or
  fragment in the URL. Don't accept an arbitrary base URL alongside an API
  key.
- **Use a distinct provider name**, even if the wire protocol matches an
  existing preset. The name identifies the service in decision logs.
- **Smallest change that works.** Core already handles deadlines, retries,
  and fallback; don't reimplement them. Add no setting without a current
  requirement.

If this skill and those files disagree, the files win.

## When a classifier doesn't fit

The real contract is the `Classifier` and `ClassifierProvider` interfaces in
`packages/core/src/classifier.ts`, not the shape of the existing presets.
Whatever the service looks like, the preset must produce one of the target
model's supported efforts from the bounded state core passes in, and report
failures in a way core can categorize and retry. Some ways a classifier might
differ, and how to approach them:

- **Different settings.** Prefer mapping onto the shared
  `REASONING_ROUTER_CLASSIFIER*` settings (`apiKey`, `baseUrl`, `accountId`,
  `model`, `timeoutMs`). If the service truly needs another one, note that
  core's `ClassifierConfig` already passes extra fields through to the preset
  from the plugin's `classifier` option, but the proxy and Pi read only the
  variables mapped in `packages/classifiers/src/env.ts`. A new setting means
  a new variable there, plus docs; propose it before building it.
- **Different auth or endpoint.** Keep the credential safe: send it only to
  hosts the preset can vouch for.
- **A different question or answer.** For example, scores or probabilities
  instead of a single choice. Translate them into one supported effort inside
  the preset, and document how.
- **Something the interface can't express**, such as needing more of the
  conversation than the bounded state, or a streaming or multi-call protocol.
  Stop and raise it with the user instead of bending core or the state to fit
  one provider.

## Typical steps

### 1. Pick the wire contract

Read `packages/classifiers/src/systemone.ts`. `createSystemOneClassifier`
already limits choices to the target model's supported efforts, refuses
redirects, discards error bodies, categorizes errors, and honors
`Retry-After`. Reuse it when the service fits:

- **Same System One API** (`state` and `questions` in, `answers.effort.choice`
  out): pass the URL, key, and model, as `laya.ts` does.
- **System One inside a provider envelope**: also pass `unwrap` to extract
  the System One response, as `clef.ts` does for Workers AI's
  `{ result, success, errors, messages }`.
- **A different contract**: translate the request and response in the new
  preset's file, keeping the same behaviors. Offer only the model's supported
  efforts, throw `ClassifierRequestError` with a category, never surface
  response bodies or credentials in errors, and treat an unsupported answer as
  invalid output.

### 2. Write `packages/classifiers/src/<name>.ts`

`laya.ts` is the simplest model. Its shape is a convention, not a
requirement; only the exported `ClassifierProvider` is required:

- a Zod connection schema validated with core's `parseConfig`, so every
  problem is reported in one error, with blank optional strings treated as
  unset;
- `resolve<Name>Connection(config)`;
- `create<Name>Transport(connection & { fetch?: Fetch })` returning a
  `Classifier`;
- the provider object:

```ts
/** Selected by `classifier: { provider: "<name>", ... }`. */
export const <name>ClassifierProvider: ClassifierProvider = {
  name: "<name>",
  create(config: ClassifierConfig): Classifier {
    return create<Name>Transport(resolve<Name>Connection(config));
  },
};
```

No type assertions: Biome rejects them (`as const` is the only exception).

### 3. Register it in `packages/classifiers/src/index.ts`

Export the provider, transport, resolver, and connection type, and append the
provider to `classifierProviders`. That array is what
`createConfiguredSelector` searches by name.

### 4. Test it in `packages/classifiers/test/<name>.test.ts`

Model it on `laya.test.ts`, or on `clef.test.ts` for an envelope.
Inject a fake `fetch` that records the URL and `init`. Cover whichever of
these apply, plus anything specific to the new contract:

- the request: URL, headers (including the key only when set), and a body
  that offers only the target model's supported efforts and omits unset
  optional fields;
- a valid answer, and an unsupported or malformed answer (fallback);
- HTTP error categories, a network error, and `Retry-After`;
- config: defaults, every accepted value, and every rejected base URL or
  missing required field;
- selection through `createConfiguredSelector({ provider: "<name>" },
  classifierProviders, {})`.

Also update tests that list every provider name, such as the list in
`clef.test.ts`; step 6 finds them.

### 5. Update the docs and examples

These are the places that currently describe each classifier. Document the
settings the new one actually uses; if it has setup steps (an account, a
server to run), describe those the way the README's Laya section does.

- `packages/classifiers/README.md`: a section with a settings table.
- Root `README.md`: a setup subsection under "Classifiers" and the provider
  list in the package description.
- `docs/environment.md`: the `REASONING_ROUTER_CLASSIFIER` value list and
  what each shared variable means for this provider.
- `.env.example`: the provider list and per-provider comments.
- `packages/proxy/src/index.ts`: the `--help` text.
- `packages/opencode/README.md` and `packages/pi/README.md`: the provider
  lists in their settings tables.
- `packages/classifiers/package.json`: the description and `keywords`.
- The `README_CN.md` and `README_JA.md` beside every README edited above:
  make the same change in Chinese and Japanese.

### 6. Sweep for missed spots

The existing names are the checklist. Every hit that lists them should now
include the new one:

```bash
rg -n -i 'laya|clef' --glob '!**/CHANGELOG.md' --glob '!package-lock.json' --glob '!.agents/**'
```

Not every hit is a list. Tests that exercise one provider end to end (for
example the Clef cases in `packages/classifiers/test/env.test.ts`,
`packages/opencode/test/plugin-v2.test.ts`, and
`packages/pi/test/config.test.ts`), research notes in `docs/harnesses/`, and
`docs/proposals/<provider>.md` describe a single provider; leave them alone.
Update `AGENTS.md` and `docs/architecture.md` only where a provider list
becomes stale.

### 7. Add a changeset

Create `.changeset/<short-name>.md`. The classifiers package gets `minor`,
because a new preset is a new feature. Bump other packages only if their
published behavior changed, for example the proxy's help text (`patch`).

```md
---
"@reasoning-router/classifiers": minor
---

Add the <Name> classifier (`provider: "<name>"`), ...
```

Don't run `npm publish` or `changeset publish`; releases go through the
release workflow.

### 8. Verify

Run from the repo root on Node 24:

- `npm run check` (typecheck, Biome, Vitest) must pass.
- `npm run smoke:package` packs, installs, and runs the packages.

Report the commands you ran and their results. If you couldn't call the real
service, say so; fake-`fetch` tests prove the contract you assumed, not that
the service accepts it.
