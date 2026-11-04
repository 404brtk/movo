# movo

A local media workspace. Import audio and video or download a public YouTube video into a persistent library, then play saved copies. Downloads run in the background while you browse other recordings. Transcription has not been implemented yet.

## Requirements

- Node **26.13.0**, pinned in `.node-version` and `.nvmrc`.
- Bun **1.4.4**, pinned in `package.json`.
- FFprobe for imports. Movo detects existing tools and offers an explicit download of FFmpeg and FFprobe when needed. The app starts without either tool or any model weights.
- For YouTube downloads, both FFmpeg and FFprobe plus the [official yt-dlp standalone executable](https://github.com/yt-dlp/yt-dlp#installation). Install yt-dlp yourself and add it to `PATH`, or set `YTDLP_PATH` to its absolute executable path, then restart Movo. Movo does not download yt-dlp automatically. Its bundled JavaScript components use Movo's Node executable.
- Windows' system `tar`, or `tar` and `xz` on Linux, for downloading/unpacking tools and running integration tests. Movo selects `%SystemRoot%/System32/tar.exe` on Windows so Git's bundled GNU tar cannot override it. Existing FFmpeg/FFprobe installations can be used without unpacking anything.

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

An optional `.env` file can override `PORT`, `MOVO_DATA_DIR`, `FFPROBE_PATH`, `FFMPEG_PATH` and `YTDLP_PATH`. The data directory must be absolute and defaults to `~/.movo`. Local databases and media/model files are outside the source tree. Copy `.env.example` only if overrides are needed. Leave executable overrides unset to use automatic discovery.

## Media tools

Open **Media tools** in the library to check FFprobe and FFmpeg. Discovery tries an explicit executable override, then Movo's managed installation, then absolute directories on `PATH`. Broken explicit overrides are reported instead of silently replaced. Imports require only FFprobe and check it before uploading or storing the file.

Choose **Download media tools** to download a private copy of both executables. The panel shows the build provider, version, compressed size and progress. Downloads continue when the panel is closed or the page is reloaded. Movo verifies the pinned size and SHA-256, extracts only the selected executables and license, checks both executables, then activates the completed installation without restarting the app. Existing system installations and `PATH` are untouched.

Automatic downloads support Windows x64 and Linux x64 with glibc 2.28 or newer. Other platforms can use manually installed tools. A stopped download is retried from the beginning; an interrupted staging directory is cleared on the next installation attempt. Previous managed copies remain available to processes already using them, and a failed repair preserves the active installation. See [media tools](docs/media-tools.md) for sources, configuration and validation.

## Import local media

Choose **Import a file** in the library. Imports are streamed to managed storage and inspected with FFprobe before appearing in the list. The library records the original filename, media type, duration, size and import time. Files are limited to **10 GiB** each. Importing the same filename again creates a separate item.

Open an item to play or seek through its saved copy. **Save a copy** downloads the original imported bytes. Browser playback depends on the file's codecs; no automatic transcoding is performed. Supported containers include MP4/MOV/M4A, WebM/Matroska, MP3, WAV, Ogg, FLAC and AAC. No model weights are required.

To check the current workflow, import a small recording, open its library entry, play and seek, then refresh the page. Restart the app to verify that the entry remains. Use **Save a copy** to retrieve its stored bytes; the original file should remain in its original location.

Metadata is stored in `MOVO_DATA_DIR/app.sqlite`; managed copies are stored in `MOVO_DATA_DIR/media/` under generated identifiers. Original source files are never moved, changed or deleted. Normal import failures remove their partial copies. An abruptly stopped app can leave unindexed files, which are not shown or served as completed imports; interrupted imports are not resumable.

The local API provides `GET /api/media`, `POST /api/media`, `GET /api/media/:id` and `GET`/`HEAD /api/media/:id/file`. Import requests contain the raw file body and a URI-encoded filename in `X-File-Name`. Metadata responses follow the Effect schemas in `src/shared/contracts/media.ts`. Playback supports HTTP byte ranges.

## Download from YouTube

Paste a YouTube link in the library and choose **Check link**. Movo asks yt-dlp for the video's title and duration; an unavailable duration is shown explicitly. Choose **Download** to queue it, then open **Downloads** from any page to see progress, cancel or retry. You can open another recording while a download runs, close the tab or reload it. Keep the local Node server running.

The initial defaults are one active download, a maximum of 1080p and a 10 GiB size limit. Movo prefers H.264/AAC and requests MP4 merging without transcoding. Actual codecs depend on the source, so browser playback is not guaranteed for every file. Downloads support single, public, completed YouTube videos. Playlists, live/upcoming streams, sign-in/cookies, X and Spotify are outside this implementation. A video link containing a playlist parameter downloads only that video.

Jobs and source URLs persist in SQLite. The same normalized video URL returns its existing job; use **Retry** for a failed, cancelled or interrupted job. Retry starts from the beginning and goes to the end of the queue. Queued jobs start automatically after a restart; an active download interrupted by shutdown needs an explicit retry. If the media was already published before an interrupted job could record completion, startup reconciles it with the library. Run one Movo backend per data directory.

Partial files and private source metadata stay in `MOVO_DATA_DIR/downloads/<job-id>/`. Successful downloads are inspected by FFprobe and moved into the regular library, retaining their source URL. Cancellation waits for the owned process tree to stop and removes its temporary files. Normal completion/failure also removes staging files; restart clears staging for finished or interrupted jobs. The final save to the library finishes before cancellation or shutdown can interrupt it.

The API provides `POST /api/downloads/preview` and `POST /api/downloads` with a JSON `{ "url": "https://www.youtube.com/watch?v=…" }` body, plus `GET /api/downloads`, `GET /api/downloads/:id`, `POST /api/downloads/:id/cancel` and `POST /api/downloads/:id/retry`. Enqueue and retry return HTTP 202 immediately; the worker owns the download independently of the request. Contracts live in `src/shared/contracts/downloads.ts`.

## Verification

```sh
bun run check
bun run test:e2e:install
bun run test:e2e
```

`bun run test:tools:real` is an opt-in check that downloads the platform's pinned package into a temporary directory, imports real audio and converts it using the managed executables. It requires internet access and is excluded from ordinary tests and CI.

`bun run test:downloads:real` separately previews and downloads a short public YouTube video, validates its library entry and removes the temporary database and media. It requires internet access, yt-dlp, FFmpeg and FFprobe. Set `MOVO_TEST_YOUTUBE_URL` to use a different public video. Ordinary tests and CI use controlled source/process fixtures and never contact YouTube.

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
