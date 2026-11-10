import type { ServerReach } from "./contracts/ask.ts";

const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u;

function ipv4Reach(host: string): ServerReach | null | undefined {
  const octets = ipv4.exec(host)?.slice(1).map(Number);
  if (!octets || octets.some((octet) => octet > 255)) return undefined;
  const [first = -1, second = -1] = octets;
  if (first === 127) return "this-computer";
  if (first === 10) return "network";
  if (first === 172 && second >= 16 && second <= 31) return "network";
  if (first === 192 && second === 168) return "network";
  return null;
}

function ipv6Reach(host: string): ServerReach | null {
  if (host === "::1") return "this-computer";
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(host)?.[1];
  if (mapped) return ipv4Reach(mapped) ?? null;
  return /^f[cd][0-9a-f]{2}:/u.test(host) ? "network" : null;
}

export function serverReach(host: string): ServerReach | null {
  const bare = host.replace(/^\[|\]$/gu, "").toLowerCase();
  if (bare === "localhost" || bare.endsWith(".localhost")) return "this-computer";
  const v4 = ipv4Reach(bare);
  if (v4 !== undefined) return v4;
  if (bare.includes(":")) return ipv6Reach(bare);
  return bare.endsWith(".local") && bare.length > ".local".length ? "network" : null;
}

export function addressReach(address: string) {
  const trimmed = address.trim();
  if (!trimmed) return null;
  const url = URL.parse(/^[a-z][a-z\d+.-]*:\/\//iu.test(trimmed) ? trimmed : `http://${trimmed}`);
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) return null;
  const reach = serverReach(url.hostname);
  return reach ? { reach, encrypted: url.protocol === "https:" } : null;
}
