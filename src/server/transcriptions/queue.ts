import type { AppDatabase } from "../db/database.ts";
import { transcriptionModel } from "../models/catalog.ts";
import { readSpeakerModelId } from "../models/speaker-labels.ts";
import { transcriptionJobs } from "./transcriptions.schema.ts";

type TranscriptionQueueDatabase = Pick<AppDatabase, "insert" | "select">;

export function queueTranscription(database: TranscriptionQueueDatabase, mediaId: string) {
  const now = Date.now();
  database
    .insert(transcriptionJobs)
    .values({
      mediaId,
      modelId: transcriptionModel.id,
      speakerModelId: readSpeakerModelId(database),
      status: "queued",
      phase: "queued",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();
}
