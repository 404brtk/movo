import {
  localServerName,
  providerNames,
  type AiConnection,
  type ChatMessage,
  type ChatPart,
  type FailureKind,
} from "../../shared/contracts/ask.ts";
import type { TranscriptionJob } from "../../shared/contracts/transcriptions.ts";
import { transcriptSpeakers } from "../../shared/transcript-speakers.ts";
import { formatDuration } from "./format.ts";

export function connectionLabel(connection: AiConnection) {
  if (connection.kind !== "server") return providerNames[connection.kind];
  if (!connection.baseUrl) return "Server";
  const url = new URL(connection.baseUrl);
  const name = localServerName(connection.baseUrl);
  if (!name) return `Server at ${url.host}`;
  return connection.reach === "this-computer"
    ? `${name} on this computer`
    : `${name} on ${url.hostname}`;
}

export const reachLabels = {
  "this-computer": "This computer",
  network: "Your network",
} as const;

const hiddenCodePoints = [
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
] as const;

const isHidden = (codePoint: number) =>
  hiddenCodePoints.some(([first, last]) => codePoint >= first && codePoint <= last);

export const revealHiddenCharacters = (text: string) =>
  Array.from(text, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return isHidden(codePoint)
      ? `[U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}]`
      : character;
  }).join("");

export function mediaLink(href: string | undefined) {
  if (!href) return null;
  const match = /^\/media\/([0-9a-f-]{36})(?:\?startMs=(\d+))?$/iu.exec(href);
  if (!match?.[1]) return null;
  return { mediaId: match[1], startMs: match[2] === undefined ? undefined : Number(match[2]) };
}

type ToolPart = Extract<ChatPart, { type: "tool" }>;
const field = (input: unknown, key: string): unknown =>
  typeof input === "object" && input !== null ? Reflect.get(input, key) : undefined;
const textField = (input: unknown, key: string) => {
  const value = field(input, key);
  return typeof value === "string" ? value : "";
};

const toolLabels: Record<string, { now: string; done: string }> = {
  search_library: { now: "Searching the library", done: "Searched the library" },
  read_transcript: { now: "Reading the transcript", done: "Read the transcript" },
  get_recording: { now: "Checking the recording", done: "Checked the recording" },
  list_transcript_changes: { now: "Reading the change history", done: "Read the change history" },
  edit_transcript: { now: "Preparing a change", done: "Prepared a change" },
  replace_in_transcript: { now: "Preparing a change", done: "Prepared a change" },
  assign_speaker: { now: "Preparing a change", done: "Prepared a change" },
  merge_speakers: { now: "Preparing a change", done: "Prepared a change" },
  rename_speaker: { now: "Preparing a change", done: "Prepared a change" },
};

const speakerReceipts: Record<string, string> = {
  assign_speaker: "Changed the speaker",
  merge_speakers: "Merged speakers",
  rename_speaker: "Named a speaker",
};

export function toolLabel(
  activity: { toolName: string; input: unknown },
  tense: "now" | "done",
  titles?: ReadonlyMap<string, string>,
) {
  const query = textField(activity.input, "q").trim();
  if (activity.toolName === "search_library" && query)
    return tense === "now" ? `Searching for “${query}”` : `Searched for “${query}”`;
  const title = titles?.get(textField(activity.input, "mediaId"));
  if (activity.toolName === "read_transcript" && title)
    return tense === "now" ? `Reading ${title}` : `Read ${title}`;
  return toolLabels[activity.toolName]?.[tense] ?? activity.toolName;
}

export const describeTool = (part: ToolPart) => toolLabel(part, "done");

export function stepReceipt(parts: readonly ChatPart[], library: boolean) {
  const steps = parts.flatMap((part) =>
    part.type === "tool" && !isEditTool(part) && part.state !== "running" ? [part] : [],
  );
  if (steps.length === 0) return null;
  if (library) {
    const searched = steps.some((part) => part.toolName === "search_library");
    const read = new Set(
      steps.flatMap((part) =>
        part.toolName === "read_transcript" ? [textField(part.input, "mediaId")] : [],
      ),
    ).size;
    return [searched ? "Searched the library" : null, read > 0 ? `read ${read}` : null]
      .filter(Boolean)
      .join(" · ")
      .replace(/^read/u, "Read");
  }
  return [...new Set(steps.map((part) => describeTool(part)))].slice(0, 3).join(" · ");
}

export function editReceipt(part: ToolPart) {
  if (part.state === "denied") return "Not changed";
  if (part.toolName === "replace_in_transcript") {
    const count = part.resultCount ?? 0;
    if (count === 0) return "Nothing matched, so nothing changed";
    return `Replaced ${count} ${count === 1 ? "place" : "places"}`;
  }
  return speakerReceipts[part.toolName] ?? "Changed a passage";
}

export const failureActions = {
  busy: "Try again",
  server: "Try again",
  other: "Try again",
  key: "Update key",
  tools: "Change model",
  model: "Change model",
} as const satisfies Record<FailureKind, string>;

export const isEditTool = (part: ToolPart) =>
  part.toolName === "edit_transcript" ||
  part.toolName === "replace_in_transcript" ||
  part.toolName in speakerReceipts;

const numberField = (input: unknown, key: string) => {
  const value = field(input, key);
  return typeof value === "number" ? value : null;
};

export const editRevision = (part: ToolPart) => numberField(part.input, "revision");

const maxContextWords = 12;

function assignedWords(part: ToolPart, job: TranscriptionJob | null | undefined) {
  const firstWord = numberField(part.input, "firstWord") ?? 0;
  const wordCount = numberField(part.input, "wordCount") ?? 0;
  const words =
    job?.revision === editRevision(part)
      ? (job.transcript?.words.slice(firstWord, firstWord + wordCount) ?? [])
      : [];
  const [first] = words;
  if (!first)
    return { context: `Words ${firstWord + 1}–${firstWord + wordCount}`, speaker: undefined };
  const quoted = words
    .slice(0, maxContextWords)
    .map((word) => word.text)
    .join(" ");
  const more = words.length > maxContextWords ? "…" : "";
  return {
    context: `${formatDuration(first.startMs / 1000)} “${quoted}${more}”`,
    speaker: first.speaker,
  };
}

export function proposedChange(part: ToolPart, job?: TranscriptionJob | null) {
  const speakers = job?.transcript ? transcriptSpeakers(job.transcript) : null;
  const label = (id: number | null | undefined) =>
    id === null || id === undefined ? null : (speakers?.label(id) ?? `Speaker ${id}`);
  const speakerAt = (key: string) => label(numberField(part.input, key)) ?? "";
  if (part.toolName === "replace_in_transcript")
    return {
      context: null,
      before: textField(part.input, "find"),
      after: textField(part.input, "replacement"),
    };
  if (part.toolName === "assign_speaker") {
    const { context, speaker } = assignedWords(part, job);
    return { context, before: label(speaker), after: speakerAt("speaker") };
  }
  if (part.toolName === "merge_speakers")
    return { context: null, before: speakerAt("speaker"), after: speakerAt("into") };
  if (part.toolName === "rename_speaker")
    return {
      context: null,
      before: speakerAt("speaker"),
      after:
        textField(part.input, "name").trim() || `Speaker ${numberField(part.input, "speaker")}`,
    };
  return { context: null, before: null, after: textField(part.input, "text") };
}

export function modelChanges(messages: readonly ChatMessage[]) {
  const changes = new Map<number, string>();
  let previous: string | null = null;
  for (const message of messages) {
    if (message.role !== "assistant" || !message.modelName) continue;
    if (previous !== null && message.modelName !== previous)
      changes.set(message.seq, message.modelName);
    previous = message.modelName;
  }
  return changes;
}
