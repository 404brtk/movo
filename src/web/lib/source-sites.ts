import {
  DropboxIcon,
  Facebook01Icon,
  GoogleDriveIcon,
  InstagramIcon,
  NewTwitterIcon,
  PodcastIcon,
  TiktokIcon,
  TwitchIcon,
  YoutubeIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { type DownloadSite, recognizeDownloadSource } from "../../shared/download-sources.ts";
import { formatSourceHost } from "./format.ts";

const sites = {
  youtube: { name: "YouTube", icon: YoutubeIcon },
  x: { name: "X", icon: NewTwitterIcon },
  tiktok: { name: "TikTok", icon: TiktokIcon },
  instagram: { name: "Instagram", icon: InstagramIcon },
  facebook: { name: "Facebook", icon: Facebook01Icon },
  twitchVod: { name: "Twitch", icon: TwitchIcon },
  twitchClip: { name: "Twitch", icon: TwitchIcon },
  applePodcasts: { name: "Apple Podcasts", icon: PodcastIcon },
  googleDrive: { name: "Google Drive", icon: GoogleDriveIcon },
  dropbox: { name: "Dropbox", icon: DropboxIcon },
} as const satisfies Record<DownloadSite, { name: string; icon: IconSvgElement }>;

export function sourceSite(url: string): { name: string; icon: IconSvgElement | null } {
  const site = recognizeDownloadSource(url)?.site;
  return site ? sites[site] : { name: formatSourceHost(url) ?? "Source", icon: null };
}
