# Local transcription

Movo transcribes a saved library recording with the installed Parakeet Ultra Q8_0 model. The initial implementation uses the CPU and automatic language behavior from the model. It does not translate, identify speakers or call a paid API. Model installation and transcription are separate explicit actions.

## Processing

Before enqueueing, Movo checks the stored media, FFmpeg and the verified model in the existing Hugging Face cache. It checks those resources again when execution begins. Missing or broken resources produce actionable errors; no model is downloaded or copied by a transcription request.

FFmpeg selects the first audio track, resamples to 16 kHz mono and writes raw float32 audio to the job's temporary directory. Inputs are restricted to supported local file containers and the `file,pipe` protocol whitelist. A video with no readable audio track fails explicitly.

A separate Node process loads the model through `transcribe-cpp` and requests segment timestamps. [Parakeet Ultra performs its own voice-activity segmentation for long recordings](https://github.com/handy-computer/transcribe.cpp/blob/main/docs/models/parakeet-ultra.md); Movo does not split audio at arbitrary time boundaries. Aborted or truncated output is rejected. The result is validated with Effect Schema, including finite nonnegative timestamps, ordered passages and passage ends within the recording's duration plus a one-second allowance for model padding.

The model worker is connected to its backend through Node IPC and exits if the owner disappears. Cancellation and ordinary shutdown stop the owned process before removing its temporary files. This is process isolation for lifecycle and fault handling, not an operating-system security sandbox.

## Storage and lifecycle

The `transcription_jobs` table in `MOVO_DATA_DIR/app.sqlite` stores one job per media ID, the model ID, state, timestamps, errors and the completed transcript. Passages contain `startMs`, `endMs` and `text`; the result also has a nullable detected language. Native model output that does not provide a language leaves it unset.

Work files live in `MOVO_DATA_DIR/transcriptions/<media-id>/`. Stored library media and shared Hugging Face weights are read-only during transcription. Results become visible through one database update; partial inference is not published as a completed transcript.

Jobs move through queued, running, completed, failed, cancelled or interrupted states. A single worker runs one transcription at a time, independently of YouTube downloads and browser requests. Duplicate enqueue requests return the existing job. Cancel and retry operations are serialized so concurrent requests cannot clean files belonging to a new attempt.

Startup marks persisted running jobs interrupted and clears terminal staging directories. Queued jobs continue automatically. Interrupted jobs require an explicit retry. Cleanup failures are saved separately on the affected job and do not stop other recordings or discard a completed transcript. Retrying requires successful cleanup. Restart attempts cleanup again.

## Copy and export

Completed, nonempty transcripts show **Copy text**, **Download TXT**, **Download SRT** and **Download VTT** above the passages. Copying and TXT use the same plain text, with a blank line between passages and no timestamps. Downloads use UTF-8 and suggest the recording title with the selected extension as the filename.

SRT and WebVTT export one subtitle cue per passage with millisecond timestamps. Subtitle text collapses whitespace into spaces so blank lines cannot split a cue, and escapes `&`, `<` and `>` so recognized text remains literal. Existing overlaps are preserved. A zero-duration passage receives a one-millisecond cue so its text is retained with a valid end time. See the [SubRip description](https://www.loc.gov/preservation/digital/formats/fdd/fdd000569.shtml) and [WebVTT specification](https://www.w3.org/TR/webvtt1/).

Exports read the saved result on demand. They do not start inference, require an installed model, write additional managed files or modify the stored transcript. The empty-speech message has no copy/download actions; the API can still export that completed empty result.

Copying runs only after an explicit action using the browser's Clipboard API. A denied or unavailable clipboard produces an error with permission guidance and the TXT alternative; it never reports success before the write finishes. Browser API reference: [Clipboard.writeText](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText).

## Resource use

Decoded float32 mono audio uses 64,000 bytes per second, approximately 230 MB per hour on disk. The isolated worker reads that prepared audio into memory, in addition to the model and inference workspace. Longer recordings therefore need proportionally more free memory and disk space. Preparation has a 30-minute timeout and inference a six-hour timeout. Memory allocation or native runtime errors fail the job; they do not silently publish partial text.

The initial implementation keeps native long-form segmentation and does not add a custom streaming decoder. Native GPU selection, speaker labels, multiple transcript versions and editing are outside this implementation.

## HTTP interface

All commands use the existing local-origin checks. They operate on a saved media ID and take no JSON options.

- `GET /api/media/:id/transcription` returns the job or `null` when the media exists without a transcription. Responses use `Cache-Control: no-store`.
- `GET /api/media/:id/transcription/export/:format` downloads a completed result as `txt`, `srt` or `vtt`. Responses use the corresponding content type, `Content-Disposition: attachment`, `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`. Unsupported formats and unfinished/missing results return HTTP 400. No transcription is enqueued by this request.
- `POST /api/media/:id/transcription` returns HTTP 202 with the existing or newly queued job.
- `POST /api/media/:id/transcription/cancel` returns the current job after stopping active work, or `null` when none exists.
- `POST /api/media/:id/transcription/retry` returns HTTP 202 after retrying a failed, cancelled or interrupted job. Other states are rejected.

An invalid or missing media ID returns HTTP 404. Model/tool unavailability returns HTTP 503. The worker owns accepted work after the initiating request ends.

## Verification

Normal tests use real temporary SQLite and filesystem storage, real local FFmpeg conversion and controlled substitutes only at inference/process boundaries. Browser tests verify explicit initiation, setup errors, navigation during work, cancellation/retry, saved passages, reload, empty output and seeking. They never download weights or inspect the user's model cache.

Export tests cover literal text, Unicode, millisecond/hour boundaries, overlaps, zero-duration cues and empty results. HTTP tests exercise real saved transcripts and reject exports before completion. Browser export tests use an isolated real backend and database with a controlled inference result, save all three formats, parse the exported WebVTT with Chromium, and verify keyboard actions, narrow layout and clipboard failures. Clipboard tests replace the browser API without changing the system clipboard.

`bun run test:transcriptions:real` is an opt-in test requiring FFmpeg, FFprobe and the pinned model already installed in the configured Hugging Face cache. It never downloads or modifies weights. It transcribes a small synthetic speech fixture, repeats it locally to exercise native long-form segmentation beyond 30 seconds, checks recognized words and timestamp offsets, and removes its isolated library and prepared audio. Existing `HF_HUB_CACHE`, `HF_HOME` and `XDG_CACHE_HOME` settings select the cache as usual.
