import { Buffer } from "node:buffer";

export function attachmentDisposition(filename: string) {
  const name = Buffer.from(filename, "utf8")
    .toString("utf8")
    .replace(/[\p{Cc}/\\]/gu, "_");
  const fallback = name.replace(/[^\x20-\x7e]|["%]/gu, "_");
  const encoded = encodeURIComponent(name).replace(
    /['()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
