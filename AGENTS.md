# Working on this repo

`reasoning-router` is a pre-alpha npm-workspaces monorepo that generalizes
[`opencode-jev-router`](https://github.com/robertn702/opencode-jev-router) to
multiple agent harnesses and multiple classifiers. It contains the port of
`opencode-jev-router` (see "Layout"). `docs/architecture.md` frames the
problem and the open design questions.

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
| Build every package to `dist/`, in dependency order | `npm run build` |
| Pack, install, and run the packages | `npm run smoke:package` |
| Install the packed plugin in OpenCode 2.0.18 | `npm run smoke:plugin:v2` |
| Install the packed extension in Pi 1.0.0 | `npm run smoke:pi` |

CI (`.github/workflows/ci.yml`) runs install, typecheck, lint, test, and
`smoke:package` on pushes to `main` and on pull requests, plus the plugin
and Pi smokes as separate jobs. The plugin smoke needs `openssl` and an
existing `/tmp/opencode`; set `OPENCODE_V2_BIN` or `OPENCODE_V2_VERSION` to
test another OpenCode V2. The Pi smoke needs `openssl` and runs the pinned
Pi devDependency; set `PI_BIN` (and `PI_VERSION`, the version it reports) to
test another Pi.

Orca runs `./scripts/setup.sh` from `orca.yaml` and waits for it to finish
before starting an agent. The script runs `npm ci`, copies local `.env*` files
(except `.env.example`) from the main checkout into a new worktree, and creates
`.env` from `.env.example` if none exists. If present, it links
`.scratch/shared` and `AGENTS.local.md`. It never overwrites existing files.

## Layout

- `packages/core` (`@reasoning-router/core`): validation, rewrite, lineage,
  forwarding, logging, model registry, and the classifier interface.
- `packages/classifiers` (`@reasoning-router/classifiers`): every
  classifier (Jev, Clef), as presets selected by `classifier.provider`.
- `packages/opencode` (`@reasoning-router/opencode`): the OpenCode V2 plugin.
- `packages/pi` (`@reasoning-router/pi`): the Pi extension.
- `packages/proxy` (`@reasoning-router/proxy`): the standalone proxy, run as
  the `reasoning-router` command.
- Each package has `src/`, `test/`, and a `tsconfig.build.json` that compiles
  `src/` to `dist/`. Package `exports` resolve the
  `@reasoning-router/source` condition to `src/*.ts`, which the root
  `tsconfig.json` and `vitest.config.ts` enable, so typecheck and tests run
  against source without building.
- `scripts/`: package, plugin, and Pi smoke tests.
- `tsconfig.base.json`: shared compiler options for packages to extend.
- `biome.json`: lint and format configuration.
- `.changeset/`: Changesets configuration (independent versions).

## Conventions

- The classifier (the component that picks the reasoning effort, such as
  Jev) is configuration. Do not make shared code depend on Jev or any single
  classifier provider; provider-specific code and dependencies stay out of
  the core.
- Create only the packages listed under "Packages" in `docs/architecture.md`:
  `@reasoning-router/core`, `@reasoning-router/opencode`,
  `@reasoning-router/classifiers`, `@reasoning-router/pi`, and
  `@reasoning-router/proxy`. Harness
  adapters use the bare harness name. Add a classifier as a preset in
  `classifiers`, not as a new package; a heavy runtime it needs is an
  optional peer dependency loaded with a dynamic `import()`. Follow the
  "Porting" decisions in `docs/architecture.md` when porting code into them.
- Each test lives in the package whose code it covers.
- Do not publish to npm. Changesets is configured for versioning only; there
  is no publish workflow. Do not add changesets until the packages are first
  released.
- Do not modify `opencode-jev-router` from here; read it for reference only.
- Make the smallest change that works. Add no speculative abstractions and no
  configuration without a current requirement.
- Record reversible decisions in the commit message and, when they affect
  contributors, in `README.md`.
