import { expect, it } from "vitest";
import { searchIndexVersion } from "../../../../src/server/media/search.ts";
import { foldSearchText } from "../../../../src/shared/search-text.ts";
import { transcriptPassages } from "../../../../src/shared/transcript-passages.ts";
import { timedWords } from "../../../helpers/timed-words.ts";

const words = [
  ...timedWords(0, 2000, "Dr. Kowalski omówił np. budżet Łodzi na rok 2026."),
  ...timedWords(
    2000,
    9000,
    "Zespół przygotował szczegółowy plan działań, który obejmuje analizę kosztów, harmonogram prac i podział odpowiedzialności między działy.",
  ),
  ...timedWords(9000, 9600, "Dziękuję!"),
];

it("requires a new search index version when stored passages or their search text change", () => {
  expect({
    version: searchIndexVersion,
    passages: transcriptPassages(words).map((passage) => [
      passage.startMs,
      foldSearchText(passage.text),
    ]),
  }).toEqual({
    version: 1,
    passages: [
      [0, "dr. kowalski omowil np."],
      [889, "budzet lodzi na rok 2026."],
      [2000, "zespol przygotowal szczegolowy plan dzialan, ktory obejmuje analize kosztow,"],
      [5938, "harmonogram prac i podzial odpowiedzialnosci miedzy dzialy."],
      [9000, "dziekuje!"],
    ],
  });
});
