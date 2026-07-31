import { getClient } from "@/db/client";
import { calculateScore, classifyLead, type BreakdownInput, SCORE_CATEGORIES } from "@/domain/scoring";
import { normalizeDomain, normalizeName, normalizePhone } from "@/domain/dedup";
import { calculateMaturitySignal } from "@/domain/research-scoring";
import { crawlWebsite } from "./crawler";
import type { DiscoveredCompany, ResearchConnector } from "./connectors";

type CompanyRow = { id: string; name: string; website: string | null; domain: string | null; city: string | null; region: string | null; score: number; completeness: number; manual_overrides: Record<string, unknown> };
export async function upsertCandidate(c: DiscoveredCompany) {
  const db = getClient(), domain = normalizeDomain(c.domain || c.website), phone = normalizePhone(c.phone);
  const match = await db.query<CompanyRow>("SELECT * FROM companies WHERE ($1::text IS NOT NULL AND domain=$1) OR ($2::text IS NOT NULL AND nip=$2) OR ($3::text IS NOT NULL AND krs=$3) OR ($4::text IS NOT NULL AND normalized_phone=$4) OR (normalized_name=$5 AND length($5)>=8) LIMIT 1", [domain, c.nip || null, c.krs || null, phone, normalizeName(c.name)]);
  if (match.rows[0]) {
    await db.query("UPDATE companies SET website=COALESCE(website,$2),phone=COALESCE(phone,$3),normalized_phone=COALESCE(normalized_phone,$4),public_email=COALESCE(public_email,$5),region=COALESCE(region,$6),city=COALESCE(city,$7),source_names=(SELECT jsonb_agg(DISTINCT x) FROM jsonb_array_elements_text(source_names||$8::jsonb) x),source_urls=(SELECT jsonb_agg(DISTINCT x) FROM jsonb_array_elements_text(source_urls||$9::jsonb) x),updated_at=now() WHERE id=$1", [match.rows[0].id, c.website || null, c.phone || null, phone, c.publicEmail || null, c.region || null, c.city || null, JSON.stringify([c.sourceName]), JSON.stringify(c.sourceUrl ? [c.sourceUrl] : [])]);
    return { id: match.rows[0].id, created: false };
  }
  const inserted = await db.query<{ id: string }>("INSERT INTO companies(name,normalized_name,domain,website,country,region,city,phone,normalized_phone,public_email,nip,krs,source_names,source_urls) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id", [c.name, normalizeName(c.name), domain, c.website || null, c.country || "PL", c.region || null, c.city || null, c.phone || null, phone, c.publicEmail || null, c.nip || null, c.krs || null, JSON.stringify([c.sourceName]), JSON.stringify(c.sourceUrl ? [c.sourceUrl] : [])]);
  return { id: inserted.rows[0].id, created: true };
}
export async function researchCompany(companyId: string, parentRunId?: string) {
  const db = getClient();
  const company = (await db.query<CompanyRow>("SELECT * FROM companies WHERE id=$1", [companyId])).rows[0];
  if (!company) throw new Error("Nie znaleziono firmy.");
  if (!company.website) throw new Error("Firma nie ma strony WWW.");
  const ownedRun = !parentRunId;
  const run = parentRunId ? { id: parentRunId } : (await db.query<{ id: string }>("INSERT INTO research_runs(type,status) VALUES('RECHECK','RUNNING') RETURNING id")).rows[0];
  try {
  const crawl = await crawlWebsite(company.website);
  await db.query("DELETE FROM evidence WHERE company_id=$1 AND evidence_type LIKE 'CRAWL_%'", [companyId]);
  const tech = [...new Set(crawl.pages.flatMap((p) => p.technologies))];
  const emails = [...new Set(crawl.pages.flatMap((p) => p.emails))].sort((a,b) => Number(/^(kontakt|biuro|office|info)@/i.test(b))-Number(/^(kontakt|biuro|office|info)@/i.test(a)));
  const phones = [...new Set(crawl.pages.flatMap((p) => p.phones))];
  const evidenceIds: Record<string, string[]> = Object.fromEntries(SCORE_CATEGORIES.map((x) => [x, []]));
  const addEvidence = async (category: string, points: number, excerpt: string, sourceUrl: string, type: string, confidence = "MEDIUM") => {
    const row = await db.query<{ id: string }>("INSERT INTO evidence(company_id,scoring_category,awarded_points,source_url,excerpt,confidence,evidence_type) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id", [companyId, category, points, sourceUrl, excerpt.slice(0, 500), confidence, type]);
    evidenceIds[category].push(row.rows[0].id);
  };
  const facts = crawl.pages.map((p) => p.facts);
  const first = <K extends keyof typeof facts[number]>(key: K) => facts.map((x) => x[key]).find((x) => Array.isArray(x) ? x.length : Boolean(x));
  const rawPortfolios = facts.flatMap((x) => x.portfolioUrls);
  const partnerships = [...new Set(facts.flatMap((x) => x.partnershipLevels))];
  const maturitySignal = calculateMaturitySignal({ portfolioUrls: rawPortfolios, partnershipLevels: partnerships });
  const portfolios = maturitySignal.uniquePortfolioUrls.slice(0, 30);
  const findPage = (test: (p: typeof crawl.pages[number]) => boolean) => crawl.pages.find(test);
  const teamPage = findPage((p) => p.signals.twoCrews) || findPage((p) => p.signals.team || p.signals.job);
  const complexityPage = findPage((p) => p.signals.premium) || findPage((p) => p.signals.comprehensive && p.signals.portfolio);
  const growthPage = findPage((p) => p.signals.job);
  const marketingPage = findPage((p) => p.signals.leadProcess);
  const maturityPage = maturitySignal.reason === "HIGH_PARTNER_STATUS"
    ? findPage((p) => p.facts.partnershipLevels.some((level) => /\b(gold|platinum|najwyższy|highest)\b/i.test(level)))
    : findPage((p) => p.signals.portfolio || p.facts.partnershipLevels.length > 0);
  const team = teamPage?.signals.twoCrews ? 2 : teamPage ? 1 : 0;
  const complexity = complexityPage?.signals.premium ? 2 : complexityPage ? 1 : 0;
  const growth = growthPage ? (/\b(obecnie|aktualnie|202[5-9])\b/i.test(growthPage.text) ? 2 : 1) : 0;
  const marketing = marketingPage ? 1 : 0;
  const maturity = maturitySignal.points;
  const maturityEvidenceKey: keyof NonNullable<typeof maturityPage>["signalEvidence"] =
    maturitySignal.reason === "HIGH_PARTNER_STATUS" || (portfolios.length === 0 && partnerships.length > 0) ? "partnership" : "portfolio";
  const pointPairs: [string, number, typeof teamPage, keyof NonNullable<typeof teamPage>["signalEvidence"], string][] = [
    ["TEAM", team, teamPage, teamPage?.signals.twoCrews ? "twoCrews" : teamPage?.signals.job ? "job" : "team", "Sygnał zespołu"],
    ["COMPLEXITY", complexity, complexityPage, complexityPage?.signals.premium ? "premium" : "comprehensive", "Zakres i złożoność"],
    ["GROWTH", growth, growthPage, "job", "Sygnał wzrostu"],
    ["MARKETING", marketing, marketingPage, "marketing", "Proces zapytania"],
    ["MATURITY", maturity, maturityPage, maturityEvidenceKey, "Wiarygodność"]
  ];
  for (const [category, points, page, evidenceKey, fallback] of pointPairs) if (points > 0 && page) await addEvidence(category, points, page.signalEvidence[evidenceKey] || fallback, page.pageUrl, `CRAWL_${category}`);
  const breakdown: BreakdownInput[] = pointPairs.map(([category, points]) => ({ category: category as BreakdownInput["category"], points, rationale: points ? `Publiczny sygnał: ${pointPairs.find((x) => x[0] === category)?.[3]}.` : "Brak publicznego dowodu.", evidenceIds: evidenceIds[category] }));
  const result = calculateScore(breakdown);

  const locationKnown = Boolean(first("city") || first("region") || company.city || company.region);
  const credibility = Boolean(partnerships.length || maturity > 0);
  const coverage = [Boolean(company.name && (company.domain || company.website)), Boolean(emails.length || phones.length), locationKnown,
    Boolean(first("serviceDescription")), tech.length > 0, portfolios.length > 0, team > 0, credibility, false, growthPage != null].filter(Boolean).length;
  const completeness = coverage * 10;
  await db.query(`UPDATE companies SET
    technologies=CASE WHEN manual_overrides ? 'technologies' THEN technologies ELSE $2::jsonb END,
    public_email=CASE WHEN manual_overrides ? 'publicEmail' THEN public_email ELSE COALESCE($3,public_email) END,
    phone=CASE WHEN manual_overrides ? 'phone' THEN phone WHEN $4::text IS NOT NULL THEN $4::text WHEN phone ~ '[*•]' THEN NULL::text ELSE phone END,
    normalized_phone=CASE WHEN manual_overrides ? 'phone' THEN normalized_phone WHEN $4::text IS NOT NULL THEN $5::text WHEN phone ~ '[*•]' THEN NULL::text ELSE normalized_phone END,
    nip=CASE WHEN manual_overrides ? 'nip' THEN nip ELSE COALESCE($6,nip) END,
    krs=CASE WHEN manual_overrides ? 'krs' THEN krs ELSE COALESCE($7,krs) END,
    city=CASE WHEN manual_overrides ? 'city' THEN city ELSE COALESCE($8,city) END,
    region=CASE WHEN manual_overrides ? 'region' THEN region ELSE COALESCE($9,region) END,
    service_description=CASE WHEN manual_overrides ? 'serviceDescription' THEN service_description ELSE COALESCE($10,service_description) END,
    partnership_levels=CASE WHEN manual_overrides ? 'partnershipLevels' THEN partnership_levels ELSE $11::jsonb END,
    portfolio_urls=CASE WHEN manual_overrides ? 'portfolioUrls' THEN portfolio_urls ELSE $12::jsonb END,
    checked_at=now(),score=$13,completeness=$14,recommendation=$15,
    qualification_final_status=CASE WHEN qualification_final_status IN ('ICP_CONFIRMED','DISQUALIFIED') THEN qualification_final_status ELSE 'UNQUALIFIED' END,updated_at=now() WHERE id=$1`,
    [companyId, JSON.stringify(tech), emails[0] || null, phones[0] || null, normalizePhone(phones[0]), first("nip") || null, first("krs") || null,
      first("city") || null, first("region") || null, first("serviceDescription") || null, JSON.stringify(partnerships), JSON.stringify(portfolios),
      result.score, completeness, classifyLead(result.score, completeness)]);
  for (const item of result.breakdown) await db.query("INSERT INTO score_breakdowns(company_id,category,points,rationale,evidence_ids) VALUES($1,$2,$3,$4,$5) ON CONFLICT(company_id,category) DO UPDATE SET points=excluded.points,rationale=excluded.rationale,evidence_ids=excluded.evidence_ids,updated_at=now()", [companyId, item.category, item.points, item.rationale, JSON.stringify(item.evidenceIds)]);
  for (const error of crawl.errors) await db.query("INSERT INTO research_errors(run_id,company_id,url,code,message,retryable) VALUES($1,$2,$3,'FETCH_ERROR',$4,true)", [run.id, companyId, error.url, error.message]);
  if (ownedRun) await db.query("UPDATE research_runs SET status='COMPLETED',completed_at=now(),stats=$2 WHERE id=$1", [run.id, JSON.stringify({ pages: crawl.pages.length, errors: crawl.errors.length, score: result.score, completeness })]);
  return { ...result, completeness, recommendation: classifyLead(result.score, completeness), technologies: tech, pages: crawl.pages.length, errors: crawl.errors };
  } catch (error) {
    if (ownedRun) await db.query("UPDATE research_runs SET status='FAILED',completed_at=now(),stats=$2 WHERE id=$1", [run.id, JSON.stringify({ error: error instanceof Error ? error.message : String(error) })]);
    throw error;
  }
}
export async function runBatch(connectors: ResearchConnector[]) {
  const db = getClient(), run = (await db.query<{ id: string }>("INSERT INTO research_runs(type,status) VALUES('BATCH','RUNNING') RETURNING id")).rows[0];
  let discovered = 0, created = 0, checked = 0;
  try {
  for (const connector of connectors) try {
    for (const candidate of await connector.discover(30 - discovered)) {
      if (discovered >= 30) break; discovered++; const saved = await upsertCandidate(candidate); if (saved.created) created++;
      try { await researchCompany(saved.id, run.id); checked++; } catch (error) { await db.query("INSERT INTO research_errors(run_id,company_id,source_name,code,message,retryable) VALUES($1,$2,$3,'RESEARCH_ERROR',$4,true)", [run.id, saved.id, connector.name, error instanceof Error ? error.message : String(error)]); }
    }
  } catch (error) { await db.query("INSERT INTO research_errors(run_id,source_name,code,message,retryable) VALUES($1,$2,'CONNECTOR_ERROR',$3,true)", [run.id, connector.name, error instanceof Error ? error.message : String(error)]); }
  const top = await db.query("SELECT id,name,score,completeness FROM companies WHERE recommendation='PERSONAL_AUDIT' ORDER BY score DESC,completeness DESC LIMIT 5");
  const stats = { discovered, created, checked, top5: top.rows };
  await db.query("UPDATE research_runs SET status='COMPLETED',completed_at=now(),stats=$2 WHERE id=$1", [run.id, JSON.stringify(stats)]);
  return stats;
  } catch (error) {
    await db.query("UPDATE research_runs SET status='FAILED',completed_at=now(),stats=$2 WHERE id=$1", [run.id, JSON.stringify({ discovered, created, checked, error: error instanceof Error ? error.message : String(error) })]);
    throw error;
  }
}
