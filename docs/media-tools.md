# Media tools

Movo's Node backend discovers and runs FFprobe, FFmpeg and yt-dlp. The browser requests status or starts an explicit download; it does not install executables itself. Tool availability is independent of model weights.

## Discovery and configuration

For each executable, discovery checks these locations in order:

1. `FFPROBE_PATH` or `FFMPEG_PATH`, if explicitly configured.
2. The installation referenced by `MOVO_DATA_DIR/tools/ffmpeg/active.json`.
3. Absolute directories on the application's `PATH`.

Each candidate must successfully run `-version` and identify itself as the requested tool within 30 seconds. Missing and broken tools have separate statuses. A broken explicit override must be corrected or removed and Movo restarted. A damaged managed installation can be repaired by downloading the tools again. FFprobe alone is sufficient for local imports.

## Managed downloads

The package catalog lives in `src/server/media-tools/packages.ts`. It pins the provider, version, release URL, archive URL, compressed byte size, SHA-256 and selected archive paths. The supported downloads are:

- Windows x64: Gyan FFmpeg 9.0.2 essentials ZIP, 114,768,076 bytes. [Release and assets](https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2).
- Linux x64 with glibc 2.28 or newer: BtbN static LGPL 9.0 build `n9.0.2-39-g7adfbe40dc`, monthly release `autobuild-2026-10-31-12-59`, 136,027,168 bytes. [Release and assets](https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-10-31-12-59).

These are independent build providers linked from the [FFmpeg download page](https://ffmpeg.org/download.html); FFmpeg itself distributes source code. BtbN's [retention policy](https://github.com/BtbN/FFmpeg-Builds#release-retention-policy) retains monthly builds for two years. Package references need maintenance before those artifacts expire. Updating catalog URLs and hashes is a reviewed source change, never an automatic switch to `latest`. A pinned hash checks the downloaded bytes against the selected artifact; it does not establish the publisher's trustworthiness.

Downloading uses `%SystemRoot%/System32/tar.exe` on Windows and `tar` on `PATH` with XZ support on Linux. The absolute Windows path prevents Git's bundled GNU tar from overriding it and treating drive-letter archive paths as remote addresses. The backend checks `tar` before downloading, bounds the transfer to the pinned size and verifies its SHA-256. It streams only the two selected executables and license from the archive into fixed destination filenames using `tar -xOf`; other archive entries are not written. Both executables must pass their version checks before an atomic pointer replacement activates them. Failed downloads, extraction or validation leave the previous pointer untouched.

One installation runs per backend. The backend's system lock on its data directory prevents another backend from running an installer against the same staging files. File existence and saved PIDs are not used as evidence of ownership. A subsequent installation clears abandoned staging after the previous backend has stopped. Downloads have a ten-minute limit, individual extraction processes have a two-minute limit, and normal backend shutdown cancels the active installation and removes its partial files. Browser requests do not own the download's lifetime. Interrupted downloads restart from the beginning.

Managed installations live outside the repository. Completed directories are retained so an in-flight operation holding an executable path can finish; this feature does not prune previous installations. Model downloads are separate explicit actions.

## yt-dlp

Link downloads use yt-dlp through the same managed-tool installer. Discovery checks `YTDLP_PATH`, then `MOVO_DATA_DIR/tools/yt-dlp/active.json`, then `yt-dlp` (`yt-dlp.exe` on Windows) in absolute `PATH` directories. A candidate must print a date-based version for `--version`. The downloader resolves yt-dlp before every run, so an installation completed while Movo runs is used immediately. Startup, imports and library browsing do not need yt-dlp.

The release is pinned in `src/server/media-tools/ytdlp.ts`, separately from the FFmpeg catalog:

- Windows x64: `yt-dlp.exe` 2026.10.26, 23,575,744 bytes.
- Linux x64 with glibc 2.17 or newer: `yt-dlp_linux` 2026.10.26, 41,166,968 bytes.

Both are standalone executables from the [official 2026.10.26 release](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.10.26). Their hashes come from the release's `SHA2-256SUMS`, whose signature was verified with the [yt-dlp signing key](https://github.com/yt-dlp/yt-dlp#release-files) before pinning. When updating the release, verify `SHA2-256SUMS.sig` the same way. The download needs no unpacking: after the size and SHA-256 checks, the file is moved into a new managed directory, made executable on Linux, checked with `--version` and activated atomically. Movo never runs yt-dlp's self-updater; a new release is a reviewed source change. Other platforms need a manual installation on `PATH` or `YTDLP_PATH`.

## HTTP interface

- `GET /api/media-tools` returns uncached per-tool availability, optional download metadata and the current installation phase/progress.
- `POST /api/media-tools/install` starts or joins an installation and returns status with HTTP 202. It never accepts an executable path or arbitrary download URL from the request. Unavailable platforms and broken explicit configuration return an actionable error.

- `GET /api/ytdlp` and `POST /api/ytdlp/install` provide the same status and installation behavior for yt-dlp.

The existing loopback-host and same-origin checks apply to all of these routes. Status responses use the Effect schemas in `src/shared/contracts/media-tools.ts`; frontend caching and polling belong to TanStack Query. Installation state is held by the backend, while executable discovery after restart reads and checks the managed files.

## Verification

Ordinary Vitest tests use real temporary files, a local HTTP download server and small TAR archives. Only executable launches for those generated fixtures are substituted; a separate test checks the actual system executables. Coverage includes failed integrity checks, truncated/oversized transfers, corrupt archives, shutdown cleanup, concurrent requests, configuration precedence, invalid activation pointers, failed repair and rediscovery after restart.

yt-dlp tests serve a small file over loopback HTTP and cover activation without restart, rediscovery, system discovery, a broken `YTDLP_PATH` and a download that is not a working yt-dlp.

Playwright checks explicit setup, failed-request retry, progress after page reload, keyboard focus and the upload preflight. For yt-dlp it checks that adding a link opens setup before any preview request and that the link is checked once setup completes. Those UI failure states use controlled HTTP responses; actual package installation is verified separately.

Run `bun run test:tools:real` to download the pinned packages and verify real managed executables, local audio import, conversion, rediscovery and the managed yt-dlp version in an isolated temporary directory. This test requires a supported platform, network access, `tar` and Linux XZ support. It is excluded from normal checks and CI, and removes its temporary data afterward.
