import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { Effect, Result, Schema } from "effect";
import { MediaToolsStatus } from "../../shared/contracts/media-tools.ts";
import { MediaError } from "../media/error.ts";
import { extractArchive, tarExecutable } from "./archive.ts";
import { downloadFile } from "../files/download.ts";
import { mediaToolsPackage, type MediaToolsPackage } from "./packages.ts";

const execute = promisify(execFile);
const ActiveInstallation = Schema.Struct({
  directory: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9.-]+$/u)),
});
type Tool = "ffprobe" | "ffmpeg";
type Availability = MediaToolsStatus[Tool];
type LocatedTool = { status: Availability; path: string | null };

export interface MediaToolsConfig {
  dataDirectory: string;
  ffprobePath?: string | undefined;
  ffmpegPath?: string | undefined;
}

async function runExecutable(path: string, args: string[], signal: AbortSignal) {
  const { stdout } = await execute(path, args, {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    signal,
  });
  return stdout;
}

function toolsError(cause: unknown) {
  return cause instanceof MediaError
    ? cause
    : new MediaError(
        "unavailable",
        "Could not prepare media tools. Check your connection, disk space and folder permissions, then try again.",
        cause,
      );
}

export function createMediaTools(
  config: MediaToolsConfig,
  {
    build = mediaToolsPackage(),
    environment = process.env,
    run = runExecutable,
  }: {
    build?: MediaToolsPackage | null;
    environment?: NodeJS.ProcessEnv;
    run?: typeof runExecutable;
  } = {},
) {
  const root = join(config.dataDirectory, "tools", "ffmpeg");
  const activePath = join(root, "active.json");
  const staging = join(root, ".installing");
  const lifetime = new AbortController();
  let installation: MediaToolsStatus["installation"] = {
    phase: "idle",
    downloadedBytes: 0,
    error: null,
  };
  let running: Promise<void> | undefined;

  const inspectExecutable = async (
    path: string,
    tool: Tool,
    source: "configured" | "managed" | "system",
    signal: AbortSignal,
  ): Promise<LocatedTool> => {
    try {
      const stdout = await run(path, ["-version"], signal);
      const version = new RegExp(`^${tool} version ([^\\s]+)`, "u").exec(stdout)?.[1];
      if (!version) throw new Error("Unexpected executable version output");
      return { path, status: { state: "ready", source, version } };
    } catch {
      return {
        path: null,
        status: {
          state: "broken",
          source,
          message:
            source === "configured"
              ? `${tool} could not run. Correct or remove ${tool.toUpperCase()}_PATH and restart Movo.`
              : `${tool} could not run. Download media tools to repair the managed installation.`,
        },
      };
    }
  };

  const locate = async (tool: Tool, signal: AbortSignal): Promise<LocatedTool> => {
    const configured = tool === "ffprobe" ? config.ffprobePath : config.ffmpegPath;
    if (configured) return inspectExecutable(configured, tool, "configured", signal);
    const filename = `${tool}${process.platform === "win32" ? ".exe" : ""}`;
    try {
      const active = Schema.decodeUnknownSync(ActiveInstallation)(
        JSON.parse(await readFile(activePath, "utf8")),
      );
      return inspectExecutable(join(root, active.directory, filename), tool, "managed", signal);
    } catch (cause) {
      if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) {
        return {
          path: null,
          status: {
            state: "broken",
            source: "managed",
            message:
              "The managed media tools installation is invalid. Download it again to repair it.",
          },
        };
      }
    }
    for (const entry of (environment.PATH ?? "").split(delimiter)) {
      const directory = entry.replace(/^"|"$/gu, "");
      if (!isAbsolute(directory)) continue;
      const path = join(directory, filename);
      try {
        await access(path, constants.F_OK);
      } catch (cause) {
        if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") continue;
        throw cause;
      }
      return inspectExecutable(path, tool, "system", signal);
    }
    return { path: null, status: { state: "missing" } };
  };

  const status = () =>
    Effect.tryPromise({
      try: async (signal) => {
        const [ffprobe, ffmpeg] = await Promise.all([
          locate("ffprobe", signal),
          locate("ffmpeg", signal),
        ]);
        return Schema.decodeUnknownSync(MediaToolsStatus)({
          ffprobe: ffprobe.status,
          ffmpeg: ffmpeg.status,
          download: build
            ? {
                provider: build.provider,
                sourceUrl: build.sourceUrl,
                version: build.version,
                bytes: build.bytes,
              }
            : null,
          installation,
        });
      },
      catch: toolsError,
    });

  const installBuild = (selected: MediaToolsPackage) =>
    Effect.tryPromise({
      try: async (parentSignal) => {
        const signal = AbortSignal.any([
          parentSignal,
          lifetime.signal,
          AbortSignal.timeout(10 * 60 * 1000),
        ]);
        await mkdir(root, { recursive: true });
        const directoryName = `${selected.id}-${randomUUID()}`;
        const destination = join(root, directoryName);
        const activeTemporary = join(root, `.active-${randomUUID()}`);
        let activated = false;
        try {
          try {
            await runExecutable(tarExecutable(), ["--version"], signal);
          } catch (cause) {
            throw new MediaError(
              "unavailable",
              "Media tools need tar to unpack their download. Install tar (and xz on Linux), then try again, or configure existing FFmpeg and FFprobe.",
              cause,
            );
          }
          await rm(staging, { recursive: true, force: true });
          await mkdir(staging);
          const archive = join(staging, "download");
          installation = { phase: "downloading", downloadedBytes: 0, error: null };
          await downloadFile(selected, archive, signal, (downloadedBytes) => {
            installation = {
              ...installation,
              downloadedBytes,
              phase: downloadedBytes === selected.bytes ? "verifying" : "downloading",
            };
          });
          installation = { ...installation, phase: "verifying" };
          const unpacked = join(staging, "unpacked");
          await mkdir(unpacked);
          installation = { ...installation, phase: "extracting" };
          await extractArchive(selected, archive, unpacked, signal);
          installation = { ...installation, phase: "validating" };
          for (const tool of ["ffprobe", "ffmpeg"] as const) {
            const path = join(unpacked, `${tool}${process.platform === "win32" ? ".exe" : ""}`);
            const inspected = await inspectExecutable(path, tool, "managed", signal);
            if (inspected.status.state !== "ready")
              throw new MediaError(
                "unavailable",
                `The downloaded ${tool} could not run on this computer. No tools were activated.`,
              );
          }
          await rename(unpacked, destination);
          await writeFile(activeTemporary, JSON.stringify({ directory: directoryName }), {
            flag: "wx",
          });
          await rename(activeTemporary, activePath);
          activated = true;
          installation = { ...installation, phase: "complete" };
        } finally {
          await rm(activeTemporary, { force: true });
          await rm(staging, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
          if (!activated)
            await rm(destination, {
              recursive: true,
              force: true,
              maxRetries: 3,
              retryDelay: 100,
            });
        }
      },
      catch: toolsError,
    });

  return {
    status,
    resolve: (tool: Tool) =>
      Effect.tryPromise({
        try: async (signal) => {
          const found = await locate(tool, signal);
          if (found.path) return found.path;
          throw new MediaError(
            "unavailable",
            found.status.state === "broken"
              ? found.status.message
              : `${tool === "ffprobe" ? "FFprobe" : "FFmpeg"} is unavailable. Download media tools in Movo or configure its executable path.`,
          );
        },
        catch: toolsError,
      }),
    install: () =>
      Effect.gen(function* () {
        if (running) return yield* status();
        const current = yield* status();
        if (running) return yield* status();
        for (const tool of [current.ffprobe, current.ffmpeg]) {
          if (tool.state === "broken" && tool.source === "configured")
            return yield* Effect.fail(new MediaError("unavailable", tool.message));
        }
        if (current.ffprobe.state === "ready" && current.ffmpeg.state === "ready") return current;
        if (!build)
          return yield* Effect.fail(
            new MediaError(
              "unavailable",
              "Automatic media tools downloads are unavailable for this platform. Install FFmpeg and FFprobe manually and configure their paths.",
            ),
          );
        if (lifetime.signal.aborted)
          return yield* Effect.fail(
            new MediaError(
              "unavailable",
              "Movo is shutting down. Restart it before installing media tools.",
            ),
          );
        installation = { phase: "downloading", downloadedBytes: 0, error: null };
        running = Effect.runPromise(Effect.result(installBuild(build)))
          .then((result) => {
            if (Result.isFailure(result))
              installation = { ...installation, phase: "failed", error: result.failure.message };
            return undefined;
          })
          .finally(() => {
            running = undefined;
          });
        return { ...current, installation };
      }),
    close: () =>
      Effect.promise(async () => {
        lifetime.abort();
        await running;
      }),
  };
}

export type MediaTools = ReturnType<typeof createMediaTools>;
