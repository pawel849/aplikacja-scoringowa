import { getClient } from "@/db/client";
import { assertPublicUrl, fetchPublicText } from "./security";
import { parsePublicPage } from "./parsers";

const hostLastFetch = new Map<string, number>();
const PATH_HINTS = ["kontakt", "o-nas", "oferta", "realizacje", "portfolio", "kariera"];
const USER_AGENT = "LeadResearchBot/1.0 (+public-page internal research)";
const remaining = (deadlineMs: number, cap: number) => {
  const value = Math.min(cap, deadlineMs - Date.now());
  if (value <= 0) throw new Error("Przekroczono budżet czasu researchu.");
  return value;
};

async function allowedByRobots(url: URL, deadlineMs: number) {
  try {
    const robots = new URL("/robots.txt", url);
    const res = await fetchPublicText(robots, { timeoutMs: remaining(deadlineMs, 4_000), maxBytes: 64_000, headers: { "user-agent": USER_AGENT, accept: "text/plain" } });
    if (res.status < 200 || res.status >= 300) return true;
    const text = res.content;
    let applies = false;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.split("#")[0].trim();
      if (/^user-agent:/i.test(line)) applies = ["*", "leadresearchbot"].includes(line.split(":").slice(1).join(":").trim().toLowerCase());
      else if (applies && /^disallow:/i.test(line)) {
        const path = line.split(":").slice(1).join(":").trim();
        if (path && url.pathname.startsWith(path)) return false;
      }
    }
  } catch (error) { if (Date.now() >= deadlineMs) throw error; return true; }
  return true;
}
export async function fetchPublicHtml(input: string | URL, deadlineMs = Date.now() + 25_000) {
  const url = await assertPublicUrl(input.toString(), remaining(deadlineMs, 3_000));
  const db = getClient();
  const cached = await db.query<{ status: number; content: string | null }>("SELECT status,content FROM fetch_cache WHERE url=$1 AND expires_at>now()", [url.toString()]);
  if (cached.rows[0]) return { status: cached.rows[0].status, content: cached.rows[0].content ?? "", cached: true, finalUrl: url.toString() };
  if (!(await allowedByRobots(url, deadlineMs))) throw new Error("ROBOTS_BLOCKED");
  const wait = Math.max(0, 700 - (Date.now() - (hostLastFetch.get(url.host) ?? 0)));
  if (wait) await new Promise((resolve) => setTimeout(resolve, remaining(deadlineMs, wait)));
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetchPublicText(url, { timeoutMs: remaining(deadlineMs, 8_000), maxBytes: 1_000_000, headers: { "user-agent": USER_AGENT, accept: "text/html" } });
      hostLastFetch.set(url.host, Date.now());
      const content = response.contentType?.includes("text/html") ? response.content : "";
      await db.query("INSERT INTO fetch_cache(url,status,content,content_type,expires_at) VALUES($1,$2,$3,$4,now()+interval '24 hours') ON CONFLICT(url) DO UPDATE SET status=excluded.status,content=excluded.content,content_type=excluded.content_type,fetched_at=now(),expires_at=excluded.expires_at", [url.toString(), response.status, content, response.contentType]);
      return { status: response.status, content, cached: false, finalUrl: response.finalUrl };
    } catch (error) { lastError = error; if (!attempt) await new Promise((r) => setTimeout(r, remaining(deadlineMs, 400))); }
  }
  throw lastError;
}
export async function crawlWebsite(input: string, deadlineMs = Date.now() + 130_000) {
  const root = await assertPublicUrl(input, remaining(deadlineMs, 3_000));
  const queue = [new URL("/", root)];
  const visited = new Set<string>(), pages: ReturnType<typeof parsePublicPage>[] = [], errors: { url: string; message: string }[] = [];
  while (queue.length && visited.size < 6) {
    remaining(deadlineMs, 1);
    const url = queue.shift()!; if (visited.has(url.toString())) continue; visited.add(url.toString());
    try {
      await assertPublicUrl(url.toString(), remaining(deadlineMs, 3_000));
      const fetched = await fetchPublicHtml(url, deadlineMs);
      if (fetched.status >= 400 || !fetched.content) throw new Error(`HTTP ${fetched.status} lub brak HTML`);
      const parsed = parsePublicPage(fetched.content, fetched.finalUrl || url.toString()); pages.push(parsed);
      if (pages.length === 1) for (const link of parsed.links) {
        const child = new URL(link);
        if (child.hostname === root.hostname && PATH_HINTS.some((hint) => child.pathname.toLowerCase().includes(hint))) queue.push(child);
      }
    } catch (error) { errors.push({ url: url.toString(), message: error instanceof Error ? error.message : String(error) }); }
  }
  return { pages, errors };
}
