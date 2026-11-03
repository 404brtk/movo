# movo

A local media workspace. This repository currently contains the application foundation; downloading and transcription features have not been implemented.

## Requirements

- Node **26.13.0**, pinned in `.node-version` and `.nvmrc`.
- Bun **1.4.4**, pinned in `package.json`.

Bun manages dependencies and invokes scripts. Node runs the backend and JavaScript tooling. Use the pinned Node version when installing dependencies because SQLite uses a native addon.

## Start developing

```sh
bun install --frozen-lockfile
bun run dev
```

Open `http://127.0.0.1:5173`. The local API listens on `127.0.0.1:4310`; Vite proxies API requests to it. No model download is required. Husky installs the local pre-commit hook during dependency installation.

For the built application:

```sh
bun run build
bun run start
```

Open `http://127.0.0.1:4310`. The Node server serves both the browser application and API.

An optional `.env` file can override `PORT` and `MOVO_DATA_DIR`. The data directory must be absolute and defaults to `~/.movo`. Local databases and future media/model files are outside the source tree. Copy `.env.example` only if overrides are needed.

## Verification

```sh
bun run check
bun run test:e2e:install
bun run test:e2e
```

`check` verifies formatting, linting, types, fast tests and the production build. Browser tests use a fresh temporary data directory and the built server. On Linux, browser system packages can be installed with `bun run test:e2e:install --with-deps`.

Pre-commit formats/lints staged files, then runs types and fast tests. CI checks the foundation on Windows and Linux and runs Chromium smoke tests on Linux. The workflow uses read-only repository permissions and commit-pinned actions.

See [testing policy](docs/testing.md) for test selection and [custom lint rules](tooling/lint/README.md) for rule development. Authored JavaScript/TypeScript comments are lint errors; the generated route tree is excluded.

## Project layout

[AGENTS.md](AGENTS.md) holds project-specific agent instructions; `CLAUDE.md` imports it. Shared docs describe supported code and contributor workflows. Exploratory research and personal planning notes belong in ignored `.agent-notes/`.

Browser code lives in `src/web`, server code in `src/server`, and browser-safe schemas in `src/shared`. TanStack generates `src/web/routeTree.gen.ts`; keep that file generated rather than editing it. `bun run routes:generate` refreshes it before type checking/building.

Drizzle and its migration tooling are configured. The first persisted feature will introduce its real `*.schema.ts` tables and generated versioned migrations; there are no sample product tables or empty migrations in the foundation. Use `db:generate` and `db:migrate` after introducing that schema.

## Dependency updates

`bun run audit:runtime` checks production dependencies; `bun run audit` includes development tools. Inspect the current command output for findings rather than relying on a dated audit snapshot.

Keep one Bun lockfile. Check the selected libraries' current documentation before changing APIs, then run all checks and browser tests. Update native dependencies using the pinned Node version. Model weights, downloaded media, databases and secrets do not belong in Git.
