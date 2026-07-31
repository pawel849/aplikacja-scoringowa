import * as cheerio from "cheerio";
import { parse } from "csv-parse/sync";

const HEADERS: Record<string, string> = {
  "nazwa firmy": "name", nazwa: "name", name: "name", "strona www": "website", strona: "website", website: "website",
  domena: "domain", domain: "domain", telefon: "phone", phone: "phone", email: "publicEmail", "e-mail": "publicEmail",
  nip: "nip", krs: "krs", województwo: "region", wojewodztwo: "region", region: "region", miasto: "city", city: "city",
  kraj: "country", country: "country", źródło: "sourceName", zrodlo: "sourceName", source: "sourceName", "url źródła": "sourceUrl", sourceurl: "sourceUrl"
};

export type CsvCompany = { name: string; website?: string; domain?: string; phone?: string; publicEmail?: string; nip?: string; krs?: string; region?: string; city?: string; country?: string; sourceName?: string; sourceUrl?: string };
export function parseCsvCompanies(content: string): CsvCompany[] {
  if (Buffer.byteLength(content, "utf8") > 2_000_000) throw new Error("Plik CSV przekracza limit 2 MB.");
  const first = content.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  const raw = parse(content, { columns: true, delimiter, skip_empty_lines: true, trim: true, bom: true, relax_column_count: false }) as Record<string, string>[];
  if (raw.length > 1000) throw new Error("CSV może zawierać maksymalnie 1000 wierszy.");
  const rows = raw.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [HEADERS[key.toLowerCase().trim()] ?? key, value.trim()])) as CsvCompany);
  if (!rows.length || rows.some((row) => !row.name)) throw new Error("Każdy wiersz musi zawierać nazwę firmy.");
  return rows;
}

export function parsePublicPage(html: string, pageUrl: string) {
  const $ = cheerio.load(html);
  const structured: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const value = JSON.parse($(el).text());
      const walk = (x: unknown) => {
        if (typeof x === "string") structured.push(x);
        else if (Array.isArray(x)) x.forEach(walk);
        else if (x && typeof x === "object") Object.values(x).forEach(walk);
      };
      walk(value);
    } catch { /* malformed third-party JSON-LD is ignored */ }
  });
  const metaText = $("meta[name=description],meta[property='og:description']").map((_, el) => $(el).attr("content") ?? "").get();
  const altText = $("img[alt]").map((_, el) => $(el).attr("alt") ?? "").get();
  const $score = cheerio.load($.html());
  $score("blockquote,q,.testimonial,.testimonials,.review,.reviews,[class*='testimonial'],[class*='opini']").remove();
  $score("script,style,noscript,svg").remove();
  $("script,style,noscript,svg").remove();
  const visibleText = $("body").text().replace(/\s+/g, " ").trim();
  const text = [visibleText, ...metaText, ...altText, ...structured].join(" ").replace(/\s+/g, " ").trim().slice(0, 50_000);
  const scoringText = $score("body").text().replace(/\s+/g, " ").trim().slice(0, 50_000);
  const emails = new Set<string>(), phones = new Set<string>(), links = new Set<string>();
  const validEmail = (raw: string) => {
    const email = raw.trim().replace(/[),.;:]+$/, "").toLowerCase();
    if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) return;
    if (/(^|\.)(example\.(com|org|net))$/i.test(email.split("@")[1]) || /^(jan|john\.doe)@example/i.test(email)) return;
    if (/^(instagram|facebook|youtube|linkedin|tiktok)@/i.test(email)) return;
    emails.add(email);
  };
  const validPhone = (raw: string) => {
    if (raw.includes("*") || /[xX•]/.test(raw)) return;
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 9 || digits.length > 15) return;
    phones.add(raw.trim());
  };
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (href.startsWith("mailto:")) validEmail(href.slice(7).split("?")[0]);
    else if (href.startsWith("tel:")) validPhone(href.slice(4));
    else try { links.add(new URL(href, pageUrl).toString()); } catch { /* invalid public link */ }
  });
  for (const match of text.matchAll(/\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)) validEmail(match[0]);
  for (const match of text.matchAll(/(?:\b(?:telefon|tel\.?)\s*:?\s*|\+)(\+?\d[\d *()•-]{7,}\d)/gi)) validPhone(match[0].replace(/^(?:telefon|tel\.?)\s*:?\s*/i, ""));
  const technologies = ["KNX", "BMS", "Loxone", "Grenton", "Ampio", "Home Assistant", "Modbus", "DALI"].filter((tech) => new RegExp(`\\b${tech.replace(" ", "\\s+")}\\b`, "i").test(text));
  const excerpts = technologies.map((technology) => {
    const index = text.toLowerCase().indexOf(technology.toLowerCase());
    return { type: "TECHNOLOGY", description: text.slice(Math.max(0, index - 90), index + technology.length + 140), technology };
  });
  const excerpt = (pattern: RegExp, haystack = scoringText) => {
    const match = pattern.exec(haystack);
    return match ? haystack.slice(Math.max(0, match.index - 100), Math.min(haystack.length, match.index + match[0].length + 180)) : "";
  };
  const jobPattern = /\b(kariera|rekrutujemy|dołącz do (nas|zespołu)|oferta pracy|szukamy (instalatora|pracownika|projektanta))\b/i;
  const teamPattern = /\b(nasz zespół|poznaj zespół|zespół (?:składa się|tworzą|specjalistów)|współpracownicy|współpracujemy w .{0,30}zespole)\b/i;
  const twoCrewsPattern = /\b(dwie|2|kilka) (ekipy|zespoły)\b|(?:team lead|kierownik projektu|project manager).{0,100}(?:instalator|ekipa|wykonaw)/i;
  const marketingPattern = /\b(zapytaj o wycenę|poproś o wycenę|wyślij (?:nam )?wiadomość|zostaw wiadomość|opisz (?:inwestycję|projekt)|(?:odpowiadamy|odpiszemy) w (?:ciągu )?\d+|formularz kontaktowy)\b/i;
  const nip = text.match(/\bNIP\s*[:#]?\s*(\d[\d -]{8,12}\d)\b/i)?.[1].replace(/\D/g, "");
  const krs = text.match(/\bKRS\s*[:#]?\s*(\d{10})\b/i)?.[1];
  const city = text.match(/\b\d{2}-\d{3}\s+([A-ZĄĆĘŁŃÓŚŹŻ][A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż -]{2,40})/)?.[1].replace(/\s+(woj|NIP|REGON|KRS|Tel).*$/i, "").trim();
  const region = text.match(/\b(dolnośląskie|kujawsko-pomorskie|lubelskie|lubuskie|łódzkie|małopolskie|mazowieckie|opolskie|podkarpackie|podlaskie|pomorskie|śląskie|świętokrzyskie|warmińsko-mazurskie|wielkopolskie|zachodniopomorskie)\b/i)?.[1];
  const partnershipLevels = [...new Set([...text.matchAll(/\b(Loxone|KNX|Grenton|Ampio)\s+(Silver|Gold|Platinum|Certified|Autoryzowany)?\s*Partner\b/gi)].map((m) => m[0].replace(/\s+/g, " ").trim()))];
  const portfolioUrls = [...links].filter((url) => /\/(realizacje?|portfolio|projekty?)(\/|$)/i.test(new URL(url).pathname));
  const description = metaText.find((x) => /\b(projekt|instal|automat|smart|BMS|KNX)\w*/i.test(x))
    || excerpt(/\b(projektujemy|instalujemy|specjalizujemy się|oferujemy|automatyka budynkowa)\b/i, visibleText);
  const leadProcess = marketingPattern.test(scoringText);
  return { pageUrl, title: $("title").text().trim().slice(0, 200), text, emails: [...emails], phones: [...phones], links: [...links], technologies, excerpts,
    facts: { nip: nip?.length === 10 ? nip : undefined, krs, city, region, serviceDescription: description?.slice(0, 500), partnershipLevels, portfolioUrls },
    signalEvidence: {
      team: excerpt(teamPattern), twoCrews: excerpt(twoCrewsPattern), job: excerpt(jobPattern),
      marketing: excerpt(marketingPattern),
      portfolio: excerpt(/\b(realizacje|portfolio|nasze projekty)\b/i),
      partnership: excerpt(/\b(Loxone|KNX|Grenton|Ampio)\s+(?:Silver|Gold|Platinum|Certified|Autoryzowany)?\s*Partner\b/i, text),
      comprehensive: excerpt(/\b(projekt\w*|montaż\w*|uruchom\w*|serwis\w*)\b/i),
      premium: excerpt(/\b(KNX|BMS|deweloper|komercyjn|showroom)\b/i)
    }, signals: {
    job: jobPattern.test(scoringText),
    team: teamPattern.test(scoringText),
    twoCrews: twoCrewsPattern.test(scoringText),
    portfolio: /\b(realizacje|portfolio|nasze projekty)\b/i.test(scoringText) || portfolioUrls.length > 0,
    comprehensive: /\b(projekt\w*|montaż\w*|uruchom\w*|serwis\w*)\b/i.test(scoringText),
    premium: /\b(KNX|BMS|deweloper|komercyjn|showroom)\b/i.test(scoringText),
    leadForm: $("form").length > 0,
    leadProcess,
    activeAds: false
  }};
}
