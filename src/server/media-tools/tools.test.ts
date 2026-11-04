import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type RequestListener } from "node:http";
import { chmod, link, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { Effect, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import { activeInstallationPhases, MediaToolsStatus } from "../../shared/contracts/media-tools.ts";
import { createMediaTools, type MediaTools } from "./tools.ts";
import type { MediaToolsPackage } from "./packages.ts";

const execute = promisify(execFile);
const suffix = process.platform === "win32" ? ".exe" : "";
const readVersion = async (path: string) => readFile(path, "utf8");

async function withInstallation(
  test: (context: {
    directory: string;
    build: MediaToolsPackage;
    create: (build?: MediaToolsPackage) => MediaTools;
    requests: () => number;
    response: (handler: RequestListener) => void;
  }) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "movo-tools-"));
  const instances: MediaTools[] = [];
  let requests = 0;
  let archive: Buffer;
  let respond: RequestListener | undefined;
  const server = createServer((request, response) => {
    requests++;
    if (typeof respond === "function") respond(request, response);
    else response.end(archive);
  });
  try {
    const archivePath = join(directory, "fixture.tar");
    const fixture = join(directory, "fixture-tools");
    await mkdir(join(fixture, "bin"), { recursive: true });
    await writeFile(join(fixture, `bin/ffprobe${suffix}`), "ffprobe version 9.0.2\n");
    await writeFile(join(fixture, `bin/ffmpeg${suffix}`), "ffmpeg version 9.0.2\n");
    await writeFile(join(fixture, "LICENSE"), "Generated test fixture, no executable code.\n");
    await writeFile(join(fixture, "unrelated.txt"), "This must not be extracted.\n");
    const fixtureTar =
      process.platform === "win32"
        ? join(process.env.SystemRoot ?? "", "System32", "tar.exe")
        : "tar";
    await execute(fixtureTar, ["-cf", archivePath, "-C", directory, "fixture-tools"]);
    archive = await readFile(archivePath);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Download fixture has no port");
    const build: MediaToolsPackage = {
      id: "fixture-9.0.2-tools",
      provider: "Local test server",
      sourceUrl: `http://127.0.0.1:${address.port}`,
      url: `http://127.0.0.1:${address.port}/download`,
      version: "9.0.2",
      sha256: createHash("sha256").update(archive).digest("hex"),
      bytes: archive.length,
      root: "fixture-tools",
      license: "LICENSE",
    };
    const create = (selected = build) => {
      const tools = createMediaTools(
        { dataDirectory: directory },
        { build: selected, environment: { PATH: "" }, run: readVersion },
      );
      instances.push(tools);
      return tools;
    };
    await test({
      directory,
      build,
      create,
      requests: () => requests,
      response: (handler) => {
        respond = handler;
      },
    });
  } finally {
    for (const tools of instances) await Effect.runPromise(tools.close());
    if (server.listening) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

async function finished(tools: MediaTools) {
  await expect
    .poll(
      async () => {
        const status = await Effect.runPromise(tools.status());
        return activeInstallationPhases.includes(status.installation.phase);
      },
      { timeout: 15000 },
    )
    .toBe(false);
  return Effect.runPromise(tools.status());
}

describe("media tools", () => {
  it("uses native Windows tar when PATH is shadowed and reports an incompatible PATH tar on Linux", async () => {
    await withInstallation(async ({ directory, create }) => {
      const shadow = join(directory, "shadow");
      await mkdir(shadow);
      const executable = join(shadow, `tar${suffix}`);
      if (process.platform === "win32") await link(process.execPath, executable);
      else {
        await writeFile(executable, "#!/bin/sh\nexit 1\n");
        await chmod(executable, 0o700);
      }
      vi.stubEnv("PATH", `${shadow}${delimiter}${process.env.PATH ?? ""}`);
      try {
        const tools = create();
        await Effect.runPromise(tools.install());
        const status = await finished(tools);
        expect(status.installation.phase).toBe(
          process.platform === "win32" ? "complete" : "failed",
        );
        expect(status.installation.error ?? "").toMatch(
          process.platform === "win32" ? /^$/u : /need tar/u,
        );
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
  it("finds working system executables without downloading anything", async () => {
    const directory = await mkdtemp(join(tmpdir(), "movo-tools-system-"));
    const tools = createMediaTools({ dataDirectory: directory }, { build: null });
    try {
      const status = Schema.decodeUnknownSync(MediaToolsStatus)(
        await Effect.runPromise(tools.status()),
      );
      expect(status.ffprobe).toMatchObject({ state: "ready", source: "system" });
      expect(status.ffmpeg).toMatchObject({ state: "ready", source: "system" });
      expect(status.download).toBeNull();
      expect(isAbsolute(await Effect.runPromise(tools.resolve("ffprobe")))).toBe(true);
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await Effect.runPromise(tools.close());
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("surfaces a broken explicit path instead of falling back to PATH", async () => {
    const tools = createMediaTools({
      dataDirectory: tmpdir(),
      ffprobePath: join(tmpdir(), "missing-movo-ffprobe"),
    });
    const status = await Effect.runPromise(tools.status());
    expect(status.ffprobe).toMatchObject({ state: "broken", source: "configured" });
    await expect(Effect.runPromise(tools.resolve("ffprobe"))).rejects.toThrow("FFPROBE_PATH");
    await expect(Effect.runPromise(tools.install())).rejects.toThrow("FFPROBE_PATH");
    await Effect.runPromise(tools.close());
  });

  it("reports unsupported-platform setup without preventing startup", async () => {
    const tools = createMediaTools(
      { dataDirectory: tmpdir() },
      { build: null, environment: { PATH: "" } },
    );
    expect((await Effect.runPromise(tools.status())).ffprobe).toEqual({ state: "missing" });
    await expect(Effect.runPromise(tools.install())).rejects.toThrow(
      "unavailable for this platform",
    );
    await Effect.runPromise(tools.close());
  });

  it("downloads once, extracts only selected files and discovers the installed tools after restart", async () => {
    await withInstallation(async ({ directory, create, requests }) => {
      const tools = create();
      expect((await Effect.runPromise(tools.status())).ffprobe).toEqual({ state: "missing" });
      expect(requests()).toBe(0);
      await Promise.all([Effect.runPromise(tools.install()), Effect.runPromise(tools.install())]);
      expect((await finished(tools)).installation.phase).toBe("complete");
      expect(requests()).toBe(1);
      const path = await Effect.runPromise(tools.resolve("ffprobe"));
      expect(await readFile(path, "utf8")).toBe("ffprobe version 9.0.2\n");
      const reopened = create();
      expect((await Effect.runPromise(reopened.status())).ffprobe).toMatchObject({
        state: "ready",
        source: "managed",
        version: "9.0.2",
      });
      expect(await Effect.runPromise(reopened.resolve("ffprobe"))).toBe(path);
      expect(new Set(await readdir(join(path, "..")))).toEqual(
        new Set(["LICENSE", `ffmpeg${suffix}`, `ffprobe${suffix}`]),
      );
      expect(await readdir(join(directory, "tools", "ffmpeg"))).not.toContain(".installing");
      await Effect.runPromise(reopened.install());
      expect(requests()).toBe(1);
    });
  });

  it("keeps FFprobe usable without FFmpeg and preserves that copy after a failed repair", async () => {
    await withInstallation(async ({ create, build, directory }) => {
      const tools = create();
      await Effect.runPromise(tools.install());
      await finished(tools);
      const probe = await Effect.runPromise(tools.resolve("ffprobe"));
      const ffmpeg = await Effect.runPromise(tools.resolve("ffmpeg"));
      await rm(ffmpeg);
      const repair = create({ ...build, sha256: "0".repeat(64) });
      const before = await Effect.runPromise(repair.status());
      expect(before.ffprobe.state).toBe("ready");
      expect(before.ffmpeg.state).toBe("broken");
      await Effect.runPromise(repair.install());
      const result = await finished(repair);
      expect(result.installation.phase).toBe("failed");
      expect(result.installation.error).toContain("integrity check");
      expect(await Effect.runPromise(repair.resolve("ffprobe"))).toBe(probe);
      expect(await readFile(probe, "utf8")).toBe("ffprobe version 9.0.2\n");
      expect(await readdir(join(directory, "tools", "ffmpeg"))).not.toContain(".installing");
    });
  });

  it("does not activate an executable with invalid version output", async () => {
    await withInstallation(async ({ directory, build }) => {
      const tools = createMediaTools(
        { dataDirectory: directory },
        { build, environment: { PATH: "" }, run: async () => "not ffmpeg" },
      );
      try {
        await Effect.runPromise(tools.install());
        expect((await finished(tools)).installation.error).toContain("could not run");
        expect(await readdir(join(directory, "tools", "ffmpeg"))).toEqual([]);
      } finally {
        await Effect.runPromise(tools.close());
      }
    });
  });

  it.each(["too short", "too large"])(
    "rejects a download that is %s and allows retry",
    async (kind) => {
      await withInstallation(async ({ create, build, requests }) => {
        const broken = create({ ...build, bytes: build.bytes + (kind === "too short" ? 1 : -1) });
        await Effect.runPromise(broken.install());
        expect((await finished(broken)).installation.phase).toBe("failed");
        const retry = create();
        await Effect.runPromise(retry.install());
        expect((await finished(retry)).installation.phase).toBe("complete");
        expect(requests()).toBe(2);
      });
    },
  );

  it("cleans up failed HTTP downloads and reports the failure", async () => {
    await withInstallation(async ({ create, response, directory }) => {
      response((_request, reply) => {
        reply.writeHead(503);
        reply.end("unavailable");
      });
      const tools = create();
      await Effect.runPromise(tools.install());
      expect((await finished(tools)).installation.error).toContain("HTTP 503");
      expect(await readdir(join(directory, "tools", "ffmpeg"))).toEqual([]);
    });
  });

  it("rejects a corrupt archive even when its download hash is correct", async () => {
    await withInstallation(async ({ create, response, build, directory }) => {
      const corrupt = Buffer.from("This is not a media tools archive.");
      response((_request, reply) => {
        reply.end(corrupt);
      });
      const tools = create({
        ...build,
        bytes: corrupt.length,
        sha256: createHash("sha256").update(corrupt).digest("hex"),
      });
      await Effect.runPromise(tools.install());
      expect((await finished(tools)).installation.error).toContain("Could not unpack");
      expect(await readdir(join(directory, "tools", "ffmpeg"))).toEqual([]);
    });
  });

  it("replaces abandoned installation staging without activating its partial files", async () => {
    await withInstallation(async ({ create, directory }) => {
      const root = join(directory, "tools", "ffmpeg");
      await mkdir(join(root, ".installing"), { recursive: true });
      await writeFile(join(root, ".installing", "interrupted-download"), "partial bytes");
      const tools = create();
      await Effect.runPromise(tools.install());
      expect((await finished(tools)).installation.phase).toBe("complete");
      expect(await readdir(root)).not.toContain(".installing");
    });
  });

  it("cancels an in-progress download on shutdown and removes its partial files", async () => {
    await withInstallation(async ({ create, response, requests, directory }) => {
      response((_request, reply) => {
        reply.writeHead(200);
        reply.write("partial");
      });
      const tools = create();
      await Effect.runPromise(tools.install());
      await expect.poll(requests).toBe(1);
      await Effect.runPromise(tools.close());
      expect((await Effect.runPromise(tools.status())).installation.phase).toBe("failed");
      expect(await readdir(join(directory, "tools", "ffmpeg"))).toEqual([]);
    });
  });

  it("rejects an active installation pointer escaping its managed directory", async () => {
    await withInstallation(async ({ create, directory }) => {
      const root = join(directory, "tools", "ffmpeg");
      await mkdir(root, { recursive: true });
      await writeFile(join(root, "active.json"), JSON.stringify({ directory: "../elsewhere" }));
      const tools = create();
      expect((await Effect.runPromise(tools.status())).ffprobe).toMatchObject({
        state: "broken",
        source: "managed",
      });
      await Effect.runPromise(tools.install());
      expect((await finished(tools)).ffprobe.state).toBe("ready");
    });
  });
});
