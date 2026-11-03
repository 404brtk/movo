import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { Schema } from "effect";

const ServerConfig = Schema.Struct({
  port: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1024, maximum: 65535 })),
  dataDirectory: Schema.String.check(Schema.isMinLength(1)),
  ffprobePath: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  ffmpegPath: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
});

export function readServerConfig(environment: NodeJS.ProcessEnv) {
  const config = Schema.decodeUnknownSync(ServerConfig)({
    port: Number(environment.PORT ?? "4310"),
    dataDirectory: environment.MOVO_DATA_DIR ?? join(homedir(), ".movo"),
    ffprobePath: environment.FFPROBE_PATH,
    ffmpegPath: environment.FFMPEG_PATH,
  });
  if (!isAbsolute(config.dataDirectory)) {
    throw new Error("MOVO_DATA_DIR must be an absolute path");
  }
  return { ...config, databasePath: join(config.dataDirectory, "app.sqlite") };
}
