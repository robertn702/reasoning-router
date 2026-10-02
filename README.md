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

- **Any decision model.** Jev is one of several models that decide how much
  reasoning a step needs, and more are being released. Which decision model
  to use is configuration, not a dependency: `reasoning-router` must not
  depend on Jev or any single provider.
- **Any harness.** The same routing should run inside other agent harnesses,
  not only OpenCode.

The plan is to publish several packages from this
monorepo under the `@reasoning-router` npm scope, such as a shared core plus
one adapter per harness. Package names and boundaries are **not decided yet**;
see [docs/architecture.md](docs/architecture.md) for the problem statement and
the open questions that must be answered first.

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
