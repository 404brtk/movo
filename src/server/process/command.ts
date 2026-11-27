import { execFile, spawn } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import { MediaError } from "../media/error.ts";

const execute = promisify(execFile);

function rejectOversizedLine(length: number, maxOutputBytes: number) {
  if (length > maxOutputBytes)
    throw new MediaError("unsupported", "The media source returned an oversized output line.");
}

type CommandOptions = {
  timeoutMs?: number;
  cwd?: string;
  environment?: NodeJS.ProcessEnv;
  onLine?: (line: string) => void;
  ipc?: boolean;
  maxOutputBytes?: number;
};

function startCommand(
  file: string,
  args: string[],
  {
    timeoutMs,
    cwd,
    environment,
    onLine,
    ipc = false,
    maxOutputBytes = 20 * 1024 * 1024,
  }: CommandOptions,
  readLines = false,
) {
  const child = spawn(file, args, {
    cwd,
    env: environment,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe", ipc ? "ipc" : "ignore"],
  });
  let closed = false;
  let stdout = "";
  const pending = { stdout: "", stderr: "" };
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
      if (readLines) child.stdout?.destroy();
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
  const receive = (line: string, stream: "stdout" | "stderr") => {
    if (onLine) onLine(line);
    else if (stream === "stdout") {
      stdout += `${line}\n`;
      if (stdout.length > maxOutputBytes)
        throw new MediaError("unsupported", "The media source returned too much metadata.");
    }
  };
  const consume = (stream: "stdout" | "stderr", chunk: string) => {
    if (stream === "stderr") {
      stderr = (stderr + chunk).slice(-8192);
      if (!onLine) return;
    }
    if (failure) return;
    try {
      let searchFrom = pending[stream].length;
      pending[stream] += chunk;
      let newline: number;
      while ((newline = pending[stream].indexOf("\n", searchFrom)) >= 0) {
        rejectOversizedLine(newline, maxOutputBytes);
        receive(pending[stream].slice(0, newline).replace(/\r$/u, ""), stream);
        pending[stream] = pending[stream].slice(newline + 1);
        searchFrom = 0;
      }
      rejectOversizedLine(pending[stream].length, maxOutputBytes);
    } catch (cause) {
      failure = cause;
      void stop().catch((error: unknown) => {
        failure = error;
      });
    }
  };
  child.stdout?.setEncoding("utf8");
  if (!readLines) child.stdout?.on("data", (chunk: string) => consume("stdout", chunk));
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => consume("stderr", chunk));
  const timer =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          void stop().catch((error: unknown) => {
            failure = error;
          });
        }, timeoutMs);
  return {
    done,
    stop,
    output: child.stdout,
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
      for (const stream of ["stdout", "stderr"] as const) {
        if (pending[stream]) receive(pending[stream].replace(/\r$/u, ""), stream);
      }
      return stdout;
    },
    clear: () => clearTimeout(timer),
  };
}

function commandFailure(cause: unknown) {
  return cause instanceof MediaError
    ? cause
    : new MediaError("unavailable", "Could not run the media command.", cause);
}

type Command = ReturnType<typeof startCommand>;

const releaseCommand = (command: Command) =>
  Effect.promise(async () => {
    command.clear();
    await command.stop();
  });

export function runCommand(
  file: string,
  args: string[],
  options: CommandOptions & { timeoutMs: number },
) {
  return Effect.acquireUseRelease(
    Effect.sync(() => startCommand(file, args, options)),
    (command) =>
      Effect.tryPromise({
        try: async () => command.finish(await command.done),
        catch: commandFailure,
      }),
    releaseCommand,
  );
}

export function streamCommand(file: string, args: string[], maxLineLength: number) {
  return Effect.acquireRelease(
    Effect.try({
      try: () => startCommand(file, args, {}, true),
      catch: commandFailure,
    }),
    releaseCommand,
  ).pipe(
    Effect.map(async function* (command) {
      if (!command.output)
        throw new MediaError("unavailable", "Could not read the media command output.");
      let pending = "";
      try {
        for await (const chunk of command.output as AsyncIterable<string>) {
          const lines = (pending + chunk).split("\n");
          pending = lines.pop() ?? "";
          for (const line of lines) {
            rejectOversizedLine(line.length, maxLineLength);
            yield line.replace(/\r$/u, "");
          }
          rejectOversizedLine(pending.length, maxLineLength);
        }
        command.finish(await command.done);
        if (pending) yield pending.replace(/\r$/u, "");
      } catch (cause) {
        if (!(cause instanceof MediaError)) {
          await command.stop();
          command.finish(await command.done);
        }
        throw commandFailure(cause);
      }
    }),
  );
}
