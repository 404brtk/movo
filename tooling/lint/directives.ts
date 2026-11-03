import { parseSync } from "oxc-parser";

export function findLintDirectives(filename: string, source: string) {
  return parseSync(filename, source).comments.filter((comment) =>
    /^\s*(?:oxlint|eslint)(?:\s|-|$)/u.test(comment.value),
  );
}
