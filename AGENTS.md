# movo

A local browser application for managing media and optional local transcription.

## Project constraints

- Node runs the application and tooling; Bun manages packages and invokes scripts. Read the pinned versions from `.node-version` and `package.json`; keep one Bun lockfile.
- Browser code belongs in `src/web`, server code in `src/server`, and browser-safe contracts in `src/shared`. Browser imports of server definitions must be type-only.
- Hono owns HTTP, Effect owns backend orchestration and shared schemas, and Drizzle owns SQLite. Validate external inputs and process output with Effect Schema.
- TanStack Query owns cached backend data, Router owns navigable URL state, and React owns temporary UI state. Keep each value in one owner.
- Use shadcn with Base UI, Tailwind and Hugeicons. Keep `components.json` consistent with generated components.
- Authored code is comment-free: explain intent with names, structure and tests. Generate `src/web/routeTree.gen.ts` through the routing tools rather than editing it; its lint exemption is specific to that file.
- Jobs continue independently of browser requests. Invoke external executables with argument arrays, and keep managed files separate from imported originals.
- Model weights are optional at startup and downloaded only through an explicit action. Ordinary tests run without model downloads, media websites or credentials.

## Verification

- For test changes and behavior regressions, follow [docs/testing.md](docs/testing.md).
- For a new lint constraint, prefer an existing Oxlint rule; otherwise follow [tooling/lint/README.md](tooling/lint/README.md) and add valid/invalid regression cases.
- Run `bun run check` after code or tooling changes. Also run `bun run test:e2e` when browser behavior, routing or the built server changes.
- Storage integration tests use real temporary SQLite databases and filesystem directories.

## Documentation

Shared documentation describes current behavior and contributor workflows. Keep exploratory research, planning history and personal notes in ignored `.agent-notes/`; shared documentation must not depend on those local files.
