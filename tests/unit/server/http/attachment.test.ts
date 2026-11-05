import { describe, expect, it } from "vitest";
import { attachmentDisposition } from "../../../../src/server/http/attachment.ts";

describe("attachment filenames", () => {
  it("preserves ASCII filenames and encodes spaces in the extended parameter", () => {
    expect(attachmentDisposition("meeting notes.txt")).toBe(
      "attachment; filename=\"meeting notes.txt\"; filename*=UTF-8''meeting%20notes.txt",
    );
  });

  it("encodes Unicode and reserved header characters with an ASCII fallback", () => {
    expect(attachmentDisposition('Żółć O\'Brien (1)*"quote".vtt')).toBe(
      "attachment; filename=\"____ O'Brien (1)*_quote_.vtt\"; filename*=UTF-8''%C5%BB%C3%B3%C5%82%C4%87%20O%27Brien%20%281%29%2A%22quote%22.vtt",
    );
  });

  it("replaces path separators and control characters without permitting header injection", () => {
    expect(attachmentDisposition("../folder\\bad\r\nX-Evil: yes.txt")).toBe(
      "attachment; filename=\".._folder_bad__X-Evil: yes.txt\"; filename*=UTF-8''.._folder_bad__X-Evil%3A%20yes.txt",
    );
  });

  it("handles malformed Unicode and percent sequences without invalid header bytes", () => {
    expect(attachmentDisposition("\ud800%20.srt")).toBe(
      "attachment; filename=\"__20.srt\"; filename*=UTF-8''%EF%BF%BD%2520.srt",
    );
  });
});
