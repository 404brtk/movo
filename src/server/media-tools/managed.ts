import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { Effect, Result, Schema } from "effect";
import type {
  ToolAvailability,
  ToolDownload,
  ToolInstallation,
} from "../../shared/contracts/media-tools.ts";
import { downloadFile } from "../files/download.ts";
import { MediaError } from "../media/error.ts";

const execute = promisify(execFile);
const ActiveInstallation = Schema.Struct({
  directory: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9.-]+$/u)),
});
export const executableSuffix = process.platform === "win32" ? ".exe" : "";
type LocatedTool = { status: ToolAvailability; path: string | null };

export type ToolsStatus<Name extends string> = { readonly [Tool in Name]: ToolAvailability } & {
  readonly download: ToolDownload | null;
  readonly installation: ToolInstallation;
};

export interface ToolPackage extends ToolDownload {
  id: string;
  url: string;
  sha256: string;
}

export interface ManagedExecutable {
  label: string;
  filename: string;
  setting: string;
  configuredPath: string | undefined;
  versionArguments: string[];
  readVersion: (output: string) => string | undefined;
}

export interface ManagedToolsDefinition<
  Name extends string,
  Status extends ToolsStatus<Name>,
  Package extends ToolPackage,
> {
  name: string;
  directory: string;
  manualSetup: string;
  executables: Record<Name, ManagedExecutable>;
  status: Schema.Codec<Status, unknown>;
  prepare?: (signal: AbortSignal) => Promise<void>;
  unpack: (
    build: Package,
    archive: string,
    destination: string,
    signal: AbortSignal,
  ) => Promise<void>;
}

export interface ManagedToolsOptions<Package extends ToolPackage> {
  build: Package | null;
  environment?: NodeJS.ProcessEnv;
  run?: typeof runExecutable;
}

export async function runExecutable(path: string, args: string[], signal: AbortSignal) {
  const { stdout } = await execute(path, args, {
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    signal,
  });
  return stdout;
}

export function createManagedTools<
  Name extends string,
  Status extends ToolsStatus<Name>,
  Package extends ToolPackage,
>(
  definition: ManagedToolsDefinition<Name, Status, Package>,
  dataDirectory: string,
  { build, environment = process.env, run = runExecutable }: ManagedToolsOptions<Package>,
) {
  const root = join(dataDirectory, "tools", definition.directory);
  const activePath = join(root, "active.json");
  const staging = join(root, ".installing");
  const lifetime = new AbortController();
  let installation: ToolInstallation = { phase: "idle", downloadedBytes: 0, error: null };
  let running: Promise<void> | undefined;

  const toolsError = (cause: unknown) =>
    cause instanceof MediaError
      ? cause
      : new MediaError(
          "unavailable",
          `Could not prepare ${definition.name}. Check your connection, disk space and folder permissions, then try again.`,
          cause,
        );

  const inspectExecutable = async (
    path: string,
    executable: ManagedExecutable,
    source: "configured" | "managed" | "system",
    signal: AbortSignal,
  ): Promise<LocatedTool> => {
    try {
      const version = executable.readVersion(await run(path, executable.versionArguments, signal));
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
              ? `${executable.label} could not run. Correct or remove ${executable.setting} and restart Movo.`
              : `${executable.label} could not run. Download ${definition.name} to repair the managed installation.`,
        },
      };
    }
  };

  const locate = async (
    executable: ManagedExecutable,
    signal: AbortSignal,
  ): Promise<LocatedTool> => {
    const configured = executable.configuredPath;
    if (configured)
      return inspectExecutable(
        /[/\\]/u.test(configured) ? resolve(configured) : configured,
        executable,
        "configured",
        signal,
      );
    const filename = `${executable.filename}${executableSuffix}`;
    try {
      const active = Schema.decodeUnknownSync(ActiveInstallation)(
        JSON.parse(await readFile(activePath, "utf8")),
      );
      return inspectExecutable(
        join(root, active.directory, filename),
        executable,
        "managed",
        signal,
      );
    } catch (cause) {
      if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) {
        return {
          path: null,
          status: {
            state: "broken",
            source: "managed",
            message: `The managed ${definition.name} installation is invalid. Download it again to repair it.`,
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
      return inspectExecutable(path, executable, "system", signal);
    }
    return { path: null, status: { state: "missing" } };
  };

  const inspect = () =>
    Effect.tryPromise({
      try: async (signal) => {
        const tools = await Promise.all(
          Object.entries<ManagedExecutable>(definition.executables).map(
            async ([name, executable]) =>
              [name, (await locate(executable, signal)).status] as const,
          ),
        );
        return {
          tools: tools.map(([, availability]) => availability),
          status: Schema.decodeUnknownSync(definition.status)({
            ...Object.fromEntries(tools),
            download: build
              ? {
                  provider: build.provider,
                  sourceUrl: build.sourceUrl,
                  version: build.version,
                  bytes: build.bytes,
                }
              : null,
            installation,
          }),
        };
      },
      catch: toolsError,
    });
  const status = () => inspect().pipe(Effect.map((current) => current.status));

  const installBuild = (selected: Package) =>
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
          await definition.prepare?.(signal);
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
          await definition.unpack(selected, archive, unpacked, signal);
          installation = { ...installation, phase: "validating" };
          for (const executable of Object.values<ManagedExecutable>(definition.executables)) {
            const path = join(unpacked, `${executable.filename}${executableSuffix}`);
            const inspected = await inspectExecutable(path, executable, "managed", signal);
            if (inspected.status.state !== "ready")
              throw new MediaError(
                "unavailable",
                `The downloaded ${executable.label} could not run on this computer. No tools were activated.`,
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
    resolve: (name: Name) =>
      Effect.tryPromise({
        try: async (signal) => {
          const executable = definition.executables[name];
          const found = await locate(executable, signal);
          if (found.path) return found.path;
          throw new MediaError(
            "unavailable",
            found.status.state === "broken"
              ? found.status.message
              : `${executable.label} is unavailable. Download ${definition.name} in Movo or set ${executable.setting}.`,
          );
        },
        catch: toolsError,
      }),
    install: () =>
      Effect.gen(function* () {
        if (running) return yield* status();
        const current = yield* inspect();
        if (running) return yield* status();
        for (const tool of current.tools) {
          if (tool.state === "broken" && tool.source === "configured")
            return yield* Effect.fail(new MediaError("unavailable", tool.message));
        }
        if (current.tools.every((tool) => tool.state === "ready")) return current.status;
        if (!build)
          return yield* Effect.fail(
            new MediaError(
              "unavailable",
              `Automatic ${definition.name} downloads are unavailable for this platform. ${definition.manualSetup}`,
            ),
          );
        if (lifetime.signal.aborted)
          return yield* Effect.fail(
            new MediaError(
              "unavailable",
              `Movo is shutting down. Restart it before installing ${definition.name}.`,
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
        return { ...current.status, installation };
      }),
    close: () =>
      Effect.promise(async () => {
        lifetime.abort();
        await running;
      }),
  };
}
