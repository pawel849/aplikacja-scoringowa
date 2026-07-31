export const SCORE_CATEGORIES = ["TEAM", "COMPLEXITY", "GROWTH", "MARKETING", "MATURITY"] as const;
export type ScoreCategory = typeof SCORE_CATEGORIES[number];
export type BreakdownInput = { category: ScoreCategory; points: number; rationale: string; evidenceIds: string[] };

export function calculateScore(inputs: BreakdownInput[]) {
  const map = new Map(inputs.map((item) => [item.category, item]));
  for (const item of inputs) {
    if (!Number.isInteger(item.points) || item.points < 0 || item.points > 2) throw new Error("Punkty kategorii muszą mieścić się w zakresie 0–2.");
    if (item.points > 0 && item.evidenceIds.length === 0) throw new Error("Dodatnie punkty wymagają zapisanego dowodu.");
  }
  const breakdown = SCORE_CATEGORIES.map((category) => map.get(category) ?? ({ category, points: 0, rationale: "Brak publicznego dowodu", evidenceIds: [] }));
  return { score: breakdown.reduce((sum, item) => sum + item.points, 0), breakdown };
}

export function classifyLead(score: number, completeness: number) {
  if (completeness < 50) return "NEEDS_MORE_RESEARCH";
  if (score >= 7) return "PERSONAL_AUDIT";
  if (score >= 4) return "QUALIFICATION_CALL";
  return "SKIP";
}
