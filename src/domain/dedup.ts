export type Candidate = { id?: string; name: string; domain?: string | null; nip?: string | null; krs?: string | null; normalizedPhone?: string | null };

export function normalizeDomain(input?: string | null) {
  if (!input) return null;
  try {
    const url = new URL(input.includes("://") ? input : `https://${input}`);
    return url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  } catch { return input.toLowerCase().replace(/^www\./, "").split("/")[0] || null; }
}
export function normalizePhone(value?: string | null) {
  if (!value || /[*•]|x{2,}/i.test(value)) return null;
  const digits = value.replace(/\D/g, "");
  if (!digits) return null;
  return digits.length === 9 ? `48${digits}` : digits;
}
export function normalizeName(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\b(sp z o o|spolka z ograniczona odpowiedzialnoscia|s a|sa|firma|phu)\b/g, "").replace(/\s+/g, " ").trim();
}
export function findDuplicate<T extends Candidate>(candidate: Candidate, existing: T[]): T | null {
  const domain = normalizeDomain(candidate.domain);
  if (domain) { const match = existing.find((x) => normalizeDomain(x.domain) === domain); if (match) return match; }
  for (const key of ["nip", "krs", "normalizedPhone"] as const) {
    const value = candidate[key]?.replace(/\D/g, "");
    if (value) { const match = existing.find((x) => x[key]?.replace(/\D/g, "") === value); if (match) return match; }
  }
  const normalized = normalizeName(candidate.name);
  if (normalized.length >= 8) {
    const match = existing.find((x) => normalizeName(x.name) === normalized);
    if (match) return match;
  }
  return null;
}
export function mergeCompany<T extends Record<string, unknown>>(oldValue: T, incoming: Partial<T>): T {
  const merged = { ...oldValue };
  for (const [key, value] of Object.entries(incoming)) if ((merged[key] === null || merged[key] === undefined || merged[key] === "") && value !== null && value !== undefined && value !== "") merged[key as keyof T] = value as T[keyof T];
  return merged;
}
