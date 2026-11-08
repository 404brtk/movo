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
    expect(() => downloadSource(input)).toThrow("YouTube video or X post");
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
    expect(() => downloadSource(input)).toThrow("YouTube video or X post");
  });
});
