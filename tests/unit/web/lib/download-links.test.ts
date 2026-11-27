import { describe, expect, it } from "vitest";
import type { DownloadJob } from "../../../../src/shared/contracts/downloads.ts";
import { recognizeYouTubeCollection } from "../../../../src/shared/download-sources.ts";
import {
  addLinks,
  canChooseKind,
  linkPreset,
  linkSkip,
} from "../../../../src/web/lib/download-links.ts";

const youtube = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
const episode = "https://podcasts.apple.com/us/podcast/a-show/id1?i=2";
const playlist = "https://www.youtube.com/playlist?list=PLabcdefghijk";
const channel = "https://www.youtube.com/@example/videos";

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
  it("opens a single direct collection and keeps collections separate in a mixed paste", () => {
    const direct = addLinks([], "https://m.youtube.com/@Example/?si=123", "video");
    expect(direct.openCollection).toEqual({ kind: "channel", id: "@example", url: channel });
    expect(direct.rows).toEqual([]);
    const mixed = addLinks(
      [],
      `${episode} ${playlist}&si=share ${channel} https://youtu.be/aaaaaaaaaaa?list=PLabcdefghijk`,
      "audio",
    );
    expect(mixed.openCollection).toBeUndefined();
    expect(mixed.collections.map(({ source, fromWatch }) => [source.url, fromWatch])).toEqual([
      [playlist, true],
      [channel, false],
    ]);
    expect(mixed.rows.map((row) => [row.source?.url, row.kind])).toEqual([
      ["https://podcasts.apple.com/podcast/id1?i=2", "audio"],
      [youtube, "audio"],
    ]);
  });

  it("keeps a Mix video and gives actionable feedback for a standalone Mix", () => {
    const watch = addLinks([], `${youtube}&list=RDMM`, "video");
    expect(watch.rows.map((row) => row.key)).toEqual([youtube]);
    expect(watch.collections).toEqual([]);
    expect(watch.note).toBeNull();
    const mixed = addLinks([], `${episode} https://www.youtube.com/playlist?list=RDMM`, "video");
    expect(mixed.note).toBe("This is a YouTube Mix. Paste a link to a specific video.");
    expect(mixed.rows.map((row) => row.source?.site)).toEqual(["applePodcasts"]);
    expect(mixed.remaining).toBe("");
    expect(mixed.collections).toEqual([]);
  });

  it("offers curated YouTube Music playlists that start with RD", () => {
    const id = "RDCLAK5uy_abcdefghijk";
    const url = `https://www.youtube.com/playlist?list=${id}`;
    expect(addLinks([], url, "video").openCollection).toEqual({ kind: "playlist", id, url });
    expect(addLinks([], `${youtube}&list=${id}`, "video").collections).toEqual([
      { source: { kind: "playlist", id, url }, fromWatch: true },
    ]);
  });

  it("only recognizes collection links that can be listed without sign-in", () => {
    const channelId = "UCabcdefghijklmnopqrstuv";
    expect(recognizeYouTubeCollection(`https://youtube.com/channel/${channelId}`)).toEqual({
      kind: "channel",
      id: channelId,
      url: `https://www.youtube.com/channel/${channelId}/videos`,
    });
    expect(
      recognizeYouTubeCollection("https://youtube.com/@%C5%BC%C3%B3%C5%82ty/videos"),
    ).toMatchObject({
      id: "@żółty",
    });
    for (const input of [
      "https://www.youtube.com.evil.example/@example",
      "https://a@www.youtube.com/@example",
      "http://www.youtube.com/@example",
      "https://www.youtube.com:123/@example",
      "https://www.youtube.com/@example/shorts",
      "https://www.youtube.com/@example/streams",
      "https://www.youtube.com/user/example",
      "https://www.youtube.com/@example%2Fvideos",
      "https://www.youtube.com/@%ff",
      "https://www.youtube.com/playlist?list=WL",
      "https://www.youtube.com/watch?v=bad&list=PLabcdefghijk",
    ])
      expect(recognizeYouTubeCollection(input)).toBeUndefined();
  });

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
    expect(result.note).toBe("The rest are added after you download these.");
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
    expect(video && linkSkip(video, "video-1080p", none, [job({ status: "failed" })])).toBe(null);
  });

  it("skips a link the library already has in that preset, even without its download", () => {
    const mediaId = "0b2f7c5e-3d1a-4f6b-8e9c-1a2b3c4d5e6f";
    const preview = {
      error: null,
      data: {
        url: youtube,
        title: "A saved talk",
        durationSeconds: 60,
        saved: [{ preset: "audio" as const, mediaId }],
      },
    };
    expect(video && linkSkip({ ...video, kind: "audio" }, "audio", preview, [])).toEqual({
      reason: "saved",
      tone: "idle",
      message: "Already saved as audio",
      mediaId,
    });
    expect(video && linkSkip(video, "video-1080p", preview, [])).toBe(null);
    expect(
      video && linkSkip(video, "audio", preview, [job({ preset: "audio", status: "failed" })]),
    ).toMatchObject({ reason: "saved", mediaId });
  });
});
