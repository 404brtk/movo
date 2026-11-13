import { describe, expect, it } from "vitest";
import { downloadSource } from "../../../../src/server/downloads/url.ts";

describe("single public YouTube URLs", () => {
  it.each([
    "https://www.youtube.com/watch?v=J7DzL2_Na80&list=ignored&t=12",
    "https://youtu.be/J7DzL2_Na80?si=tracking",
    "https://m.youtube.com/watch?v=J7DzL2_Na80",
    "https://youtube.com/shorts/J7DzL2_Na80",
    "https://www.youtube.com/embed/J7DzL2_Na80",
  ])("normalizes %s to a video identity", (input) => {
    expect(downloadSource(input)).toEqual({
      site: "youtube",
      id: "J7DzL2_Na80",
      url: "https://www.youtube.com/watch?v=J7DzL2_Na80",
    });
  });
  it.each([
    "file:///etc/passwd",
    "http://127.0.0.1/video",
    "https://localhost/video",
    "https://youtube.com.evil.example/watch?v=J7DzL2_Na80",
    "https://user:pass@youtube.com/watch?v=J7DzL2_Na80",
    "https://youtube.com:444/watch?v=J7DzL2_Na80",
    "https://www.youtube.com/playlist?list=foo",
    "https://www.youtube.com/@channel",
    "https://youtu.be/../etc",
    "not a url",
    "",
  ])("rejects unsupported input %s", (input) => {
    expect(() => downloadSource(input)).toThrow("one public video or podcast episode");
  });
});

it("rejects links longer than 2048 characters before parsing them", () => {
  const link = `https://www.youtube.com/watch?v=J7DzL2_Na80&t=${"1".repeat(2048)}`;
  expect(() => downloadSource(link)).toThrow("Links must be 2048 characters or shorter.");
});

describe("single X post URLs", () => {
  it.each([
    "https://x.com/movo_test/status/123?s=20",
    "https://twitter.com/another_name/status/123#tracking",
    "https://www.x.com/i/web/status/123/",
    "https://mobile.twitter.com/example/status/123",
    "https://m.x.com/example/status/123",
    " https://x.com/i/status/123 ",
  ])("normalizes %s to the same post identity", (input) => {
    expect(downloadSource(input)).toEqual({
      site: "x",
      id: "123",
      url: "https://x.com/i/web/status/123",
    });
  });

  it("preserves a large synthetic post ID without number rounding", () => {
    expect(downloadSource("https://x.com/movo_test/status/9999999999999999999").id).toBe(
      "9999999999999999999",
    );
  });

  it.each([
    "http://x.com/example/status/123",
    "https://x.com.evil.example/example/status/123",
    "https://user:pass@x.com/example/status/123",
    "https://x.com:444/example/status/123",
    "https://x.com/example/status/123/video/2",
    "https://x.com/example/status/123/photo/1",
    "https://x.com/example/status/not-a-number",
    "https://x.com/example/status/0123",
    "https://x.com/example/status/123456789012345678901",
    "https://x.com/example",
    "https://x.com/i/spaces/abc",
    "https://t.co/shortened",
    "https://www.reddit.com/comments/example",
  ])("rejects unsupported input %s", (input) => {
    expect(() => downloadSource(input)).toThrow("one public video or podcast episode");
  });
});

describe("single links from other supported sites", () => {
  it.each([
    [
      "https://www.tiktok.com/@movo.test/video/7706564076964498719?is_from_webapp=1",
      "tiktok",
      "7706564076964498719",
      "https://www.tiktok.com/@movo.test/video/7706564076964498719",
    ],
    [
      "https://www.instagram.com/reels/DfP5u9CFOTK/",
      "instagram",
      "DfP5u9CFOTK",
      "https://www.instagram.com/p/DfP5u9CFOTK/",
    ],
    [
      "https://www.instagram.com/movo_test/reel/DfP5u9CFOTK/?igsh=share",
      "instagram",
      "DfP5u9CFOTK",
      "https://www.instagram.com/p/DfP5u9CFOTK/",
    ],
    [
      "https://www.facebook.com/reel/1150068097483241",
      "facebook",
      "1150068097483241",
      "https://www.facebook.com/watch/?v=1150068097483241",
    ],
    [
      "https://m.facebook.com/watch/?v=1150068097483241&_rdr",
      "facebook",
      "1150068097483241",
      "https://www.facebook.com/watch/?v=1150068097483241",
    ],
    [
      "https://www.facebook.com/movo.page/videos/1150068097483241/",
      "facebook",
      "1150068097483241",
      "https://www.facebook.com/watch/?v=1150068097483241",
    ],
    [
      "https://www.twitch.tv/videos/2872307685?t=1h2m",
      "twitchVod",
      "v2872307685",
      "https://www.twitch.tv/videos/2872307685",
    ],
    [
      "https://www.twitch.tv/movo_test/clip/CallousRoundGorillaRalpherZ-MkMVgOaSjfBRkUsm?range=7d",
      "twitchClip",
      "CallousRoundGorillaRalpherZ-MkMVgOaSjfBRkUsm",
      "https://clips.twitch.tv/CallousRoundGorillaRalpherZ-MkMVgOaSjfBRkUsm",
    ],
    [
      "https://clips.twitch.tv/CallousRoundGorillaRalpherZ-MkMVgOaSjfBRkUsm",
      "twitchClip",
      "CallousRoundGorillaRalpherZ-MkMVgOaSjfBRkUsm",
      "https://clips.twitch.tv/CallousRoundGorillaRalpherZ-MkMVgOaSjfBRkUsm",
    ],
    [
      "https://podcasts.apple.com/us/podcast/an-episode/id6812430636?i=1000801205093&uo=4",
      "applePodcasts",
      "1000801205093",
      "https://podcasts.apple.com/podcast/id6812430636?i=1000801205093",
    ],
    [
      "https://drive.google.com/file/d/0ByeS4oOUV-49Zzh4R1J6R09zazQ/view?usp=sharing",
      "googleDrive",
      "0ByeS4oOUV-49Zzh4R1J6R09zazQ",
      "https://drive.google.com/file/d/0ByeS4oOUV-49Zzh4R1J6R09zazQ/view",
    ],
    [
      "https://drive.google.com/open?id=0ByeS4oOUV-49Zzh4R1J6R09zazQ",
      "googleDrive",
      "0ByeS4oOUV-49Zzh4R1J6R09zazQ",
      "https://drive.google.com/file/d/0ByeS4oOUV-49Zzh4R1J6R09zazQ/view",
    ],
    [
      "https://www.dropbox.com/scl/fi/r2kd2skcy5ylbbta5y1pz/DJI_0003.MP4?rlkey=wcdgqangn7t3lnmmv6li9mu9h&dl=0",
      "dropbox",
      "r2kd2skcy5ylbbta5y1pz",
      "https://www.dropbox.com/scl/fi/r2kd2skcy5ylbbta5y1pz/DJI_0003.MP4?rlkey=wcdgqangn7t3lnmmv6li9mu9h",
    ],
    [
      "https://www.dropbox.com/s/nelirfsxnmcfbfh/test%20video.mp4?dl=0",
      "dropbox",
      "nelirfsxnmcfbfh",
      "https://www.dropbox.com/s/nelirfsxnmcfbfh/test%20video.mp4",
    ],
  ])("normalizes %s", (input, site, id, url) => {
    expect(downloadSource(input)).toEqual({ site, id, url });
  });

  it.each([
    "https://www.tiktok.com/@movo.test",
    "https://www.tiktok.com/@movo.test/photo/7706564076964498719",
    "https://vm.tiktok.com/ZMabcdef/",
    "https://www.instagram.com/movo_test/",
    "https://www.instagram.com/stories/movo_test/3456789012345678901/",
    "https://www.facebook.com/movo.page",
    "https://www.facebook.com/watch/?v=not-a-number",
    "https://fb.watch/abcdef/",
    "https://www.twitch.tv/movo_test",
    "https://www.twitch.tv/videos/0123",
    "https://podcasts.apple.com/us/podcast/a-show/id6812430636",
    "https://podcasts.apple.com/us/podcast/a-show/id6812430636?i=episode",
    "https://drive.google.com/drive/folders/0ByeS4oOUV-49Zzh4R1J6R09zazQ",
    "https://drive.google.com/file/d/short/view",
    "https://www.dropbox.com/scl/fi/r2kd2skcy5ylbbta5y1pz/DJI_0003.MP4",
    "https://www.dropbox.com/scl/fo/r2kd2skcy5ylbbta5y1pz/folder?rlkey=wcdgqangn7t3lnmmv6li9mu9h",
    "https://tiktok.com.evil.example/@movo.test/video/7706564076964498719",
    "https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk",
  ])("rejects unsupported input %s", (input) => {
    expect(() => downloadSource(input)).toThrow("one public video or podcast episode");
  });
});
