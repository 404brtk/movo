import { eq, inArray, isNotNull, sql } from "drizzle-orm";
import { Schema } from "effect";
import type { LibraryMatch } from "../../shared/contracts/library.ts";
import type { MediaItem } from "../../shared/contracts/media.ts";
import { Transcript } from "../../shared/contracts/transcriptions.ts";
import { foldSearchText, matchedRanges } from "../../shared/search-text.ts";
import { transcriptPassages } from "../../shared/transcript-passages.ts";
import type { AppDatabase } from "../db/database.ts";
import { transcriptionJobs } from "../transcriptions/transcriptions.schema.ts";
import { mediaItems } from "./media.schema.ts";
import { searchIndex, searchPassages } from "./search.schema.ts";

type SearchDatabase = Pick<AppDatabase, "run" | "all" | "insert" | "delete">;

export const searchIndexVersion = 1;
const maxPassageMatches = 3;
const passagesPerInsert = 1000;

interface FoundPassages {
  passages: { startMs: number; text: string }[];
  total: number;
}

const matchExpression = (terms: readonly string[], operator: " " | " OR ") =>
  terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(operator);

export function addSearchEntry(database: SearchDatabase, item: Pick<MediaItem, "id" | "title">) {
  database.run(
    sql`insert into media_search (media_id, title, transcript) values (${item.id}, ${foldSearchText(item.title)}, '')`,
  );
}

export function setSearchTitle(database: SearchDatabase, id: string, title: string) {
  database.run(
    sql`update media_search set title = ${foldSearchText(title)} where media_id = ${id}`,
  );
}

export function setSearchTranscript(database: SearchDatabase, id: string, transcript: Transcript) {
  const passages = transcriptPassages(transcript.words).map((passage) => ({
    mediaId: id,
    startMs: passage.startMs,
    text: passage.text,
    searchText: foldSearchText(passage.text),
  }));
  database.run(
    sql`update media_search set transcript = ${passages.map((passage) => passage.searchText).join(" ")} where media_id = ${id}`,
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
    transaction.insert(searchIndex).values({ version: searchIndexVersion }).run();
  });
}

export function rankSearchMatches(database: SearchDatabase, terms: readonly string[]) {
  const matches = database.all<{ mediaId: string; rank: number }>(
    sql`select media_id as mediaId, bm25(media_search, 0, 10, 1) as rank from media_search where media_search match ${matchExpression(terms, " ")}`,
  );
  return new Map(matches.map((match) => [match.mediaId, match.rank]));
}

export function findPassageMatches(
  database: SearchDatabase,
  terms: readonly string[],
  mediaIds: readonly string[],
) {
  const rows = database.all<{ mediaId: string; startMs: number; text: string; total: number }>(
    sql`select media_id as mediaId, start_ms as startMs, text, total from (
      select ${searchPassages.mediaId}, ${searchPassages.startMs}, ${searchPassages.text},
        row_number() over (partition by ${searchPassages.mediaId} order by ${searchPassages.startMs}) as position,
        count(*) over (partition by ${searchPassages.mediaId}) as total
      from passage_search join ${searchPassages} on ${searchPassages.id} = passage_search.rowid
      where passage_search match ${matchExpression(terms, " OR ")}
        and ${inArray(searchPassages.mediaId, [...mediaIds])}
    ) where position <= ${maxPassageMatches} order by mediaId, startMs`,
  );
  const matches = new Map<string, FoundPassages>();
  for (const row of rows) {
    const match = matches.get(row.mediaId) ?? { passages: [], total: row.total };
    match.passages.push({ startMs: row.startMs, text: row.text });
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
    passages: (found?.passages ?? []).map((passage) => ({
      ...passage,
      ranges: matchedRanges(passage.text, terms),
    })),
    passageCount: found?.total ?? 0,
  };
}
