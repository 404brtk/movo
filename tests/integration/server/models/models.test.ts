import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type RequestListener, type ServerResponse } from "node:http";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { Effect, Schema } from "effect";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  activeModelPhases,
  ModelCatalog,
  ModelStatus,
} from "../../../../src/shared/contracts/models.ts";
import type { AppDatabase } from "../../../../src/server/db/database.ts";
import { createApp } from "../../../../src/server/http/app.ts";
import { huggingFaceCacheDirectory, modelCachePath } from "../../../../src/server/models/cache.ts";
import {
  pyannoteModel,
  transcriptionModel,
  type ModelDefinition,
  type ModelFile,
} from "../../../../src/server/models/catalog.ts";
import { createModels, type Models } from "../../../../src/server/models/models.ts";
import { validateModel } from "../../../../src/server/models/validation.ts";
import { openTestDatabase } from "../../../helpers/test-database.ts";

const execute = promisify(execFile);

it("resolves only verified cached weights without starting a download", async () => {
  await withModels(async ({ create, path, requests }) => {
    const models = create();
    await expect(Effect.runPromise(models.resolve(transcriptionModel.id))).rejects.toThrow(
      /Download/u,
    );
    expect(requests()).toBe(0);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, weights);
    expect(await Effect.runPromise(models.resolve(transcriptionModel.id))).toEqual({
      transcription: path,
    });
    await writeFile(path, Buffer.alloc(weights.length, 1));
    await expect(Effect.runPromise(models.resolve(transcriptionModel.id))).rejects.toThrow(
      /integrity/u,
    );
    expect(requests()).toBe(0);
    await Effect.runPromise(models.close());
    await expect(Effect.runPromise(models.resolve(transcriptionModel.id))).rejects.toThrow(
      /shutting down/u,
    );
  });
});

function speakerFixture(cacheDirectory: string, url: string) {
  const { segmentation: segmentationFile, embedding: embeddingFile } = pyannoteModel.files;
  const segmentation = Buffer.from("segmentation weights");
  const embedding = Buffer.from("speaker embedding weights");
  const definition = {
    ...pyannoteModel,
    files: {
      segmentation: {
        ...segmentationFile,
        url: `${url}/segmentation`,
        bytes: segmentation.length,
        sha256: digest(segmentation),
      },
      embedding: {
        ...embeddingFile,
        url: `${url}/embedding`,
        bytes: embedding.length,
        sha256: digest(embedding),
      },
    },
  } satisfies ModelDefinition;
  const segmentationPath = modelCachePath(cacheDirectory, definition.files.segmentation);
  const embeddingPath = modelCachePath(cacheDirectory, definition.files.embedding);
  return { definition, segmentation, embedding, segmentationPath, embeddingPath };
}

it("keeps the optional speaker models separate and treats them as absent until every file is verified", async () => {
  await withModels(async ({ cacheDirectory, file, definition, create, requests }) => {
    const speakers = speakerFixture(cacheDirectory, file.url);
    const { embedding, segmentation } = speakers.definition.files;
    const models = create(definition, {
      ...speakers.definition,
      files: { embedding, segmentation },
    });
    const catalog = await Effect.runPromise(models.list());
    expect(catalog.speakerModelId).toBeNull();
    expect(
      catalog.models.map(({ id, role, state, bytes, maxSpeakers }) => ({
        id,
        role,
        state,
        bytes,
        maxSpeakers,
      })),
    ).toEqual([
      {
        id: transcriptionModel.id,
        role: "transcription",
        state: "missing",
        bytes: file.bytes,
        maxSpeakers: undefined,
      },
      {
        id: pyannoteModel.id,
        role: "speakers",
        state: "missing",
        bytes: speakers.segmentation.length + speakers.embedding.length,
        maxSpeakers: 32,
      },
    ]);
    const missing =
      /Speaker labels use Pyannote, which is not installed\. Download it in Settings/u;
    await expect(Effect.runPromise(models.resolve(pyannoteModel.id))).rejects.toThrow(missing);
    await mkdir(dirname(speakers.segmentationPath), { recursive: true });
    await writeFile(speakers.segmentationPath, speakers.segmentation);
    await expect(Effect.runPromise(models.resolve(pyannoteModel.id))).rejects.toThrow(missing);
    await mkdir(dirname(speakers.embeddingPath), { recursive: true });
    await writeFile(speakers.embeddingPath, Buffer.alloc(speakers.embedding.length, 1));
    await expect(Effect.runPromise(models.resolve(pyannoteModel.id))).rejects.toThrow(
      /wespeaker_en_voxceleb_resnet34_LM\.onnx.*integrity/u,
    );
    await writeFile(speakers.embeddingPath, speakers.embedding);
    const repairedAt = new Date(Date.now() + 60000);
    await utimes(speakers.embeddingPath, repairedAt, repairedAt);
    expect(await Effect.runPromise(models.resolve(pyannoteModel.id))).toEqual({
      segmentation: speakers.segmentationPath,
      embedding: speakers.embeddingPath,
    });
    await expect(Effect.runPromise(models.resolve(transcriptionModel.id))).rejects.toThrow(
      /Download Parakeet Ultra/u,
    );
    await expect(Effect.runPromise(models.resolve("unknown"))).rejects.toThrow(/Model not found/u);
    expect(requests()).toBe(0);
  });
});

it("uses only a verified speaker model for speaker labels and keeps the choice", async () => {
  await withModels(async ({ cacheDirectory, file, definition, create, requests }) => {
    const speakers = speakerFixture(cacheDirectory, file.url);
    const models = create(definition, speakers.definition);
    const choose = (speakerModelId: typeof pyannoteModel.id | null) =>
      Effect.runPromise(models.chooseSpeakerLabels(speakerModelId));
    await expect(choose(pyannoteModel.id)).rejects.toMatchObject({
      reason: "invalid",
      message: "Download Pyannote before using it for speaker labels.",
    });
    await mkdir(dirname(speakers.segmentationPath), { recursive: true });
    await writeFile(speakers.segmentationPath, speakers.segmentation);
    await mkdir(dirname(speakers.embeddingPath), { recursive: true });
    await writeFile(speakers.embeddingPath, Buffer.alloc(speakers.embedding.length, 1));
    await expect(choose(pyannoteModel.id)).rejects.toMatchObject({
      reason: "invalid",
      message: expect.stringMatching(/integrity/u),
    });
    await writeFile(speakers.embeddingPath, speakers.embedding);
    const repairedAt = new Date(Date.now() + 60000);
    await utimes(speakers.embeddingPath, repairedAt, repairedAt);
    expect(await choose(pyannoteModel.id)).toEqual({ speakerModelId: pyannoteModel.id });
    const reopened = create(definition, speakers.definition);
    expect((await Effect.runPromise(reopened.list())).speakerModelId).toBe(pyannoteModel.id);
    expect(await choose(null)).toEqual({ speakerModelId: null });
    expect((await Effect.runPromise(reopened.list())).speakerModelId).toBeNull();
    expect(requests()).toBe(0);
  });
});

it("saves concurrent speaker labels choices in the order they arrive", async () => {
  await withModels(async ({ cacheDirectory, file, definition, create }) => {
    const speakers = speakerFixture(cacheDirectory, file.url);
    await mkdir(dirname(speakers.segmentationPath), { recursive: true });
    await writeFile(speakers.segmentationPath, speakers.segmentation);
    await mkdir(dirname(speakers.embeddingPath), { recursive: true });
    await writeFile(speakers.embeddingPath, speakers.embedding);
    const models = create(definition, speakers.definition);
    await Effect.runPromise(
      Effect.all([models.chooseSpeakerLabels(pyannoteModel.id), models.chooseSpeakerLabels(null)], {
        concurrency: "unbounded",
      }),
    );
    expect((await Effect.runPromise(models.list())).speakerModelId).toBeNull();
  });
});

it("uses a speaker model for speaker labels once its download completes", async () => {
  await withModels(async ({ cacheDirectory, file, respond, create }) => {
    const speakers = speakerFixture(cacheDirectory, file.url);
    respond((request, response) =>
      response.end(
        request.url === "/weights/segmentation" ? speakers.segmentation : speakers.embedding,
      ),
    );
    const models = create(speakers.definition);
    await Effect.runPromise(models.install(pyannoteModel.id));
    expect(await finished(models)).toMatchObject({
      state: "ready",
      installation: { phase: "complete" },
    });
    expect((await Effect.runPromise(models.list())).speakerModelId).toBe(pyannoteModel.id);
  });
});

it("fails the download and keeps speaker labels off when a cached file disappears meanwhile", async () => {
  await withModels(async ({ cacheDirectory, file, respond, create }) => {
    const speakers = speakerFixture(cacheDirectory, file.url);
    let transfer: ServerResponse | undefined;
    respond((_request, response) => {
      response.write(speakers.embedding.subarray(0, 8));
      transfer = response;
    });
    await mkdir(dirname(speakers.segmentationPath), { recursive: true });
    await writeFile(speakers.segmentationPath, speakers.segmentation);
    const models = create(speakers.definition);
    await Effect.runPromise(models.install(pyannoteModel.id));
    await expect
      .poll(async () => (await status(models)).installation.phase, { timeout: 10000 })
      .toBe("downloading");
    if (!transfer) throw new Error("The embedding download did not start.");
    await rm(speakers.segmentationPath);
    transfer.end(speakers.embedding.subarray(8));
    expect(await finished(models)).toMatchObject({
      state: "missing",
      installation: {
        phase: "failed",
        error: "A file of Pyannote was removed during the download. Download it again.",
      },
    });
    expect((await Effect.runPromise(models.list())).speakerModelId).toBeNull();
  });
});

it("counts the cached second file while downloading and verifying the first", async () => {
  await withModels(async ({ cacheDirectory, file, respond, create, requests }) => {
    const speakers = speakerFixture(cacheDirectory, file.url);
    const requested: string[] = [];
    let transfer: ServerResponse | undefined;
    const firstChunk = 8;
    respond((request, response) => {
      requested.push(request.url ?? "");
      response.write(speakers.segmentation.subarray(0, firstChunk));
      transfer = response;
    });
    await mkdir(dirname(speakers.embeddingPath), { recursive: true });
    await writeFile(speakers.embeddingPath, speakers.embedding);
    const models = create(speakers.definition);
    const total = speakers.segmentation.length + speakers.embedding.length;
    await Effect.runPromise(models.install(pyannoteModel.id));
    await expect
      .poll(async () => (await status(models)).installation, { timeout: 10000 })
      .toMatchObject({
        phase: "downloading",
        downloadedBytes: speakers.embedding.length + firstChunk,
      });
    if (!transfer) throw new Error("The segmentation download did not start.");
    transfer.write(speakers.segmentation.subarray(firstChunk));
    await expect
      .poll(async () => (await status(models)).installation, { timeout: 10000 })
      .toMatchObject({
        phase: "verifying",
        downloadedBytes: total,
      });
    transfer.end();
    expect(await finished(models)).toMatchObject({
      state: "ready",
      installation: { phase: "complete", downloadedBytes: total },
    });
    expect(requests()).toBe(1);
    expect(requested).toEqual(["/weights/segmentation"]);
    expect(await readFile(speakers.segmentationPath)).toEqual(speakers.segmentation);
  });
});

it.each(["cancelled", "failed"] as const)(
  "retries only the second file after it %s",
  async (phase) => {
    await withModels(async ({ cacheDirectory, file, respond, create }) => {
      const speakers = speakerFixture(cacheDirectory, file.url);
      const requested: string[] = [];
      let transfer: ServerResponse | undefined;
      const firstChunk = 8;
      respond((request, response) => {
        const url = request.url ?? "";
        requested.push(url);
        if (url === "/weights/segmentation") response.end(speakers.segmentation);
        else {
          response.write(speakers.embedding.subarray(0, firstChunk));
          transfer = response;
        }
      });
      const models = create(speakers.definition);
      await Effect.runPromise(models.install(pyannoteModel.id));
      await expect
        .poll(async () => (await status(models)).installation.downloadedBytes, { timeout: 10000 })
        .toBe(speakers.segmentation.length + firstChunk);
      if (!transfer) throw new Error("The embedding download did not start.");
      if (phase === "cancelled") await Effect.runPromise(models.cancel(pyannoteModel.id));
      else transfer.end();
      expect(await finished(models)).toMatchObject({
        state: "missing",
        installation: { phase },
      });
      expect(await readdir(dirname(speakers.embeddingPath))).toEqual([]);
      expect(await readFile(speakers.segmentationPath)).toEqual(speakers.segmentation);
      respond((request, response) => {
        requested.push(request.url ?? "");
        response.end(speakers.embedding);
      });
      await Effect.runPromise(models.install(pyannoteModel.id));
      expect(await finished(models)).toMatchObject({
        state: "ready",
        installation: {
          phase: "complete",
          downloadedBytes: speakers.segmentation.length + speakers.embedding.length,
        },
      });
      expect(requested).toEqual([
        "/weights/segmentation",
        "/weights/embedding",
        "/weights/embedding",
      ]);
      expect(await readFile(speakers.embeddingPath)).toEqual(speakers.embedding);
    });
  },
);

function ggufString(value: string) {
  const bytes = Buffer.from(value);
  const size = Buffer.alloc(8);
  size.writeBigUInt64LE(BigInt(bytes.length));
  return Buffer.concat([size, bytes]);
}
function ggufWeights(architecture: string) {
  const header = Buffer.alloc(24);
  header.write("GGUF");
  header.writeUInt32LE(3, 4);
  header.writeBigUInt64LE(1n, 16);
  const type = Buffer.alloc(4);
  type.writeUInt32LE(8);
  return Buffer.concat([
    header,
    ggufString("general.architecture"),
    type,
    ggufString(architecture),
    Buffer.alloc(32),
  ]);
}
const weights = ggufWeights("parakeet");
const digest = (data: Buffer) => createHash("sha256").update(data).digest("hex");

async function withModels(
  test: (context: {
    directory: string;
    cacheDirectory: string;
    path: string;
    file: ModelFile;
    database: AppDatabase;
    definition: ModelDefinition;
    withFile: (changes: Partial<ModelFile>) => ModelDefinition;
    create: (...definitions: ModelDefinition[]) => Models;
    requests: () => number;
    respond: (handler: RequestListener) => void;
  }) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "movo-models-"));
  const cacheDirectory = join(directory, "hf-cache");
  const { database, close } = await openTestDatabase(directory);
  const instances: Models[] = [];
  let requests = 0;
  let handler: RequestListener = (_request, response) => response.end(weights);
  const server = createServer((request, response) => {
    requests++;
    handler(request, response);
  });
  onTestFinished(async () => {
    for (const model of instances) await Effect.runPromise(model.close());
    await close();
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Model fixture has no port.");
  const file: ModelFile = {
    ...transcriptionModel.files.transcription,
    url: `http://127.0.0.1:${address.port}/weights`,
    bytes: weights.length,
    sha256: digest(weights),
  };
  const withFile = (changes: Partial<ModelFile>): ModelDefinition => ({
    ...transcriptionModel,
    files: { transcription: { ...file, ...changes } },
  });
  const definition = withFile({});
  const create = (...definitions: ModelDefinition[]) => {
    const manager = createModels({
      database,
      cacheDirectory,
      definitions: definitions.length > 0 ? definitions : [definition],
    });
    instances.push(manager);
    return manager;
  };
  await test({
    directory,
    cacheDirectory,
    path: modelCachePath(cacheDirectory, file),
    file,
    database,
    definition,
    withFile,
    create,
    requests: () => requests,
    respond: (updated) => {
      handler = updated;
    },
  });
}
async function status(models: Models) {
  const [entry] = (await Effect.runPromise(models.list())).models;
  if (!entry) throw new Error("Model catalog is empty.");
  return entry;
}
async function finished(models: Models) {
  await expect
    .poll(async () => activeModelPhases.includes((await status(models)).installation.phase), {
      timeout: 15000,
    })
    .toBe(false);
  return status(models);
}

describe("shared transcription model cache", () => {
  it("resolves the standard cache environment precedence", () => {
    expect(
      huggingFaceCacheDirectory({
        HF_HUB_CACHE: join(tmpdir(), "direct-cache"),
        HF_HOME: join(tmpdir(), "hf-home"),
        XDG_CACHE_HOME: join(tmpdir(), "xdg"),
      }),
    ).toBe(join(tmpdir(), "direct-cache"));
    expect(huggingFaceCacheDirectory({ HF_HOME: join(tmpdir(), "hf-home") })).toBe(
      join(tmpdir(), "hf-home", "hub"),
    );
    expect(huggingFaceCacheDirectory({ XDG_CACHE_HOME: join(tmpdir(), "xdg") })).toBe(
      join(tmpdir(), "xdg", "huggingface", "hub"),
    );
    expect(huggingFaceCacheDirectory({})).toBe(join(homedir(), ".cache", "huggingface", "hub"));
  });

  it("lists a missing model without network access, private paths or cache writes", async () => {
    await withModels(async ({ directory, cacheDirectory, create, requests }) => {
      const models = create();
      expect(await status(models)).toMatchObject({
        state: "missing",
        installation: { phase: "idle" },
      });
      expect(requests()).toBe(0);
      await expect(readdir(cacheDirectory)).rejects.toMatchObject({ code: "ENOENT" });
      expect(JSON.stringify(await status(models))).not.toContain(directory);
    });
  });

  it("reuses and verifies an external cache file without copies or manifests, detects changed bytes and rediscovery", async () => {
    await withModels(async ({ path, file, create, requests }) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, weights);
      const original = await stat(path);
      const models = create();
      expect((await status(models)).state).toBe("ready");
      await Effect.runPromise(models.install(transcriptionModel.id));
      expect((await status(create())).state).toBe("ready");
      expect(requests()).toBe(0);
      expect(await readdir(dirname(path))).toEqual([file.filename]);
      expect((await stat(path)).mtimeMs).toBe(original.mtimeMs);
      await writeFile(path, Buffer.alloc(weights.length, 42));
      await utimes(path, original.atime, original.mtime);
      expect((await status(models)).state).toBe("broken");
      await expect(Effect.runPromise(models.install(transcriptionModel.id))).rejects.toThrow(
        "will not overwrite",
      );
      expect(requests()).toBe(0);
      expect(await readFile(path)).toEqual(Buffer.alloc(weights.length, 42));
      await rm(path);
      expect((await status(models)).state).toBe("missing");
      await Effect.runPromise(models.install(transcriptionModel.id));
      expect((await finished(models)).state).toBe("ready");
      expect(requests()).toBe(1);
    });
  });

  it("follows cached links and leaves their target unchanged", async () => {
    await withModels(async ({ directory, path, file, create, requests }) => {
      const blobs = join(directory, "blobs");
      await mkdir(blobs);
      const blob = join(blobs, file.filename);
      await writeFile(blob, weights);
      await mkdir(dirname(dirname(path)), { recursive: true });
      if (process.platform === "win32") {
        await symlink(blobs, dirname(path), "junction");
      } else {
        await mkdir(dirname(path));
        await symlink(blob, path);
      }
      expect((await status(create())).state).toBe("ready");
      expect(await readFile(blob)).toEqual(weights);
      expect(requests()).toBe(0);
    });
  });

  it("deduplicates requests in one manager and publishes only completed verified weights", async () => {
    await withModels(async ({ path, file, create, requests, definition, respond }) => {
      let finish: (() => void) | undefined;
      respond((_request, response) => {
        response.write(weights.subarray(0, 8));
        finish = () => response.end(weights.subarray(8));
      });
      const models = create();
      await Promise.all([
        Effect.runPromise(models.install(definition.id)),
        Effect.runPromise(models.install(definition.id)),
      ]);
      await expect
        .poll(async () => (await status(models)).installation.downloadedBytes, { timeout: 10000 })
        .toBe(8);
      expect((await status(models)).state).toBe("missing");
      expect(requests()).toBe(1);
      expect(await stat(path).catch(() => null)).toBeNull();
      if (!finish) throw new Error("Fixture transfer did not start.");
      finish();
      expect((await finished(models)).state).toBe("ready");
      expect(await readFile(path)).toEqual(weights);
      expect(await readdir(dirname(path))).toEqual([file.filename]);
      expect((await status(create())).state).toBe("ready");
    });
  });

  it("publishes safely when two independent Node processes download to the same cache", async (context) => {
    await withModels(
      async ({ directory, cacheDirectory, path, file, definition, respond, requests }) => {
        const responses: ServerResponse[] = [];
        respond((_request, response) => {
          response.write(weights.subarray(0, 8));
          responses.push(response);
          if (responses.length === 2)
            for (const pending of responses) pending.end(weights.subarray(8));
        });
        const script = `
        import { Effect, Exit, Scope } from "effect";
        import { openDatabase } from ${JSON.stringify(new URL("../../../../src/server/db/database.ts", import.meta.url).href)};
        import { createModels } from ${JSON.stringify(new URL("../../../../src/server/models/models.ts", import.meta.url).href)};
        const definition = JSON.parse(process.argv[1]);
        const scope = Scope.makeUnsafe();
        const database = await Effect.runPromise(Scope.provide(openDatabase(process.argv[3]), scope));
        const models = createModels({ database, definitions: [definition], cacheDirectory: process.argv[2] });
        try {
          await Effect.runPromise(models.install(definition.id));
          let entry;
          for (let attempt = 0; attempt < 1000; attempt++) {
            [entry] = (await Effect.runPromise(models.list())).models;
            if (["complete", "failed", "cancelled"].includes(entry.installation.phase)) break;
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          console.log(JSON.stringify(entry));
          if (entry.state !== "ready" || entry.installation.phase !== "complete") process.exitCode = 1;
        } finally {
          await Effect.runPromise(models.close());
          await Effect.runPromise(Scope.close(scope, Exit.void));
        }
      `;
        const results = await Promise.allSettled(
          [1, 2].map((writer) =>
            execute(
              process.execPath,
              [
                "--input-type=module",
                "-e",
                script,
                JSON.stringify(definition),
                cacheDirectory,
                join(directory, `writer-${writer}.sqlite`),
              ],
              { timeout: 15000, windowsHide: true, signal: context.signal },
            ),
          ),
        );
        for (const result of results) {
          if (result.status === "rejected") {
            const error = result.reason;
            throw new Error(
              error instanceof Error && "stdout" in error ? String(error.stdout) : String(error),
            );
          }
          expect(Schema.decodeUnknownSync(ModelStatus)(JSON.parse(result.value.stdout)).state).toBe(
            "ready",
          );
        }
        expect(requests()).toBe(2);
        expect(await readFile(path)).toEqual(weights);
        expect(await readdir(dirname(path))).toEqual([file.filename]);
      },
    );
  });

  it("preserves an existing file that appears while a download is running", async () => {
    await withModels(async ({ path, file, create, definition, respond }) => {
      const foreign = Buffer.alloc(weights.length, 42);
      respond((_request, response) => {
        void writeFile(path, foreign).then(
          () => response.end(weights),
          () => response.destroy(),
        );
      });
      const models = create();
      await Effect.runPromise(models.install(definition.id));
      expect(await finished(models)).toMatchObject({
        state: "broken",
        installation: { phase: "failed" },
      });
      expect(await readFile(path)).toEqual(foreign);
      expect(await readdir(dirname(path))).toEqual([file.filename]);
    });
  });

  it.each([-1, 1])("rejects an incorrect download length (offset %s)", async (offset) => {
    await withModels(async ({ path, file, definition, withFile, create }) => {
      const models = create(withFile({ bytes: file.bytes + offset }));
      await Effect.runPromise(models.install(definition.id));
      expect((await finished(models)).installation.phase).toBe("failed");
      expect(await readdir(dirname(path))).toEqual([]);
    });
  });

  it("rejects a SHA-256 mismatch before publication", async () => {
    await withModels(async ({ path, create, definition, withFile }) => {
      const models = create(withFile({ sha256: "0".repeat(64) }));
      await Effect.runPromise(models.install(definition.id));
      expect((await finished(models)).installation.error).toContain("integrity check");
      expect(await readdir(dirname(path))).toEqual([]);
    });
  });

  it.each(["llama", "invalid"])(
    "rejects correctly hashed incompatible GGUF (%s)",
    async (architecture) => {
      await withModels(async ({ path, create, definition, withFile, respond }) => {
        const content =
          architecture === "invalid" ? Buffer.from("not GGUF") : ggufWeights(architecture);
        respond((_request, response) => response.end(content));
        const models = create(withFile({ bytes: content.length, sha256: digest(content) }));
        await Effect.runPromise(models.install(definition.id));
        expect((await finished(models)).installation.error).toContain(
          "is not a supported parakeet GGUF",
        );
        expect(await readdir(dirname(path))).toEqual([]);
      });
    },
  );

  it("cancels only its own partial download, preserves foreign files and permits retry", async () => {
    await withModels(async ({ path, create, definition, respond }) => {
      await mkdir(dirname(path), { recursive: true });
      const foreign = join(dirname(path), "another-tool.incomplete");
      await writeFile(foreign, "another client's download");
      respond((_request, response) => {
        response.write(weights.subarray(0, 8));
      });
      const models = create();
      await Effect.runPromise(models.install(definition.id));
      await expect
        .poll(async () => (await status(models)).installation.downloadedBytes, { timeout: 10000 })
        .toBe(8);
      expect((await Effect.runPromise(models.cancel(definition.id))).installation.phase).toBe(
        "cancelled",
      );
      expect(await readdir(dirname(path))).toEqual(["another-tool.incomplete"]);
      respond((_request, response) => response.end(weights));
      await Effect.runPromise(models.install(definition.id));
      expect((await finished(models)).state).toBe("ready");
      expect(await readFile(foreign, "utf8")).toBe("another client's download");
    });
  });

  it("reports cleanup failure rather than successful cancellation", async () => {
    await withModels(async ({ path, create, definition, respond }) => {
      respond((_request, response) => {
        response.write(weights.subarray(0, 8));
      });
      const models = create();
      await Effect.runPromise(models.install(definition.id));
      await expect
        .poll(async () => (await status(models)).installation.downloadedBytes, { timeout: 10000 })
        .toBe(8);
      const partial = (await readdir(dirname(path))).find((name) => name.endsWith(".partial"));
      if (!partial) throw new Error("Partial download not found.");
      await rm(join(dirname(path), partial));
      await mkdir(join(dirname(path), partial));
      const result = await Effect.runPromise(models.cancel(definition.id));
      expect(result.installation.phase).toBe("failed");
      expect(result.installation.error).toContain("clean up");
    });
  });

  it("keeps another manager's download running when one transfer is cancelled", async () => {
    await withModels(async ({ path, file, create, definition, respond }) => {
      const responses: ServerResponse[] = [];
      respond((_request, response) => {
        response.write(weights.subarray(0, 8));
        responses.push(response);
      });
      const first = create();
      const second = create();
      await Effect.runPromise(first.install(definition.id));
      await expect
        .poll(async () => (await status(first)).installation.downloadedBytes, { timeout: 10000 })
        .toBe(8);
      await Effect.runPromise(second.install(definition.id));
      await expect
        .poll(async () => (await status(second)).installation.downloadedBytes, { timeout: 10000 })
        .toBe(8);
      await Effect.runPromise(first.cancel(definition.id));
      expect((await status(first)).installation.phase).toBe("cancelled");
      expect((await status(second)).installation.phase).toBe("downloading");
      const response = responses[1];
      if (!response) throw new Error("Second transfer did not start.");
      response.end(weights.subarray(8));
      expect((await finished(second)).state).toBe("ready");
      expect(await readFile(path)).toEqual(weights);
      expect(await readdir(dirname(path))).toEqual([file.filename]);
    });
  });

  it("does not start work after shutdown and cleans an interrupted download", async () => {
    await withModels(async ({ path, create, definition, requests, respond }) => {
      const stopped = create();
      const pending = Effect.runPromise(stopped.install(definition.id));
      await Effect.runPromise(stopped.close());
      await expect(pending).rejects.toThrow("shutting down");
      expect(requests()).toBe(0);
      respond((_request, response) => {
        response.write(weights.subarray(0, 8));
      });
      const models = create();
      await Effect.runPromise(models.install(definition.id));
      await expect
        .poll(async () => (await status(models)).installation.downloadedBytes, { timeout: 10000 })
        .toBe(8);
      await Effect.runPromise(models.close());
      expect(await readdir(dirname(path))).toEqual([]);
      expect((await status(create())).state).toBe("missing");
    });
  });

  it("serves uncached status, speaker labels and asynchronous install/cancel through the real HTTP app", async () => {
    await withModels(
      async ({ directory, cacheDirectory, file, database, definition, create, respond }) => {
        respond((_request, response) => {
          response.write(weights.subarray(0, 8));
        });
        const models = create(definition, speakerFixture(cacheDirectory, file.url).definition);
        await Effect.runPromise(
          Effect.gen(function* () {
            const app = createApp(database, { dataDirectory: directory }, undefined, { models });
            yield* Effect.promise(async () => {
              const response = await app.request("http://localhost/api/models");
              expect(response.status).toBe(200);
              expect(response.headers.get("cache-control")).toBe("no-store");
              const catalog = Schema.decodeUnknownSync(ModelCatalog)(await response.json());
              expect(catalog.speakerModelId).toBeNull();
              expect(catalog.models.map(({ id }) => id)).toEqual([
                transcriptionModel.id,
                pyannoteModel.id,
              ]);
              const chooseSpeakers = (body: string) =>
                app.request("http://localhost/api/models/speaker-labels", {
                  method: "PUT",
                  headers: { "content-type": "application/json" },
                  body,
                });
              const off = await chooseSpeakers(JSON.stringify({ speakerModelId: null }));
              expect(off.status).toBe(200);
              expect(await off.json()).toEqual({ speakerModelId: null });
              const missing = await chooseSpeakers(
                JSON.stringify({ speakerModelId: pyannoteModel.id }),
              );
              expect(missing.status).toBe(400);
              expect(await missing.json()).toEqual({
                error: "Download Pyannote before using it for speaker labels.",
              });
              for (const body of [
                JSON.stringify({ speakerModelId: transcriptionModel.id }),
                JSON.stringify({}),
                "{",
              ]) {
                const rejected = await chooseSpeakers(body);
                expect(rejected.status).toBe(400);
                expect(await rejected.json()).toEqual({
                  error: "Choose a speaker model from Settings, or turn speaker labels off.",
                });
              }
              expect(
                (await chooseSpeakers(JSON.stringify({ speakerModelId: "x".repeat(5000) }))).status,
              ).toBe(413);
              const base = `http://localhost/api/models/${definition.id}`;
              expect(
                (
                  await app.request(`${base}/install`, {
                    method: "POST",
                    headers: { origin: "https://foreign.example" },
                  })
                ).status,
              ).toBe(403);
              expect(
                (
                  await app.request("http://localhost/api/models/unknown/install", {
                    method: "POST",
                  })
                ).status,
              ).toBe(404);
              const installed = await app.request(`${base}/install`, { method: "POST" });
              expect(installed.status).toBe(202);
              expect(
                Schema.decodeUnknownSync(ModelStatus)(await installed.json()).installation.phase,
              ).toBe("checking");
              const cancelled = await app.request(`${base}/cancel`, { method: "POST" });
              expect(cancelled.status).toBe(200);
              expect(
                Schema.decodeUnknownSync(ModelStatus)(await cancelled.json()).installation.phase,
              ).toBe("cancelled");
            });
          }),
        );
      },
    );
  });

  it("initializes the real engine without weights and rejects an invalid GGUF", async () => {
    const directory = await mkdtemp(join(tmpdir(), "movo-model-engine-"));
    try {
      const path = join(directory, "invalid.gguf");
      await writeFile(path, "This is not a GGUF model.");
      const signal = AbortSignal.timeout(25000);
      await expect(validateModel(null, signal)).resolves.toHaveProperty("engineVersion");
      await expect(validateModel(path, signal)).rejects.toThrow("Could not validate");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
