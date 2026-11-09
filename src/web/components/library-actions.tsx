import { DownloadLink } from "./download-link.tsx";
import { ImportMedia } from "./import-media.tsx";

export function LibraryActions() {
  return (
    <div className="flex gap-2">
      <DownloadLink />
      <ImportMedia />
    </div>
  );
}
