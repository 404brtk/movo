import type { AppDatabase } from "../db/database.ts";
import { transcriptionModel } from "../models/catalog.ts";
import { transcriptionJobs } from "./transcriptions.schema.ts";

type TranscriptionQueueDatabase = Pick<AppDatabase, "insert">;

export function queueTranscription(database: TranscriptionQueueDatabase, mediaId: string) {
  const now = Date.now();
  database
    .insert(transcriptionJobs)
    .values({
      mediaId,
      modelId: transcriptionModel.id,
      status: "queued",
      phase: "queued",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();
}
