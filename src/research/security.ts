import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function privateIp(ip: string) {
  if (ip === "::1" || ip === "::" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80:")) return true;
  const p = ip.split(".").map(Number);
  return p.length === 4 && (p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168));
}
export async function assertPublicUrl(input: string) {
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Dozwolone są wyłącznie publiczne adresy HTTP(S).");
  if (["localhost", "localhost.localdomain"].includes(url.hostname) || url.hostname.endsWith(".local")) throw new Error("Adres lokalny jest niedozwolony.");
  const addresses = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => privateIp(address))) throw new Error("Adres prywatny lub link-local jest niedozwolony.");
  return url;
}
