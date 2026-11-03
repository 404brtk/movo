import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readServerConfig } from "./config.ts";

describe("server configuration", () => {
  it("uses a local data directory and a nonprivileged default port", () => {
    expect(readServerConfig({})).toEqual({
      port: 4310,
      dataDirectory: join(homedir(), ".movo"),
      databasePath: join(homedir(), ".movo", "app.sqlite"),
      ffprobePath: "ffprobe",
    });
  });

  it.each(["", "abc", "80", "65536", "4310.5"])("rejects invalid port %s", (port) => {
    expect(() => readServerConfig({ PORT: port })).toThrow(/Expected/u);
  });

  it("rejects a relative data directory", () => {
    expect(() => readServerConfig({ MOVO_DATA_DIR: "./data" })).toThrow("must be an absolute path");
  });

  it("honors MOVO_DATA_DIR and PORT overrides", () => {
    const dataDirectory = join(homedir(), "custom-movo-data");
    expect(readServerConfig({ MOVO_DATA_DIR: dataDirectory, PORT: "4500" })).toEqual({
      port: 4500,
      dataDirectory,
      databasePath: join(dataDirectory, "app.sqlite"),
      ffprobePath: "ffprobe",
    });
  });
});
