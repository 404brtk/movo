import { sql } from "drizzle-orm";
import type { LibraryMatch } from "../../shared/contracts/library.ts";
import type { MediaItem } from "../../shared/contracts/media.ts";
import type { Transcript } from "../../shared/contracts/transcriptions.ts";
import { foldSearchText, matchedRanges } from "../../shared/search-text.ts";
import { transcriptPassages } from "../../shared/transcript-passages.ts";
import type { AppDatabase } from "../db/database.ts";

type SearchDatabase = Pick<AppDatabase, "run" | "all">;

const maxPassageMatches = 3;

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
  const text = foldSearchText(transcript.words.map((word) => word.text).join(" "));
  database.run(sql`update media_search set transcript = ${text} where media_id = ${id}`);
}

export function removeSearchEntry(database: SearchDatabase, id: string) {
  database.run(sql`delete from media_search where media_id = ${id}`);
}

export function rankSearchMatches(database: SearchDatabase, terms: readonly string[]) {
  const expression = terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(" ");
  const matches = database.all<{ mediaId: string; rank: number }>(
    sql`select media_id as mediaId, bm25(media_search, 0, 10, 1) as rank from media_search where media_search match ${expression}`,
  );
  return new Map(matches.map((match) => [match.mediaId, match.rank]));
}

export function describeMatch(
  title: string,
  transcript: Transcript | undefined,
  terms: readonly string[],
): LibraryMatch {
  const passages = transcriptPassages(transcript?.words ?? [])
    .map((passage) => ({
      startMs: passage.startMs,
      text: passage.text,
      ranges: matchedRanges(passage.text, terms),
    }))
    .filter((passage) => passage.ranges.length > 0);
  return {
    title: matchedRanges(title, terms),
    passages: passages.slice(0, maxPassageMatches),
    passageCount: passages.length,
  };
}
