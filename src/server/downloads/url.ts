import { MediaError } from "../media/error.ts";

export function youtubeUrl(input: string) {
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
    if (!id || !/^[\w-]{11}$/u.test(id)) throw new Error("Not a single YouTube video");
    return `https://www.youtube.com/watch?v=${id}`;
  } catch (cause) {
    throw new MediaError(
      "invalid",
      "Paste an HTTPS link to a single YouTube video. Channels, playlists and other websites are not supported yet.",
      cause,
    );
  }
}
