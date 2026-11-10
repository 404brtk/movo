import { serverReach } from "../../shared/server-address.ts";
import { MediaError } from "../media/error.ts";

export function readServerAddress(address: string) {
  let url: URL;
  try {
    url = new URL(
      /^[a-z][a-z\d+.-]*:\/\//iu.test(address.trim()) ? address.trim() : `http://${address.trim()}`,
    );
  } catch (cause) {
    throw new MediaError("invalid", "Enter an address like http://192.168.1.20:11434.", cause);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new MediaError("invalid", "Use an http:// or https:// address.");
  if (url.username || url.password || url.search || url.hash)
    throw new MediaError("invalid", "Enter only the server's address, without a login or query.");
  const reach = serverReach(url.hostname);
  if (!reach)
    throw new MediaError(
      "invalid",
      "Only servers on this computer or your home network can be added here. Add internet services with an API key.",
    );
  const path = url.pathname.replace(/\/+$/u, "").replace(/\/v1$/u, "");
  return { baseUrl: `${url.origin}${path}`, reach };
}
