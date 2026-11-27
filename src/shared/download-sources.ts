type Located = { id: string; url: string } | undefined;

const youtubeHost = /^(?:(?:www\.|m\.)?youtube\.com|youtu\.be)$/u;
const youtubeOrigin = "https://www.youtube.com";
const isYouTubeVideoId = (id: string) => /^[\w-]{11}$/u.test(id);
const youtubeVideoUrl = (id: string) => `${youtubeOrigin}/watch?v=${id}`;

const youtubeId = (url: URL) => {
  if (url.hostname === "youtu.be") return url.pathname.slice(1);
  if (url.pathname === "/watch") return url.searchParams.get("v");
  return /^\/(?:shorts|embed|live)\/([^/]+)\/?$/u.exec(url.pathname)?.[1];
};

const facebookId = (url: URL) =>
  /^\/watch\/?$/u.test(url.pathname)
    ? url.searchParams.get("v")
    : /^\/(?:reel|[\w.-]{1,80}\/videos)\/(\d+)\/?$/u.exec(url.pathname)?.[1];

const googleDriveId = (url: URL) =>
  /^\/(?:open|uc)$/u.test(url.pathname)
    ? url.searchParams.get("id")
    : /^\/file\/d\/([^/]+)(?:\/(?:view|edit|preview))?\/?$/u.exec(url.pathname)?.[1];

const sites = [
  {
    site: "youtube",
    host: youtubeHost,
    locate: (url: URL): Located => {
      const id = youtubeId(url);
      return id && isYouTubeVideoId(id) ? { id, url: youtubeVideoUrl(id) } : undefined;
    },
  },
  {
    site: "x",
    host: /^(?:(?:www|m|mobile)\.)?(?:x|twitter)\.com$/u,
    locate: (url: URL): Located => {
      const id = /^\/(?:\w{1,15}|i\/web)\/status\/([1-9]\d{0,19})\/?$/u.exec(url.pathname)?.[1];
      return id ? { id, url: `https://x.com/i/web/status/${id}` } : undefined;
    },
  },
  {
    site: "tiktok",
    host: /^(?:(?:www|m)\.)?tiktok\.com$/u,
    locate: (url: URL): Located => {
      const id = /^\/@[\w.]{0,24}\/video\/([1-9]\d{0,19})\/?$/u.exec(url.pathname)?.[1];
      return id ? { id, url: `https://www.tiktok.com/@/video/${id}` } : undefined;
    },
  },
  {
    site: "instagram",
    host: /^(?:www\.)?instagram\.com$/u,
    locate: (url: URL): Located => {
      const id = /^\/(?:[\w.]{1,30}\/)?(?:p|reels?|tv)\/([\w-]{5,40})\/?$/u.exec(url.pathname)?.[1];
      return id ? { id, url: `https://www.instagram.com/p/${id}/` } : undefined;
    },
  },
  {
    site: "facebook",
    host: /^(?:(?:www|m|web)\.)?facebook\.com$/u,
    locate: (url: URL): Located => {
      const id = facebookId(url);
      return id && /^[1-9]\d{0,19}$/u.test(id)
        ? { id, url: `https://www.facebook.com/watch/?v=${id}` }
        : undefined;
    },
  },
  {
    site: "twitchVod",
    host: /^(?:(?:www|m)\.)?twitch\.tv$/u,
    locate: (url: URL): Located => {
      const id = /^\/videos\/([1-9]\d{0,19})\/?$/u.exec(url.pathname)?.[1];
      return id ? { id: `v${id}`, url: `https://www.twitch.tv/videos/${id}` } : undefined;
    },
  },
  {
    site: "twitchClip",
    host: /^(?:(?:www|m|clips)\.)?twitch\.tv$/u,
    locate: (url: URL): Located => {
      const id = (
        url.hostname === "clips.twitch.tv"
          ? /^\/([\w-]{1,100})\/?$/u
          : /^\/\w{1,25}\/clip\/([\w-]{1,100})\/?$/u
      ).exec(url.pathname)?.[1];
      return id ? { id, url: `https://clips.twitch.tv/${id}` } : undefined;
    },
  },
  {
    site: "applePodcasts",
    host: /^podcasts\.apple\.com$/u,
    locate: (url: URL): Located => {
      const show = /^\/(?:[a-z]{2}\/)?podcast\/(?:[^/]+\/)?id(\d{1,20})\/?$/u.exec(
        url.pathname,
      )?.[1];
      const id = url.searchParams.get("i");
      return show && id && /^\d{1,20}$/u.test(id)
        ? { id, url: `https://podcasts.apple.com/podcast/id${show}?i=${id}` }
        : undefined;
    },
  },
  {
    site: "googleDrive",
    host: /^drive\.google\.com$/u,
    locate: (url: URL): Located => {
      const id = googleDriveId(url);
      return id && /^[\w-]{25,100}$/u.test(id)
        ? { id, url: `https://drive.google.com/file/d/${id}/view` }
        : undefined;
    },
  },
  {
    site: "dropbox",
    host: /^(?:www\.)?dropbox\.com$/u,
    locate: (url: URL): Located => {
      const [, kind, id, name] =
        /^\/(scl\/fi|s)\/(\w{1,100})\/([^/]{1,255})$/u.exec(url.pathname) ?? [];
      const key = url.searchParams.get("rlkey");
      if (!id || !name) return undefined;
      if (kind === "s") return { id, url: `https://www.dropbox.com/s/${id}/${name}` };
      return key && /^\w{1,100}$/u.test(key)
        ? { id, url: `https://www.dropbox.com/scl/fi/${id}/${name}?rlkey=${key}` }
        : undefined;
    },
  },
] as const;

export type DownloadSite = (typeof sites)[number]["site"];

export type DownloadSource = { site: DownloadSite; id: string; url: string };

export const maxDownloadLinkLength = 2048;

const audioOnlySites: ReadonlySet<DownloadSite> = new Set(["applePodcasts"]);

export const isAudioOnlySite = (site: DownloadSite) => audioOnlySites.has(site);

function parseDownloadUrl(input: string) {
  if (input.length > maxDownloadLinkLength) return undefined;
  const url = URL.parse(input.trim());
  if (!url || url.protocol !== "https:" || url.username || url.password || url.port)
    return undefined;
  return url;
}

export type YouTubeCollection = { kind: "playlist" | "channel"; id: string; url: string };

export const isYouTubeChannelId = (id: string) => /^UC[\w-]{22}$/u.test(id);

export function recognizeYouTubeCollection(
  input: string,
): YouTubeCollection | { kind: "mix" } | undefined {
  const url = parseDownloadUrl(input);
  if (!url || !youtubeHost.test(url.hostname)) return undefined;
  const videoId = youtubeId(url);
  if (
    (url.hostname !== "youtu.be" && /^\/playlist\/?$/u.test(url.pathname)) ||
    (videoId &&
      isYouTubeVideoId(videoId) &&
      (url.pathname === "/watch" || url.hostname === "youtu.be"))
  ) {
    const id = url.searchParams.get("list");
    if (id && /^(?:PL|LL|EC|UU|FL|UL|TL|PU|RDCLAK5uy_|OLAK5uy_)[\w-]{10,100}$/u.test(id))
      return { kind: "playlist", id, url: `${youtubeOrigin}/playlist?list=${id}` };
    if (id && /^RD[\w-]*$/u.test(id)) return { kind: "mix" };
    return undefined;
  }
  if (url.hostname === "youtu.be") return undefined;
  const channel = /^\/channel\/([^/]+)(?:\/videos)?\/?$/u.exec(url.pathname)?.[1];
  if (channel && isYouTubeChannelId(channel))
    return { kind: "channel", id: channel, url: `${youtubeOrigin}/channel/${channel}/videos` };
  const encoded = /^\/(@[^/]+)(?:\/videos)?\/?$/u.exec(url.pathname)?.[1];
  if (!encoded) return undefined;
  let handle: string;
  try {
    handle = decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
  if (!/^@[\p{L}\p{M}\p{N}._-]{3,30}$/u.test(handle)) return undefined;
  const id = handle.toLowerCase();
  return {
    kind: "channel",
    id,
    url: `${youtubeOrigin}/@${encodeURIComponent(id.slice(1))}/videos`,
  };
}

export function recognizeDownloadSource(input: string): DownloadSource | undefined {
  const url = parseDownloadUrl(input);
  if (!url) return undefined;
  for (const { site, host, locate } of sites) {
    const located = host.test(url.hostname) ? locate(url) : undefined;
    if (located) return { site, ...located };
  }
  return undefined;
}
