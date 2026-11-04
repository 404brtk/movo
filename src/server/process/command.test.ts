import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { Effect, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import { runCommand } from "./command.ts";
import { MediaError } from "../media/error.ts";

describe("owned background processes", () => {
  it("delivers separate complete lines from stdout and stderr, including split and unterminated lines", async () => {
    const lines: string[] = [];
    await Effect.runPromise(
      runCommand(
        process.execPath,
        [
          "-e",
          "process.stdout.write('OUT_A\\r'); process.stderr.write('MOVO_PRO'); setTimeout(() => { process.stdout.write('\\nOUT_B'); process.stderr.write('CESSING\\r\\nERR_END'); }, 20)",
        ],
        {
          timeoutMs: 5000,
          onLine: (line) => {
            lines.push(line);
          },
        },
      ),
    );
    expect(lines.filter((line) => line.startsWith("OUT_"))).toEqual(["OUT_A", "OUT_B"]);
    expect(lines.filter((line) => !line.startsWith("OUT_"))).toEqual([
      "MOVO_PROCESSING",
      "ERR_END",
    ]);
  });

  it("keeps stderr warnings out of stdout metadata without a line callback", async () => {
    const output = await Effect.runPromise(
      runCommand(
        process.execPath,
        [
          "-e",
          "process.stdout.write('{\"ok\":true}'); process.stderr.write('WARNING: diagnostic output\\n');",
        ],
        { timeoutMs: 5000 },
      ),
    );
    expect(JSON.parse(output)).toEqual({ ok: true });
  });

  it("stops the process and preserves a progress callback failure from stderr", async () => {
    await expect(
      Effect.runPromise(
        runCommand(
          process.execPath,
          [
            "-e",
            "process.stderr.write('MOVO_PROGRESS:over limit\\n'); setInterval(() => {}, 1000)",
          ],
          {
            timeoutMs: 5000,
            onLine: () => {
              throw new MediaError("tooLarge", "The download exceeds the limit.");
            },
          },
        ),
      ),
    ).rejects.toMatchObject({ reason: "tooLarge", message: "The download exceeds the limit." });
  });
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
  it("bounds stderr progress lines before invoking the callback", async () => {
    await expect(
      Effect.runPromise(
        runCommand(process.execPath, ["-e", "process.stderr.write('x'.repeat(9 * 1024 * 1024))"], {
          timeoutMs: 5000,
          onLine: () => undefined,
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
