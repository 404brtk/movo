import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { chmod, open, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { MediaError } from "../media/error.ts";
import type { MediaToolsPackage } from "./packages.ts";

export function tarExecutable() {
  if (process.platform !== "win32") return "tar";
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !isAbsolute(systemRoot)) {
    throw new MediaError(
      "unavailable",
      "Windows SystemRoot is unavailable. Movo could not locate the system archive tool.",
    );
  }
  return join(systemRoot, "System32", "tar.exe");
}

export async function downloadArchive(
  build: MediaToolsPackage,
  destination: string,
  signal: AbortSignal,
  progress: (bytes: number) => void,
) {
  const response = await fetch(build.url, { signal });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new MediaError(
      "unavailable",
      `Could not download media tools (HTTP ${response.status}). Try again or configure local tools manually.`,
    );
  }
  const hash = createHash("sha256");
  let bytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.byteLength;
      if (bytes > build.bytes) {
        callback(new MediaError("unavailable", "The media tools download has an unexpected size."));
        return;
      }
      hash.update(chunk);
      progress(bytes);
      callback(null, chunk);
    },
  });
  await pipeline(response.body, counter, createWriteStream(destination, { flags: "wx" }), {
    signal,
  });
  if (bytes !== build.bytes || hash.digest("hex") !== build.sha256) {
    throw new MediaError(
      "unavailable",
      "The media tools download failed its integrity check. No tools were activated. Try again.",
    );
  }
}

export async function extractArchive(
  build: MediaToolsPackage,
  archive: string,
  directory: string,
  signal: AbortSignal,
) {
  const suffix = process.platform === "win32" ? ".exe" : "";
  const members = [
    [`bin/ffmpeg${suffix}`, `ffmpeg${suffix}`],
    [`bin/ffprobe${suffix}`, `ffprobe${suffix}`],
    [build.license, "LICENSE"],
  ];
  for (const [member, filename] of members) {
    if (!member || !filename) throw new Error("Media tools package has no archive member");
    const path = join(directory, filename);
    const output = await open(path, "wx", 0o700);
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(tarExecutable(), ["-xOf", archive, `${build.root}/${member}`], {
          stdio: ["ignore", output.fd, "pipe"],
          windowsHide: true,
          timeout: 120000,
          signal,
        });
        let failure: Error | undefined;
        let diagnostic = "";
        child.once("error", (error) => {
          failure = error;
        });
        child.stderr?.on("data", (chunk: Buffer) => {
          if (diagnostic.length < 8192) diagnostic += chunk.toString("utf8");
        });
        child.once("close", (code) => {
          if (failure || code !== 0) {
            reject(
              new MediaError(
                "unavailable",
                "Could not unpack media tools. Check that tar is available and supports this archive.",
                failure ?? new Error(diagnostic),
              ),
            );
          } else resolve();
        });
      });
    } finally {
      await output.close();
    }
    const file = await stat(path);
    if (!file.isFile() || file.size === 0 || file.size > 1024 * 1024 * 1024) {
      throw new MediaError("unavailable", "The media tools archive contains an invalid file.");
    }
    if (process.platform !== "win32" && filename !== "LICENSE") await chmod(path, 0o700);
  }
}
