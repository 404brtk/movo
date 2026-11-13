import { describe, expect, it } from "vitest";
import type { DownloadJob } from "../../../../src/shared/contracts/downloads.ts";
import {
  addLinks,
  canChooseKind,
  linkPreset,
  linkSkip,
} from "../../../../src/web/lib/download-links.ts";

const youtube = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
const episode = "https://podcasts.apple.com/us/podcast/a-show/id1?i=2";

const job = (changes: Partial<DownloadJob>): DownloadJob => ({
  id: "6f1f4f8e-8a7c-4d2b-9a55-0d7c2f4b9e11",
  url: youtube,
  preset: "video-1080p",
  transcribe: false,
  title: null,
  durationSeconds: null,
  status: "queued",
  phase: "queued",
  downloadedBytes: 0,
  totalBytes: null,
  error: null,
  cleanupError: null,
  mediaId: null,
  createdAt: 1,
  updatedAt: 1,
  ...changes,
});

describe("adding pasted links", () => {
  it("adds every link as a row in order and keeps text that is not a link", () => {
    const result = addLinks(
      [],
      ` ${youtube}\nhello https://open.spotify.com/episode/abc ${episode} `,
      "audio",
    );
    expect(result.rows.map((row) => [row.source?.site, row.kind])).toEqual([
      ["youtube", "audio"],
      [undefined, "audio"],
      ["applePodcasts", "audio"],
    ]);
    expect(result.remaining).toBe("hello");
    expect(result.note).toBe("Paste full links that start with https://.");
  });

  it("keeps one row per item after normalizing the link", () => {
    const first = addLinks([], youtube, "video");
    const again = addLinks(first.rows, "https://youtu.be/aaaaaaaaaaa?t=3", "video");
    expect(again.rows).toHaveLength(1);
    expect(again.note).toBe("Already in the list.");
  });

  it("leaves links past the limit in the field", () => {
    const links = Array.from(
      { length: 22 },
      (_, index) => `https://youtu.be/${String(index).padStart(11, "a")}`,
    );
    const result = addLinks([], links.join(" "), "video");
    expect(result.rows).toHaveLength(20);
    expect(result.remaining).toBe(links.slice(20).join(" "));
    expect(result.note).toBe("Add the rest once these links are downloaded.");
  });
});

describe("link options", () => {
  const [video, podcast, unsupported] = addLinks(
    [],
    `${youtube} ${episode} https://open.spotify.com/episode/abc`,
    "video",
  ).rows;

  it("saves sources without video as audio whatever the row says", () => {
    expect(video && linkPreset(video, "video-720p")).toBe("video-720p");
    expect(video && linkPreset({ ...video, kind: "audio" }, "video-720p")).toBe("audio");
    expect(podcast && canChooseKind(podcast)).toBe(false);
    expect(podcast && linkPreset(podcast, "video-720p")).toBe("audio");
  });

  it("explains why a link is skipped", () => {
    const none = { error: null };
    expect(unsupported && linkSkip(unsupported, "audio", none, [])).toMatchObject({
      reason: "unsupported",
      message: "open.spotify.com isn’t supported",
    });
    expect(
      video && linkSkip(video, "video-1080p", { error: new Error("Private post.") }, []),
    ).toMatchObject({ reason: "unavailable", message: "Private post." });
    expect(video && linkSkip(video, "video-1080p", none, [job({})])).toMatchObject({
      reason: "queued",
    });
    const mediaId = "0b2f7c5e-3d1a-4f6b-8e9c-1a2b3c4d5e6f";
    expect(
      video && linkSkip(video, "video-1080p", none, [job({ status: "completed", mediaId })]),
    ).toEqual({ reason: "saved", tone: "idle", message: "Already saved as video", mediaId });
    expect(video && linkSkip(video, "audio", none, [job({ status: "completed", mediaId })])).toBe(
      null,
    );
  });
});
