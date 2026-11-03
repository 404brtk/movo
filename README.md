# movo

A local media workspace. Import audio and video into a persistent library, play saved copies and keep your originals untouched. URL downloading and transcription have not been implemented yet.

## Requirements

- Node **26.13.0**, pinned in `.node-version` and `.nvmrc`.
- Bun **1.4.4**, pinned in `package.json`.
- FFprobe, included with FFmpeg, for inspecting imported files. Make it available on `PATH` or set `FFPROBE_PATH` to its executable. The app starts without it, but imports require it.

Bun manages dependencies and invokes scripts. Node runs the backend and JavaScript tooling. Use the pinned Node version when installing dependencies because SQLite uses a native addon.

## Start developing

```sh
bun install --frozen-lockfile
bun run dev
```

Open `http://localhost:5173` or `http://127.0.0.1:5173`. The local API listens on `127.0.0.1:4310`; Vite proxies API requests while preserving the browser's host so same-origin checks work with either address. No model download is required. Husky installs the local pre-commit hook during dependency installation.

For the built application:

```sh
bun run build
bun run start
```

Open `http://127.0.0.1:4310`. The Node server serves both the browser application and API.

An optional `.env` file can override `PORT`, `MOVO_DATA_DIR` and `FFPROBE_PATH`. The data directory must be absolute and defaults to `~/.movo`. Local databases and media/model files are outside the source tree. Copy `.env.example` only if overrides are needed.

## Import local media

Choose **Import a file** in the library. Imports are streamed to managed storage and inspected with FFprobe before appearing in the list. The library records the original filename, media type, duration, size and import time. Files are limited to **10 GiB** each. Importing the same filename again creates a separate item.

Open an item to play or seek through its saved copy. **Save a copy** downloads the original imported bytes. Browser playback depends on the file's codecs; no automatic transcoding is performed. Supported containers include MP4/MOV/M4A, WebM/Matroska, MP3, WAV, Ogg, FLAC and AAC. No model weights are required.

To check the current workflow, import a small recording, open its library entry, play and seek, then refresh the page. Restart the app to verify that the entry remains. Use **Save a copy** to retrieve its stored bytes; the original file should remain in its original location.

Metadata is stored in `MOVO_DATA_DIR/app.sqlite`; managed copies are stored in `MOVO_DATA_DIR/media/` under generated identifiers. Original source files are never moved, changed or deleted. Normal import failures remove their partial copies. An abruptly stopped app can leave unindexed files, which are not shown or served as completed imports; interrupted imports are not resumable.

The local API provides `GET /api/media`, `POST /api/media`, `GET /api/media/:id` and `GET`/`HEAD /api/media/:id/file`. Import requests contain the raw file body and a URI-encoded filename in `X-File-Name`. Metadata responses follow the Effect schemas in `src/shared/contracts/media.ts`. Playback supports HTTP byte ranges.

## Verification

```sh
bun run check
bun run test:e2e:install
bun run test:e2e
```

`check` verifies formatting, linting, types, fast tests and the production build. Browser tests use a fresh temporary data directory and the built server. On Linux, browser system packages can be installed with `bun run test:e2e:install --with-deps`.

Pre-commit formats/lints staged files, then runs types and fast tests. CI installs FFmpeg and checks the application and Chromium flows on Ubuntu. The workflow uses read-only repository permissions and commit-pinned actions.

See [testing policy](docs/testing.md) for test selection and [custom lint rules](tooling/lint/README.md) for rule development. Authored JavaScript/TypeScript comments are lint errors; the generated route tree is excluded.

## Project layout

[AGENTS.md](AGENTS.md) holds project-specific agent instructions; `CLAUDE.md` imports it. Shared docs describe supported code and contributor workflows. Exploratory research and personal planning notes belong in ignored `.agent-notes/`.

Browser code lives in `src/web`, server code in `src/server`, and browser-safe schemas in `src/shared`. TanStack generates `src/web/routeTree.gen.ts`; keep that file generated rather than editing it. `bun run routes:generate` refreshes it before type checking/building.

Drizzle schemas live in `src/server/**/*.schema.ts`; generated, versioned migrations are committed under `migrations/`. The server applies pending migrations when opening the database. After a schema change, use `bun run db:generate` and restart the app. `bun run db:migrate` also applies migrations explicitly to the configured data directory.

## Dependency updates

`bun run audit:runtime` checks production dependencies; `bun run audit` includes development tools. Inspect the current command output for findings rather than relying on a dated audit snapshot.

Keep one Bun lockfile. Check the selected libraries' current documentation before changing APIs, then run all checks and browser tests. Update native dependencies using the pinned Node version. Model weights, downloaded media, databases and secrets do not belong in Git.
