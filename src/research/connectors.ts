import { parseCsvCompanies, type CsvCompany } from "./parsers";
import * as cheerio from "cheerio";
import { fetchPublicHtml } from "./crawler";
export type DiscoveredCompany = CsvCompany & { sourceName: string; sourceUrl?: string };
export interface ResearchConnector { name: string; discover(limit: number, deadlineMs?: number): Promise<DiscoveredCompany[]> }
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
export type DirectoryConfig = { name: string; url?: string; enabled: boolean; parser?: (html: string) => DiscoveredCompany[] };
const NON_COMPANY_HOSTS = new Set(["facebook.com", "instagram.com", "linkedin.com", "youtube.com", "twitter.com", "x.com"]);
export function parseGenericDirectory(html: string, directoryUrl: string, sourceName: string): DiscoveredCompany[] {
  const $ = cheerio.load(html), directoryHost = new URL(directoryUrl).hostname.replace(/^www\./, "");
  const found = new Map<string, DiscoveredCompany>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href")?.trim(); if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) return;
    let url: URL; try { url = new URL(href, directoryUrl); } catch { return; }
    const host = url.hostname.replace(/^www\./, "");
    if (!/^https?:$/.test(url.protocol) || host === directoryHost || NON_COMPANY_HOSTS.has(host) || [...NON_COMPANY_HOSTS].some((x) => host.endsWith(`.${x}`))) return;
    const name = ($(el).attr("title") || $(el).find("img[alt]").attr("alt") || $(el).text()).replace(/\s+/g, " ").trim();
    if (name.length < 2 || name.length > 200 || /^(www|strona|website|więcej|zobacz|link)$/i.test(name)) return;
    const website = `${url.protocol}//${url.host}${url.pathname === "/" ? "/" : url.pathname}`;
    if (!found.has(host)) found.set(host, { name, website, domain: host, sourceName, sourceUrl: directoryUrl });
  });
  return [...found.values()];
}
export class DirectoryConnector implements ResearchConnector {
  constructor(public config: DirectoryConfig) {}
  get name() { return this.config.name; }
  async discover(limit: number, deadlineMs?: number) {
    if (!this.config.enabled || !this.config.url) return [];
    const response = await fetchPublicHtml(this.config.url, deadlineMs);
    if (response.status >= 400 || !response.content) throw new Error(`Katalog ${this.name}: HTTP ${response.status} lub brak HTML`);
    const rows = (this.config.parser ? this.config.parser(response.content) : parseGenericDirectory(response.content, this.config.url, this.name)).slice(0, limit);
    if (!rows.length) throw new Error(`Katalog ${this.name}: nie znaleziono jednoznacznych zewnętrznych linków firm.`);
    return rows;
  }
}
