# Testing policy

## Test levels

- Vitest runs deterministic logic and integration tests on Node. Co-locate these tests with the behavior they verify. Filesystem tests use isolated temporary directories; database tests use real temporary SQLite files with Drizzle.
- Media import tests use local FFprobe and committed, generated audio/video fixtures from `tests/fixtures`. Install FFmpeg before running them, or set `FFPROBE_PATH` to its executable. They do not access media websites or model weights.
- Playwright runs a small Chromium suite against the built application. Verify user-visible behavior and HTTP failures using roles, labels and explicit assertions. Add browser tests when navigation or interaction changes.
- Real media-site downloads and large-model inference belong in a separate opt-in integration suite when those integrations exist. Normal tests and CI must not require model weights, credentials or third-party media availability.

Test behavior at its actual interface. A bug fix should add a regression test that fails without the fix. Cover invalid input, cleanup, cancellation and storage failures when relevant. Avoid tests that merely repeat a constant or inspect a private implementation.

Keep mocks at genuinely external interfaces. Prefer real SQLite/filesystem behavior over mocking the database driver or filesystem. Tiny controlled local fixtures are appropriate; fake product data and simulated success paths do not replace real integration checks.

## Commands and enforcement

Use `bun run test` for the fast suite, `bun run test:watch` while editing, `bun run check` for the full non-browser gate, and `bun run test:e2e` for browser checks. `package.json` owns the command definitions.

Pre-commit formats/lints staged files and runs type checks and fast tests. CI runs a frozen dependency install, formatting, linting, type checks, tests, production build and browser flows on Ubuntu. FFmpeg and browser installation are explicit setup steps.

There is no blanket coverage percentage. Add assertions where behavior and risk justify them. Do not add skipped tests, empty test suites or permissive assertions to satisfy a gate. Prefer adding a focused test over expanding a broad mock harness.

## Custom lint rules

Custom rules have valid/invalid fixture tests, including edge cases, and a CLI integration check when configuration or suppression behavior matters. The authored-code comment ban is enforced as a rule, including JSX and directive comments. See [the lint guide](../tooling/lint/README.md).

## Foundation checks

The initial suite should prove actual HTTP health/unknown-route behavior, input validation, real SQLite persistence/rollback, and the lint rule. The browser suite checks that the built application loads and talks to the local service. Product workflow tests are added with their implementation, not as empty cases in advance.

The local library suite verifies copied bytes and preserved originals, persistence after reopening SQLite, rejected/interrupted uploads, failed-insert cleanup, missing stored files and HTTP range serving. Browser tests import real fixtures, play and seek audio/video, reload detail pages, save identical bytes, recover after rejection and check the narrow layout. Ordinary tests do not use the application's normal data directory.

The development-proxy regression test runs the actual Vite proxy configuration against the local Hono API on isolated ports. It verifies same-origin writes through both `localhost` and `127.0.0.1`, and checks that foreign origins remain rejected. Built-app browser checks alone do not cover this development transport.
