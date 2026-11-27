import { eq, inArray, isNotNull, sql } from "drizzle-orm";
import { Schema } from "effect";
import type { LibraryMatch } from "../../shared/contracts/library.ts";
import type { MediaItem } from "../../shared/contracts/media.ts";
import { Transcript } from "../../shared/contracts/transcriptions.ts";
import { foldSearchText, matchedRanges } from "../../shared/search-text.ts";
import { transcriptPassages } from "../../shared/transcript-passages.ts";
import { transcriptSpeakers } from "../../shared/transcript-speakers.ts";
import type { AppDatabase } from "../db/database.ts";
import { recordingOverviews } from "../overview/overview.schema.ts";
import { transcriptionJobs } from "../transcriptions/transcriptions.schema.ts";
import { mediaItems } from "./media.schema.ts";
import { searchIndex, searchPassages } from "./search.schema.ts";

type SearchDatabase = Pick<AppDatabase, "run" | "all" | "insert" | "delete">;

export const searchIndexVersion = 4;
const maxPassageMatches = 3;
const passagesPerInsert = 1000;

interface FoundPassages {
  passages: { startMs: number; text: string; speaker: string | null }[];
  total: number;
  everyWordTotal: number;
}

const matchExpression = (terms: readonly string[], operator: " " | " OR ") =>
  terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(operator);

export function addSearchEntry(database: SearchDatabase, item: Pick<MediaItem, "id" | "title">) {
  database.run(
    sql`insert into media_search (media_id, title, transcript, speakers, summary) values (${item.id}, ${foldSearchText(item.title)}, '', '', '')`,
  );
}

export function setSearchTitle(database: SearchDatabase, id: string, title: string) {
  database.run(
    sql`update media_search set title = ${foldSearchText(title)} where media_id = ${id}`,
  );
}

export function setSearchSummary(
  database: SearchDatabase,
  id: string,
  summary: { text: string; keyPoints: readonly { text: string }[] } | null,
) {
  const text = summary ? [summary.text, ...summary.keyPoints.map((point) => point.text)] : [];
  database.run(
    sql`update media_search set summary = ${foldSearchText(text.join(" "))} where media_id = ${id}`,
  );
}

export function setSearchTranscript(database: SearchDatabase, id: string, transcript: Transcript) {
  const speakers = transcriptSpeakers(transcript);
  const speakerName = (speaker: number | undefined) =>
    speaker === undefined ? null : speakers.nameOf(speaker);
  const passages = transcriptPassages(transcript.words).map((passage) => {
    const speaker = speakerName(passage.speaker);
    return {
      mediaId: id,
      startMs: passage.startMs,
      text: passage.text,
      searchText: foldSearchText(passage.text),
      speaker,
      speakerSearchText: speaker === null ? null : foldSearchText(speaker),
    };
  });
  const speakerNames = speakers.ids.flatMap((speaker) => speakerName(speaker) ?? []);
  database.run(
    sql`update media_search set transcript = ${passages.map((passage) => passage.searchText).join(" ")}, speakers = ${foldSearchText(speakerNames.join(" "))} where media_id = ${id}`,
  );
  database.delete(searchPassages).where(eq(searchPassages.mediaId, id)).run();
  for (let first = 0; first < passages.length; first += passagesPerInsert)
    database
      .insert(searchPassages)
      .values(passages.slice(first, first + passagesPerInsert))
      .run();
}

export function removeSearchEntry(database: SearchDatabase, id: string) {
  database.delete(searchPassages).where(eq(searchPassages.mediaId, id)).run();
  database.run(sql`delete from media_search where media_id = ${id}`);
}

export function syncSearchIndex(database: AppDatabase) {
  if (database.select().from(searchIndex).get()?.version === searchIndexVersion) return;
  database.transaction((transaction) => {
    transaction.delete(searchPassages).run();
    transaction.run(sql`delete from media_search`);
    transaction.delete(searchIndex).run();
    for (const item of transaction
      .select({ id: mediaItems.id, title: mediaItems.title })
      .from(mediaItems)
      .all())
      addSearchEntry(transaction, item);
    for (const { mediaId } of transaction
      .select({ mediaId: transcriptionJobs.mediaId })
      .from(transcriptionJobs)
      .where(isNotNull(transcriptionJobs.transcript))
      .all()) {
      const stored = transaction
        .select({ transcript: transcriptionJobs.transcript })
        .from(transcriptionJobs)
        .where(eq(transcriptionJobs.mediaId, mediaId))
        .get();
      setSearchTranscript(
        transaction,
        mediaId,
        Schema.decodeUnknownSync(Transcript)(stored?.transcript),
      );
    }
    for (const { mediaId, text, keyPoints } of transaction
      .select({
        mediaId: recordingOverviews.mediaId,
        text: recordingOverviews.summary,
        keyPoints: recordingOverviews.keyPoints,
      })
      .from(recordingOverviews)
      .where(isNotNull(recordingOverviews.summary))
      .all())
      setSearchSummary(transaction, mediaId, { text: text ?? "", keyPoints: keyPoints ?? [] });
    transaction.insert(searchIndex).values({ version: searchIndexVersion }).run();
  });
}

export function rankSearchMatches(database: SearchDatabase, terms: readonly string[]) {
  const matches = database.all<{ mediaId: string; rank: number }>(
    sql`select media_id as mediaId, bm25(media_search, 0, 10, 1, 5, 2) as rank from media_search where media_search match ${matchExpression(terms, " ")}`,
  );
  return new Map(matches.map((match) => [match.mediaId, match.rank]));
}

export function findPassageMatches(
  database: SearchDatabase,
  terms: readonly string[],
  mediaIds: readonly string[],
) {
  const rows = database.all<{
    mediaId: string;
    startMs: number;
    text: string;
    speaker: string | null;
    total: number;
    everyWordTotal: number;
  }>(
    sql`select media_id as mediaId, start_ms as startMs, text, speaker, total, every_word_total as everyWordTotal from (
      select media_id, start_ms, text, speaker,
        row_number() over (partition by media_id order by every_word desc, start_ms) as position,
        count(*) over (partition by media_id) as total,
        sum(every_word) over (partition by media_id) as every_word_total
      from (
        select ${searchPassages.mediaId}, ${searchPassages.startMs}, ${searchPassages.text}, ${searchPassages.speaker},
          passage_search.rowid in (
            select rowid from passage_search where passage_search match ${matchExpression(terms, " ")}
          ) as every_word
        from passage_search join ${searchPassages} on ${searchPassages.id} = passage_search.rowid
        where passage_search match ${matchExpression(terms, " OR ")}
          and ${inArray(searchPassages.mediaId, [...mediaIds])}
      )
    ) where position <= ${maxPassageMatches} order by mediaId, position`,
  );
  const matches = new Map<string, FoundPassages>();
  for (const row of rows) {
    const match = matches.get(row.mediaId) ?? {
      passages: [],
      total: row.total,
      everyWordTotal: row.everyWordTotal,
    };
    match.passages.push({ startMs: row.startMs, text: row.text, speaker: row.speaker });
    matches.set(row.mediaId, match);
  }
  return matches;
}

export function describeMatch(
  title: string,
  found: FoundPassages | undefined,
  terms: readonly string[],
): LibraryMatch {
  return {
    title: matchedRanges(title, terms),
    passages: (found?.passages ?? []).map(({ speaker, ...passage }) => ({
      ...passage,
      ranges: matchedRanges(passage.text, terms),
      ...(speaker === null
        ? {}
        : { speaker: { name: speaker, ranges: matchedRanges(speaker, terms) } }),
    })),
    passageCount: found?.total ?? 0,
    everyWordPassageCount: found?.everyWordTotal ?? 0,
  };
}
