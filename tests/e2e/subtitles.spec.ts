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
      revision: 0,
      resultRevision: 0,
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

const videoPlayer = (page: Page) => page.getByRole("region", { name: "Video player", exact: true });

const caption = (page: Page, text: string) => videoPlayer(page).getByText(text, { exact: true });

const captionClearsControls = async (page: Page, text: string) => {
  const captionBox = await caption(page, text).boundingBox();
  const controlBox = await videoPlayer(page)
    .getByRole("button", { name: "Subtitles", exact: true })
    .boundingBox();
  return captionBox && controlBox ? captionBox.y + captionBox.height <= controlBox.y : false;
};

const singleCueTrack = (text: string | null) => [
  {
    kind: "subtitles",
    label: "Transcript",
    language: "pl",
    mode: "hidden",
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
        mode: "hidden",
        cues: [
          { start: 0.125, end: 0.999, text: "Zażółć gęślą jaźń." },
          { start: 1, end: 1.8, text: "A & <b>B</b> --> end." },
        ],
      },
    ]);
  const panel = page.getByRole("region", { name: "Transcription", exact: true });
  const transcribeAgain = async (text: string) => {
    await page.getByRole("button", { name: "More actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Transcribe again", exact: true }).click();
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
  const subtitlesToggle = page.getByRole("button", { name: "Subtitles", exact: true });

  await transcribeAgain("Nowa transkrypcja.");
  await expect.poll(() => subtitleTracks(video)).toEqual(singleCueTrack("Nowa transkrypcja."));
  await expect(caption(page, "Nowa transkrypcja.")).toBeVisible();
  await expect.poll(() => captionClearsControls(page, "Nowa transkrypcja.")).toBe(true);

  await expect(subtitlesToggle).toHaveAttribute("aria-pressed", "true");
  await subtitlesToggle.click();
  await expect(subtitlesToggle).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => subtitleTracks(video)).toEqual(singleCueTrack("Nowa transkrypcja."));
  await expect(caption(page, "Nowa transkrypcja.")).toBeHidden();
  await transcribeAgain("Kolejna wersja.");
  await expect.poll(() => subtitleTracks(video)).toEqual(singleCueTrack("Kolejna wersja."));
  await expect(caption(page, "Kolejna wersja.")).toBeHidden();
  await subtitlesToggle.click();
  await expect.poll(() => subtitleTracks(video)).toEqual(singleCueTrack("Kolejna wersja."));
  await expect(caption(page, "Kolejna wersja.")).toBeVisible();
});

test("follows seeking and playback, and lowers subtitles while the controls hide", async ({
  page,
  request,
}) => {
  await openRecording(page, request, "sample.webm", {
    language: "pl",
    words: [
      ...timedWords(0, 900, "Pierwsza kwestia."),
      ...timedWords(1000, 1900, "Druga kwestia."),
    ],
  });
  const video = page.locator("video");
  await expect(caption(page, "Pierwsza kwestia.")).toBeVisible();

  await video.evaluate((element: HTMLVideoElement) => {
    element.currentTime = 1.2;
  });
  await expect(caption(page, "Druga kwestia.")).toBeVisible();
  await expect(caption(page, "Pierwsza kwestia.")).toBeHidden();

  await video.evaluate((element: HTMLVideoElement) => {
    element.currentTime = 0.5;
    element.playbackRate = 0.25;
  });
  await expect(caption(page, "Pierwsza kwestia.")).toBeVisible();
  await expect.poll(() => captionClearsControls(page, "Pierwsza kwestia.")).toBe(true);

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.mouse.move(0, 0);
  await expect.poll(() => captionClearsControls(page, "Pierwsza kwestia.")).toBe(false);

  await expect(caption(page, "Druga kwestia.")).toBeVisible();
  await expect(caption(page, "Pierwsza kwestia.")).toBeHidden();
  await videoPlayer(page).hover();
  await expect.poll(() => captionClearsControls(page, "Druga kwestia.")).toBe(true);
  await page.mouse.move(0, 0);
  await expect.poll(() => captionClearsControls(page, "Druga kwestia.")).toBe(false);
  await page.keyboard.press("Tab");
  await expect.poll(() => captionClearsControls(page, "Druga kwestia.")).toBe(true);
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
