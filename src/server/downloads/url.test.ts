import { describe, expect, it } from "vitest";
import { youtubeUrl } from "./url.ts";

describe("single public YouTube URLs", () => {
  it.each([
    "https://www.youtube.com/watch?v=J7DzL2_Na80&list=ignored&t=12",
    "https://youtu.be/J7DzL2_Na80?si=tracking",
    "https://m.youtube.com/watch?v=J7DzL2_Na80",
    "https://youtube.com/shorts/J7DzL2_Na80",
    "https://www.youtube.com/embed/J7DzL2_Na80",
  ])("normalizes %s to a video identity", (input) => {
    expect(youtubeUrl(input)).toBe("https://www.youtube.com/watch?v=J7DzL2_Na80");
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
  ])("rejects unsupported input %s", (input) => {
    expect(() => youtubeUrl(input)).toThrow("single YouTube video");
  });
});
