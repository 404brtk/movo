import { MediaToolsStatus } from "../../shared/contracts/media-tools.ts";
import { MediaError } from "../media/error.ts";
import { extractArchive, tarExecutable } from "./archive.ts";
import { createManagedTools, runExecutable, type ManagedToolsOptions } from "./managed.ts";
import { mediaToolsPackage, type MediaToolsPackage } from "./packages.ts";

export interface MediaToolsConfig {
  dataDirectory: string;
  ffprobePath?: string | undefined;
  ffmpegPath?: string | undefined;
}

export function createMediaTools(
  config: MediaToolsConfig,
  { build = mediaToolsPackage(), ...options }: Partial<ManagedToolsOptions<MediaToolsPackage>> = {},
) {
  return createManagedTools(
    {
      name: "media tools",
      directory: "ffmpeg",
      manualSetup: "Install FFmpeg and FFprobe manually and configure their paths.",
      status: MediaToolsStatus,
      executables: {
        ffprobe: {
          label: "FFprobe",
          filename: "ffprobe",
          setting: "FFPROBE_PATH",
          configuredPath: config.ffprobePath,
          versionArguments: ["-version"],
          readVersion: (output) => /^ffprobe version (\S+)/u.exec(output)?.[1],
        },
        ffmpeg: {
          label: "FFmpeg",
          filename: "ffmpeg",
          setting: "FFMPEG_PATH",
          configuredPath: config.ffmpegPath,
          versionArguments: ["-version"],
          readVersion: (output) => /^ffmpeg version (\S+)/u.exec(output)?.[1],
        },
      },
      prepare: async (signal) => {
        try {
          await runExecutable(tarExecutable(), ["--version"], signal);
        } catch (cause) {
          throw new MediaError(
            "unavailable",
            "Media tools need tar to unpack their download. Install tar (and xz on Linux), then try again, or configure existing FFmpeg and FFprobe.",
            cause,
          );
        }
      },
      unpack: extractArchive,
    },
    config.dataDirectory,
    { build, ...options },
  );
}

export type MediaTools = ReturnType<typeof createMediaTools>;
