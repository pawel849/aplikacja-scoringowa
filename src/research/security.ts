import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, fetch as undiciFetch } from "undici";

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export function isPublicIp(input: string) {
  try {
    const address = ipaddr.parse(input);
    if (address instanceof ipaddr.IPv6 && address.isIPv4MappedAddress()) return isPublicIp(address.toIPv4Address().toString());
    return address.range() === "unicast";
  } catch {
    return false;
  }
}

async function lookupWithTimeout(hostname: string, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Przekroczono limit czasu DNS.")), timeoutMs); })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function resolvePublicUrl(input: string, dnsTimeoutMs = 3_000) {
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Dozwolone są wyłącznie publiczne adresy HTTP(S).");
  if (["localhost", "localhost.localdomain"].includes(url.hostname) || url.hostname.endsWith(".local")) throw new Error("Adres lokalny jest niedozwolony.");
  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname, family: isIP(url.hostname) }]
    : await lookupWithTimeout(url.hostname, dnsTimeoutMs);
  if (!addresses.length || addresses.some(({ address }) => !isPublicIp(address))) throw new Error("Adres prywatny, zastrzeżony lub link-local jest niedozwolony.");
  return { url, address: addresses[0].address, family: addresses[0].family };
}

export async function assertPublicUrl(input: string, dnsTimeoutMs = 3_000) {
  return (await resolvePublicUrl(input, dnsTimeoutMs)).url;
}

export async function readLimitedText(response: { headers: { get(name: string): string | null }; body: unknown }, maxBytes: number) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`Odpowiedź przekracza limit ${maxBytes} bajtów.`);
  const body = response.body as ReadableStream<Uint8Array> | null;
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let total = 0, text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Odpowiedź przekracza limit ${maxBytes} bajtów.`);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export async function fetchPublicText(input: string | URL, options: {
  timeoutMs: number;
  maxBytes: number;
  headers?: Record<string, string>;
  maxRedirects?: number;
  method?: "GET" | "POST";
  body?: string;
}) {
  let target = new URL(input.toString());
  const maxRedirects = options.maxRedirects ?? 4;
  const deadline = Date.now() + options.timeoutMs;
  for (let redirect = 0; redirect <= maxRedirects; redirect++) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error("Przekroczono limit czasu pobierania.");
    const resolved = await resolvePublicUrl(target.toString(), Math.min(remainingMs, 3_000));
    const requestRemainingMs = deadline - Date.now();
    if (requestRemainingMs <= 0) throw new Error("Przekroczono limit czasu pobierania.");
    const dispatcher = new Agent({ connect: {
      lookup: (_hostname, lookupOptions, callback) => {
        const done = callback as (...args: unknown[]) => void;
        if (typeof lookupOptions === "object" && lookupOptions.all) done(null, [{ address: resolved.address, family: resolved.family }]);
        else done(null, resolved.address, resolved.family);
      }
    } });
    try {
      const response = await undiciFetch(resolved.url, {
        method: options.method ?? "GET",
        body: options.body,
        redirect: "manual",
        signal: AbortSignal.timeout(requestRemainingMs),
        headers: options.headers,
        dispatcher
      });
      if (REDIRECTS.has(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location) throw new Error("Przekierowanie bez nagłówka Location.");
        if (redirect === maxRedirects) throw new Error("Zbyt wiele przekierowań.");
        target = new URL(location, resolved.url);
        continue;
      }
      const content = await readLimitedText(response, options.maxBytes);
      return {
        status: response.status,
        content,
        contentType: response.headers.get("content-type"),
        finalUrl: resolved.url.toString(),
        headers: response.headers
      };
    } finally {
      await dispatcher.close();
    }
  }
  throw new Error("Zbyt wiele przekierowań.");
}
