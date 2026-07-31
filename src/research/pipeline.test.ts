import { beforeEach, describe, expect, it, vi } from "vitest";

const queries: string[] = [];
let lockAllowed = true;
const query = vi.fn(async (sql: string) => {
  queries.push(sql);
  if (sql.includes("SELECT * FROM companies")) return { rows: [{
    id: "company-1", name: "Test", website: "https://example.com", domain: "example.com",
    city: null, region: null, score: 7, completeness: 80, manual_overrides: {}
  }] };
  if (sql.includes("INSERT INTO research_locks")) return { rows: lockAllowed ? [{ token: "lock-1" }] : [] };
  if (sql.includes("INSERT INTO research_runs")) return { rows: [{ id: "run-1" }] };
  return { rows: [] };
});

vi.mock("@/db/client", () => ({ getClient: () => ({ query }) }));
vi.mock("./crawler", () => ({ crawlWebsite: vi.fn(async () => ({
  pages: [], errors: [{ url: "https://example.com", message: "timeout" }]
})) }));

import { researchCompany, runBatch } from "./pipeline";

describe("bezpieczna aktualizacja researchu", () => {
  beforeEach(() => { queries.length = 0; query.mockClear(); lockAllowed = true; });

  it("nie usuwa wcześniejszych dowodów i nie zeruje firmy, gdy nie pobrano żadnej strony", async () => {
    await expect(researchCompany("company-1")).rejects.toThrow("zachowano wcześniejsze dane");
    expect(queries.some((sql) => sql.includes("UPDATE companies SET"))).toBe(false);
    expect(queries.some((sql) => sql.includes("evidence_type LIKE 'CRAWL_%'"))).toBe(false);
    expect(queries.some((sql) => sql.includes("status='FAILED'"))).toBe(true);
  });

  it("odrzuca równoległy research tej samej firmy", async () => {
    lockAllowed = false;
    await expect(researchCompany("company-1")).rejects.toThrow("już trwa");
    expect(queries.some((sql) => sql.includes("INSERT INTO research_runs"))).toBe(false);
  });

  it("przerywa oczekiwanie na konektor po wyczerpaniu budżetu", async () => {
    const started = Date.now();
    const result = await runBatch([{ name: "wiszący", discover: () => new Promise<never>(() => undefined) }], { budgetMs: 5_020 });
    expect(Date.now() - started).toBeLessThan(500);
    expect(result.discovered).toBe(0);
    expect(queries.some((sql) => sql.includes("CONNECTOR_ERROR"))).toBe(true);
  });
});
