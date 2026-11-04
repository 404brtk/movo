# Testing policy

## Test levels

- Vitest runs deterministic logic and integration tests on Node. Co-locate these tests with the behavior they verify. Filesystem tests use isolated temporary directories; database tests use real temporary SQLite files with Drizzle.
- Media import tests use local FFprobe and committed, generated audio/video fixtures from `tests/fixtures`. Install FFmpeg before running them, or set `FFPROBE_PATH` to its executable. They do not access media websites or model weights.
- Playwright runs a small Chromium suite against the built application. Verify user-visible behavior and HTTP failures using roles, labels and explicit assertions. Add browser tests when navigation or interaction changes.
- Real media-site downloads and large-model inference belong in a separate opt-in integration suite when those integrations exist. Normal tests and CI must not require model weights, credentials or third-party media availability.
- Media-tools installer tests use small generated TAR archives, real filesystem directories and a loopback HTTP server. `tar` is required. Substitute only executable launches for those fixtures; retain real system-tool checks. `bun run test:tools:real` separately downloads the pinned platform package and verifies real managed tools, import, conversion and rediscovery. It uses `vitest.real.config.ts` and is excluded from normal checks and CI.

Test behavior at its actual interface. A bug fix should add a regression test that fails without the fix. Cover invalid input, cleanup, cancellation and storage failures when relevant. Avoid tests that merely repeat a constant or inspect a private implementation.

Keep mocks at genuinely external interfaces. Prefer real SQLite/filesystem behavior over mocking the database driver or filesystem. Tiny controlled local fixtures are appropriate; fake product data and simulated success paths do not replace real integration checks.

CI installs FFmpeg/FFprobe once in its setup step; individual tests reuse those executables. The committed two-second audio/video fixtures are about 44 kB in total. Installer tests generate small archives and serve them over loopback HTTP, without contacting build providers. Real YouTube downloads and platform-package downloads remain opt-in. Dependency and Chromium installation are separate CI setup downloads.

Temporary databases and managed media use a fresh directory per test or browser run, outside the application's normal data directory. Close workers, processes and database connections before removing that directory, including on failure. Queue fixtures pass the test's abort signal to Effect and use awaited test-finished cleanup so a timed-out test cannot race directory deletion against a running worker. A forced process termination can bypass in-process cleanup; do not rely on it to remove local temporary files. Browser reports/traces are diagnostic artifacts, not library data; CI uploads them on failure with a seven-day retention period.

## Commands and enforcement

Use `bun run test` for the fast suite, `bun run test:watch` while editing, `bun run check` for the full non-browser gate, and `bun run test:e2e` for browser checks. `package.json` owns the command definitions.

The fast suite has a 30-second test and cleanup-hook budget. Polling and command timeouts must leave room for resource cleanup within that budget; do not extend an inner wait beyond the enclosing test. Existing queue and installer polls allow 10 and 15 seconds respectively. Match each assertion to the failure it claims to cover: write partial files before simulating a failed download, exceed a combined limit with individually valid streams, and verify HTTP methods and payloads in controlled browser routes.

Pre-commit formats/lints staged files and runs type checks and fast tests. CI runs a frozen dependency install, formatting, linting, type checks, tests, production build and browser flows on Ubuntu. FFmpeg and browser installation are explicit setup steps.

There is no blanket coverage percentage. Add assertions where behavior and risk justify them. Do not add skipped tests, empty test suites or permissive assertions to satisfy a gate. Prefer adding a focused test over expanding a broad mock harness.

## Custom lint rules

Custom rules have valid/invalid fixture tests, including edge cases, and a CLI integration check when configuration or suppression behavior matters. The authored-code comment ban is enforced as a rule, including JSX and directive comments. See [the lint guide](../tooling/lint/README.md).

## Foundation checks

The initial suite should prove actual HTTP health/unknown-route behavior, input validation, real SQLite persistence/rollback, and the lint rule. The browser suite checks that the built application loads and talks to the local service. Product workflow tests are added with their implementation, not as empty cases in advance.

The local library suite verifies copied bytes and preserved originals, persistence after reopening SQLite, rejected/interrupted uploads, failed-insert cleanup, missing stored files and HTTP range serving. Browser tests import real fixtures, play and seek audio/video, reload detail pages, save identical bytes, recover after rejection and check the narrow layout. Ordinary tests do not use the application's normal data directory.

The development-proxy regression test runs the actual Vite proxy configuration against the local Hono API on isolated ports. It verifies same-origin writes through both `localhost` and `127.0.0.1`, and checks that foreign origins remain rejected. Built-app browser checks alone do not cover this development transport.

The download suite uses real temporary SQLite and filesystem storage to verify queue ordering, cancellation, retry, persistence across reopening the database, shutdown interruption, publication recovery and rejection of paths outside a job's staging directory. Protocol tests substitute the external process boundary for yt-dlp; process tests launch real Node children to verify arguments, timeout and process-tree cancellation. HTTP tests verify bounded/validated requests and a worker that outlives enqueue requests. Browser tests control only download HTTP responses and verify preview errors, unknown duration, navigation during work, completion, cancel/retry and reload.

Concurrent retry tests submit two requests for the same terminal job, verify that only one is accepted, and check the saved media bytes. Cleanup failure tests also retry after the storage error is resolved so a failed operation cannot leave retry processing locked.

Cleanup regressions use a real Windows file lock or Unix directory permissions. They cover failed, completed and cancelled jobs, rejected retries, restart recovery and continued queue processing while preserving original errors and saved media. Startup tests launch independent backend processes against one temporary data directory, verify exclusive ownership across different ports, and kill the owner to verify immediate recovery. They also verify release on scope exit and preserve errors from a damaged lock database so storage failures cannot masquerade as a running backend. Saved PIDs never decide whether persisted jobs can be recovered.

Process-boundary tests use real Node children to verify independent stdout/stderr line buffering, split lines, CRLF and unterminated final lines, progress callback failures and output bounds. Stderr diagnostics remain separate from stdout metadata when no callback is supplied.

`bun run test:downloads:real` is the separate opt-in test for the actual yt-dlp pipeline. It previews and downloads a public YouTube video, checks its real probed library entry and removes its isolated data directory. It requires installed yt-dlp, FFmpeg/FFprobe and internet access. `MOVO_TEST_YOUTUBE_URL` optionally selects another video. This check is excluded from normal tests, pre-commit and CI; source availability can cause it to fail independently of application changes.

Model setup tests use tiny generated GGUF files from a loopback HTTP server and real isolated HF cache directories. Use the real parser and integrity checks; cover existing regular/linked files, same-size corruption, external repair, publication collisions, two independent Node writers, cancellation, shutdown and cleanup failures. Keep a real no-weights engine initialization and invalid-GGUF rejection check so missing native runtime/package failures cannot masquerade as successful corrupt-model rejection. Browser route fixtures validate methods and model IDs and cover navigation, reload, cancellation, retry and repair guidance. The built browser server receives its own temporary `HF_HUB_CACHE`; tests must never inspect or alter the user's model cache.

`bun run test:models:real` is the opt-in model download/load check. It downloads the pinned 740 MB file, verifies integrity, loads it in the actual CPU worker and verifies rediscovery, then removes the temporary model files. Normal CI installs the native engine as an application dependency but never downloads weights or runs model inference. See [model setup](models.md) for the supported configuration and validation limits.
