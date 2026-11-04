import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { Effect, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import { runCommand } from "./command.ts";

describe("owned background processes", () => {
  it("passes arguments without a shell and preserves stdout", async () => {
    const result = await Effect.runPromise(
      runCommand(
        process.execPath,
        [
          "-e",
          "console.log(JSON.stringify(process.argv.slice(1)))",
          "a path with spaces",
          "$(not-a-command)",
        ],
        { timeoutMs: 5000 },
      ),
    );
    expect(JSON.parse(result)).toEqual(["a path with spaces", "$(not-a-command)"]);
  });
  it("surfaces the source's error instead of silently accepting a failed command", async () => {
    await expect(
      Effect.runPromise(
        runCommand(
          process.execPath,
          ["-e", "console.error('ERROR: This video is unavailable'); process.exit(7)"],
          { timeoutMs: 5000 },
        ),
      ),
    ).rejects.toThrow("This video is unavailable");
  });
  it("times out a stalled executable", async () => {
    await expect(
      Effect.runPromise(
        runCommand(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 100 }),
      ),
    ).rejects.toThrow("timed out");
  });
  it("rejects oversized output", async () => {
    await expect(
      Effect.runPromise(
        runCommand(process.execPath, ["-e", "process.stdout.write('x'.repeat(9 * 1024 * 1024))"], {
          timeoutMs: 5000,
        }),
      ),
    ).rejects.toThrow("oversized output line");
  });
  it("waits for the owned process tree to stop when its fiber is cancelled", async () => {
    const directory = await mkdtemp(join(tmpdir(), "movo-process-tree-"));
    const started = join(directory, "started");
    const escaped = join(directory, "escaped");
    const childCode = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(escaped)}, 'escaped'), 1200)`;
    const parentCode = `const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childCode)}], {stdio: 'inherit'}); require('node:fs').writeFileSync(${JSON.stringify(started)}, String(child.pid)); setInterval(() => {}, 1000)`;
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const fiber = yield* Effect.forkChild(
              runCommand(process.execPath, ["-e", parentCode], { timeoutMs: 10000 }),
            );
            yield* Effect.promise(async () => {
              await expect
                .poll(async () => Boolean(await stat(started).catch(() => null)))
                .toBe(true);
            });
            expect(Number(yield* Effect.promise(() => readFile(started, "utf8")))).toBeGreaterThan(
              0,
            );
            yield* Fiber.interrupt(fiber);
            yield* Effect.promise(() => setTimeout(1400));
            expect(yield* Effect.promise(() => stat(escaped).catch(() => null))).toBeNull();
          }),
        ),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
