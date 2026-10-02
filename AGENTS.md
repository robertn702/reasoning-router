# Working on this repo

`reasoning-router` is a pre-alpha npm-workspaces monorepo that will generalize
[`opencode-jev-router`](https://github.com/robertn702/opencode-jev-router) to
multiple agent harnesses and multiple classifiers. It currently contains **no packages**.
`docs/architecture.md` frames the problem and the open design questions.

## Commands

Use Node.js 24.x from the repo root.

| Task | Command |
| --- | --- |
| Install dependencies | `npm ci` |
| Typecheck, lint, and test | `npm run check` |
| Typecheck | `npm run typecheck` |
| Lint and format check (Biome) | `npm run lint` |
| Apply lint fixes and formatting | `npm run format` |
| Run tests (Vitest) | `npm test` |

CI (`.github/workflows/ci.yml`) runs install, typecheck, lint, and test on
pushes to `main` and on pull requests.

## Layout

- `packages/*`: future workspace packages, each with `src/` and `test/`.
  The root `tsconfig.json` and `vitest.config.ts` already include
  `packages/*/src/**/*.ts` and `packages/*/test/**/*.test.ts`.
- `tsconfig.base.json`: shared compiler options for packages to extend.
- `biome.json`: lint and format configuration.

## Conventions

- The classifier (the component that picks the reasoning effort, such as
  Jev) is configuration. Do not make shared code depend on Jev or any single
  classifier provider; provider-specific code and dependencies stay out of
  the core.
- Create only the packages listed under "Packages" in `docs/architecture.md`:
  `@reasoning-router/core`, `@reasoning-router/opencode`, and
  `@reasoning-router/classifier-jev`. Harness adapters use the bare harness
  name; classifiers use a `classifier-` prefix. Follow the "Porting"
  decisions in `docs/architecture.md` when porting code into them.
- Do not publish to npm. Release tooling (e.g. Changesets) is deferred until
  the first package exists.
- Do not modify `opencode-jev-router` from here; read it for reference only.
- Make the smallest change that works. Add no speculative abstractions and no
  configuration without a current requirement.
- Record reversible decisions in the commit message and, when they affect
  contributors, in `README.md`.
