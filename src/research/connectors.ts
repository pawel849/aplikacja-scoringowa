import { parseCsvCompanies, type CsvCompany } from "./parsers";
import * as cheerio from "cheerio";
import { fetchPublicHtml } from "./crawler";
import { fetchPublicText } from "./security";

export type DiscoveredCompany = CsvCompany & {
  sourceName: string;
  sourceUrl?: string;
  partnershipLevels?: string[];
};
export interface ResearchConnector { name: string; discover(limit: number, deadlineMs?: number): Promise<DiscoveredCompany[]> }

const OFFICIAL_URLS = {
  ampio: "https://ampio.com/pl/kontakt",
  grenton: "https://grenton.pl/dla-twojego-domu/mapa-znajdz-instalatora/",
  knx: "https://www.knx.org/find-an-installer",
  loxone: "https://www.loxone.com/plpl/sprzedaz/znajdz-partnera/"
} as const;
const OFFICIAL_NAMES: Record<keyof typeof OFFICIAL_URLS, string> = {
  ampio: "Ampio", grenton: "Grenton", knx: "KNX", loxone: "Loxone"
};
const NON_COMPANY_HOSTS = new Set([
  "facebook.com", "instagram.com", "linkedin.com", "youtube.com", "twitter.com", "x.com",
  "jobs.loxone.com", "shop.loxone.com", "support.loxone.com"
]);
const NON_COMPANY_LABEL = /\b(kariera|career|jobs?|praca|sklep|shop|kontakt|contact|wsparcie|support|newsletter|blog|forum|logowanie|login)\b/i;

function remaining(deadlineMs: number | undefined, cap: number) {
  if (!deadlineMs) return cap;
  const value = Math.min(cap, deadlineMs - Date.now());
  if (value <= 0) throw new Error("Przekroczono budżet czasu katalogu.");
  return value;
}

function canonicalWebsite(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw || /[*•]/.test(raw)) return undefined;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return undefined;
    url.hash = "";
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (NON_COMPANY_HOSTS.has(host) || [...NON_COMPANY_HOSTS].some((x) => host.endsWith(`.${x}`))) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function publicPhone(value: unknown) {
  const raw = String(value ?? "").trim();
  return raw && !/[*•xX]/.test(raw) ? raw : undefined;
}

function extractBalancedJson(input: string, marker: string) {
  const markerIndex = input.indexOf(marker);
  if (markerIndex < 0) return undefined;
  const start = input.indexOf("[", markerIndex + marker.length);
  if (start < 0) return undefined;
  let depth = 0, quoted = false, escaped = false;
  for (let index = start; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "[") depth++;
    else if (char === "]" && --depth === 0) return input.slice(start, index + 1);
  }
  return undefined;
}

export class ManualUrlConnector implements ResearchConnector {
  name = "Ręczny URL";
  constructor(private url: string, private companyName?: string) {}
  async discover(limit?: number, deadlineMs?: number) { void limit; void deadlineMs; return [{ name: this.companyName || new URL(this.url).hostname.replace(/^www\./, ""), website: this.url, sourceName: this.name, sourceUrl: this.url }]; }
}

export class CsvConnector implements ResearchConnector {
  name = "Import CSV";
  constructor(private csv: string) {}
  async discover(limit: number, deadlineMs?: number) { void deadlineMs; return parseCsvCompanies(this.csv).slice(0, limit).map((row) => ({ ...row, sourceName: row.sourceName || this.name })); }
}

export function parseGenericDirectory(html: string, directoryUrl: string, sourceName: string): DiscoveredCompany[] {
  const $ = cheerio.load(html), directoryHost = new URL(directoryUrl).hostname.replace(/^www\./, "");
  const found = new Map<string, DiscoveredCompany>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href")?.trim(); if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) return;
    let url: URL; try { url = new URL(href, directoryUrl); } catch { return; }
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    const name = ($(el).attr("title") || $(el).find("img[alt]").attr("alt") || $(el).text()).replace(/\s+/g, " ").trim();
    const sameSite = host === directoryHost || host.endsWith(`.${directoryHost}`) || directoryHost.endsWith(`.${host}`);
    if (!/^https?:$/.test(url.protocol) || sameSite || NON_COMPANY_HOSTS.has(host) || [...NON_COMPANY_HOSTS].some((x) => host.endsWith(`.${x}`))) return;
    if (name.length < 2 || name.length > 200 || NON_COMPANY_LABEL.test(name) || /^(www|strona|website|więcej|zobacz|link)$/i.test(name)) return;
    const website = canonicalWebsite(`${url.protocol}//${url.host}${url.pathname === "/" ? "/" : url.pathname}`);
    if (website && !found.has(host)) found.set(host, { name, website, domain: host, sourceName, sourceUrl: directoryUrl });
  });
  return [...found.values()];
}

type LoxoneCompany = {
  comp_name?: string; comp_country_code?: string; comp_city?: string; comp_website?: string;
  comp_email?: string; comp_phone?: string; comp_partner_status?: string;
};
export function parseLoxonePartnerData(content: string, sourceName: string, sourceUrl: string): DiscoveredCompany[] {
  const payload = JSON.parse(content) as { success?: boolean; data?: { companies?: Record<string, LoxoneCompany[] | LoxoneCompany> } };
  if (!payload.success || !payload.data?.companies) return [];
  const values = Object.values(payload.data.companies).flatMap((value) => Array.isArray(value) ? value : [value]);
  const found = new Map<string, DiscoveredCompany>();
  for (const company of values) {
    const website = canonicalWebsite(company.comp_website);
    const name = company.comp_name?.trim();
    if (company.comp_country_code !== "PL" || !name || !website) continue;
    const domain = new URL(website).hostname.replace(/^www\./, "");
    if (found.has(domain)) continue;
    const status = normalizeLoxonePartnerStatus(company.comp_partner_status);
    found.set(domain, {
      name, website, domain, city: company.comp_city?.trim() || undefined, country: "PL",
      phone: publicPhone(company.comp_phone), publicEmail: company.comp_email?.trim() || undefined,
      partnershipLevels: status ? [`Loxone ${status} Partner`] : ["Loxone Partner"], sourceName, sourceUrl
    });
  }
  return [...found.values()];
}

export function normalizeLoxonePartnerStatus(value: unknown) {
  const status = String(value ?? "").trim().toUpperCase();
  if (/^PLATIN(?:UM)?\d*$/.test(status)) return "Platinum";
  if (/^GOLD\d*$/.test(status)) return "Gold";
  if (/^SILVER\d*$/.test(status)) return "Silver";
  if (/^REG\d*$/.test(status)) return "Registered";
  return status ? status.replace(/\d+$/, "") : undefined;
}

type GrentonStore = {
  title?: { rendered?: string }; class_list?: string[];
  acf?: {
    website?: string; map?: { city?: string; state?: string; country_short?: string };
    "contact-data"?: Array<{ type?: string; phone?: string; email?: string }>;
  };
};
export function parseGrentonStores(content: string, sourceName: string, sourceUrl: string): DiscoveredCompany[] {
  const stores = JSON.parse(content) as GrentonStore[];
  const found = new Map<string, DiscoveredCompany>();
  for (const store of stores) {
    const website = canonicalWebsite(store.acf?.website);
    const name = store.title?.rendered?.replace(/<[^>]+>/g, "").trim();
    const installer = store.class_list?.includes("grenton-store-category-instalator-grenton");
    if (!installer || store.acf?.map?.country_short !== "PL" || !name || !website) continue;
    const domain = new URL(website).hostname.replace(/^www\./, "");
    const contacts = store.acf?.["contact-data"] ?? [];
    const phone = contacts.find((item) => item.type === "phone")?.phone;
    const publicEmail = contacts.find((item) => item.type === "email")?.email;
    found.set(domain, {
      name, website, domain, city: store.acf?.map?.city?.trim() || undefined,
      region: store.acf?.map?.state?.replace(/^Województwo\s+/i, "").trim() || undefined,
      country: "PL", phone: publicPhone(phone), publicEmail: publicEmail?.trim() || undefined,
      partnershipLevels: ["Grenton Partner"], sourceName, sourceUrl
    });
  }
  return [...found.values()];
}

type GrentonFetcher = (input: string | URL, options: {
  timeoutMs: number; maxBytes: number; headers?: Record<string, string>;
}) => Promise<{ status: number; content: string; finalUrl: string; contentType?: string | null; headers: { get(name: string): string | null } }>;
const GRENTON_API = "https://grenton.pl/wp-json/wp/v2/grenton-store";
const GRENTON_MAX_PAGES = 50;
const GRENTON_MAX_BYTES = 12_000_000;

export async function fetchGrentonDirectory(deadlineMs: number, fetcher: GrentonFetcher = fetchPublicText) {
  const rows = new Map<string, DiscoveredCompany>();
  let totalPages: number | undefined;
  let bytesLeft = GRENTON_MAX_BYTES;
  for (let page = 1; page <= (totalPages ?? 1); page++) {
    const url = new URL(GRENTON_API);
    url.search = new URLSearchParams({ page: String(page), per_page: "100", _fields: "id,title,class_list,acf" }).toString();
    const response = await fetcher(url, {
      timeoutMs: remaining(deadlineMs, 25_000), maxBytes: bytesLeft, headers: { accept: "application/json" }
    });
    if (response.status >= 400) throw new Error(`Katalog Grenton: HTTP ${response.status}`);
    bytesLeft -= new TextEncoder().encode(response.content).byteLength;
    if (bytesLeft < 0) throw new Error("Katalog Grenton przekracza limit bajtów.");
    if (page === 1) {
      totalPages = Number(response.headers.get("x-wp-totalpages"));
      if (!Number.isSafeInteger(totalPages) || totalPages < 1) throw new Error("Katalog Grenton nie podał poprawnej liczby stron.");
      if (totalPages > GRENTON_MAX_PAGES) throw new Error(`Katalog Grenton przekracza limit stron (${GRENTON_MAX_PAGES}).`);
    }
    for (const candidate of parseGrentonStores(response.content, "Grenton", OFFICIAL_URLS.grenton)) {
      if (candidate.domain && !rows.has(candidate.domain)) rows.set(candidate.domain, candidate);
    }
  }
  return [...rows.values()];
}

type AmpioPoint = {
  name?: string; active?: boolean; is_polish_market?: boolean; country?: string;
  address?: { city?: string }; roles?: Array<{ role_slug?: string }>;
  contact_info?: { website?: string | null; phone?: string | null; email?: string | null } | null;
};
export function parseAmpioContactPage(html: string, sourceName: string, sourceUrl: string): DiscoveredCompany[] {
  const chunks: string[] = [];
  for (const match of html.matchAll(/self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)/g)) {
    try { chunks.push(JSON.parse(match[1]) as string); } catch { /* unrelated malformed RSC chunk */ }
  }
  const decoded = chunks.join("");
  const json = extractBalancedJson(decoded, '"contactPointsData":');
  if (!json) return [];
  const points = JSON.parse(json) as AmpioPoint[];
  const found = new Map<string, DiscoveredCompany>();
  for (const point of points) {
    const website = canonicalWebsite(point.contact_info?.website);
    const name = point.name?.trim();
    const installer = point.roles?.some((role) => role.role_slug === "installer");
    if (!point.active || !point.is_polish_market || !installer || !name || !website) continue;
    const domain = new URL(website).hostname.replace(/^www\./, "");
    found.set(domain, {
      name, website, domain, city: point.address?.city?.trim() || undefined, country: "PL",
      phone: publicPhone(point.contact_info?.phone), publicEmail: point.contact_info?.email?.trim() || undefined,
      partnershipLevels: ["Ampio Partner"], sourceName, sourceUrl
    });
  }
  return [...found.values()];
}

export type DirectoryConfig = { name: string; url?: string; enabled: boolean; parser?: (html: string) => DiscoveredCompany[] };
export type DirectoryKind = keyof typeof OFFICIAL_URLS | "generic";
export function classifyDirectoryKind(config: Pick<DirectoryConfig, "name" | "url">): DirectoryKind {
  const officialKinds = Object.keys(OFFICIAL_URLS) as Array<keyof typeof OFFICIAL_URLS>;
  const byName = officialKinds.find((kind) => config.name === OFFICIAL_NAMES[kind]);
  if (byName) return byName;
  if (!config.url) return "generic";
  let canonicalUrl: string;
  try { canonicalUrl = new URL(config.url).toString(); } catch { return "generic"; }
  return officialKinds.find((kind) => canonicalUrl === new URL(OFFICIAL_URLS[kind]).toString()) ?? "generic";
}
export class DirectoryConnector implements ResearchConnector {
  constructor(public config: DirectoryConfig) {}
  get name() { return this.config.name; }
  async discover(limit: number, deadlineMs?: number) {
    if (!this.config.enabled) return [];
    const kind = classifyDirectoryKind(this.config);
    let rows: DiscoveredCompany[];
    if (kind === "loxone") {
      const response = await fetchPublicText("https://www.loxone.com/dede/wp-json/loxone-partner-search/v1/partner-data", {
        timeoutMs: remaining(deadlineMs, 45_000), maxBytes: 12_000_000, maxRedirects: 0, method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: "lang=pl&use_miles=false&max_distance=200&mode=all"
      });
      if (response.status >= 400) throw new Error(`Katalog Loxone: HTTP ${response.status}`);
      rows = parseLoxonePartnerData(response.content, this.name, OFFICIAL_URLS.loxone);
    } else if (kind === "grenton") {
      rows = (await fetchGrentonDirectory(deadlineMs ?? Date.now() + 25_000))
        .map((candidate) => ({ ...candidate, sourceName: this.name }));
    } else if (kind === "ampio") {
      const response = await fetchPublicHtml(OFFICIAL_URLS.ampio, deadlineMs);
      if (response.status >= 400 || !response.content) throw new Error(`Katalog Ampio: HTTP ${response.status} lub brak HTML`);
      rows = parseAmpioContactPage(response.content, this.name, OFFICIAL_URLS.ampio);
    } else if (kind === "knx") {
      throw new Error("Katalog KNX nie publikuje stron WWW instalatorów; może służyć tylko do późniejszego potwierdzania certyfikacji.");
    } else {
      if (!this.config.url) return [];
      const response = await fetchPublicHtml(this.config.url, deadlineMs);
      if (response.status >= 400 || !response.content) throw new Error(`Katalog ${this.name}: HTTP ${response.status} lub brak HTML`);
      rows = this.config.parser ? this.config.parser(response.content) : parseGenericDirectory(response.content, this.config.url, this.name);
    }
    const result = rows.slice(0, limit);
    if (!result.length) throw new Error(`Katalog ${this.name}: nie znaleziono polskich instalatorów z własną stroną WWW.`);
    return result;
  }
}
