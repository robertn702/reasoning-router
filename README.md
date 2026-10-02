# reasoning-router

Harness-agnostic adaptive reasoning effort for coding agents.

> **Status: pre-alpha.** The packages below are a port of
> `opencode-jev-router`. Nothing is published to npm yet.

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

The packages are:

- [`@reasoning-router/core`](packages/core): the shared, harness- and
  classifier-independent router.
- [`@reasoning-router/opencode`](packages/opencode): the OpenCode V2 plugin.
- [`@reasoning-router/classifiers`](packages/classifiers): the
  classifiers (Jev and Cloudflare Clef), selected by `classifier.provider`.
- [`@reasoning-router/proxy`](packages/proxy): the standalone
  Responses/Messages proxy (command `reasoning-router`).

See [docs/architecture.md](docs/architecture.md) for the problem statement,
the package plan, and the open questions, and
[docs/behavior.md](docs/behavior.md) for the router's wire behavior.

## Development

Requires Node.js 24.x.

```bash
npm ci
npm run check   # typecheck + lint + test
```

See [AGENTS.md](AGENTS.md) for the full command list and repo conventions.

## Decisions so far

These are reversible:

- **npm workspaces** (`packages/*`).
- **Node 24, TypeScript, Vitest**, matching `opencode-jev-router`.
- **Biome** for lint and format. `opencode-jev-router` has no linter or
  formatter; Biome covers both with one dev dependency and no plugins.
  `noNonNullAssertion` is off, and `noExplicitAny` is off in tests, to keep
  ported code close to its source.
- **Source condition.** Package `exports` map the custom
  `@reasoning-router/source` condition to `src/*.ts`, so typecheck and tests
  run against source without a build; published consumers get `dist/`.
- **Changesets** with independent versions and no publish workflow. No
  changesets are recorded until the packages are first released.
- **The standalone proxy is its own package** (`@reasoning-router/proxy`,
  command `reasoning-router`), since it needs a classifier and core must not
  depend on one. The unscoped `reasoning-router` name stays free for a future
  umbrella CLI.
- **Zod for configuration only.** Plugin options, proxy environment
  variables, and classifier settings are Zod schemas, and their option types
  are inferred from those schemas. Core exports the shared schemas and `parseConfig`, which
  reports every problem in one error. Request bodies and streamed usage stay on
  `isRecord` narrowing so unknown provider fields pass through unchanged. Zod
  is core's only dependency.

## License

[MIT](LICENSE)
