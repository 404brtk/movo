import { chmod, rename } from "node:fs/promises";
import { join } from "node:path";
import { YtdlpStatus } from "../../shared/contracts/media-tools.ts";
import { hasGlibc } from "./glibc.ts";
import {
  createManagedTools,
  executableSuffix,
  type ManagedToolsOptions,
  type ToolPackage,
} from "./managed.ts";

export interface YtdlpConfig {
  dataDirectory: string;
  ytdlpPath?: string | undefined;
}

export function ytdlpPackage(): ToolPackage | null {
  if (process.arch !== "x64") return null;
  if (process.platform === "win32") {
    return {
      id: "ytdlp-2026.10.26-win32-x64",
      provider: "yt-dlp",
      sourceUrl: "https://github.com/yt-dlp/yt-dlp/releases/tag/2026.10.26",
      version: "2026.10.26",
      bytes: 23575744,
      url: "https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp.exe",
      sha256: "f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d",
    };
  }
  if (hasGlibc(2, 17)) {
    return {
      id: "ytdlp-2026.10.26-linux-x64",
      provider: "yt-dlp",
      sourceUrl: "https://github.com/yt-dlp/yt-dlp/releases/tag/2026.10.26",
      version: "2026.10.26",
      bytes: 41166968,
      url: "https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp_linux",
      sha256: "767ba9dce7052aa196f8b12652f433d76de128ba168966fa84b6394d5e6c6795",
    };
  }
  return null;
}

export function createYtdlp(
  config: YtdlpConfig,
  { build = ytdlpPackage(), ...options }: Partial<ManagedToolsOptions<ToolPackage>> = {},
) {
  return createManagedTools(
    {
      name: "yt-dlp",
      directory: "yt-dlp",
      manualSetup: "Install the official yt-dlp standalone executable and set YTDLP_PATH.",
      status: YtdlpStatus,
      executables: {
        ytdlp: {
          label: "yt-dlp",
          filename: "yt-dlp",
          setting: "YTDLP_PATH",
          configuredPath: config.ytdlpPath,
          versionArguments: ["--version"],
          readVersion: (output) => /^(\d{4}\.\d+\.\d+(?:\.\d+)?)\s*$/u.exec(output)?.[1],
        },
      },
      unpack: async (_build, download, destination) => {
        const executable = join(destination, `yt-dlp${executableSuffix}`);
        await rename(download, executable);
        if (process.platform !== "win32") await chmod(executable, 0o700);
      },
    },
    config.dataDirectory,
    { build, ...options },
  );
}

export type Ytdlp = ReturnType<typeof createYtdlp>;
