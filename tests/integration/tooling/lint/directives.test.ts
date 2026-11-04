import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { findLintDirectives } from "../../../../tooling/lint/directives.ts";

describe("lint suppression guard", () => {
  it.each([
    "// oxlint-disable",
    "/* oxlint-disable project/no-comments */",
    "// eslint-disable-next-line",
  ])("detects %s", (source) => {
    expect(findLintDirectives("example.ts", source)).toHaveLength(1);
  });

  it("accepts directive-like text inside strings", () => {
    expect(findLintDirectives("example.ts", "const text = '// oxlint-disable';")).toHaveLength(0);
  });

  it("rejects a suppression attempt through the normal lint entry point", () => {
    const directory = mkdtempSync(join(tmpdir(), "movo-lint-"));
    try {
      const filename = join(directory, "bypass.ts");
      writeFileSync(filename, "// oxlint-disable project/no-comments\nexport const value = 1;\n");
      const result = spawnSync(process.execPath, [resolve("tooling/lint/run.ts"), filename], {
        encoding: "utf8",
        timeout: 20000,
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Lint directives are banned");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
