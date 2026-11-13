import { downloadSiteNames } from "../../shared/contracts/downloads.ts";
import { maxDownloadLinkLength, recognizeDownloadSource } from "../../shared/download-sources.ts";
import { MediaError } from "../media/error.ts";

export function downloadSource(input: string) {
  if (input.length > maxDownloadLinkLength)
    throw new MediaError("invalid", "Links must be 2048 characters or shorter.");
  const source = recognizeDownloadSource(input);
  if (!source)
    throw new MediaError(
      "invalid",
      `Paste an HTTPS link to one public video or podcast episode from ${downloadSiteNames}. Profiles, playlists and individual attachment links are not supported.`,
    );
  return source;
}
