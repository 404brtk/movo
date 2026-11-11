import type { LibraryItem, LibrarySort } from "../../shared/contracts/library.ts";
import { groupByImportPeriod } from "../lib/library-view.ts";
import { LibraryRow } from "./library-row.tsx";

export function LibraryList({ items, sort }: { items: readonly LibraryItem[]; sort: LibrarySort }) {
  const groups =
    sort === "title" || sort === "relevance"
      ? [{ label: null, items }]
      : groupByImportPeriod(items);
  return (
    <section aria-label="Media library" className={groups[0]?.label ? undefined : "mt-5"}>
      {groups.map((group, index) => (
        <div key={index}>
          {group.label ? (
            <h2 className="mt-[26px] mb-1.5 text-xs/[normal] font-medium text-muted-foreground">
              {group.label}
            </h2>
          ) : null}
          <ul className="-mx-2.5">
            {group.items.map((item) => (
              <li key={item.id}>
                <LibraryRow item={item} detailed offerTranscribe className="h-15" />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
