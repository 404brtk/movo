import { homedir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/**/*.schema.ts",
  out: "./migrations",
  dbCredentials: {
    url: join(process.env.MOVO_DATA_DIR ?? join(homedir(), ".movo"), "app.sqlite"),
  },
  strict: true,
});
