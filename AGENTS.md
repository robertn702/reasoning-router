# Working on this repo

`reasoning-router` is a pre-alpha npm-workspaces monorepo that will generalize
[`opencode-jev-router`](https://github.com/robertn702/opencode-jev-router) to
multiple agent harnesses and multiple decision models. It currently contains **no packages**.
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

- The decision model (the model that picks the reasoning effort, such as Jev)
  is configuration. Do not make shared code depend on Jev or any single
  decision-model provider; provider-specific code and dependencies stay out
  of the core.
- Do not create packages under `packages/` until package names and
  boundaries are decided (see the open questions in `docs/architecture.md`).
- Do not publish to npm. Release tooling (e.g. Changesets) is deferred until
  the first package exists.
- Do not modify `opencode-jev-router` from here; read it for reference only.
- Make the smallest change that works. Add no speculative abstractions and no
  configuration without a current requirement.
- Record reversible decisions in the commit message and, when they affect
  contributors, in `README.md`.
