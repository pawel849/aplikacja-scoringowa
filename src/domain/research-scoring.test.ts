import { describe, expect, it } from "vitest";
import { calculateMaturitySignal } from "./research-scoring";

describe("dojrzałość oparta na unikalnych dowodach", () => {
  it("nie traktuje powtarzających się linków portfolio jako rozbudowanego portfolio", () => {
    expect(calculateMaturitySignal({
      portfolioUrls: ["https://firma.pl/realizacje", "https://firma.pl/realizacje", "https://firma.pl/realizacje#content"],
      partnershipLevels: ["Loxone Silver Partner"]
    })).toMatchObject({ points: 1, reason: "PORTFOLIO_OR_CREDENTIAL" });
  });

  it("przyznaje dwa punkty za co najmniej pięć unikalnych realizacji", () => {
    expect(calculateMaturitySignal({
      portfolioUrls: Array.from({ length: 5 }, (_, i) => `https://firma.pl/realizacje/${i + 1}`),
      partnershipLevels: []
    }).points).toBe(2);
  });

  it("przyznaje dwa punkty wyłącznie za jawnie wysoki status partnera", () => {
    expect(calculateMaturitySignal({ portfolioUrls: [], partnershipLevels: ["Loxone Gold Partner"] }).points).toBe(2);
    expect(calculateMaturitySignal({ portfolioUrls: [], partnershipLevels: ["Loxone Silver Partner"] }).points).toBe(1);
  });

  it("rozpoznaje znormalizowane poziomy live API Loxone", () => {
    expect(calculateMaturitySignal({ portfolioUrls: [], partnershipLevels: ["Loxone Gold Partner"] })).toMatchObject({ points: 2, reason: "HIGH_PARTNER_STATUS" });
    expect(calculateMaturitySignal({ portfolioUrls: [], partnershipLevels: ["Loxone Platinum Partner"] })).toMatchObject({ points: 2, reason: "HIGH_PARTNER_STATUS" });
    expect(calculateMaturitySignal({ portfolioUrls: [], partnershipLevels: ["Loxone Registered Partner"] }).points).toBe(1);
  });

  it("przyznaje dwa punkty za minimum 20 wiarygodnie ustalonych opinii", () => {
    expect(calculateMaturitySignal({ portfolioUrls: [], partnershipLevels: [], reviewCount: 20 }).points).toBe(2);
    expect(calculateMaturitySignal({ portfolioUrls: [], partnershipLevels: [], reviewCount: 10 }).points).toBe(1);
  });
});
