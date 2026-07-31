export type MaturitySignalInput = {
  portfolioUrls: string[];
  partnershipLevels: string[];
  reviewCount?: number | null;
};

export type MaturitySignal = {
  points: 0 | 1 | 2;
  reason: "NONE" | "PORTFOLIO_OR_CREDENTIAL" | "EXPANDED_PORTFOLIO" | "HIGH_PARTNER_STATUS" | "REVIEWS_10_19" | "REVIEWS_20_PLUS";
  uniquePortfolioUrls: string[];
};

function normalizeEvidenceUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim();
  }
}

export function calculateMaturitySignal(input: MaturitySignalInput): MaturitySignal {
  const uniquePortfolioUrls = [...new Set(input.portfolioUrls.map(normalizeEvidenceUrl).filter(Boolean))];
  const reviewCount = input.reviewCount ?? null;

  if (reviewCount !== null && reviewCount >= 20) return { points: 2, reason: "REVIEWS_20_PLUS", uniquePortfolioUrls };
  if (input.partnershipLevels.some((level) => /\b(gold|platinum|najwyższy|highest)\b/i.test(level))) {
    return { points: 2, reason: "HIGH_PARTNER_STATUS", uniquePortfolioUrls };
  }
  if (uniquePortfolioUrls.length >= 5) return { points: 2, reason: "EXPANDED_PORTFOLIO", uniquePortfolioUrls };
  if (reviewCount !== null && reviewCount >= 10) return { points: 1, reason: "REVIEWS_10_19", uniquePortfolioUrls };
  if (uniquePortfolioUrls.length > 0 || input.partnershipLevels.length > 0) {
    return { points: 1, reason: "PORTFOLIO_OR_CREDENTIAL", uniquePortfolioUrls };
  }
  return { points: 0, reason: "NONE", uniquePortfolioUrls };
}
