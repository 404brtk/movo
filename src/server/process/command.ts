import { execFile, spawn } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import { MediaError } from "../media/error.ts";

const execute = promisify(execFile);

export function runCommand(
  file: string,
  args: string[],
  {
    timeoutMs,
    cwd,
    environment,
    onLine,
  }: {
    timeoutMs: number;
    cwd?: string;
    environment?: NodeJS.ProcessEnv;
    onLine?: (line: string) => void;
  },
) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const child = spawn(file, args, {
        cwd,
        env: environment,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
      let closed = false;
      let stdout = "";
      let pending = "";
      let stderr = "";
      let failure: unknown;
      let stopping: Promise<void> | undefined;
      let timedOut = false;
      const done = new Promise<number | null>((resolve) => {
        child.once("error", (error) => {
          failure = error;
        });
        child.once("close", (code) => {
          closed = true;
          resolve(code);
        });
      });
      const stop = () => {
        stopping ??= (async () => {
          if (closed || !child.pid) return;
          if (process.platform === "win32") {
            try {
              await execute(
                join(process.env.SystemRoot ?? "", "System32", "taskkill.exe"),
                ["/PID", String(child.pid), "/T", "/F"],
                { timeout: 5000, windowsHide: true },
              );
            } catch {
              if (!closed) child.kill("SIGKILL");
            }
          } else {
            try {
              process.kill(-child.pid, "SIGTERM");
            } catch {
              if (!closed) child.kill("SIGTERM");
            }
          }
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              done,
              new Promise<void>((resolve) => {
                timer = setTimeout(resolve, 1500);
              }),
            ]);
          } finally {
            clearTimeout(timer);
          }
          if (!closed) {
            try {
              if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
              else child.kill("SIGKILL");
            } catch {
              if (!closed) throw new Error("Could not terminate the owned media process");
            }
          }
          await done;
        })();
        return stopping;
      };
      const receive = (line: string) => {
        if (onLine) onLine(line);
        else {
          stdout += `${line}\n`;
          if (stdout.length > 8 * 1024 * 1024)
            throw new MediaError("unsupported", "The media source returned too much metadata.");
        }
      };
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        if (failure) return;
        try {
          pending += chunk;
          if (pending.length > 8 * 1024 * 1024)
            throw new MediaError(
              "unsupported",
              "The media source returned an oversized output line.",
            );
          let newline: number;
          while ((newline = pending.indexOf("\n")) >= 0) {
            receive(pending.slice(0, newline).replace(/\r$/u, ""));
            pending = pending.slice(newline + 1);
          }
        } catch (cause) {
          failure = cause;
          void stop().catch((error: unknown) => {
            failure = error;
          });
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr = (stderr + chunk).slice(-8192);
      });
      const timer = setTimeout(() => {
        timedOut = true;
        void stop().catch((error: unknown) => {
          failure = error;
        });
      }, timeoutMs);
      return {
        done,
        stop,
        finish: (code: number | null) => {
          clearTimeout(timer);
          if (timedOut)
            throw new MediaError("unavailable", "The media operation timed out. Try again.");
          if (failure instanceof MediaError) throw failure;
          if (failure instanceof Error && "code" in failure && failure.code === "ENOENT")
            throw new MediaError(
              "unavailable",
              "The required executable is unavailable. Check its installation and configuration.",
              failure,
            );
          if (failure || code !== 0) {
            const detail = stderr
              .split(/\r?\n/u)
              .findLast((line) => line.startsWith("ERROR:"))
              ?.slice(6)
              .trim()
              .slice(0, 600);
            throw new MediaError(
              "unavailable",
              detail
                ? `The media command failed: ${detail}`
                : "The media command failed. Check the required tools and try again.",
              failure ?? new Error(stderr),
            );
          }
          if (pending) receive(pending);
          return stdout;
        },
        clear: () => clearTimeout(timer),
      };
    }),
    (command) =>
      Effect.tryPromise({
        try: async () => command.finish(await command.done),
        catch: (cause) =>
          cause instanceof MediaError
            ? cause
            : new MediaError("unavailable", "Could not run the media command.", cause),
      }),
    (command) =>
      Effect.promise(async () => {
        command.clear();
        await command.stop();
      }),
  );
}
