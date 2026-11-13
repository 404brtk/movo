export function toggleSelection(
  selected: ReadonlySet<string>,
  order: readonly string[],
  id: string,
  anchor: string | null,
  extend: boolean,
): Set<string> {
  const checked = !selected.has(id);
  const target = order.indexOf(id);
  const start = extend && anchor !== null ? order.indexOf(anchor) : -1;
  const range =
    start >= 0 && target >= 0
      ? order.slice(Math.min(start, target), Math.max(start, target) + 1)
      : [id];
  const next = new Set(selected);
  for (const each of range) {
    if (checked) next.add(each);
    else next.delete(each);
  }
  return next;
}

export type BulkFailure = { title: string; message: string };

export function describeBulkDeletion(total: number, failures: readonly BulkFailure[]) {
  const deleted = total - failures.length;
  const summary = deleted > 0 ? `Deleted ${deleted} of ${total}. ` : "";
  const [only] = failures;
  if (failures.length === 1 && only)
    return `${summary}“${only.title}” was not deleted: ${only.message}`;
  const reasons = failures.map((failure) => `“${failure.title}”: ${failure.message}`).join(" ");
  return `${summary}${failures.length} recordings were not deleted. ${reasons}`;
}

export const recordingCount = (count: number) =>
  `${count} ${count === 1 ? "recording" : "recordings"}`;
