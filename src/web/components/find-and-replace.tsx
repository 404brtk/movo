import { useDeferredValue, useMemo, useState } from "react";
import type { Transcript } from "../../shared/contracts/transcriptions.ts";
import { findWords, replaceWords } from "../../shared/transcript-edits.ts";
import { useMatchStepper, type StepDirection } from "../lib/match-stepper.ts";
import type { TranscriptMatches } from "../lib/passage-marks.ts";

export function useFindAndReplace(transcript: Transcript, chosen: readonly number[] | undefined) {
  const [find, setFind] = useState("");
  const [replacement, setReplacement] = useState("");
  const previewFind = useDeferredValue(find);
  const previewReplacement = useDeferredValue(replacement);
  const found = useMemo(
    () => findWords(transcript.words, previewFind, chosen),
    [transcript.words, previewFind, chosen],
  );
  const changeCount = useMemo(
    () => replaceWords(transcript.words, previewFind, previewReplacement, chosen).length,
    [transcript.words, previewFind, previewReplacement, chosen],
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
    chosen,
    count: found.length,
    changeCount,
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
