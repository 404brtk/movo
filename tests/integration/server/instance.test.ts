import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { access, chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { expect, it, onTestFinished } from "vitest";
import { acquireDataDirectory } from "../../../src/server/instance.ts";
import { openDatabase } from "../../../src/server/db/database.ts";
import { mediaItems } from "../../../src/server/media/media.schema.ts";

it("holds ownership until scope exit and allows independent data directories", async () => {
  const directory = await mkdtemp(join(tmpdir(), "movo-instance-scope-"));
  onTestFinished(() =>
    rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
  );
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* acquireDataDirectory(directory);
        const duplicate = yield* Effect.result(Effect.scoped(acquireDataDirectory(directory)));
        expect(duplicate).toMatchObject({ _tag: "Failure" });
        yield* Effect.scoped(acquireDataDirectory(join(directory, "independent")));
      }),
    ),
  );
  await expect(
    Effect.runPromise(Effect.scoped(acquireDataDirectory(directory))),
  ).resolves.toBeDefined();
});

it("keeps the data directory, which holds API keys, private to the user on Unix", async () => {
  const directory = await mkdtemp(join(tmpdir(), "movo-instance-mode-"));
  onTestFinished(() =>
    rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
  );
  await chmod(directory, 0o755);
  const created = join(directory, "created");
  await Effect.runPromise(Effect.scoped(acquireDataDirectory(directory)));
  await Effect.runPromise(Effect.scoped(acquireDataDirectory(created)));
  const modes = [(await stat(directory)).mode & 0o777, (await stat(created)).mode & 0o777];
  const unixModes = process.platform === "win32" ? modes : [0o700, 0o700];
  expect(modes).toEqual(unixModes);
});

it("preserves storage errors and releases a failed lock connection for repair", async () => {
  const directory = await mkdtemp(join(tmpdir(), "movo-instance-invalid-"));
  onTestFinished(() =>
    rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
  );
  const path = join(directory, "instance.sqlite");
  await writeFile(path, "not a SQLite database");
  await expect(
    Effect.runPromise(Effect.scoped(acquireDataDirectory(directory))),
  ).rejects.toMatchObject({ code: "SQLITE_NOTADB" });
  await rm(path);
  await expect(
    Effect.runPromise(Effect.scoped(acquireDataDirectory(directory))),
  ).resolves.toBeDefined();
});

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (!address || typeof address === "string") throw new Error("Missing test port.");
  return address.port;
}

function backend(directory: string, port: number) {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("../../../src/server/main.ts", import.meta.url))],
    {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_ENV: "development",
        MOVO_DATA_DIR: directory,
        PORT: String(port),
        HF_HUB_CACHE: join(directory, "hf-cache"),
      },
    },
  );
  let stdout = "";
  let stderr = "";
  const ready = new Promise<void>((resolve) => {
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString()).slice(-8192);
      if (stdout.includes("Local service listening")) resolve();
    });
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-8192);
  });
  const finished = new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, output: stdout + stderr }));
  });
  return { child, ready, finished };
}

it("recovers interrupted deletions before serving media and cleans up committed deletions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "movo-deletion-recovery-"));
  let instance: ReturnType<typeof backend> | undefined;
  onTestFinished(async () => {
    if (instance) {
      if (instance.child.exitCode === null) instance.child.kill("SIGKILL");
      await instance.finished;
    }
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
  const audio = await readFile(new URL("../../fixtures/tone.wav", import.meta.url));
  const id = randomUUID();
  const originalName = "recording.wav";
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const database = yield* openDatabase(join(directory, "app.sqlite"));
        database
          .insert(mediaItems)
          .values({
            id,
            title: "Pending deletion",
            originalName,
            kind: "audio",
            contentType: "audio/wav",
            byteSize: audio.length,
            durationSeconds: 2,
            importedAt: Date.now(),
            sourceUrl: null,
          })
          .run();
      }),
    ),
  );
  await mkdir(join(directory, "media"));
  const pending = join(directory, "media", `${id}.wav.deleting`);
  const committed = join(directory, "media", `${randomUUID()}.wav.deleting`);
  const original = join(directory, originalName);
  await writeFile(pending, audio);
  await writeFile(committed, audio);
  await writeFile(original, audio);
  const port = await freePort();
  instance = backend(directory, port);
  await Promise.race([
    instance.ready,
    instance.finished.then((exit) => {
      throw new Error(exit.output);
    }),
  ]);
  const response = await fetch(`http://127.0.0.1:${port}/api/media/${id}/file`);
  expect(response.status).toBe(200);
  expect(Buffer.from(await response.arrayBuffer())).toEqual(audio);
  await expect(access(pending)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(access(committed)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(original)).toEqual(audio);
});

it("rejects a second backend for the same data directory and releases ownership after a crash", async () => {
  const directory = await mkdtemp(join(tmpdir(), "movo-instance-"));
  const children: ReturnType<typeof backend>[] = [];
  onTestFinished(async () => {
    for (const instance of children) {
      if (instance.child.exitCode === null) instance.child.kill("SIGKILL");
      await instance.finished;
    }
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
  const first = backend(directory, await freePort());
  children.push(first);
  await Promise.race([
    first.ready,
    first.finished.then((result) => {
      throw new Error(result.output);
    }),
  ]);
  const second = backend(directory, await freePort());
  children.push(second);
  const result = await Promise.race([
    second.finished.then((exit) => ({ started: false, ...exit })),
    second.ready.then(() => ({ started: true, code: null, output: "" })),
  ]);
  expect(result.started).toBe(false);
  expect(result.code).not.toBe(0);
  expect(result.output).toContain("Another Movo backend is already using this data directory");
  first.child.kill("SIGKILL");
  await first.finished;
  const port = await freePort();
  const restarted = backend(directory, port);
  children.push(restarted);
  await Promise.race([
    restarted.ready,
    restarted.finished.then((exit) => {
      throw new Error(exit.output);
    }),
  ]);
  expect((await fetch(`http://127.0.0.1:${port}/api/health`)).status).toBe(200);
});
