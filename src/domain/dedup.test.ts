import { describe, expect, it } from "vitest";
import { findDuplicate, mergeCompany, normalizeDomain, normalizeName, normalizePhone } from "./dedup";

const companies: Array<{id:string;name:string;domain:string|null;nip:string|null;krs:string|null;normalizedPhone:string|null}> = [
  { id: "1", name: "Elektro Dom Sp. z o.o.", domain: "elektro.pl", nip: "1234567890", krs: null, normalizedPhone: "48111222333" }
];

describe("normalizacja i deduplikacja", () => {
  it("normalizuje domenę, telefon i polską nazwę prawną", () => {
    expect(normalizeDomain("https://WWW.ELEKTRO.pl/oferta")).toBe("elektro.pl");
    expect(normalizePhone("+48 111-222-333")).toBe("48111222333");
    expect(normalizePhone("+487****6450")).toBeNull();
    expect(normalizeName("Elektro-Dom Sp. z o.o.")).toBe("elektro dom");
  });
  it("wybiera domenę przed NIP/KRS i telefonem", () => {
    expect(findDuplicate({ name: "Inna", domain: "elektro.pl", nip: null, krs: null, normalizedPhone: null }, companies)?.id).toBe("1");
  });
  it("nie scala agresywnie krótkich lub różnych nazw", () => {
    expect(findDuplicate({ name: "Dom", domain: null, nip: null, krs: null, normalizedPhone: null }, companies)).toBeNull();
    expect(findDuplicate({ name: "Elektro Max", domain: null, nip: null, krs: null, normalizedPhone: null }, companies)).toBeNull();
  });
  it("scala pola komplementarne bez kasowania istniejących", () => {
    expect(mergeCompany<{name:string;city:string|null;phone:string|null}>({ name: "A", city: "Kraków", phone: null }, { name: "Nowa", city: null, phone: "123" })).toEqual({ name: "A", city: "Kraków", phone: "123" });
  });
});
