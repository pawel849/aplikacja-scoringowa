import { describe, expect, it } from "vitest";
import { parseCsvCompanies, parsePublicPage } from "./parsers";

describe("parser CSV", () => {
  it("obsługuje polskie i kanoniczne nagłówki", () => {
    const rows = parseCsvCompanies("Nazwa firmy;Strona WWW;Telefon;Województwo\nTest;https://test.pl;+48 123;małopolskie");
    expect(rows[0]).toMatchObject({ name: "Test", website: "https://test.pl", phone: "+48 123", region: "małopolskie" });
  });
  it("odrzuca brak nazwy, nadmiar wierszy i zbyt duży plik", () => {
    expect(() => parseCsvCompanies("telefon\n123")).toThrow(/nazw/i);
    expect(() => parseCsvCompanies("name\n" + "x\n".repeat(1001))).toThrow(/1000/);
    expect(() => parseCsvCompanies("name\n" + "x".repeat(2_000_001))).toThrow(/MB/i);
  });
});

describe("parser strony publicznej", () => {
  it("wyciąga kontakty, technologie, role i bezpieczne fragmenty", () => {
    const parsed = parsePublicPage(`
      <html><head><title>Firma</title></head><body>
      <a href="mailto:biuro@example.pl">mail</a><a href="tel:+48123456789">tel</a>
      <p>Projektujemy systemy KNX i BMS. Prezes Jan Kowalski kieruje zespołem.</p>
      <a href="/realizacje">Realizacje</a></body></html>`, "https://example.pl");
    expect(parsed.emails).toContain("biuro@example.pl");
    expect(parsed.technologies).toEqual(expect.arrayContaining(["KNX", "BMS"]));
    expect(parsed.links).toContain("https://example.pl/realizacje");
    expect(parsed.text).not.toContain("<");
  });
  it("nie traktuje słowa reklama jako dowodu aktywnych reklam", () => {
    expect(parsePublicPage("<p>Pomagamy z reklamą</p>", "https://x.pl").signals.activeAds).toBe(false);
  });
  it("nie przyznaje sygnału zespołu na podstawie opinii „fachowa ekipa”", () => {
    const parsed = parsePublicPage(`<section class="testimonials"><blockquote>„Bardzo fachowa ekipa” — klient</blockquote></section>`, "https://inteli-home.pl/");
    expect(parsed.signals.team).toBe(false);
    expect(parsed.signals.twoCrews).toBe(false);
  });
  it("wymaga jawnego kontekstu wielu osób, współpracowników lub rekrutacji dla zespołu", () => {
    expect(parsePublicPage("<main><h2>Nasz zespół</h2><p>Anna — projektantka, Jan — instalator. Współpracujemy w pięcioosobowym zespole.</p></main>", "https://x.pl/o-nas").signals.team).toBe(true);
    expect(parsePublicPage("<main><h2>Kariera</h2><p>Dołącz do naszego zespołu — szukamy instalatora.</p></main>", "https://x.pl/kariera").signals.job).toBe(true);
  });
  it("wyciąga prawdziwy e-mail z tekstu i schema, odrzuca placeholdery oraz maskowane telefony", () => {
    const parsed = parsePublicPage(`<script type="application/ld+json">{"email":"schema@firma.pl","telephone":"+48 *** *** 123"}</script>
      <p>Napisz: kontakt@inteli-home.pl, instagram@intelihome.pl lub jan@example.com. Telefon: +48 12* *** **9</p>`, "https://inteli-home.pl/kontakt");
    expect(parsed.emails).toEqual(expect.arrayContaining(["kontakt@inteli-home.pl", "schema@firma.pl"]));
    expect(parsed.emails).not.toEqual(expect.arrayContaining(["jan@example.com", "instagram@intelihome.pl"]));
    expect(parsed.phones).toEqual([]);
  });
  it("wyciąga wyłącznie jawne fakty firmowe, partnerstwo i portfolio", () => {
    const parsed = parsePublicPage(`<html><head><meta name="description" content="Projektujemy i instalujemy automatykę budynkową w Krakowie."></head><body>
      <img alt="Loxone Silver Partner"><footer>INTELI sp. z o.o., NIP: 6761234567, KRS: 0000123456, 30-001 Kraków, małopolskie</footer>
      <a href="/realizacje/dom-a">Zobacz realizację</a></body></html>`, "https://firma.pl/o-nas");
    expect(parsed.facts).toMatchObject({ nip: "6761234567", krs: "0000123456", city: "Kraków", region: "małopolskie" });
    expect(parsed.facts.partnershipLevels).toContain("Loxone Silver Partner");
    expect(parsed.facts.portfolioUrls).toContain("https://firma.pl/realizacje/dom-a");
    expect(parsed.facts.serviceDescription).toMatch(/automatykę budynkową/i);
  });
  it("uznaje widoczny proces kontaktu bez elementu form i zachowuje URL strony", () => {
    const parsed = parsePublicPage("<main><h2>Zapytaj o wycenę</h2><p>Opisz inwestycję i zostaw wiadomość. Odpowiadamy w 24 godziny.</p></main>", "https://x.pl/kontakt");
    expect(parsed.signals.leadProcess).toBe(true);
    expect(parsed.pageUrl).toBe("https://x.pl/kontakt");
    expect(parsed.signalEvidence.marketing).toMatch(/wycenę/i);
  });
});
