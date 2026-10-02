# reasoning-router

Harness-agnostic adaptive reasoning effort for coding agents.

> **Status: pre-alpha.** This repository is workspace scaffolding only. It
> contains no packages and nothing is published to npm yet.

## Intent

[`opencode-jev-router`](https://github.com/robertn702/opencode-jev-router) asks
[Jev](https://typesafe.ai/) how much reasoning each step of an OpenCode session
needs, then applies that effort to the outgoing model request without breaking
the prompt cache. It works, but only inside OpenCode (or behind its standalone
proxy).

`reasoning-router` generalizes that idea in two directions:

- **Any classifier.** Jev is one of several decision models that can classify
  how much reasoning a step needs, and more are being released. Which
  classifier to use is configuration, not a dependency: `reasoning-router`
  must not depend on Jev or any single provider.
- **Any harness.** The same routing should run inside other agent harnesses,
  not only OpenCode.

The first packages, planned but not yet created, are:

- `@reasoning-router/core`: the shared, harness- and classifier-independent
  router.
- `@reasoning-router/opencode`: the OpenCode plugin.
- `@reasoning-router/classifier-jev`: the Jev classifier.

See [docs/architecture.md](docs/architecture.md) for the problem statement,
the package plan, and the open questions.

## Development

Requires Node.js 24.x.

```bash
npm ci
npm run check   # typecheck + lint + test
```

See [AGENTS.md](AGENTS.md) for the full command list and repo conventions.

## Decisions so far

These are reversible and can be revisited once the first package exists:

- **npm workspaces** (`packages/*`), with no packages yet.
- **Node 24, TypeScript, Vitest**, matching `opencode-jev-router`.
- **Biome** for lint and format. `opencode-jev-router` has no linter or
  formatter; Biome covers both with one dev dependency and no plugins.
- **Release tooling deferred.** Changesets (or similar) will be added with the
  first publishable package.

## License

[MIT](LICENSE)
