import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import { noComments } from "./no-comments.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "tsx" } } });
tester.run("no-comments", noComments, {
  valid: [
    "const url: string = 'https://example.com';",
    "const text = '/* a string */';",
    "const template = `// a template`;",
    "const pattern = /https?:\\/\\//;",
    "const element = <p>Text</p>;",
  ],
  invalid: [
    {
      code: "// explanation\nconst value = 1;",
      errors: [{ messageId: "forbidden", line: 1, column: 0 }],
    },
    { code: "const value = 1; // explanation", errors: [{ messageId: "forbidden" }] },
    { code: "/* explanation */ const value = 1;", errors: [{ messageId: "forbidden" }] },
    { code: "/** documentation */ const value = 1;", errors: [{ messageId: "forbidden" }] },
    {
      code: "const element = <p>{/* explanation */}Text</p>;",
      errors: [{ messageId: "forbidden" }],
    },
    {
      code: "// first\n/* second */",
      errors: [{ messageId: "forbidden" }, { messageId: "forbidden" }],
    },
  ],
});
