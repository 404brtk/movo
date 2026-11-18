import { useDeferredValue, useMemo, useState } from "react";
import type { Transcript } from "../../shared/contracts/transcriptions.ts";
import { findWords, replaceWords } from "../../shared/transcript-edits.ts";
import { transcriptPassages } from "../../shared/transcript-passages.ts";
import { useMatchStepper, type StepDirection } from "../lib/match-stepper.ts";
import { marksByPassage, type TranscriptMatches } from "../lib/passage-marks.ts";

export function useFindAndReplace(transcript: Transcript) {
  const [find, setFind] = useState("");
  const [replacement, setReplacement] = useState("");
  const previewFind = useDeferredValue(find);
  const previewReplacement = useDeferredValue(replacement);
  const found = useMemo(
    () => findWords(transcript.words, previewFind),
    [transcript.words, previewFind],
  );
  const changeCount = useMemo(
    () => replaceWords(transcript.words, previewFind, previewReplacement).length,
    [transcript.words, previewFind, previewReplacement],
  );
  const passageCount = useMemo(
    () => marksByPassage(transcriptPassages(transcript.words), { ranges: found, current: 0 }).size,
    [found, transcript.words],
  );
  const stepper = useMatchStepper(found.length);
  const { index } = stepper;
  const matches = useMemo<TranscriptMatches | undefined>(
    () => (found.length === 0 ? undefined : { ranges: found, current: index }),
    [found, index],
  );
  return {
    find,
    replacement,
    count: found.length,
    changeCount,
    passageCount,
    index,
    matches,
    previewCurrent: previewFind === find && previewReplacement === replacement,
    setFind: (value: string) => {
      setFind(value);
      stepper.reset();
    },
    setReplacement,
    step: (direction: StepDirection) => {
      stepper.step(direction);
    },
  };
}

export type FindAndReplaceState = ReturnType<typeof useFindAndReplace>;
