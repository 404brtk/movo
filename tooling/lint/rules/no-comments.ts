import type { RuleTester } from "oxlint/plugins-dev";

export const noComments = {
  meta: {
    type: "suggestion",
    schema: [],
    messages: { forbidden: "Comments are banned. Use a clearer name or a test." },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          context.report({ loc: comment.loc, messageId: "forbidden" });
        }
      },
    };
  },
} satisfies Parameters<RuleTester["run"]>[1];
