import type { SpeakerModelId } from "../../shared/contracts/models.ts";
import type { AppDatabase } from "../db/database.ts";
import { modelSettings } from "./models.schema.ts";

export const readSpeakerModelId = (database: Pick<AppDatabase, "select">) =>
  database.select().from(modelSettings).get()?.speakerModelId ?? null;

export const saveSpeakerModelId = (
  database: Pick<AppDatabase, "insert">,
  speakerModelId: SpeakerModelId | null,
) =>
  database
    .insert(modelSettings)
    .values({ id: 1, speakerModelId })
    .onConflictDoUpdate({ target: modelSettings.id, set: { speakerModelId } })
    .run();
