import { Context, Schema, Struct } from "effect";
import { Tool, Toolkit } from "effect/ai";
import {
  DownloadJob,
  DownloadPreview,
  DownloadPreviewRequest,
  DownloadRequest,
} from "../../shared/contracts/downloads.ts";
import { LibraryItem, LibraryQuery } from "../../shared/contracts/library.ts";
import { MediaDeletion, MediaId, MediaItem, MediaTitle } from "../../shared/contracts/media.ts";
import { Transcript, TranscriptionJob } from "../../shared/contracts/transcriptions.ts";
import { MediaError } from "../media/error.ts";
import { maxPagePassages } from "./transcript-page.ts";

const Count = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const Milliseconds = Count;
const limit = (maximum: number) =>
  Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum })));

export const TranscriptionSummary = Schema.NullOr(
  Schema.Struct({
    ...Struct.omit(TranscriptionJob.fields, ["transcript"]),
    transcript: Schema.NullOr(
      Schema.Struct({ language: Transcript.fields.language, passageCount: Count }),
    ),
  }),
);
const Page = { limit: limit(100), offset: Schema.optional(Count) };
const Recording = Schema.Struct({ mediaId: MediaId });
const Download = Schema.Struct({ downloadId: MediaId });
const failure = Schema.instanceOf(MediaError);

const hints = (hint: {
  readOnly: boolean;
  destructive: boolean;
  idempotent: boolean;
  openWorld: boolean;
}) =>
  Context.make(Tool.Readonly, hint.readOnly).pipe(
    Context.add(Tool.Destructive, hint.destructive),
    Context.add(Tool.Idempotent, hint.idempotent),
    Context.add(Tool.OpenWorld, hint.openWorld),
  );
const reads = hints({ readOnly: true, destructive: false, idempotent: true, openWorld: false });
const changes = (hint: { destructive?: boolean; idempotent: boolean; openWorld?: boolean }) =>
  hints({
    readOnly: false,
    destructive: hint.destructive ?? false,
    idempotent: hint.idempotent,
    openWorld: hint.openWorld ?? false,
  });

export const movoTools = Toolkit.make(
  Tool.make("search_library", {
    description:
      "Search saved recordings by title and transcript text, or list them when q is empty. Every word of q must match; words also match longer words that start with them. Optional filters: kind (audio, video), transcript (available, missing), sort (relevance, newest, oldest, title). Transcript matches include up to three passages with startMs, which read_transcript accepts as fromMs. Returns at most limit recordings (default 20, up to 100) after skipping offset (default 0), and the total number of matches.",
    parameters: Schema.Struct({ ...LibraryQuery.fields, ...Page }),
    success: Schema.Struct({
      items: Schema.Array(LibraryItem),
      total: Count,
      transcribing: Schema.Boolean,
    }),
    failure,
  }).annotateMerge(reads),
  Tool.make("get_recording", {
    description:
      "Get a recording's details and the state of its transcription. transcription is null when it was never transcribed. A completed transcript stays available while a new attempt runs.",
    parameters: Recording,
    success: Schema.Struct({ recording: MediaItem, transcription: TranscriptionSummary }),
    failure,
  }).annotateMerge(reads),
  Tool.make("read_transcript", {
    description: `Read a saved transcript as timestamped passages, starting at the first passage that begins at or after fromMs (default 0). Returns at most maxPassages passages (default 200, up to ${maxPagePassages}); continue with nextFromMs until it is null.`,
    parameters: Schema.Struct({
      ...Recording.fields,
      fromMs: Schema.optional(Milliseconds),
      maxPassages: limit(maxPagePassages),
    }),
    success: Schema.Struct({
      language: Transcript.fields.language,
      passages: Schema.Array(
        Schema.Struct({ startMs: Milliseconds, endMs: Milliseconds, text: Schema.String }),
      ),
      nextFromMs: Schema.NullOr(Milliseconds),
    }),
    failure,
  }).annotateMerge(reads),
  Tool.make("list_downloads", {
    description:
      "List link downloads, newest first. Returns at most limit jobs (default 20, up to 100) after skipping offset (default 0), and the total number of jobs.",
    parameters: Schema.Struct(Page),
    success: Schema.Struct({ jobs: Schema.Array(DownloadJob), total: Count }),
    failure,
  }).annotateMerge(reads),
  Tool.make("get_download", {
    description:
      "Get the state of a download job. mediaId is set once the recording is saved in the library.",
    parameters: Download,
    success: DownloadJob,
    failure,
  }).annotateMerge(reads),
  Tool.make("preview_link", {
    description:
      "Check a YouTube video or X post link and return its title and duration without downloading it.",
    parameters: DownloadPreviewRequest,
    success: DownloadPreview,
    failure,
  }).annotateMerge(
    hints({ readOnly: true, destructive: false, idempotent: true, openWorld: true }),
  ),
  Tool.make("download_links", {
    description:
      "Queue downloads of YouTube videos or X posts into the library, in the given order. Returns one job per link. If any link is unsupported, nothing is queued. preset is video-480p, video-720p, video-1080p (default), video-best or audio and applies to every link; video presets set a maximum height and use the best lower resolution a source offers. Set transcribe to transcribe each recording once it is saved. The same link and preset return the existing job. Downloads run one at a time in the background; check them with get_download every few seconds.",
    parameters: DownloadRequest,
    success: Schema.Struct({ jobs: Schema.Array(DownloadJob) }),
    failure,
  }).annotateMerge(changes({ idempotent: true, openWorld: true })),
  Tool.make("cancel_download", {
    description: "Cancel a queued or running download.",
    parameters: Download,
    success: DownloadJob,
    failure,
  }).annotateMerge(changes({ idempotent: true })),
  Tool.make("retry_download", {
    description: "Start a failed, cancelled or interrupted download again.",
    parameters: Download,
    success: DownloadJob,
    failure,
  }).annotateMerge(changes({ idempotent: false, openWorld: true })),
  Tool.make("import_file", {
    description:
      "Copy a local audio or video file into the library. path must be absolute. The original file is not changed. Large files can take a while to copy.",
    parameters: Schema.Struct({ path: Schema.String.check(Schema.isMinLength(1)) }),
    success: MediaItem,
    failure,
  }).annotateMerge(changes({ idempotent: false })),
  Tool.make("transcribe_recording", {
    description:
      "Queue a local transcription of a recording. If the recording already has a transcription job, including a completed one, that job is returned unchanged; use retry_transcription to transcribe it again. Transcription runs in the background; check it with get_recording every few seconds.",
    parameters: Recording,
    success: TranscriptionSummary,
    failure,
  }).annotateMerge(changes({ idempotent: true })),
  Tool.make("cancel_transcription", {
    description: "Cancel a queued or running transcription.",
    parameters: Recording,
    success: TranscriptionSummary,
    failure,
  }).annotateMerge(changes({ idempotent: true })),
  Tool.make("retry_transcription", {
    description:
      "Transcribe a recording again after its transcription completed, failed, was cancelled or was interrupted. A completed transcript is kept until the new attempt completes and then replaced.",
    parameters: Recording,
    success: TranscriptionSummary,
    failure,
  }).annotateMerge(changes({ destructive: true, idempotent: false })),
  Tool.make("rename_recording", {
    description:
      "Change a recording's library title. The saved file and its original filename stay unchanged.",
    parameters: Schema.Struct({ ...Recording.fields, title: MediaTitle }),
    success: MediaItem,
    failure,
  }).annotateMerge(changes({ idempotent: true })),
  Tool.make("remove_saved_copy", {
    description:
      "Permanently delete a transcribed recording's saved media file to free disk space, keeping its title, transcript and download history. Playback and transcribing again are no longer possible.",
    parameters: Recording,
    success: MediaDeletion,
    failure,
  }).annotateMerge(changes({ destructive: true, idempotent: true })),
  Tool.make("delete_recording", {
    description:
      "Permanently delete a recording with its saved file, transcript and download history. Imported original files are not touched. Cancel a queued or running transcription first.",
    parameters: Recording,
    success: MediaDeletion,
    failure,
  }).annotateMerge(changes({ destructive: true, idempotent: true })),
);
