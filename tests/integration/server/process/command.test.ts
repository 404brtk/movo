import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { Effect, Fiber } from "effect";
import { describe, expect, it, onTestFinished } from "vitest";
import { runCommand } from "../../../../src/server/process/command.ts";
import { MediaError } from "../../../../src/server/media/error.ts";
import { spawn } from "node:child_process";

describe("owned background processes", () => {
  it("stops an IPC worker after abrupt termination of its owner", async () => {
    const directory = await mkdtemp(join(tmpdir(), "movo-process-owner-"));
    const started = join(directory, "started");
    const childCode = `const fs = require('node:fs'); process.once('disconnect', () => process.exit(0)); fs.writeFileSync(${JSON.stringify(started)}, JSON.stringify({pid: process.pid, connected: process.connected, parent: process.ppid})); setInterval(() => {}, 1000)`;
    const source = `import { Effect } from 'effect'; import { runCommand } from ${JSON.stringify(new URL("../../../../src/server/process/command.ts", import.meta.url).href)}; await Effect.runPromise(runCommand(process.execPath, ['-e', ${JSON.stringify(childCode)}], { timeoutMs: 10000, ipc: true }));`;
    const owner = spawn(process.execPath, ["--input-type=module", "-e", source], {
      windowsHide: true,
      stdio: "ignore",
    });
    const exited = new Promise<void>((resolve, reject) => {
      owner.once("error", reject);
      owner.once("close", () => resolve());
    });
    let workerPid: number | undefined;
    onTestFinished(async () => {
      if (owner.exitCode === null && owner.signalCode === null) owner.kill("SIGKILL");
      await exited;
      if (!workerPid) {
        const info: { pid?: number } = JSON.parse(
          await readFile(started, "utf8").catch(() => "{}"),
        );
        workerPid = info.pid;
      }
      if (workerPid && workerPid > 0) {
        try {
          process.kill(workerPid, "SIGKILL");
        } catch (cause) {
          if (!(cause instanceof Error && "code" in cause && cause.code === "ESRCH")) throw cause;
        }
      }
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    });
    await expect
      .poll(async () => Boolean(await stat(started).catch(() => null)), { timeout: 5000 })
      .toBe(true);
    const info: { pid: number; connected: boolean; parent: number } = JSON.parse(
      await readFile(started, "utf8"),
    );
    workerPid = info.pid;
    expect(info.pid).toBeGreaterThan(0);
    expect(info.connected).toBe(true);
    expect(info.parent).toBe(owner.pid);
    owner.kill("SIGKILL");
    await exited;
    await expect
      .poll(
        () => {
          try {
            process.kill(info.pid, 0);
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 3000 },
      )
      .toBe(false);
  });
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
