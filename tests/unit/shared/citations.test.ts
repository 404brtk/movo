import { describe, expect, it } from "vitest";
import { citedMoments, normalizeCitations } from "../../../src/shared/citations.ts";

const sync = "0b6f7c1e-2a3b-4c5d-8e9f-0a1b2c3d4e5f";
const demo = "1b6f7c1e-2a3b-4c5d-8e9f-0a1b2c3d4e5f";
const moments = new Map([
  [289040, sync],
  [292280, sync],
  [718000, sync],
  [757000, sync],
  [4000, demo],
]);
const link = (mediaId: string, startMs: number, label: string | number = startMs) =>
  `[${label}](/media/${mediaId}?startMs=${startMs})`;

describe("normalizeCitations", () => {
  it.for([
    ["a bare startMs", "Opens here [289040].", `Opens here ${link(sync, 289040)}.`],
    [
      "several startMs in one bracket",
      "Both [289040, 292280].",
      `Both ${link(sync, 289040)} ${link(sync, 292280)}.`,
    ],
    ["a startMs label", "See [startMs: 289040].", `See ${link(sync, 289040)}.`],
    [
      "the start of a range",
      `From [289040${String.fromCodePoint(0x2011)}289999].`,
      `From ${link(sync, 289040)}.`,
    ],
    [
      "a link with a wrong host",
      `Opens [289040](https://media/${sync}?startMs=289040).`,
      `Opens ${link(sync, 289040)}.`,
    ],
    [
      "a copied template label",
      `Here [Recording title 289040](/media/${sync}?startMs=289040).`,
      `Here ${link(sync, 289040, "Recording title 289040")}.`,
    ],
  ] as const)("links %s", ([, text, expected]) => {
    expect(normalizeCitations(text, moments)).toBe(expected);
  });

  it.for([
    ["footnotes and unknown numbers", "A footnote [1] and a guess [123456]."],
    ["code", "Run `[289040]` or\n```\n[289040]\n```"],
    ["images", "![289040](/media/x.png)"],
    ["external links", `[docs](https://example.com/media/${demo}?startMs=4000)`],
    ["words in brackets", "The [intro] part."],
  ] as const)("leaves %s alone", ([, text]) => {
    expect(normalizeCitations(text, moments)).toBe(text);
  });
});

it("groups cited moments by recording in the order they appear", () => {
  expect(
    citedMoments(
      `First [718000], then [4000] and ${link(sync, 757000, "Sync 12:37")}, again [718000]. [x](https://example.com/media/${sync}) and \`[292280]\``,
      moments,
    ),
  ).toEqual([
    { mediaId: sync, moments: [718000, 757000] },
    { mediaId: demo, moments: [4000] },
  ]);
});
