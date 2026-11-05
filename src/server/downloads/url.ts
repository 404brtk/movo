import { MediaError } from "../media/error.ts";

export function downloadSource(input: string) {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      throw new Error("Invalid URL origin");
    const host = url.hostname.toLowerCase();
    let id: string | null | undefined;
    if (host === "youtu.be") id = url.pathname.slice(1);
    else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)) {
      if (url.pathname === "/watch") id = url.searchParams.get("v");
      else id = /^\/(?:shorts|embed|live)\/([^/]+)\/?$/u.exec(url.pathname)?.[1];
    }
    if (id && /^[\w-]{11}$/u.test(id))
      return { site: "youtube", id, url: `https://www.youtube.com/watch?v=${id}` } as const;
    if (/^(?:(?:www|m|mobile)\.)?(?:x|twitter)\.com$/u.test(host)) {
      const postId = /^\/(?:[\w]{1,15}|i\/web)\/status\/([1-9]\d{0,19})\/?$/u.exec(
        url.pathname,
      )?.[1];
      if (postId)
        return { site: "x", id: postId, url: `https://x.com/i/web/status/${postId}` } as const;
    }
    throw new Error("Not a supported video or post URL");
  } catch (cause) {
    throw new MediaError(
      "invalid",
      "Paste an HTTPS link to a YouTube video or X post with one video. Profiles, playlists and individual attachment links are not supported.",
      cause,
    );
  }
}
