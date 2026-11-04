# Project lint rules

`bun run lint` runs Oxlint with type-aware checks and the local plugin in `index.ts`. It first uses the Oxc parser to reject inline lint directives, because a comment rule alone could be disabled by the very comment it is meant to reject.

`project/no-comments` rejects every comment token in authored JavaScript/TypeScript, including JSX, JSDoc and TypeScript directives. Strings, URLs, regex literals and test fixture strings are parsed as code rather than searched with a delimiter regex. The exact generated TanStack route tree is excluded; authored shadcn components, tooling and tests are included. Other file formats are not parsed by this JS/TS rule.

The configuration targets React's automatic JSX runtime, so the legacy React-in-scope rule is disabled. Stylesheet side-effect imports are explicitly permitted; other unassigned imports remain checked.

`jsx-a11y/media-has-caption` is disabled only in `src/web/components/media-player.tsx`. That player opens user-imported media, which may not include captions; it does not fabricate empty tracks. Native playback controls and accessible names remain required. Other authored media elements retain the caption rule.

To add a rule:

1. Check whether an existing Oxlint rule solves the problem.
2. Add a focused rule under `rules/`, with an actionable message and no automatic fix unless the transformation is provably safe.
3. Add valid/invalid cases under `tests/unit/tooling/lint/rules/` using `RuleTester` from `oxlint/plugins-dev`, with regression and false-positive cases.
4. Register it in `index.ts` and enable it in `.oxlintrc.json`.
5. Test the normal CLI entry point under `tests/integration/tooling/lint/` when configuration, suppression or file selection affects correctness.
6. Run the project checks. Keep rule explanations here or in test names, not in code comments.

The plugin API is version-sensitive. Update the pinned Oxlint version together with its rule tests. Source: [Oxlint plugin testing](https://oxc.rs/docs/guide/usage/linter/writing-js-plugins.html).
