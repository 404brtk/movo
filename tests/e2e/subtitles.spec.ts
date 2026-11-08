import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import type { Transcript, TranscriptionJob } from "../../src/shared/contracts/transcriptions.ts";
import { timedWords } from "../helpers/timed-words.ts";

async function openRecording(
  page: Page,
  request: APIRequestContext,
  fixture: string,
  transcript: Transcript,
) {
  const uploaded = await request.post("/api/media", {
    data: readFileSync(new URL(`../fixtures/${fixture}`, import.meta.url)),
    headers: { "x-file-name": `${randomUUID()}.${fixture.split(".").at(-1)}` },
  });
  expect(uploaded.status()).toBe(201);
  const media: { id: string } = await uploaded.json();
  const job: { value: TranscriptionJob } = {
    value: {
      mediaId: media.id,
      modelId: "parakeet-ultra-q8",
      status: "completed",
      phase: "finished",
      transcript,
      device: { backend: "cpu", name: "Test CPU" },
      error: null,
      cleanupError: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  };
  await page.route(`**/api/media/${media.id}/transcription`, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: job.value });
  });
  await page.route(`**/api/media/${media.id}/transcription/retry`, (route) => {
    expect(route.request().method()).toBe("POST");
    job.value = { ...job.value, status: "running", phase: "transcribing", device: null };
    return route.fulfill({ status: 202, json: job.value });
  });
  await page.goto(`/media/${media.id}`);
  return job;
}

const subtitleTracks = (player: Locator) =>
  player.evaluate((element: HTMLMediaElement) =>
    Array.from(element.textTracks, (track) => ({
      kind: track.kind,
      label: track.label,
      language: track.language,
      mode: track.mode,
      cues: Array.from(track.cues ?? [], (cue) => {
        if (!(cue instanceof VTTCue)) throw new Error("Expected a WebVTT cue.");
        return { start: cue.startTime, end: cue.endTime, text: cue.getCueAsHTML().textContent };
      }),
    })),
  );

const singleCueTrack = (mode: TextTrackMode, text: string | null) => [
  {
    kind: "subtitles",
    label: "Transcript",
    language: "pl",
    mode,
    cues: text === null ? [] : [{ start: 0, end: 1.5, text }],
  },
];

test("shows the transcript as video subtitles and replaces them after transcribing again, also while turned off", async ({
  page,
  request,
}) => {
  const job = await openRecording(page, request, "sample.webm", {
    language: "pl",
    words: [
      ...timedWords(125, 999, "Zażółć gęślą jaźń."),
      ...timedWords(1000, 1800, "A & <b>B</b> --> end."),
    ],
  });
  const video = page.locator("video");
  await expect
    .poll(() => subtitleTracks(video))
    .toEqual([
      {
        kind: "subtitles",
        label: "Transcript",
        language: "pl",
        mode: "showing",
        cues: [
          { start: 0.125, end: 0.999, text: "Zażółć gęślą jaźń." },
          { start: 1, end: 1.8, text: "A & <b>B</b> --> end." },
        ],
      },
    ]);
  const panel = page.getByRole("region", { name: "Transcription", exact: true });
  const transcribeAgain = async (text: string) => {
    await panel.getByRole("button", { name: "Transcribe again", exact: true }).click();
    await expect(panel.getByRole("status").filter({ hasText: "Transcribing" })).toBeVisible();
    job.value = {
      ...job.value,
      status: "completed",
      phase: "finished",
      transcript: { language: "pl", words: timedWords(0, 1500, text) },
      updatedAt: Date.now(),
    };
    await expect(panel.getByText(text, { exact: true })).toBeVisible();
  };
  const setSubtitleMode = (mode: TextTrackMode) =>
    video.evaluate((element: HTMLMediaElement, nextMode: TextTrackMode) => {
      const [track] = element.textTracks;
      if (!track) throw new Error("Expected a subtitle track.");
      track.mode = nextMode;
    }, mode);

  await transcribeAgain("Nowa transkrypcja.");
  await expect
    .poll(() => subtitleTracks(video))
    .toEqual(singleCueTrack("showing", "Nowa transkrypcja."));

  await setSubtitleMode("disabled");
  await transcribeAgain("Kolejna wersja.");
  expect(await subtitleTracks(video)).toEqual(singleCueTrack("disabled", null));
  await setSubtitleMode("showing");
  await expect
    .poll(() => subtitleTracks(video))
    .toEqual(singleCueTrack("showing", "Kolejna wersja."));
});

test("adds no subtitle track to audio recordings", async ({ page, request }) => {
  await openRecording(page, request, "tone.wav", {
    language: "en",
    words: timedWords(0, 1000, "Audio only."),
  });
  const panel = page.getByRole("region", { name: "Transcription", exact: true });
  await expect(panel.getByText("Audio only.", { exact: true })).toBeVisible();
  expect(await subtitleTracks(page.locator("audio"))).toEqual([]);
});
