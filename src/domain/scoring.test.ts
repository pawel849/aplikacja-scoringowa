import { describe, expect, it } from "vitest";
import { calculateScore, classifyLead } from "./scoring";

describe("deterministyczny scoring", () => {
  it("sumuje pięć kategorii i zachowuje uzasadnienia", () => {
    const result = calculateScore([
      { category: "TEAM", points: 2, rationale: "Dwie ekipy", evidenceIds: ["e1"] },
      { category: "COMPLEXITY", points: 2, rationale: "BMS", evidenceIds: ["e2"] },
      { category: "GROWTH", points: 1, rationale: "Partnerstwo", evidenceIds: ["e3"] },
      { category: "MARKETING", points: 1, rationale: "Formularz", evidenceIds: ["e4"] },
      { category: "MATURITY", points: 2, rationale: "Portfolio", evidenceIds: ["e5"] }
    ]);
    expect(result.score).toBe(8);
    expect(result.breakdown).toHaveLength(5);
  });
  it("odrzuca punkty spoza zakresu i brak dowodu dla dodatnich punktów", () => {
    expect(() => calculateScore([{ category: "TEAM", points: 3, rationale: "x", evidenceIds: ["e"] }])).toThrow();
    expect(() => calculateScore([{ category: "TEAM", points: 1, rationale: "x", evidenceIds: [] }])).toThrow(/dowodu/i);
  });
  it("uzupełnia brakujące kategorie zerami", () => {
    expect(calculateScore([]).breakdown).toHaveLength(5);
  });
});

describe("rekomendacja", () => {
  it.each([[7, 80, "PERSONAL_AUDIT"], [10, 50, "PERSONAL_AUDIT"], [4, 75, "QUALIFICATION_CALL"], [3, 100, "SKIP"]])(
    "score %i kompletność %i => %s", (score, completeness, expected) => expect(classifyLead(score, completeness)).toBe(expected)
  );
  it("niska kompletność zawsze wymaga dalszego researchu", () => {
    expect(classifyLead(10, 49)).toBe("NEEDS_MORE_RESEARCH");
  });
});
