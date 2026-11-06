import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { activeInstallationPhases } from "../../../../src/shared/contracts/media-tools.ts";
import type { ToolPackage } from "../../../../src/server/media-tools/managed.ts";
import { createYtdlp, type Ytdlp } from "../../../../src/server/media-tools/ytdlp.ts";

const suffix = process.platform === "win32" ? ".exe" : "";
const readVersion = async (path: string) => readFile(path, "utf8");

async function withRelease(
  executable: string,
  test: (context: {
    directory: string;
    create: (config?: { ytdlpPath?: string; PATH?: string }) => Ytdlp;
    requests: () => number;
  }) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "movo-ytdlp-"));
  const instances: Ytdlp[] = [];
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.end(executable);
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Release fixture has no port");
    const build: ToolPackage = {
      id: "ytdlp-fixture",
      provider: "Local test server",
      sourceUrl: `http://127.0.0.1:${address.port}`,
      url: `http://127.0.0.1:${address.port}/yt-dlp`,
      version: "2026.10.26",
      bytes: Buffer.byteLength(executable),
      sha256: createHash("sha256").update(executable).digest("hex"),
    };
    const create = ({ ytdlpPath, PATH = "" }: { ytdlpPath?: string; PATH?: string } = {}) => {
      const ytdlp = createYtdlp(
        { dataDirectory: directory, ytdlpPath },
        { build, environment: { PATH }, run: readVersion },
      );
      instances.push(ytdlp);
      return ytdlp;
    };
    await test({ directory, create, requests: () => requests });
  } finally {
    for (const ytdlp of instances) await Effect.runPromise(ytdlp.close());
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

async function finished(ytdlp: Ytdlp) {
  await expect
    .poll(
      async () =>
        activeInstallationPhases.includes(
          (await Effect.runPromise(ytdlp.status())).installation.phase,
        ),
      { timeout: 15000 },
    )
    .toBe(false);
  return Effect.runPromise(ytdlp.status());
}

describe("managed yt-dlp", () => {
  it("installs the verified executable, uses it without restarting and rediscovers it", async () => {
    await withRelease("2026.10.26\n", async ({ directory, create, requests }) => {
      const ytdlp = create();
      expect((await Effect.runPromise(ytdlp.status())).ytdlp).toEqual({ state: "missing" });
      await expect(Effect.runPromise(ytdlp.resolve("ytdlp"))).rejects.toThrow("YTDLP_PATH");
      await Effect.runPromise(ytdlp.install());
      const installed = await finished(ytdlp);
      expect(installed.installation.phase).toBe("complete");
      expect(installed.ytdlp).toEqual({ state: "ready", source: "managed", version: "2026.10.26" });
      const path = await Effect.runPromise(ytdlp.resolve("ytdlp"));
      expect(await readdir(join(path, ".."))).toEqual([`yt-dlp${suffix}`]);
      await expect(access(path, constants.X_OK)).resolves.toBeUndefined();
      expect(await readdir(join(directory, "tools", "yt-dlp"))).not.toContain(".installing");
      const reopened = create();
      expect(await Effect.runPromise(reopened.resolve("ytdlp"))).toBe(path);
      await Effect.runPromise(reopened.install());
      expect(requests()).toBe(1);
    });
  });

  it("finds yt-dlp on PATH without downloading it", async () => {
    await withRelease("2026.10.26\n", async ({ directory, create, requests }) => {
      const system = join(directory, "system");
      await mkdir(system);
      await writeFile(join(system, `yt-dlp${suffix}`), "2026.10.21\n");
      const ytdlp = create({ PATH: system });
      expect((await Effect.runPromise(ytdlp.status())).ytdlp).toEqual({
        state: "ready",
        source: "system",
        version: "2026.10.21",
      });
      await Effect.runPromise(ytdlp.install());
      expect(requests()).toBe(0);
    });
  });

  it("reports a broken YTDLP_PATH instead of falling back or downloading", async () => {
    await withRelease("2026.10.26\n", async ({ directory, create, requests }) => {
      const configured = join(directory, "configured-yt-dlp");
      await writeFile(configured, "not a version\n");
      const system = join(directory, "system");
      await mkdir(system);
      await writeFile(join(system, `yt-dlp${suffix}`), "2026.10.21\n");
      const ytdlp = create({ ytdlpPath: configured, PATH: system });
      expect((await Effect.runPromise(ytdlp.status())).ytdlp).toMatchObject({
        state: "broken",
        source: "configured",
        message: "yt-dlp could not run. Correct or remove YTDLP_PATH and restart Movo.",
      });
      await expect(Effect.runPromise(ytdlp.resolve("ytdlp"))).rejects.toThrow("YTDLP_PATH");
      await expect(Effect.runPromise(ytdlp.install())).rejects.toThrow("YTDLP_PATH");
      expect(requests()).toBe(0);
    });
  });

  it("does not activate a download that is not a working yt-dlp", async () => {
    await withRelease("ffmpeg version 9.0.2\n", async ({ directory, create }) => {
      const ytdlp = create();
      await Effect.runPromise(ytdlp.install());
      const failed = await finished(ytdlp);
      expect(failed.installation.error).toContain("could not run");
      expect(failed.ytdlp).toEqual({ state: "missing" });
      expect(await readdir(join(directory, "tools", "yt-dlp"))).toEqual([]);
    });
  });
});
