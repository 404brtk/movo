import { describe, expect, it } from "vitest";
import { sourceSite } from "../../../../src/web/lib/source-sites.ts";

describe("source sites", () => {
  it.each([
    ["https://www.youtube.com/watch?v=aaaaaaaaaaa", "YouTube"],
    ["https://x.com/i/web/status/1853920261", "X"],
    ["https://www.tiktok.com/@/video/7212345678901234567", "TikTok"],
    ["https://www.instagram.com/p/C1a2b3c4d5e/", "Instagram"],
    ["https://www.facebook.com/watch/?v=1234567890", "Facebook"],
    ["https://www.twitch.tv/videos/2012345678", "Twitch"],
    ["https://clips.twitch.tv/BraveCleverClip-AbC123", "Twitch"],
    ["https://podcasts.apple.com/podcast/id1234567890?i=1000654321098", "Apple Podcasts"],
    ["https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view", "Google Drive"],
    ["https://www.dropbox.com/s/abc123/talk.mp4", "Dropbox"],
  ])("names the stored link %s with its site and mark", (url, name) => {
    const site = sourceSite(url);
    expect(site.name).toBe(name);
    expect(site.icon).not.toBeNull();
  });

  it("falls back to the host without a mark for links Movo does not recognize", () => {
    expect(sourceSite("https://www.example.com/talk.mp4")).toEqual({
      name: "example.com",
      icon: null,
    });
  });
});
