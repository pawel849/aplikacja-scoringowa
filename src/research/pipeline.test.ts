import { beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const queries: string[] = [];
let lockAllowed = true;
let queryImplementation: ((sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>) | undefined;
const query = vi.fn(async (sql: string, params?: unknown[]) => {
  if (queryImplementation) return queryImplementation(sql, params);
  void params;
  queries.push(sql);
  if (sql.includes("SELECT * FROM companies")) return { rows: params?.length === 5 ? [] : [{
    id: "company-1", name: "Test", website: "https://example.com", domain: "example.com",
    city: null, region: null, score: 7, completeness: 80, manual_overrides: {}
  }] };
  if (sql.includes("WITH inserted_company AS")) return { rows: [{ id: "new-company" }] };
  if (sql.includes("INSERT INTO research_locks")) return { rows: lockAllowed ? [{ token: "lock-1" }] : [] };
  if (sql.includes("INSERT INTO research_runs")) return { rows: [{ id: "run-1" }] };
  return { rows: [] };
});

vi.mock("@/db/client", () => ({ getClient: () => ({ query }) }));
vi.mock("./crawler", () => ({ crawlWebsite: vi.fn(async () => ({
  pages: [], errors: [{ url: "https://example.com", message: "timeout" }]
})) }));

import { clampBatchCandidateLimit, expandSelectedCandidateSources, mergePartnershipLevels, researchCompany, runBatch, selectBatchCandidates, upsertCandidate } from "./pipeline";

describe("bezpieczna aktualizacja researchu", () => {
  beforeEach(() => { queries.length = 0; query.mockClear(); lockAllowed = true; queryImplementation = undefined; });

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

  it("łączy statusy z witryny z audytowalnymi statusami z katalogów", () => {
    expect(mergePartnershipLevels(
      ["KNX Certified Partner"],
      [{ id: "evidence-1", excerpt: "Loxone GOLD Partner", source_url: "https://www.loxone.com/partnerzy" }]
    )).toEqual(["KNX Certified Partner", "Loxone GOLD Partner"]);
  });

  it("nie synchronizuje destrukcyjnie istniejącej firmy podczas batcha", async () => {
    const db = await partnershipDb();
    await db.query(`INSERT INTO companies(id,name,normalized_name,domain,website,partnership_levels,score,completeness)
      VALUES('00000000-0000-0000-0000-000000000001','Partner','partner','partner.pl','https://partner.pl','["Loxone Silver Partner"]',7,80)`);
    await db.query(`INSERT INTO evidence(company_id,scoring_category,source_url,excerpt,confidence,evidence_type,context)
      VALUES('00000000-0000-0000-0000-000000000001','FACT','https://loxone.example/directory','Loxone Silver Partner','HIGH','DIRECTORY_PARTNERSHIP','Loxone')`);
    queryImplementation = async (sql, params) => db.query(sql, params) as Promise<{ rows: unknown[] }>;

    const result = await runBatch([{ name: "Loxone", discover: async () => [{
      name: "Istniejący partner", website: "https://partner.pl", sourceName: "Loxone",
      sourceUrl: "https://www.loxone.com/plpl/sprzedaz/znajdz-partnera/",
      partnershipLevels: ["Loxone Gold Partner"]
    }] }], { maxCandidates: 15, budgetMs: 1_000 });

    expect(result.discovered).toBe(0);
    expect(result.checked).toBe(0);
    expect((await db.query<{ partnership_levels: string[]; score: number; completeness: number }>(
      "SELECT partnership_levels,score,completeness FROM companies WHERE domain='partner.pl'"
    )).rows[0]).toEqual({ partnership_levels: ["Loxone Silver Partner"], score: 7, completeness: 80 });
    expect((await db.query<{ excerpt: string }>("SELECT excerpt FROM evidence WHERE company_id='00000000-0000-0000-0000-000000000001'")).rows)
      .toEqual([{ excerpt: "Loxone Silver Partner" }]);
  });

  it("przerywa oczekiwanie na konektor po wyczerpaniu budżetu", async () => {
    const started = Date.now();
    const result = await runBatch([{ name: "wiszący", discover: () => new Promise<never>(() => undefined) }], { budgetMs: 120 });
    expect(Date.now() - started).toBeLessThan(110);
    expect(result.discovered).toBe(0);
    expect(queries.some((sql) => sql.includes("CONNECTOR_ERROR"))).toBe(true);
  });

  it("kończy discovery przed workDeadline i pozostawia czas na zapis oraz research", async () => {
    const started = Date.now();
    let receivedDeadline = 0;
    const result = await runBatch([{ name: "wolny", discover: async (_limit, deadline) => {
      receivedDeadline = deadline ?? 0;
      await new Promise((resolve) => setTimeout(resolve, 15));
      return [{ name: "Nowa firma", website: "https://nowa-firma.pl", sourceName: "wolny" }];
    } }], { budgetMs: 120, maxCandidates: 1 });
    expect(receivedDeadline).toBeLessThan(started + 110);
    expect(result.discovered).toBe(1);
    expect(queries.some((sql) => sql.includes("WITH inserted_company AS"))).toBe(true);
    expect(queries.some((sql) => sql.includes("INSERT INTO research_locks"))).toBe(true);
  });

  it("audytuje błąd późnej strony Grenton bez modyfikowania firm", async () => {
    await runBatch([{ name: "Grenton", discover: async () => {
      throw new Error("Katalog Grenton: HTTP 500 na stronie 2");
    } }], { budgetMs: 1_000 });
    expect(queries.some((sql) => sql.includes("DELETE FROM evidence") || sql.includes("UPDATE companies SET partnership_levels"))).toBe(false);
    expect(queries.some((sql) => sql.includes("CONNECTOR_ERROR"))).toBe(true);
  });
});

describe("atomowy zapis kandydata katalogowego", () => {
  beforeEach(() => { queries.length = 0; query.mockClear(); queryImplementation = undefined; });

  it("w trybie batcha nie modyfikuje firmy istniejącej przed jego rozpoczęciem", async () => {
    const db = await partnershipDb();
    await db.query(`INSERT INTO companies(id,name,normalized_name,domain,website,partnership_levels)
      VALUES('00000000-0000-0000-0000-000000000009','Istniejąca','ta sama nazwa',NULL,NULL,'[]')`);
    queryImplementation = async (sql, params) => db.query(sql, params) as Promise<{ rows: unknown[] }>;

    const result = await upsertCandidate({
      name: "Ta sama nazwa", website: "https://nowa-domena.pl", sourceName: "Loxone",
      sourceUrl: "https://loxone.example/directory", partnershipLevels: ["Loxone Gold Partner"]
    }, { mergeExistingIds: new Set() });

    expect(result.skipped).toBe(true);
    expect((await db.query<{ domain: string | null }>("SELECT domain FROM companies WHERE id='00000000-0000-0000-0000-000000000009'")).rows[0].domain).toBeNull();
    expect((await db.query("SELECT id FROM evidence WHERE company_id='00000000-0000-0000-0000-000000000009'")).rows).toEqual([]);
  });

  it("tworzy firmę i jej dowód w jednym zapytaniu CTE", async () => {
    const db = await partnershipDb();
    queryImplementation = async (sql, params) => db.query(sql, params) as Promise<{ rows: unknown[] }>;

    const saved = await upsertCandidate({
      name: "Nowy Partner", website: "https://nowy-partner.pl", sourceName: "Loxone",
      sourceUrl: "https://loxone.example/directory", partnershipLevels: ["Loxone Gold Partner"]
    });

    expect(saved.created).toBe(true);
    expect((await db.query<{ partnership_levels: string[] }>("SELECT partnership_levels FROM companies WHERE id=$1", [saved.id])).rows[0].partnership_levels)
      .toEqual(["Loxone Gold Partner"]);
    expect((await db.query<{ excerpt: string; context: string }>("SELECT excerpt,context FROM evidence WHERE company_id=$1", [saved.id])).rows)
      .toEqual([{ excerpt: "Loxone Gold Partner", context: "Loxone" }]);
    const writes = query.mock.calls.map((call) => String(call[0])).filter((sql) => /INSERT INTO companies|INSERT INTO evidence/.test(sql));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("WITH inserted_company AS");
    expect(writes[0]).toContain("INSERT INTO evidence");
  });

  it("wycofuje INSERT firmy, gdy zapis dowodu nie powiedzie się", async () => {
    const db = await partnershipDb();
    queryImplementation = async (sql, params) => db.query(sql, params) as Promise<{ rows: unknown[] }>;

    await expect(upsertCandidate({
      name: "Niedozwolony Partner", website: "https://rollback-insert.pl", sourceName: "Loxone",
      sourceUrl: "https://loxone.example/directory", partnershipLevels: ["REJECTED"]
    })).rejects.toThrow();
    expect((await db.query("SELECT id FROM companies WHERE domain='rollback-insert.pl'")).rows).toEqual([]);
  });

  it("scala firmę i podmienia tylko dowód oraz prefiks danego źródła w jednym CTE", async () => {
    const db = await partnershipDb();
    await db.query(`INSERT INTO companies(id,name,normalized_name,domain,website,partnership_levels)
      VALUES('00000000-0000-0000-0000-000000000002','Partner','partner','partner.pl','https://partner.pl','["Loxone Silver Partner","Grenton Partner","KNX Certified Partner"]')`);
    await db.query(`INSERT INTO evidence(company_id,scoring_category,source_url,excerpt,confidence,evidence_type,context) VALUES
      ('00000000-0000-0000-0000-000000000002','FACT','https://loxone.example/old','Loxone Silver Partner','HIGH','DIRECTORY_PARTNERSHIP','Loxone'),
      ('00000000-0000-0000-0000-000000000002','FACT','https://grenton.example','Grenton Partner','HIGH','DIRECTORY_PARTNERSHIP','Grenton'),
      ('00000000-0000-0000-0000-000000000002','FACT','https://other.example','Inny fakt','HIGH','OTHER','Loxone')`);
    queryImplementation = async (sql, params) => db.query(sql, params) as Promise<{ rows: unknown[] }>;

    const saved = await upsertCandidate({
      name: "Partner", website: "https://partner.pl", sourceName: "Loxone",
      sourceUrl: "https://loxone.example/new", partnershipLevels: ["Loxone Gold Partner"]
    });

    expect(saved).toEqual({ id: "00000000-0000-0000-0000-000000000002", created: false });
    expect((await db.query<{ partnership_levels: string[] }>("SELECT partnership_levels FROM companies WHERE id=$1", [saved.id])).rows[0].partnership_levels.sort())
      .toEqual(["Grenton Partner", "KNX Certified Partner", "Loxone Gold Partner"]);
    expect((await db.query<{ excerpt: string; evidence_type: string; context: string }>(
      "SELECT excerpt,evidence_type,context FROM evidence WHERE company_id=$1 ORDER BY excerpt", [saved.id]
    )).rows).toEqual([
      { excerpt: "Grenton Partner", evidence_type: "DIRECTORY_PARTNERSHIP", context: "Grenton" },
      { excerpt: "Inny fakt", evidence_type: "OTHER", context: "Loxone" },
      { excerpt: "Loxone Gold Partner", evidence_type: "DIRECTORY_PARTNERSHIP", context: "Loxone" }
    ]);
    const mergeWrites = query.mock.calls.map((call) => String(call[0])).filter((sql) => sql.includes("UPDATE companies"));
    expect(mergeWrites).toHaveLength(1);
    expect(mergeWrites[0]).toContain("INSERT INTO evidence");
  });

  it("wycofuje merge oraz usunięcie starego dowodu, gdy nowy dowód jest błędny", async () => {
    const db = await partnershipDb();
    await db.query(`INSERT INTO companies(id,name,normalized_name,domain,website,partnership_levels)
      VALUES('00000000-0000-0000-0000-000000000003','Partner','partner','rollback-merge.pl','https://rollback-merge.pl','["Loxone Silver Partner"]')`);
    await db.query(`INSERT INTO evidence(company_id,scoring_category,source_url,excerpt,confidence,evidence_type,context)
      VALUES('00000000-0000-0000-0000-000000000003','FACT','https://loxone.example/old','Loxone Silver Partner','HIGH','DIRECTORY_PARTNERSHIP','Loxone')`);
    queryImplementation = async (sql, params) => db.query(sql, params) as Promise<{ rows: unknown[] }>;

    await expect(upsertCandidate({
      name: "Partner", website: "https://rollback-merge.pl", sourceName: "Loxone",
      sourceUrl: "https://loxone.example/new", partnershipLevels: ["REJECTED"]
    })).rejects.toThrow();
    expect((await db.query<{ partnership_levels: string[] }>("SELECT partnership_levels FROM companies WHERE domain='rollback-merge.pl'")).rows[0].partnership_levels)
      .toEqual(["Loxone Silver Partner"]);
    expect((await db.query<{ excerpt: string }>("SELECT excerpt FROM evidence WHERE company_id='00000000-0000-0000-0000-000000000003'")).rows)
      .toEqual([{ excerpt: "Loxone Silver Partner" }]);
  });

  it("respektuje manual_overrides poziomów partnerstwa", async () => {
    const db = await partnershipDb();
    await db.query(`INSERT INTO companies(id,name,normalized_name,domain,website,partnership_levels,manual_overrides)
      VALUES('00000000-0000-0000-0000-000000000004','Partner','partner','manual.pl','https://manual.pl','["Wartość ręczna"]','{"partnershipLevels":true}')`);
    queryImplementation = async (sql, params) => db.query(sql, params) as Promise<{ rows: unknown[] }>;

    await upsertCandidate({
      name: "Partner", website: "https://manual.pl", sourceName: "Loxone",
      sourceUrl: "https://loxone.example/new", partnershipLevels: ["Loxone Gold Partner"]
    });
    expect((await db.query<{ partnership_levels: string[] }>("SELECT partnership_levels FROM companies WHERE domain='manual.pl'")).rows[0].partnership_levels)
      .toEqual(["Wartość ręczna"]);
  });

  it("po konflikcie INSERT ponownie znajduje firmę i wykonuje atomowy merge z dowodem", async () => {
    let lookups = 0;
    queryImplementation = async (sql) => {
      if (sql.includes("SELECT * FROM companies")) {
        lookups++;
        return { rows: lookups === 1 ? [] : [{ id: "race-company" }] };
      }
      if (sql.includes("WITH inserted_company AS")) return { rows: [] };
      if (sql.includes("WITH updated_company AS")) {
        expect(sql).toContain("DELETE FROM evidence");
        expect(sql).toContain("INSERT INTO evidence");
        return { rows: [{ id: "race-company" }] };
      }
      return { rows: [] };
    };

    await expect(upsertCandidate({
      name: "Race Partner", website: "https://race.pl", sourceName: "Loxone",
      sourceUrl: "https://loxone.example/directory", partnershipLevels: ["Loxone Gold Partner"]
    })).resolves.toEqual({ id: "race-company", created: false });
    expect(lookups).toBe(2);
  });
});

async function partnershipDb() {
  const db = new PGlite();
  await db.exec(`
    CREATE TYPE confidence AS ENUM ('LOW','MEDIUM','HIGH');
    CREATE TABLE companies (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, normalized_name text NOT NULL,
      domain text UNIQUE, website text, country text NOT NULL DEFAULT 'PL', region text, city text,
      phone text, normalized_phone text, public_email text, nip text UNIQUE, krs text UNIQUE,
      source_names jsonb NOT NULL DEFAULT '[]', source_urls jsonb NOT NULL DEFAULT '[]',
      partnership_levels jsonb NOT NULL DEFAULT '[]', manual_overrides jsonb NOT NULL DEFAULT '{}',
      score integer NOT NULL DEFAULT 0, completeness integer NOT NULL DEFAULT 0, recommendation text,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE evidence (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id),
      scoring_category text NOT NULL, awarded_points integer NOT NULL DEFAULT 0, source_url text NOT NULL,
      excerpt text NOT NULL CHECK(excerpt <> 'REJECTED'), confidence confidence NOT NULL, evidence_type text NOT NULL, context text,
      found_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE research_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type text, status text, completed_at timestamptz, stats jsonb
    );
    CREATE TABLE research_errors (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid, source_name text, code text, message text, retryable boolean
    );
  `);
  return db;
}

describe("wybór firm do batcha", () => {
  it("wymusza twardy limit od 0 do 15 kandydatów", () => {
    expect(clampBatchCandidateLimit(99)).toBe(15);
    expect(clampBatchCandidateLimit(7.9)).toBe(7);
    expect(clampBatchCandidateLimit(-3)).toBe(0);
  });

  it("zwraca wyłącznie nowe domeny, nawet gdy nie wypełniają limitu", () => {
    const selected = selectBatchCandidates([{ sourceName: "Katalog", candidates: [
      { name: "Nowa", website: "https://nowa.pl", sourceName: "Katalog" },
      { name: "Znana 1", website: "https://znana-1.pl", sourceName: "Katalog" },
      { name: "Znana 2", website: "https://znana-2.pl", sourceName: "Katalog" }
    ] }], new Set(["znana-1.pl", "znana-2.pl"]), 3);
    expect(selected.map((row) => row.name)).toEqual(["Nowa"]);
  });

  it("pomija znane domeny i przeplata firmy z różnych katalogów", () => {
    const selected = selectBatchCandidates([
      { sourceName: "Ampio", candidates: [
        { name: "Znana", website: "https://znana.pl", sourceName: "Ampio" },
        { name: "Ampio 1", website: "https://ampio-1.pl", sourceName: "Ampio" },
        { name: "Ampio 2", website: "https://ampio-2.pl", sourceName: "Ampio" }
      ] },
      { sourceName: "Grenton", candidates: [
        { name: "Grenton 1", website: "https://grenton-1.pl", sourceName: "Grenton" },
        { name: "Grenton 2", website: "https://grenton-2.pl", sourceName: "Grenton" }
      ] }
    ], new Set(["znana.pl"]), 3);
    expect(selected.map((row) => row.name)).toEqual(["Ampio 1", "Grenton 1", "Ampio 2"]);
  });

  it("nie wybiera drugi raz tej samej domeny, ale zachowuje metadane ze wszystkich katalogów", () => {
    const groups = [
      { sourceName: "Loxone", candidates: [{ name: "Firma L", website: "https://firma.pl", sourceName: "Loxone", partnershipLevels: ["Loxone Partner"] }] },
      { sourceName: "Grenton", candidates: [{ name: "Firma G", website: "https://www.firma.pl/", sourceName: "Grenton", partnershipLevels: ["Grenton Partner"] }] }
    ];
    const selected = selectBatchCandidates(groups, new Set(), 15);
    expect(selected).toHaveLength(1);
    expect(expandSelectedCandidateSources(selected, groups).map((row) => row.sourceName)).toEqual(["Loxone", "Grenton"]);
  });
});
