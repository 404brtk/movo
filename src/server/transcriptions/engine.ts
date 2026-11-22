import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Schema } from "effect";
import type { SpeakerModelId } from "../../shared/contracts/models.ts";
import {
  PhaseProgress,
  Transcript,
  TranscriptionDevice,
} from "../../shared/contracts/transcriptions.ts";
import { MediaError } from "../media/error.ts";
import type { MediaTools } from "../media-tools/tools.ts";
import { transcriptionModel } from "../models/catalog.ts";
import type { Models } from "../models/models.ts";
import { runCommand } from "../process/command.ts";
import type { TranscriptionReport, TranscriptionRequest } from "./jobs.ts";
import { SpeakerDiarizer } from "./speaker-diarization.ts";

const EnginePhase = Schema.Literals(["loading", "transcribing", "speakers"]);

const missingFile = () =>
  new MediaError("unavailable", "The model catalog is missing a required file.");

export function createTranscriptionEngine(
  tools: Pick<MediaTools, "resolve">,
  models: Pick<Models, "resolve" | "speakerLabels">,
  run = runCommand,
) {
  const transcriber = () =>
    Effect.all({
      ffmpeg: tools.resolve("ffmpeg"),
      model: models.resolve(transcriptionModel.id),
    }).pipe(
      Effect.flatMap(({ ffmpeg, model }) =>
        model.transcription
          ? Effect.succeed({ ffmpeg, modelPath: model.transcription })
          : Effect.fail(missingFile()),
      ),
    );
  const diarizer = (speakerModelId: SpeakerModelId | null) =>
    speakerModelId === null
      ? Effect.succeed(null)
      : models.resolve(speakerModelId).pipe(
          Effect.flatMap((files) =>
            Effect.try({
              try: () =>
                Schema.decodeUnknownSync(SpeakerDiarizer)({ model: speakerModelId, ...files }),
              catch: missingFile,
            }),
          ),
        );
  return {
    check: () =>
      Effect.all([transcriber(), Effect.flatMap(models.speakerLabels(), diarizer)]).pipe(
        Effect.asVoid,
      ),
    transcribe: (
      { path, directory, speakerModelId }: TranscriptionRequest,
      report: TranscriptionReport,
    ) =>
      Effect.gen(function* () {
        const { ffmpeg, modelPath } = yield* transcriber();
        const speakers = yield* diarizer(speakerModelId);
        const pcm = join(directory, "audio.f32");
        const resultPath = join(directory, "result.json");
        report.phase("preparing");
        yield* run(
          ffmpeg,
          [
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-n",
            "-protocol_whitelist",
            "file,pipe",
            "-format_whitelist",
            "mov,mp3,wav,ogg,flac,matroska,webm,aac",
            "-i",
            path,
            "-map",
            "0:a:0",
            "-vn",
            "-sn",
            "-dn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_f32le",
            "-f",
            "f32le",
            pcm,
          ],
          { timeoutMs: 30 * 60 * 1000 },
        ).pipe(
          Effect.mapError(
            (cause) =>
              new MediaError(
                "unsupported",
                "Could not prepare audio for transcription. The recording must contain a readable audio track. Check disk space and FFmpeg, then try again.",
                cause,
              ),
          ),
        );
        const worker = new URL(
          import.meta.url.endsWith(".ts") ? "./worker.ts" : "./worker.js",
          import.meta.url,
        );
        let deviceReported = false;
        yield* run(
          process.execPath,
          [
            fileURLToPath(worker),
            modelPath,
            pcm,
            resultPath,
            ...(speakers ? [JSON.stringify(speakers)] : []),
          ],
          {
            timeoutMs: 6 * 60 * 60 * 1000,
            ipc: true,
            onLine: (line) => {
              if (line.startsWith("MOVO_DEVICE:")) {
                report.device(
                  Schema.decodeUnknownSync(TranscriptionDevice)(
                    JSON.parse(line.slice("MOVO_DEVICE:".length)),
                  ),
                );
                deviceReported = true;
                return;
              }
              if (line.startsWith("MOVO_PROGRESS:")) {
                report.progress(
                  Schema.decodeUnknownSync(PhaseProgress)(
                    Number(line.slice("MOVO_PROGRESS:".length)),
                  ),
                );
                return;
              }
              if (!line.startsWith("MOVO_PHASE:")) return;
              const phase = line.slice("MOVO_PHASE:".length);
              if (!Schema.is(EnginePhase)(phase))
                throw new MediaError(
                  "unsupported",
                  "The transcription engine returned an invalid phase.",
                );
              report.phase(phase);
            },
          },
        ).pipe(
          Effect.mapError(
            (cause) =>
              new MediaError(
                "unavailable",
                `Local transcription failed. Check free memory and the native runtime prerequisites, then retry. ${cause.message}`,
                cause,
              ),
          ),
        );
        return yield* Effect.tryPromise({
          try: async () => {
            if (!deviceReported) throw new Error("The engine did not report its device.");
            const file = await lstat(resultPath);
            if (!file.isFile() || file.size < 1 || file.size > 32 * 1024 * 1024)
              throw new Error("Invalid transcription result file.");
            return Schema.decodeUnknownSync(Transcript)(
              JSON.parse(await readFile(resultPath, "utf8")),
            );
          },
          catch: (cause) =>
            new MediaError(
              "unsupported",
              "The transcription engine returned an invalid result.",
              cause,
            ),
        });
      }),
  };
}
