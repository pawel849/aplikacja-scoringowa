import { describe, expect, it } from "vitest";
import {
  classifyDirectoryKind,
  fetchGrentonDirectory,
  normalizeLoxonePartnerStatus,
  parseAmpioContactPage,
  parseGenericDirectory,
  parseGrentonStores,
  parseLoxonePartnerData
} from "./connectors";

describe("konserwatywny parser katalogu", () => {
  it("wybiera nazwane zewnętrzne strony firm i pomija nawigację oraz social media", () => {
    const rows = parseGenericDirectory(`<a href="/kontakt">Kontakt</a>
      <a href="https://firma-a.pl/"><img alt="Firma A"></a>
      <a href="https://facebook.com/firma">Facebook</a>
      <a href="https://firma-b.pl">Firma B Instalacje</a>`, "https://katalog.pl/partnerzy", "Katalog");
    expect(rows).toEqual([
      expect.objectContaining({ name: "Firma A", website: "https://firma-a.pl/", sourceName: "Katalog" }),
      expect.objectContaining({ name: "Firma B Instalacje", website: "https://firma-b.pl/" })
    ]);
  });
  it("odrzuca odnośniki producenta typu Kariera, sklep i kontakt", () => {
    const rows = parseGenericDirectory(`<a href="https://jobs.loxone.com/">Kariera w Loxone</a>
      <a href="https://shop.loxone.com/">Sklep</a>
      <a href="https://support.loxone.com/">Kontakt i wsparcie</a>
      <a href="https://partners.loxone.com/acme">Firma Acme</a>`, "https://www.loxone.com/plpl/", "Loxone");
    expect(rows).toEqual([]);
  });
  it("zwraca pustą listę, gdy brak jednoznacznych firm", () => {
    expect(parseGenericDirectory('<a href="/o-nas">O nas</a>', "https://katalog.pl", "Katalog")).toEqual([]);
  });
});

describe("oficjalne katalogi partnerów", () => {
  it("wybiera oficjalny parser tylko dla dokładnej nazwy lub kanonicznego URL", () => {
    expect(classifyDirectoryKind({ name: "Loxone" })).toBe("loxone");
    expect(classifyDirectoryKind({ name: "KNX" })).toBe("knx");
    expect(classifyDirectoryKind({ name: "Inny katalog", url: "https://www.loxone.com/plpl/sprzedaz/znajdz-partnera/" })).toBe("loxone");
    expect(classifyDirectoryKind({ name: "Katalog fanów Loxone", url: "https://example.com/loxone" })).toBe("generic");
    expect(classifyDirectoryKind({ name: "my-grenton-knx", url: "https://ampio.example.com/knx" })).toBe("generic");
  });

  it("normalizuje numeryczne kody poziomów Loxone do stabilnych etykiet", () => {
    expect(["GOLD23", "PLATIN27", "REG10", "REG15", "SILVER12"].map(normalizeLoxonePartnerStatus))
      .toEqual(["Gold", "Platinum", "Registered", "Registered", "Silver"]);
  });

  it("wybiera polskich partnerów Loxone mających własną stronę", () => {
    const rows = parseLoxonePartnerData(JSON.stringify({ success: true, data: { companies: {
      silver: [{ comp_name: "Firma PL", comp_country_code: "PL", comp_city: "Poznań", comp_website: "firma.pl", comp_partner_status: "SILVER" }],
      gold: [{ comp_name: "Bez WWW", comp_country_code: "PL", comp_city: "Kraków", comp_website: "" }],
      other: [{ comp_name: "Firma DE", comp_country_code: "DE", comp_website: "https://firma.de" }]
    } } }), "Loxone", "https://www.loxone.com/plpl/sprzedaz/znajdz-partnera/");
    expect(rows).toEqual([expect.objectContaining({ name: "Firma PL", website: "https://firma.pl/", city: "Poznań", country: "PL", partnershipLevels: ["Loxone Silver Partner"] })]);
  });

  it("pobiera wszystkie strony katalogu Grenton i zachowuje wspólny limit czasu oraz bajtów", async () => {
    const calls: Array<{ url: string; timeoutMs: number; maxBytes: number }> = [];
    const fetcher = async (input: string | URL, options: { timeoutMs: number; maxBytes: number }) => {
      const url = input.toString();
      calls.push({ url, timeoutMs: options.timeoutMs, maxBytes: options.maxBytes });
      const page = Number(new URL(url).searchParams.get("page"));
      return {
        status: 200,
        content: JSON.stringify([{ title: { rendered: `Firma ${page}` }, class_list: ["grenton-store-category-instalator-grenton"], acf: {
          website: `https://firma-${page}.pl`, map: { country_short: "PL" }
        } }]),
        contentType: "application/json", finalUrl: url,
        headers: new Headers(page === 1 ? { "x-wp-totalpages": "2" } : {})
      };
    };
    const rows = await fetchGrentonDirectory(Date.now() + 1_000, fetcher);
    expect(rows.map((row) => row.name)).toEqual(["Firma 1", "Firma 2"]);
    expect(calls.map((call) => new URL(call.url).searchParams.get("page"))).toEqual(["1", "2"]);
    expect(calls[1].maxBytes).toBeLessThan(calls[0].maxBytes);
    expect(calls.every((call) => call.timeoutMs > 0 && call.timeoutMs <= 1_000)).toBe(true);
  });

  it("odrzuca odpowiedź Grenton przekraczającą bezpieczny limit stron", async () => {
    const fetcher = async (input: string | URL) => ({
      status: 200, content: "[]", contentType: "application/json", finalUrl: input.toString(),
      headers: new Headers({ "x-wp-totalpages": "999" })
    });
    await expect(fetchGrentonDirectory(Date.now() + 1_000, fetcher)).rejects.toThrow("limit stron");
  });

  it("odrzuca wyniki Grenton, gdy późna strona zwraca błąd", async () => {
    const fetcher = async (input: string | URL) => {
      const page = Number(new URL(input.toString()).searchParams.get("page"));
      return {
        status: page === 2 ? 500 : 200,
        content: page === 1 ? "[]" : "awaria",
        contentType: "application/json", finalUrl: input.toString(),
        headers: new Headers({ "x-wp-totalpages": "2" })
      };
    };
    await expect(fetchGrentonDirectory(Date.now() + 1_000, fetcher)).rejects.toThrow("HTTP 500");
  });

  it("wybiera polskich instalatorów Grenton mających własną stronę", () => {
    const rows = parseGrentonStores(JSON.stringify([{ title: { rendered: "ControlTECH" }, class_list: ["grenton-store-category-instalator-grenton"], acf: {
      website: "https://controltech.net.pl/", map: { city: "Bochnia", state: "Województwo małopolskie", country_short: "PL" },
      "contact-data": [{ type: "phone", phone: "+48 123 456 789" }, { type: "email", email: "biuro@controltech.net.pl" }]
    } }]), "Grenton", "https://grenton.pl/dla-twojego-domu/mapa-znajdz-instalatora/");
    expect(rows).toEqual([expect.objectContaining({ name: "ControlTECH", website: "https://controltech.net.pl/", city: "Bochnia", region: "małopolskie", phone: "+48 123 456 789", publicEmail: "biuro@controltech.net.pl", partnershipLevels: ["Grenton Partner"] })]);
  });

  it("wybiera aktywnych polskich instalatorów Ampio z osadzonego RSC", () => {
    const payload = `7:{"contactPointsData":[{"name":"ADAMONET","country":"Polska","active":true,"address":{"city":"Rybnik"},"contact_info":{"website":"www.adamonet.pl","phone":"+486****9581","email":"biuro@adamonet.pl"},"roles":[{"role_slug":"installer"}],"is_polish_market":true},{"name":"Sklep","active":true,"contact_info":{"website":"sklep.pl"},"roles":[{"role_slug":"distributor"}],"is_polish_market":true}]}`;
    const html = `<script>self.__next_f.push([1,${JSON.stringify(payload)}])</script>`;
    const rows = parseAmpioContactPage(html, "Ampio", "https://ampio.com/pl/kontakt");
    expect(rows).toEqual([expect.objectContaining({ name: "ADAMONET", website: "https://www.adamonet.pl/", city: "Rybnik", country: "PL", publicEmail: "biuro@adamonet.pl", partnershipLevels: ["Ampio Partner"] })]);
    expect(rows[0].phone).toBeUndefined();
  });
});
