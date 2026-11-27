import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { expect, it } from "vitest";
import { createMediaDownloader } from "../../src/server/downloads/ytdlp.ts";
import { createMediaTools } from "../../src/server/media-tools/tools.ts";
import { createYtdlp, pinnedYtdlpVersion } from "../../src/server/media-tools/ytdlp.ts";
import { recognizeDownloadSource } from "../../src/shared/download-sources.ts";

it.for([
  {
    kind: "playlist",
    url: "https://www.youtube.com/playlist?list=PLZHQObOWTQDPD3MizzM2xVFitgF8hE_ab",
  },
  { kind: "channel's Videos tab", url: "https://www.youtube.com/@3blue1brown/videos" },
])("reads a real YouTube $kind through its final collection line", async ({ url }, { signal }) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "movo-real-collection-"));
  const tools = createMediaTools({ dataDirectory });
  const ytdlp = createYtdlp({ dataDirectory, ytdlpPath: process.env.YTDLP_PATH });
  const downloader = createMediaDownloader(() => ytdlp.resolve("ytdlp"), tools);
  try {
    const { ytdlp: availability } = await Effect.runPromise(ytdlp.status(), { signal });
    expect(availability).toMatchObject({ state: "ready", version: pinnedYtdlpVersion });
    const cursors = new Set<string>();
    let cursor: string | undefined;
    let count = 0;
    do {
      const page = await Effect.runPromise(downloader.previewCollection({ url, cursor }), {
        signal,
      });
      expect(page.title?.trim()).toBeTruthy();
      for (const video of page.videos) {
        expect(recognizeDownloadSource(video.url)?.site).toBe("youtube");
        expect(video.title.trim()).toBeTruthy();
      }
      count += page.videos.length;
      cursor = page.nextCursor ?? undefined;
      if (cursor) {
        if (cursors.has(cursor)) throw new Error("The collection returned the same cursor twice.");
        cursors.add(cursor);
      }
    } while (cursor);
    expect(count).toBeGreaterThan(0);
  } finally {
    await Effect.runPromise(downloader.closeCollections());
    await Effect.runPromise(ytdlp.close());
    await Effect.runPromise(tools.close());
    await rm(dataDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
