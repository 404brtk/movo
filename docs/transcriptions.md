# Local transcription

Movo transcribes a saved library recording with the installed Parakeet Ultra Q8_0 model. The engine selects the processing hardware automatically, and language behavior comes from the model. It does not translate, identify speakers or call a paid API. Model installation and transcription are separate explicit actions.

## Processing

Before enqueueing, Movo checks the stored media, FFmpeg and the verified model in the existing Hugging Face cache. It checks those resources again when execution begins. Missing or broken resources produce actionable errors; no model is downloaded or copied by a transcription request.

Downloads can also request transcription explicitly with **Transcribe after download**. FFmpeg and model availability are checked before accepting the combined request. Once the recording is saved, the download's completion and idempotent transcription enqueue share one SQLite transaction. Startup recovery uses the same operation when it finds a recording published by an interrupted download. The normal transcription worker handles execution, results and failures; the media and completed download remain available if transcription fails. Repeated download requests never replace or retry an existing transcription job.

FFmpeg selects the first audio track, resamples to 16 kHz mono and writes raw float32 audio to the job's temporary directory. Inputs are restricted to supported local file containers and the `file,pipe` protocol whitelist. A video with no readable audio track fails explicitly.

A separate Node process loads the model through `transcribe-cpp` and requests word timestamps. [Parakeet Ultra performs its own voice-activity segmentation for long recordings](https://github.com/handy-computer/transcribe.cpp/blob/main/docs/models/parakeet-ultra.md); Movo does not split audio at arbitrary time boundaries. Aborted or truncated output is rejected. The result is validated with Effect Schema, including word timestamps, word text without whitespace, words ordered by start time and word ends within the recording's duration plus a one-second allowance for model padding.

## Hardware selection

The worker loads the model with the engine's [automatic backend policy](https://github.com/handy-computer/transcribe.cpp/blob/main/bindings/typescript/README.md#backend-selection): the best accelerator supported by the installed native package, otherwise the CPU. The engine falls back to the CPU without an error when, for example, the Vulkan loader or driver is missing. Movo does not add its own fallback or offer a device setting. A failure to initialize or run on the selected device fails the job and publishes no transcript.

After loading, the worker reports the device the model actually runs on. The job stores it as `device` with the engine's backend (`cpu`, `vulkan`, `cuda`, `rocm` or `metal`) and the device name. The transcription panel shows it while the job runs and after it finishes; a CPU fallback therefore appears as the CPU. Failed, cancelled and interrupted attempts keep the device they ran on. Retry and re-transcription clear it until the next attempt reports one, so the device always describes the latest attempt. Transcripts completed before this field existed have no device. A worker result without a device report is rejected.

The model worker is connected to its backend through Node IPC and exits if the owner disappears. Cancellation and ordinary shutdown stop the owned process before removing its temporary files. This is process isolation for lifecycle and fault handling, not an operating-system security sandbox.

## Storage and lifecycle

The `transcription_jobs` table in `MOVO_DATA_DIR/app.sqlite` stores one job per media ID, the model ID, state, timestamps, errors and the completed transcript. The transcript stores the recognized words, each with `startMs`, `endMs` and `text`, plus a nullable detected language. Passages are not stored; they are derived from the words wherever they are shown or exported, so their rules can change without transcribing again. A migration discards transcripts saved before word timestamps: their jobs become failed with an explanation, so the recordings can be retried and startup still cleans their temporary files. Native model output that does not provide a language leaves it unset.

Work files live in `MOVO_DATA_DIR/transcriptions/<media-id>/`. Stored library media and shared Hugging Face weights are read-only during transcription. Results become visible through one database update; partial inference is not published as a completed transcript.

Jobs move through queued, running, completed, failed, cancelled or interrupted states. A single worker runs one transcription at a time, independently of media downloads and browser requests. Duplicate enqueue requests return the existing job. Cancel and retry operations are serialized so concurrent requests cannot clean files belonging to a new attempt.

**Transcribe again** starts a new attempt for a completed recording through the retry operation. The row keeps its last successful transcript while the new attempt is queued or running, and the panel shows it with a note until a replacement completes. A successful attempt replaces it in the same update that marks the job completed. Failure, cancellation and interruption keep the previous transcript and report the new attempt's state and error. A second retry while an attempt is queued or running is rejected, so one recording never has two active attempts.

Startup marks persisted running jobs interrupted and clears terminal staging directories. Queued jobs continue automatically. Interrupted jobs require an explicit retry; both keep any previous transcript. Cleanup failures are saved separately on the affected job and do not stop other recordings or discard a completed transcript. Retrying requires successful cleanup. Restart attempts cleanup again.

## Passages and reading along

`src/shared/transcript-passages.ts` groups words into passages. A passage ends after a word that ends a sentence (`.`, `?`, `!` or `…`, optionally followed by closing quotes or brackets). A new passage also starts before a word that would make the passage longer than 84 characters or 7 seconds, the length of a two-line subtitle. A single word longer than either limit forms its own passage. The model's own long-form segments are internal processing chunks of up to 30 seconds and are not used for display.

While the recording plays, the passage containing the current word is highlighted and marked with `aria-current="time"`, and the current word is wrapped in `<mark>`. The current word is the last word that started at or before the player's position. Only the passages whose state changes re-render. Word timestamps come in 80 ms steps and can be off by a word or two; selecting a passage's timestamp seeks to its first word.

## Copy and export

Saved, nonempty transcripts show **Copy text**, **Download TXT**, **Download SRT** and **Download VTT** above the passages. Copying and TXT use the same plain text, one passage per line and no timestamps. Downloads use UTF-8. The server supplies the recording title with the selected extension in `Content-Disposition`, so normal links and direct export URLs use the same filename. The header includes an ASCII `filename` fallback and UTF-8 `filename*`; path separators and control characters are replaced with underscores.

SRT and WebVTT export one subtitle cue per passage with millisecond timestamps. Words never contain whitespace, so a cue cannot be split by blank lines. Subtitle text escapes `&`, `<` and `>` so recognized text remains literal. Existing overlaps are preserved. A zero-duration passage receives a one-millisecond cue so its text is retained with a valid end time. See the [SubRip description](https://www.loc.gov/preservation/digital/formats/fdd/fdd000569.shtml) and [WebVTT specification](https://www.w3.org/TR/webvtt1/).

Exports read the saved result on demand. They do not start inference, require an installed model, write additional managed files or modify the stored transcript. The empty-speech message has no copy/download actions; the API can still export that completed empty result.

Copying runs only after an explicit action using the browser's Clipboard API. A denied or unavailable clipboard produces an error with permission guidance and the TXT alternative; it never reports success before the write finishes. Browser API reference: [Clipboard.writeText](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText).

## Resource use

Decoded float32 mono audio uses 64,000 bytes per second, approximately 230 MB per hour on disk. The isolated worker reads that prepared audio into memory, in addition to the model and inference workspace. Longer recordings therefore need proportionally more free memory and disk space. Preparation has a 30-minute timeout and inference a six-hour timeout. Memory allocation or native runtime errors fail the job; they do not silently publish partial text.

The initial implementation keeps native long-form segmentation and does not add a custom streaming decoder. Manual device selection, speaker labels, multiple transcript versions and editing are outside this implementation.

## HTTP interface

All commands use the existing local-origin checks. They operate on a saved media ID and take no JSON options.

- `GET /api/media/:id/transcription` returns the job or `null` when the media exists without a transcription. Responses use `Cache-Control: no-store`.
- `GET /api/media/:id/transcription/export/:format` downloads the saved transcript, including while a replacement attempt runs or after it fails, as `txt`, `srt` or `vtt`. Responses use the corresponding content type, `Content-Disposition: attachment` with the filename parameters above, `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`. Unsupported formats and recordings without a saved transcript return HTTP 400. No transcription is enqueued by this request.
- `POST /api/media/:id/transcription` returns HTTP 202 with the existing or newly queued job.
- `POST /api/media/:id/transcription/cancel` returns the current job after stopping active work, or `null` when none exists.
- `POST /api/media/:id/transcription/retry` returns HTTP 202 after starting a new attempt for a completed, failed, cancelled or interrupted job. Queued and running jobs are rejected.

An invalid or missing media ID returns HTTP 404. Model/tool unavailability returns HTTP 503. The worker owns accepted work after the initiating request ends.

## Verification

Normal tests use real temporary SQLite and filesystem storage, real local FFmpeg conversion and controlled substitutes only at inference/process boundaries. Browser tests verify explicit initiation, setup errors, navigation during work, cancellation/retry, re-transcription with the previous transcript visible, saved passages, reload, empty output, seeking and the highlighted passage and word. They never download weights or inspect the user's model cache.

Export tests cover literal text, Unicode, millisecond/hour boundaries, overlaps, zero-duration cues and empty results. HTTP tests exercise real saved transcripts and reject exports before completion. Browser export tests use an isolated real backend and database with a controlled inference result, save all three formats, parse the exported WebVTT with Chromium, and verify keyboard actions, narrow layout and clipboard failures. Clipboard tests replace the browser API without changing the system clipboard.

`bun run test:transcriptions:real` is an opt-in test requiring FFmpeg, FFprobe and the pinned model already installed in the configured Hugging Face cache. It never downloads or modifies weights. It transcribes a small synthetic speech fixture, repeats it locally to exercise native long-form segmentation beyond 30 seconds, checks recognized words and timestamp offsets, requires an accelerator to be selected when the engine reports one and the CPU otherwise, and removes its isolated library and prepared audio. Existing `HF_HUB_CACHE`, `HF_HOME` and `XDG_CACHE_HOME` settings select the cache as usual.
