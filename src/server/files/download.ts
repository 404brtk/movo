import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { MediaError } from "../media/error.ts";

export interface DownloadSource {
  url: string;
  bytes: number;
  sha256: string;
}

export async function downloadFile(
  source: DownloadSource,
  destination: string,
  signal: AbortSignal,
  progress: (bytes: number) => void,
) {
  const response = await fetch(source.url, { signal });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new MediaError(
      "unavailable",
      `Could not download the file (HTTP ${response.status}). Try again.`,
    );
  }
  const hash = createHash("sha256");
  let bytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.byteLength;
      if (bytes > source.bytes) {
        callback(new MediaError("unavailable", "The download has an unexpected size."));
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
  if (bytes !== source.bytes || hash.digest("hex") !== source.sha256)
    throw new MediaError(
      "unavailable",
      "The download failed its integrity check. No files were activated. Try again.",
    );
}
