import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const dictionaryEntries = sqliteTable("dictionary_entries", {
  id: text("id").primaryKey(),
  spelling: text("spelling").notNull(),
  similar: integer("similar", { mode: "boolean" }).notNull(),
  alsoReplace: text("also_replace", { mode: "json" }).$type<readonly string[]>().notNull(),
  neverChange: text("never_change", { mode: "json" }).$type<readonly string[]>().notNull(),
  fixes: integer("fixes").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
