import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "movo-browser-"));
try {
  const result = spawnSync(
    process.execPath,
    [resolve("node_modules/@playwright/test/cli.js"), "test", ...process.argv.slice(2)],
    {
      stdio: "inherit",
      env: { ...process.env, MOVO_TEST_DATA_DIR: directory },
    },
  );
  if (result.error) {
    throw result.error;
  }
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
