import { describe, expect, it } from "vitest";
import { parseGenericDirectory } from "./connectors";

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
  it("zwraca pustą listę, gdy brak jednoznacznych firm", () => {
    expect(parseGenericDirectory('<a href="/o-nas">O nas</a>', "https://katalog.pl", "Katalog")).toEqual([]);
  });
});
