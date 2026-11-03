import type { MediaToolsDownload } from "../../shared/contracts/media-tools.ts";
import { Result, Schema } from "effect";

export interface MediaToolsPackage extends MediaToolsDownload {
  id: string;
  url: string;
  sha256: string;
  root: string;
  license: string;
}

export function mediaToolsPackage(): MediaToolsPackage | null {
  if (process.arch !== "x64") return null;
  if (process.platform === "win32") {
    return {
      id: "gyan-9.0.2-win32-x64",
      provider: "Gyan",
      sourceUrl: "https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2",
      version: "9.0.2",
      bytes: 114768076,
      url: "https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip",
      sha256: "60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba",
      root: "ffmpeg-9.0.2-essentials_build",
      license: "LICENSE",
    };
  }
  const report =
    process.platform === "linux"
      ? Schema.decodeUnknownResult(
          Schema.Struct({ header: Schema.Struct({ glibcVersionRuntime: Schema.String }) }),
        )(process.report.getReport())
      : null;
  const [major = 0, minor = 0] =
    report && Result.isSuccess(report)
      ? report.success.header.glibcVersionRuntime.split(".").map(Number)
      : [];
  if (process.platform === "linux" && (major > 2 || (major === 2 && minor >= 28))) {
    return {
      id: "btbn-9.0.2-39-linux-x64",
      provider: "BtbN",
      sourceUrl: "https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-10-31-12-59",
      version: "9.0.2-39",
      bytes: 136027168,
      url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-31-12-59/ffmpeg-n9.0.2-39-g7adfbe40dc-linux64-lgpl-9.0.tar.xz",
      sha256: "6046d6731b26f58887e953561551d254a6eec9fbca4100dfeab56e19af8328d5",
      root: "ffmpeg-n9.0.2-39-g7adfbe40dc-linux64-lgpl-9.0",
      license: "LICENSE.txt",
    };
  }
  return null;
}
