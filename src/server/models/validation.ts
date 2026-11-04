import { fileURLToPath } from "node:url";
import { Effect, Schema } from "effect";
import { MediaError } from "../media/error.ts";
import { runCommand } from "../process/command.ts";

const EngineValidation = Schema.Struct({
  engineVersion: Schema.String.check(Schema.isMinLength(1)),
});
export function validateModel(path: string | null, signal: AbortSignal) {
  const runtimeHelp =
    process.platform === "win32"
      ? " On Windows, install Visual C++ 2015–2022 x64 runtime 14.40 or newer."
      : "";
  const worker = new URL(
    import.meta.url.endsWith(".ts") ? "./validation-worker.ts" : "./validation-worker.js",
    import.meta.url,
  );
  return Effect.runPromise(
    runCommand(process.execPath, [fileURLToPath(worker), path ?? "--probe"], {
      timeoutMs: 120000,
    }).pipe(
      Effect.flatMap((output) =>
        Effect.try({
          try: () => {
            const line = output.split("\n").findLast((value) => value.startsWith("MOVO_MODEL:"));
            if (!line) throw new Error("The model worker returned no result.");
            return Schema.decodeUnknownSync(EngineValidation)(
              JSON.parse(line.slice("MOVO_MODEL:".length)),
            );
          },
          catch: (cause) =>
            new MediaError(
              "unavailable",
              "The model worker returned an invalid validation result.",
              cause,
            ),
        }),
      ),
      Effect.mapError(
        (cause) =>
          new MediaError(
            "unavailable",
            `Could not validate the local transcription engine or model. Check free memory and native runtime prerequisites.${runtimeHelp} ${cause.message}`,
            cause,
          ),
      ),
    ),
    { signal },
  );
}
