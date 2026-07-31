import { getClient } from "@/db/client";
import { assertPublicUrl } from "./security";
import { parsePublicPage } from "./parsers";

const hostLastFetch = new Map<string, number>();
const PATH_HINTS = ["kontakt", "o-nas", "oferta", "realizacje", "portfolio", "kariera"];
const USER_AGENT = "LeadResearchBot/1.0 (+public-page internal research)";

async function allowedByRobots(url: URL) {
  try {
    const robots = new URL("/robots.txt", url);
    const res = await fetch(robots, { signal: AbortSignal.timeout(4_000), headers: { "user-agent": USER_AGENT } });
    if (!res.ok) return true;
    const text = await res.text();
    let applies = false;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.split("#")[0].trim();
      if (/^user-agent:/i.test(line)) applies = ["*", "leadresearchbot"].includes(line.split(":").slice(1).join(":").trim().toLowerCase());
      else if (applies && /^disallow:/i.test(line)) {
        const path = line.split(":").slice(1).join(":").trim();
        if (path && url.pathname.startsWith(path)) return false;
      }
    }
  } catch { return true; }
  return true;
}
export async function fetchPublicHtml(input: string | URL) {
  const url = await assertPublicUrl(input.toString());
  const db = getClient();
  const cached = await db.query<{ status: number; content: string | null }>("SELECT status,content FROM fetch_cache WHERE url=$1 AND expires_at>now()", [url.toString()]);
  if (cached.rows[0]) return { status: cached.rows[0].status, content: cached.rows[0].content ?? "", cached: true, finalUrl: url.toString() };
  if (!(await allowedByRobots(url))) throw new Error("ROBOTS_BLOCKED");
  const wait = Math.max(0, 700 - (Date.now() - (hostLastFetch.get(url.host) ?? 0)));
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      let target = url, response: Response | undefined;
      for (let redirect = 0; redirect < 4; redirect++) {
        response = await fetch(target, { redirect: "manual", signal: AbortSignal.timeout(8_000), headers: { "user-agent": USER_AGENT, accept: "text/html" } });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get("location"); if (!location) break;
        target = await assertPublicUrl(new URL(location, target).toString());
      }
      if (!response || [301, 302, 303, 307, 308].includes(response.status)) throw new Error("Zbyt wiele przekierowań.");
      hostLastFetch.set(url.host, Date.now());
      const content = response.headers.get("content-type")?.includes("text/html") ? (await response.text()).slice(0, 1_000_000) : "";
      await db.query("INSERT INTO fetch_cache(url,status,content,content_type,expires_at) VALUES($1,$2,$3,$4,now()+interval '24 hours') ON CONFLICT(url) DO UPDATE SET status=excluded.status,content=excluded.content,content_type=excluded.content_type,fetched_at=now(),expires_at=excluded.expires_at", [url.toString(), response.status, content, response.headers.get("content-type")]);
      return { status: response.status, content, cached: false, finalUrl: target.toString() };
    } catch (error) { lastError = error; if (!attempt) await new Promise((r) => setTimeout(r, 400)); }
  }
  throw lastError;
}
export async function crawlWebsite(input: string) {
  const root = await assertPublicUrl(input);
  const queue = [new URL("/", root)];
  const visited = new Set<string>(), pages: ReturnType<typeof parsePublicPage>[] = [], errors: { url: string; message: string }[] = [];
  while (queue.length && visited.size < 6) {
    const url = queue.shift()!; if (visited.has(url.toString())) continue; visited.add(url.toString());
    try {
      await assertPublicUrl(url.toString());
      const fetched = await fetchPublicHtml(url);
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
