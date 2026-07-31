import { getClient } from "@/db/client";
import { calculateScore, classifyLead, type BreakdownInput, SCORE_CATEGORIES } from "@/domain/scoring";
import { normalizeDomain, normalizeName, normalizePhone } from "@/domain/dedup";
import { calculateMaturitySignal } from "@/domain/research-scoring";
import { crawlWebsite } from "./crawler";
import type { DiscoveredCompany, ResearchConnector } from "./connectors";

const RESEARCH_WORST_CASE_MS = 130_000;
async function beforeDeadline<T>(work: Promise<T>, deadlineMs: number) {
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0) throw new Error("Przekroczono budżet czasu batcha.");
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Przekroczono budżet czasu batcha.")), remaining); })]);
  } finally { clearTimeout(timer!); }
}

type CompanyRow = {
  id: string; name: string; website: string | null; domain: string | null; city: string | null; region: string | null;
  phone: string | null; public_email: string | null; service_description: string | null; technologies: string[];
  partnership_levels: string[]; portfolio_urls: string[]; decision_makers: unknown[]; public_job_postings: unknown[];
  score: number; completeness: number; manual_overrides: Record<string, unknown>;
};
export async function upsertCandidate(c: DiscoveredCompany) {
  const db = getClient(), domain = normalizeDomain(c.domain || c.website), phone = normalizePhone(c.phone), normalizedName = normalizeName(c.name);
  const identifiers = [domain, c.nip || null, c.krs || null, phone, normalizedName];
  const findMatch = async () => {
    const rows = (await db.query<CompanyRow>("SELECT * FROM companies WHERE ($1::text IS NOT NULL AND domain=$1) OR ($2::text IS NOT NULL AND nip=$2) OR ($3::text IS NOT NULL AND krs=$3) OR ($4::text IS NOT NULL AND normalized_phone=$4) OR (normalized_name=$5 AND length($5)>=8)", identifiers)).rows;
    if (rows.length > 1) throw new Error("Identyfikatory kandydata wskazują różne firmy; wymagane jest ręczne scalenie.");
    return rows[0];
  };
  const merge = async (id: string) => db.query(`UPDATE companies SET
    domain=COALESCE(domain,$2),website=COALESCE(website,$3),nip=COALESCE(nip,$4),krs=COALESCE(krs,$5),
    phone=COALESCE(phone,$6),normalized_phone=COALESCE(normalized_phone,$7),public_email=COALESCE(public_email,$8),
    region=COALESCE(region,$9),city=COALESCE(city,$10),
    source_names=COALESCE((SELECT jsonb_agg(DISTINCT x) FROM jsonb_array_elements_text(source_names||$11::jsonb) x),'[]'::jsonb),
    source_urls=COALESCE((SELECT jsonb_agg(DISTINCT x) FROM jsonb_array_elements_text(source_urls||$12::jsonb) x),'[]'::jsonb),updated_at=now() WHERE id=$1`,
    [id, domain, c.website || null, c.nip || null, c.krs || null, c.phone || null, phone, c.publicEmail || null, c.region || null, c.city || null,
      JSON.stringify([c.sourceName]), JSON.stringify(c.sourceUrl ? [c.sourceUrl] : [])]);
  const matched = await findMatch();
  if (matched) {
    await merge(matched.id);
    return { id: matched.id, created: false };
  }
  const inserted = await db.query<{ id: string }>("INSERT INTO companies(name,normalized_name,domain,website,country,region,city,phone,normalized_phone,public_email,nip,krs,source_names,source_urls) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING RETURNING id", [c.name, normalizedName, domain, c.website || null, c.country || "PL", c.region || null, c.city || null, c.phone || null, phone, c.publicEmail || null, c.nip || null, c.krs || null, JSON.stringify([c.sourceName]), JSON.stringify(c.sourceUrl ? [c.sourceUrl] : [])]);
  if (inserted.rows[0]) return { id: inserted.rows[0].id, created: true };
  const concurrent = await findMatch();
  if (!concurrent) throw new Error("Nie udało się bezpiecznie scalić równoległego importu.");
  await merge(concurrent.id);
  return { id: concurrent.id, created: false };
}
export async function researchCompany(companyId: string, parentRunId?: string, deadlineMs = Date.now() + RESEARCH_WORST_CASE_MS) {
  const db = getClient();
  const company = (await db.query<CompanyRow>("SELECT * FROM companies WHERE id=$1", [companyId])).rows[0];
  if (!company) throw new Error("Nie znaleziono firmy.");
  if (!company.website) throw new Error("Firma nie ma strony WWW.");
  const ownedRun = !parentRunId;
  const lockToken = crypto.randomUUID();
  const lock = await db.query<{ token: string }>(`INSERT INTO research_locks(company_id,token,expires_at) VALUES($1,$2,now()+interval '10 minutes')
    ON CONFLICT(company_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE research_locks.expires_at<now() RETURNING token`, [companyId, lockToken]);
  if (!lock.rows[0]) throw new Error("Research tej firmy już trwa.");
  let runId = parentRunId;
  const evidenceGeneration = crypto.randomUUID();
  const ensureTime = () => { if (Date.now() >= deadlineMs) throw new Error("Przekroczono budżet czasu researchu."); };
  try {
  if (!runId) runId = (await db.query<{ id: string }>("INSERT INTO research_runs(type,status) VALUES('RECHECK','RUNNING') RETURNING id")).rows[0].id;
  ensureTime();
  const crawl = await crawlWebsite(company.website, deadlineMs);
  if (!crawl.pages.length) {
    for (const error of crawl.errors) await db.query("INSERT INTO research_errors(run_id,company_id,url,code,message,retryable) VALUES($1,$2,$3,'FETCH_ERROR',$4,true)", [runId, companyId, error.url, error.message]);
    throw new Error("Nie pobrano żadnej poprawnej strony; zachowano wcześniejsze dane i scoring.");
  }
  const tech = [...new Set(crawl.pages.flatMap((p) => p.technologies))];
  const emails = [...new Set(crawl.pages.flatMap((p) => p.emails))].sort((a,b) => Number(/^(kontakt|biuro|office|info)@/i.test(b))-Number(/^(kontakt|biuro|office|info)@/i.test(a)));
  const phones = [...new Set(crawl.pages.flatMap((p) => p.phones))];
  const evidenceIds: Record<string, string[]> = Object.fromEntries(SCORE_CATEGORIES.map((x) => [x, []]));
  const evidenceRows: { id: string; category: string; points: number; source_url: string; excerpt: string; confidence: string; evidence_type: string; context: string }[] = [];
  const addEvidence = (category: string, points: number, excerpt: string, sourceUrl: string, type: string, confidence = "MEDIUM") => {
    ensureTime();
    const id = crypto.randomUUID();
    evidenceRows.push({ id, category, points, source_url: sourceUrl, excerpt: excerpt.slice(0, 500), confidence, evidence_type: type, context: evidenceGeneration });
    evidenceIds[category]?.push(id);
  };
  const facts = crawl.pages.map((p) => p.facts);
  const recordedFacts = new Set<string>();
  const factEvidence = (type: string, value: string | undefined, pageUrl: string, excerpt?: string) => {
    if (!value) return;
    const key = `${type}:${value}`;
    if (recordedFacts.has(key)) return;
    recordedFacts.add(key);
    addEvidence("FACT", 0, excerpt || value, pageUrl, `CRAWL_FACT_${type}`, "HIGH");
  };
  for (const page of crawl.pages) {
    for (const email of page.emails) factEvidence("EMAIL", email, page.pageUrl, email);
    for (const phone of page.phones) if (normalizePhone(phone)) factEvidence("PHONE", phone, page.pageUrl, phone);
    for (const item of page.excerpts) factEvidence("TECHNOLOGY", item.technology, page.pageUrl, item.description);
    factEvidence("NIP", page.facts.nip, page.pageUrl);
    factEvidence("KRS", page.facts.krs, page.pageUrl);
    factEvidence("CITY", page.facts.city, page.pageUrl);
    factEvidence("REGION", page.facts.region, page.pageUrl);
    factEvidence("SERVICE_DESCRIPTION", page.facts.serviceDescription, page.pageUrl, page.facts.serviceDescription);
    for (const partnership of page.facts.partnershipLevels) factEvidence("PARTNERSHIP", partnership, page.pageUrl, page.signalEvidence.partnership || partnership);
    for (const portfolio of page.facts.portfolioUrls) factEvidence("PORTFOLIO", portfolio, page.pageUrl, `Publiczny link do realizacji lub portfolio: ${portfolio}`);
  }
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
  const complexity = complexityPage?.signals.premium && (complexityPage.signals.comprehensive || complexityPage.signals.portfolio) ? 2 : complexityPage ? 1 : 0;
  const growth = growthPage ? (/\b(obecnie|aktualnie|202[5-9])\b/i.test(growthPage.text) ? 2 : 1) : 0;
  const marketing = marketingPage ? 1 : 0;
  const maturity = maturitySignal.points;
  const maturityEvidenceKey: keyof NonNullable<typeof maturityPage>["signalEvidence"] =
    maturitySignal.reason === "HIGH_PARTNER_STATUS" || (portfolios.length === 0 && partnerships.length > 0) ? "partnership" : "portfolio";
  const pointPairs: [string, number, typeof teamPage, keyof NonNullable<typeof teamPage>["signalEvidence"]][] = [
    ["TEAM", team, teamPage, teamPage?.signals.twoCrews ? "twoCrews" : teamPage?.signals.job ? "job" : "team"],
    ["COMPLEXITY", complexity, complexityPage, complexityPage?.signals.premium ? "premium" : "comprehensive"],
    ["GROWTH", growth, growthPage, "job"],
    ["MARKETING", marketing, marketingPage, "marketing"],
    ["MATURITY", maturity, maturityPage, maturityEvidenceKey]
  ];
  for (const pair of pointPairs) {
    const [category, points, page, evidenceKey] = pair;
    const excerpt = page?.signalEvidence[evidenceKey]
      || (category === "MATURITY" && portfolios[0] ? `Publiczny link do realizacji lub portfolio: ${portfolios[0]}` : "");
    if (points > 0 && page && excerpt) addEvidence(category, points, excerpt, page.pageUrl, `CRAWL_${category}`);
    else if (points > 0) pair[1] = 0;
  }
  const breakdown: BreakdownInput[] = pointPairs.map(([category, points]) => ({ category: category as BreakdownInput["category"], points, rationale: points ? `Publiczny sygnał: ${pointPairs.find((x) => x[0] === category)?.[3]}.` : "Brak publicznego dowodu.", evidenceIds: evidenceIds[category] }));
  const result = calculateScore(breakdown);

  const manual = company.manual_overrides || {};
  const effectiveTech = Object.hasOwn(manual, "technologies") ? company.technologies : tech;
  const effectivePartnerships = Object.hasOwn(manual, "partnershipLevels") ? company.partnership_levels : partnerships;
  const effectivePortfolios = Object.hasOwn(manual, "portfolioUrls") ? company.portfolio_urls : portfolios;
  const locationKnown = Boolean(first("city") || first("region") || company.city || company.region);
  const credibility = Boolean(effectivePartnerships.length || maturity > 0);
  const coverage = [
    Boolean(company.name && (company.domain || company.website)),
    Boolean(emails.length || phones.length || company.public_email || company.phone),
    locationKnown,
    Boolean(first("serviceDescription") || company.service_description),
    effectiveTech.length > 0,
    effectivePortfolios.length > 0,
    team > 0,
    credibility,
    company.decision_makers.length > 0,
    growthPage != null || company.public_job_postings.length > 0
  ].filter(Boolean).length;
  const completeness = coverage * 10;
  ensureTime();
  await db.query(`WITH removed AS (
    DELETE FROM evidence WHERE company_id=$1 AND evidence_type LIKE 'CRAWL_%' RETURNING id
  ), new_evidence AS (
    INSERT INTO evidence(id,company_id,scoring_category,awarded_points,source_url,excerpt,confidence,evidence_type,context)
    SELECT x.id,$1,x.category,x.points,x.source_url,x.excerpt,x.confidence::confidence,x.evidence_type,x.context
    FROM jsonb_to_recordset($17::jsonb) AS x(id uuid,category text,points integer,source_url text,excerpt text,confidence text,evidence_type text,context text)
    CROSS JOIN (SELECT count(*) FROM removed) done RETURNING id
  ), updated AS (UPDATE companies SET
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
    qualification_final_status=CASE WHEN qualification_final_status IN ('ICP_CONFIRMED','DISQUALIFIED') THEN qualification_final_status ELSE 'UNQUALIFIED' END,updated_at=now()
    WHERE id=$1 AND (SELECT count(*) FROM new_evidence)>=0 RETURNING id
  ), items AS (SELECT * FROM jsonb_to_recordset($16::jsonb) AS x(category text,points integer,rationale text,evidence_ids jsonb))
  INSERT INTO score_breakdowns(company_id,category,points,rationale,evidence_ids)
  SELECT updated.id,items.category,items.points,items.rationale,items.evidence_ids FROM updated CROSS JOIN items
  ON CONFLICT(company_id,category) DO UPDATE SET points=excluded.points,rationale=excluded.rationale,evidence_ids=excluded.evidence_ids,updated_at=now()`,
    [companyId, JSON.stringify(tech), emails[0] || null, phones[0] || null, normalizePhone(phones[0]), first("nip") || null, first("krs") || null,
      first("city") || null, first("region") || null, first("serviceDescription") || null, JSON.stringify(partnerships), JSON.stringify(portfolios),
      result.score, completeness, classifyLead(result.score, completeness), JSON.stringify(result.breakdown.map((item) => ({ ...item, evidence_ids: item.evidenceIds }))), JSON.stringify(evidenceRows)]);
  for (const error of crawl.errors) await db.query("INSERT INTO research_errors(run_id,company_id,url,code,message,retryable) VALUES($1,$2,$3,'FETCH_ERROR',$4,true)", [runId, companyId, error.url, error.message]);
  if (ownedRun) await db.query("UPDATE research_runs SET status='COMPLETED',completed_at=now(),stats=$2 WHERE id=$1", [runId, JSON.stringify({ pages: crawl.pages.length, errors: crawl.errors.length, score: result.score, completeness })]);
  return { ...result, completeness, recommendation: classifyLead(result.score, completeness), technologies: tech, pages: crawl.pages.length, errors: crawl.errors };
  } catch (error) {
    if (ownedRun && runId) await db.query("UPDATE research_runs SET status='FAILED',completed_at=now(),stats=$2 WHERE id=$1", [runId, JSON.stringify({ error: error instanceof Error ? error.message : String(error) })]);
    throw error;
  } finally {
    await db.query("DELETE FROM research_locks WHERE company_id=$1 AND token=$2", [companyId, lockToken]);
  }
}
export async function runBatch(connectors: ResearchConnector[], options: { maxCandidates?: number; budgetMs?: number } = {}) {
  const db = getClient(), run = (await db.query<{ id: string }>("INSERT INTO research_runs(type,status) VALUES('BATCH','RUNNING') RETURNING id")).rows[0];
  const startedAt = Date.now(), maxCandidates = options.maxCandidates ?? 30, budgetMs = options.budgetMs ?? 240_000;
  const workDeadline = startedAt + Math.max(0, budgetMs - 5_000);
  let discovered = 0, created = 0, checked = 0, attempted = 0;
  const queue: { id: string; sourceName: string }[] = [], queued = new Set<string>();
  try {
    for (const connector of connectors) {
      if (discovered >= maxCandidates || Date.now() >= workDeadline) break;
      try {
        const candidates = await beforeDeadline(connector.discover(maxCandidates - discovered, workDeadline), workDeadline);
        for (const candidate of candidates) {
          if (discovered >= maxCandidates || Date.now() >= workDeadline) break;
          discovered++;
          const saved = await upsertCandidate(candidate);
          if (saved.created) created++;
          if (!queued.has(saved.id)) { queued.add(saved.id); queue.push({ id: saved.id, sourceName: connector.name }); }
        }
      } catch (error) {
        await db.query("INSERT INTO research_errors(run_id,source_name,code,message,retryable) VALUES($1,$2,'CONNECTOR_ERROR',$3,true)", [run.id, connector.name, error instanceof Error ? error.message : String(error)]);
      }
    }
    for (const company of queue) {
      if (Date.now() >= workDeadline) break;
      attempted++;
      try { await researchCompany(company.id, run.id, workDeadline); checked++; }
      catch (error) { await db.query("INSERT INTO research_errors(run_id,company_id,source_name,code,message,retryable) VALUES($1,$2,$3,'RESEARCH_ERROR',$4,true)", [run.id, company.id, company.sourceName, error instanceof Error ? error.message : String(error)]); }
    }
    const deferred = Math.max(0, queue.length - attempted);
    const top = await db.query("SELECT id,name,score,completeness FROM companies WHERE recommendation='PERSONAL_AUDIT' ORDER BY score DESC,completeness DESC LIMIT 5");
    const stats = { discovered, created, checked, deferred, top5: top.rows };
    await db.query("UPDATE research_runs SET status='COMPLETED',completed_at=now(),stats=$2 WHERE id=$1", [run.id, JSON.stringify(stats)]);
    return stats;
  } catch (error) {
    await db.query("UPDATE research_runs SET status='FAILED',completed_at=now(),stats=$2 WHERE id=$1", [run.id, JSON.stringify({ discovered, created, checked, error: error instanceof Error ? error.message : String(error) })]);
    throw error;
  }
}
