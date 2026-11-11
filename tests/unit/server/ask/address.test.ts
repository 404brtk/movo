import { describe, expect, it } from "vitest";
import { readServerAddress } from "../../../../src/server/ask/address.ts";
import { addressReach, serverReach } from "../../../../src/shared/server-address.ts";
import { isOpenAiChatModel } from "../../../../src/server/ask/providers.ts";
import { MediaError } from "../../../../src/server/media/error.ts";

describe("server addresses", () => {
  it.each([
    ["localhost", "this-computer"],
    ["127.0.0.1", "this-computer"],
    ["[::1]", "this-computer"],
    ["10.0.0.5", "network"],
    ["172.16.0.1", "network"],
    ["172.31.255.255", "network"],
    ["192.168.1.20", "network"],
    ["nas.local", "network"],
    ["[fd12:3456::1]", "network"],
    ["[::ffff:192.168.1.2]", "network"],
    ["172.32.0.1", null],
    ["169.254.169.254", null],
    ["8.8.8.8", null],
    ["example.com", null],
    [".local", null],
  ])("classifies %s", (host, reach) => {
    expect(serverReach(host)).toBe(reach);
  });

  it("describes an address while it is typed", () => {
    expect(addressReach("192.168.1.20:11434")).toEqual({ reach: "network", encrypted: false });
    expect(addressReach("https://localhost:1234")).toEqual({
      reach: "this-computer",
      encrypted: true,
    });
    expect(addressReach("api.example.com")).toBeNull();
    expect(addressReach("999.1.1.1")).toBeNull();
    expect(addressReach("")).toBeNull();
  });

  it("normalizes an address to its base URL", () => {
    expect(readServerAddress("192.168.1.20:11434")).toEqual({
      baseUrl: "http://192.168.1.20:11434",
      reach: "network",
    });
    expect(readServerAddress(" http://localhost:1234/v1/ ").baseUrl).toBe("http://localhost:1234");
    expect(readServerAddress("https://nas.local/llm").baseUrl).toBe("https://nas.local/llm");
  });

  it.each([
    "ftp://192.168.1.2",
    "http://user:secret@192.168.1.2",
    "http://192.168.1.2/?q=1",
    "http://api.example.com",
    "http://",
  ])("rejects %s", (address) => {
    expect(() => readServerAddress(address)).toThrow(MediaError);
  });
});

it("keeps chat models from OpenAI's list and leaves out other model families", () => {
  expect(["gpt-5.5", "o4-mini", "gpt-4.1"].filter(isOpenAiChatModel)).toHaveLength(3);
  expect(
    [
      "text-embedding-3-large",
      "tts-1",
      "whisper-1",
      "gpt-4o-transcribe",
      "dall-e-3",
      "gpt-image-1",
      "omni-moderation-latest",
      "gpt-4o-realtime-preview",
      "gpt-4o-audio-preview",
      "sora-2",
      "babbage-002",
      "gpt-4o-search-preview",
    ].filter(isOpenAiChatModel),
  ).toEqual([]);
});
