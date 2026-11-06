# Testing policy

## Layout and test levels

All test files live under `tests/`. Within `unit/` and `integration/`, mirror the module path after `src/`; tooling tests mirror `tooling/`. For example, `src/server/downloads/url.ts` has its test at `tests/unit/server/downloads/url.test.ts`.

```text
tests/
  unit/
    server/
    web/
    tooling/
  integration/
    server/
    tooling/
  e2e/
  real/
  fixtures/
  helpers/
```

- `unit/`: Vitest tests of isolated logic on Node, without filesystem writes, child processes or network requests.
- `integration/`: Vitest tests of local boundaries on Node. Filesystem tests use isolated temporary directories; database tests use real temporary SQLite files with Drizzle. HTTP, process and CLI tests belong here, including files that also contain isolated logic checks.
- `fixtures/`: shared static media and its generation instructions. `helpers/`: shared test-only utilities; helpers used by one suite stay in that test file.
- Media import tests use local FFprobe and committed, generated audio/video fixtures from `tests/fixtures`. Install FFmpeg before running them, or set `FFPROBE_PATH` to its executable. They do not access media websites or model weights.
- `e2e/`: Playwright runs a small Chromium suite against the built application. Verify user-visible behavior and HTTP failures using roles, labels and explicit assertions. Add browser tests when navigation or interaction changes.
- `real/`: actual media-site downloads, platform-package downloads and large-model inference run only through the separate opt-in configuration. Normal tests and CI must not require model weights, credentials or third-party media availability.
- Media-tools installer tests use small generated TAR archives, real filesystem directories and a loopback HTTP server. `tar` is required. Substitute only executable launches for those fixtures; retain real system-tool checks. `bun run test:tools:real` separately downloads the pinned platform package and verifies real managed tools, import, conversion and rediscovery. It uses `vitest.real.config.ts` and is excluded from normal checks and CI.

Test behavior at its actual interface. A bug fix should add a regression test that fails without the fix. Cover invalid input, cleanup, cancellation and storage failures when relevant. Avoid tests that merely repeat a constant or inspect a private implementation.

Keep mocks at genuinely external interfaces. Prefer real SQLite/filesystem behavior over mocking the database driver or filesystem. Tiny controlled local fixtures are appropriate; fake product data and simulated success paths do not replace real integration checks.

CI installs FFmpeg/FFprobe once in its setup step with `tooling/install-media-tools.ts`, which runs Movo's own installer for the pinned, SHA-256-verified platform package and prints the directory added to `PATH`. The installation is cached per operating system and keyed by `src/server/media-tools/packages.ts`, so it is downloaded again only when the pinned package changes. Individual tests reuse those executables. Ordinary media tests use two-second audio/video fixtures of about 44 kB in total. A separate synthetic speech fixture of about 175 KiB is used only by the opt-in transcription test. Installer tests generate small archives and serve them over loopback HTTP, without contacting build providers. Real YouTube/X downloads and platform-package downloads remain opt-in. Dependency and Chromium installation are separate CI setup downloads. CI installs only Chromium's headless shell and relies on the runner image for system libraries instead of installing operating-system packages.

Temporary databases and managed media use a fresh directory per test or browser run, outside the application's normal data directory. Close workers, processes and database connections before removing that directory, including on failure. Queue fixtures pass the test's abort signal to Effect and use awaited test-finished cleanup so a timed-out test cannot race directory deletion against a running worker. A forced process termination can bypass in-process cleanup; do not rely on it to remove local temporary files. Browser reports/traces are diagnostic artifacts, not library data; CI uploads them on failure with a seven-day retention period.

## Commands and enforcement

Use `bun run test` for the fast suite, `bun run test:watch` while editing, `bun run check` for the full non-browser gate, and `bun run test:e2e` for browser checks. `package.json` owns the command definitions.

The default Vitest configuration includes only `unit/` and `integration/`. Run either group with `bun run test tests/unit` or `bun run test tests/integration`. Playwright discovers only `e2e/`; `vitest.real.config.ts` discovers only `real/`. Keep these discovery boundaries explicit so normal checks cannot pick up opt-in tests.

The fast suite has a 30-second test and cleanup-hook budget. Polling and command timeouts must leave room for resource cleanup within that budget; do not extend an inner wait beyond the enclosing test. Existing queue and installer polls allow 10 and 15 seconds respectively. Match each assertion to the failure it claims to cover: write partial files before simulating a failed download, exceed a combined limit with individually valid streams, and verify HTTP methods and payloads in controlled browser routes.

Pre-commit formats/lints staged files and runs type checks and fast tests. CI runs a frozen dependency install, formatting, linting, type checks, tests, production build and browser flows on Ubuntu and Windows, so platform-specific paths are checked on both. Media tools and browser installation are explicit setup steps with their own time limits.

There is no blanket coverage percentage. Add assertions where behavior and risk justify them. Do not add skipped tests, empty test suites or permissive assertions to satisfy a gate. Prefer adding a focused test over expanding a broad mock harness.

## Custom lint rules

Custom rules have valid/invalid fixture tests, including edge cases, and a CLI integration check when configuration or suppression behavior matters. The authored-code comment ban is enforced as a rule, including JSX and directive comments. See [the lint guide](../tooling/lint/README.md).

## Foundation checks

The initial suite should prove actual HTTP health/unknown-route behavior, input validation, real SQLite persistence/rollback, and the lint rule. The browser suite checks that the built application loads and talks to the local service. Product workflow tests are added with their implementation, not as empty cases in advance.

The local library suite verifies copied bytes and preserved originals, persistence after reopening SQLite, rejected/interrupted uploads, failed-insert cleanup, missing stored files and HTTP range serving. Browser tests import real fixtures, play and seek audio/video, reload detail pages, save identical bytes, recover after rejection and check the narrow layout. Ordinary tests do not use the application's normal data directory.

Library management tests verify title validation and persistence, preserved filenames and bytes, transcript/export titles, removal of related rows and temporary files, rejection during active jobs, and deletion after cancellation finishes. Real file locks or directory permissions and SQLite triggers exercise failure recovery. Browser tests cover rename cancellation and retry, confirmation focus and dismissal, deletion failure and retry, updated library entries, reload and missing-item navigation.

Saved-copy removal tests verify that the transcript, download history and metadata survive reopening SQLite, that removal is idempotent and rejected without a transcript or during transcription, that the file endpoint and transcription retry report the removed copy while exports keep working, and that recovery deletes rather than restores a pending removed copy. The browser flow covers cancelling the confirmation, the player-free transcript after reload, a TXT export and the library entry.

Deletion commit regressions use a deferred SQLite foreign key to fail at `COMMIT`, after the file has been staged, and verify restoration of bytes and related rows. Recovery tests preserve conflicting or unrecognized files, retry committed cleanup after repair, and start an actual backend against preexisting pending files to verify recovery before HTTP serving. Browser checks distinguish a committed cleanup warning from a rejected deletion and provide a keyboard-accessible return to the library.

The development-proxy regression test runs the actual Vite proxy configuration against the local Hono API on isolated ports. It verifies same-origin writes through both `localhost` and `127.0.0.1`, and checks that foreign origins remain rejected. Built-app browser checks alone do not cover this development transport.

The download suite uses real temporary SQLite and filesystem storage to verify queue ordering, cancellation, retry, persistence across reopening the database, shutdown interruption, publication recovery and rejection of paths outside a job's staging directory. Protocol tests substitute the external process boundary for yt-dlp; process tests launch real Node children to verify arguments, timeout and process-tree cancellation. HTTP tests verify bounded/validated requests and a worker that outlives enqueue requests. Browser tests control only download HTTP responses and verify preview errors, unknown duration, navigation during work, completion, cancel/retry and reload.

Concurrent retry tests submit two requests for the same terminal job, verify that only one is accepted, and check the saved media bytes. Cleanup failure tests also retry after the storage error is resolved so a failed operation cannot leave retry processing locked.

Cleanup regressions use a real Windows file lock or Unix directory permissions. They cover failed, completed and cancelled jobs, rejected retries, restart recovery and continued queue processing while preserving original errors and saved media. Startup tests launch independent backend processes against one temporary data directory, verify exclusive ownership across different ports, and kill the owner to verify immediate recovery. They also verify release on scope exit and preserve errors from a damaged lock database so storage failures cannot masquerade as a running backend. Saved PIDs never decide whether persisted jobs can be recovered.

Process-boundary tests use real Node children to verify independent stdout/stderr line buffering, split lines, CRLF and unterminated final lines, progress callback failures and output bounds. Stderr diagnostics remain separate from stdout metadata when no callback is supplied.

`bun run test:downloads:real` is the separate opt-in test for the actual yt-dlp pipeline. It previews and downloads public YouTube and X sources in video and audio-only modes, checks each real probed library entry, decodes the first second of audio and removes its isolated data directory. It requires yt-dlp on `PATH` or in `YTDLP_PATH`, FFmpeg/FFprobe and internet access. `MOVO_TEST_X_URL` must select a public X post with one video; there is no default X post. The suite fails before any downloads when it is missing. `MOVO_TEST_YOUTUBE_URL` optionally selects another YouTube source. This check is excluded from normal tests, pre-commit and CI; source availability can cause it to fail independently of application changes.

Library search tests import real fixtures into temporary SQLite/media storage and substitute only the inference result. They verify title and passage matches with folded Polish and other Latin letters, word prefixes, all-words semantics, ignored search syntax, highlighted offsets, the passage limit and count, type/transcript filters, relevance and chosen ordering, and that renames, replacement transcripts and deletions update the index. A held transcription verifies that the listing reports active work even when the filter hides that recording, and the download-and-transcribe browser flow shows the finished recording in an already open filtered library. The migration test indexes recordings and transcripts saved before search existed. HTTP checks reject invalid filters, repeated parameters and overlong queries. The browser suite starts an isolated backend, searches transcripts, opens a passage at its timestamp, returns to the restored search, keeps filters and order through reload and history, ignores invalid address parameters, recovers from an empty result and checks a narrow viewport.

Download-option regressions verify every YouTube yt-dlp selector and the absence of audio conversion, deduplication by normalized URL and preset, and retained settings through retry and SQLite reopen. The migration test starts from the committed migrations through local transcription, inserts legacy queued/completed jobs with a media reference and cleanup warning, then runs the current migration and reopens the database again. Browser tests verify the default, quality/audio selection, request payload, visible job options after reload and narrow layout.

X regressions verify alias normalization and deduplication by post ID, preservation of the normalized source URL, differing post/media IDs, rejection of multiple videos, external players and broadcasts, and actionable access failures. Process-boundary tests verify the combined-stream audio fallback and extraction flags while retaining the YouTube selectors. Browser tests submit an X share link through the common form, recover from an access error and follow the job while another recording is open. Offline X fixtures use synthetic URLs and IDs, without linking to selected real posts. Normal tests never contact X or read account cookies.

Download-and-transcribe integration tests use real SQLite/filesystem storage and both queue services, substituting only source downloading and inference. They verify atomic handoff, rollback when transcription insertion fails, publication recovery, enabling transcription on running/completed downloads, retained intent through cancellation/retry and database reopen, preserved existing transcription jobs, and saved media after inference failure. HTTP checks verify that prerequisite failures leave download state unchanged. The browser flow uses an isolated real backend and controlled source/inference boundaries to exercise keyboard selection, setup errors, background processing across navigation/reload, saved passages and a narrow viewport. It downloads no models or external media.

Model setup tests use tiny generated GGUF files from a loopback HTTP server and real isolated HF cache directories. Use the real parser and integrity checks; cover existing regular/linked files, same-size corruption, external repair, publication collisions, two independent Node writers, cancellation, shutdown and cleanup failures. Keep a real no-weights engine initialization and invalid-GGUF rejection check so missing native runtime/package failures cannot masquerade as successful corrupt-model rejection. Browser route fixtures validate methods and model IDs and cover navigation, reload, cancellation, retry and repair guidance. The built browser server receives its own temporary `HF_HUB_CACHE`; tests must never inspect or alter the user's model cache.

`bun run test:models:real` is the opt-in model download/load check. It downloads the pinned 740 MB file, verifies integrity, loads it in the actual CPU worker and verifies rediscovery, then removes the temporary model files. Normal CI installs the native engine as an application dependency but never downloads weights or runs model inference. See [model setup](models.md) for the supported configuration and validation limits.

Transcription tests use public queue operations, real temporary SQLite/media and controlled inference results. They verify one accepted job per recording, ordered execution, cancellation before cleanup, concurrent retry exclusion, restart recovery, persisted results, rejected prerequisites and invalid timestamps, empty speech output, and cleanup failures that preserve results and allow later recovery. The engine suite runs real FFmpeg on the audio/video fixtures and validates prepared PCM and untrusted inference output. The process suite kills an actual IPC worker's owner to verify worker termination. The shared file-lock fixture exercises real Windows locks or Unix directory permissions for both download and transcription cleanup.

Transcript export tests cover the shared text/subtitle serializer and the real HTTP endpoint, including Unicode, escaping, timestamps, empty results and rejection before completion. Browser export tests start an isolated local backend with real SQLite/media, substitute only the inference result, and download actual response bytes; no production test flags or model weights are needed. They also parse WebVTT in Chromium and replace the browser clipboard API to verify copying, denied access and recovery without touching the system clipboard.

`bun run test:transcriptions:real` is the separate opt-in speech-recognition check. It requires the pinned model already present in the configured Hugging Face cache and reads it without modifying it. It creates an isolated library, transcribes synthetic speech and a locally repeated recording longer than 30 seconds, verifies recognized words, later timestamp offsets and the automatically selected device, then removes all temporary data. It downloads no weights and never runs in ordinary CI. See [local transcription](transcriptions.md).
