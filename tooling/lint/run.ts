import { spawnSync } from "node:child_process";
import { globSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findLintDirectives } from "./directives.ts";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const args = process.argv.slice(2);
const filenames = args.filter((argument) => !argument.startsWith("-"));
const targets = filenames.length
  ? filenames
  : globSync([
      "src/**/*.{ts,tsx,js,jsx}",
      "tooling/**/*.{ts,js}",
      "tests/**/*.ts",
      "*.{ts,js,mjs,cjs}",
    ]);
let hasDirectives = false;
for (const filename of targets) {
  const projectPath = relative(projectRoot, resolve(filename)).replaceAll("\\", "/");
  if (projectPath === "src/web/routeTree.gen.ts") {
    continue;
  }
  const source = readFileSync(filename, "utf8");
  for (const comment of findLintDirectives(filename, source)) {
    const line = source.slice(0, comment.start).split("\n").length;
    console.error(`${filename}:${line}: Lint directives are banned; fix the rule or the code.`);
    hasDirectives = true;
  }
}
if (hasDirectives) {
  process.exitCode = 1;
} else {
  const result = spawnSync(
    process.execPath,
    [
      resolve(projectRoot, "node_modules/oxlint/bin/oxlint"),
      "--disable-nested-config",
      ...args,
      ...(filenames.length ? [] : ["."]),
    ],
    { stdio: "inherit" },
  );
  if (result.error) {
    throw result.error;
  }
  process.exitCode = result.status ?? 1;
}
