import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { SpeakerModelId } from "../../shared/contracts/models.ts";

export const modelSettings = sqliteTable(
  "model_settings",
  {
    id: integer("id").primaryKey(),
    speakerModelId: text("speaker_model_id", { enum: SpeakerModelId.literals }),
  },
  (table) => [check("model_settings_single_row", sql`${table.id} = 1`)],
);
