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
type DirectoryPartnershipEvidence = { id: string; excerpt: string; source_url: string };
export function mergePartnershipLevels(crawled: string[], directoryEvidence: DirectoryPartnershipEvidence[]) {
  return [...new Set([...crawled, ...directoryEvidence.map((row) => row.excerpt)])];
}
export async function upsertCandidate(c: DiscoveredCompany, options: { mergeExistingIds?: ReadonlySet<string> } = {}) {
  const db = getClient(), domain = normalizeDomain(c.domain || c.website), phone = normalizePhone(c.phone), normalizedName = normalizeName(c.name);
  const partnershipLevels = [...new Set(c.partnershipLevels ?? [])];
  const partnershipPrefix = partnershipLevels.map((level) => level.match(/^(Loxone|Grenton|Ampio|KNX)\b/i)?.[1]).find(Boolean) || c.sourceName;
  const hasDirectoryEvidence = Boolean(c.sourceUrl && partnershipLevels.length);
  const identifiers = [domain, c.nip || null, c.krs || null, phone, normalizedName];
  const findMatch = async () => {
    const rows = (await db.query<CompanyRow>("SELECT * FROM companies WHERE ($1::text IS NOT NULL AND domain=$1) OR ($2::text IS NOT NULL AND nip=$2) OR ($3::text IS NOT NULL AND krs=$3) OR ($4::text IS NOT NULL AND normalized_phone=$4) OR (normalized_name=$5 AND length($5)>=8)", identifiers)).rows;
    if (rows.length > 1) throw new Error("Identyfikatory kandydata wskazują różne firmy; wymagane jest ręczne scalenie.");
    return rows[0];
  };
  const merge = async (id: string) => db.query<{ id: string }>(`WITH updated_company AS (
    UPDATE companies SET
      domain=COALESCE(domain,$2),website=COALESCE(website,$3),nip=COALESCE(nip,$4),krs=COALESCE(krs,$5),
      phone=COALESCE(phone,$6),normalized_phone=COALESCE(normalized_phone,$7),public_email=COALESCE(public_email,$8),
      region=COALESCE(region,$9),city=COALESCE(city,$10),
      partnership_levels=CASE
        WHEN manual_overrides ? 'partnershipLevels' OR NOT $15::boolean THEN partnership_levels
        ELSE COALESCE((SELECT jsonb_agg(DISTINCT level) FROM (
          SELECT value AS level FROM jsonb_array_elements_text(partnership_levels)
          WHERE lower(value) <> lower($14) AND lower(value) NOT LIKE lower($14)||' %'
          UNION ALL SELECT value AS level FROM jsonb_array_elements_text($11::jsonb)
        ) merged_levels),'[]'::jsonb)
      END,
      source_names=COALESCE((SELECT jsonb_agg(DISTINCT value) FROM jsonb_array_elements_text(source_names||$12::jsonb)),'[]'::jsonb),
      source_urls=COALESCE((SELECT jsonb_agg(DISTINCT value) FROM jsonb_array_elements_text(source_urls||$13::jsonb)),'[]'::jsonb),updated_at=now()
    WHERE id=$1 RETURNING id
  ), removed_evidence AS (
    DELETE FROM evidence e USING updated_company company
    WHERE e.company_id=company.id AND e.evidence_type='DIRECTORY_PARTNERSHIP' AND e.context=$16 AND $15::boolean
    RETURNING e.id
  ), inserted_evidence AS (
    INSERT INTO evidence(company_id,scoring_category,awarded_points,source_url,excerpt,confidence,evidence_type,context)
    SELECT company.id,'FACT',0,$17,level.value,'HIGH','DIRECTORY_PARTNERSHIP',$16
    FROM updated_company company
    CROSS JOIN LATERAL jsonb_array_elements_text($11::jsonb) AS level(value)
    CROSS JOIN (SELECT count(*) FROM removed_evidence) synchronized
    WHERE $15::boolean
    RETURNING company_id
  )
  SELECT company.id FROM updated_company company CROSS JOIN (SELECT count(*) FROM inserted_evidence) completed`,
    [id, domain, c.website || null, c.nip || null, c.krs || null, c.phone || null, phone, c.publicEmail || null, c.region || null, c.city || null,
      JSON.stringify(partnershipLevels), JSON.stringify([c.sourceName]), JSON.stringify(c.sourceUrl ? [c.sourceUrl] : []), partnershipPrefix,
      hasDirectoryEvidence, c.sourceName, c.sourceUrl || null]);
  const matched = await findMatch();
  if (matched) {
    if (options.mergeExistingIds && !options.mergeExistingIds.has(matched.id)) return { id: matched.id, created: false, skipped: true };
    await merge(matched.id);
    return { id: matched.id, created: false };
  }
  const inserted = await db.query<{ id: string }>(`WITH inserted_company AS (
    INSERT INTO companies(name,normalized_name,domain,website,country,region,city,phone,normalized_phone,public_email,nip,krs,partnership_levels,source_names,source_urls)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    ON CONFLICT DO NOTHING RETURNING id
  ), inserted_evidence AS (
    INSERT INTO evidence(company_id,scoring_category,awarded_points,source_url,excerpt,confidence,evidence_type,context)
    SELECT company.id,'FACT',0,$17,level.value,'HIGH','DIRECTORY_PARTNERSHIP',$16
    FROM inserted_company company
    CROSS JOIN LATERAL jsonb_array_elements_text($13::jsonb) AS level(value)
    WHERE $18::boolean
    RETURNING company_id
  )
  SELECT company.id FROM inserted_company company CROSS JOIN (SELECT count(*) FROM inserted_evidence) completed`,
    [c.name, normalizedName, domain, c.website || null, c.country || "PL", c.region || null, c.city || null, c.phone || null, phone,
      c.publicEmail || null, c.nip || null, c.krs || null, JSON.stringify(partnershipLevels), JSON.stringify([c.sourceName]),
      JSON.stringify(c.sourceUrl ? [c.sourceUrl] : []), c.sourceName, c.sourceUrl || null, hasDirectoryEvidence]);
  if (inserted.rows[0]) {
    return { id: inserted.rows[0].id, created: true };
  }
  const concurrent = await findMatch();
  if (!concurrent) throw new Error("Nie udało się bezpiecznie scalić równoległego importu.");
  if (options.mergeExistingIds && !options.mergeExistingIds.has(concurrent.id)) return { id: concurrent.id, created: false, skipped: true };
  await merge(concurrent.id);
  return { id: concurrent.id, created: false };
}
export async function researchCompany(companyId: string, parentRunId?: string, deadlineMs = Date.now() + RESEARCH_WORST_CASE_MS) {
  const db = getClient();
  const company = (await db.query<CompanyRow>("SELECT * FROM companies WHERE id=$1", [companyId])).rows[0];
  if (!company) throw new Error("Nie znaleziono firmy.");
  if (!company.website) throw new Error("Firma nie ma strony WWW.");
  const directoryPartnershipEvidence = (await db.query<DirectoryPartnershipEvidence>(
    "SELECT id,excerpt,source_url FROM evidence WHERE company_id=$1 AND evidence_type='DIRECTORY_PARTNERSHIP' ORDER BY found_at",
    [companyId]
  )).rows;
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
  const partnerships = mergePartnershipLevels(facts.flatMap((x) => x.partnershipLevels), directoryPartnershipEvidence);
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
    else if (points > 0 && category === "MATURITY" && directoryPartnershipEvidence.length) {
      evidenceIds[category].push(...directoryPartnershipEvidence.map((row) => row.id));
    }
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
export function selectBatchCandidates(
  groups: Array<{ sourceName: string; candidates: DiscoveredCompany[] }>,
  existingDomains: Set<string>,
  limit: number
) {
  const queues = groups.map((group) => ({
    ...group,
    fresh: group.candidates.filter((candidate) => {
      const domain = normalizeDomain(candidate.domain || candidate.website);
      return domain && !existingDomains.has(domain);
    })
  }));
  const selected: DiscoveredCompany[] = [], seen = new Set<string>();
  let moved = true;
  while (selected.length < limit && moved) {
    moved = false;
    for (const queue of queues) {
        while (queue.fresh.length) {
          const candidate = queue.fresh.shift()!;
          const domain = normalizeDomain(candidate.domain || candidate.website);
          if (!domain || seen.has(domain)) continue;
          seen.add(domain); selected.push(candidate); moved = true; break;
        }
        if (selected.length >= limit) break;
    }
  }
  return selected;
}

export function expandSelectedCandidateSources(
  selected: DiscoveredCompany[],
  groups: Array<{ sourceName: string; candidates: DiscoveredCompany[] }>
) {
  const selectedDomains = new Set(selected.map((candidate) => normalizeDomain(candidate.domain || candidate.website)).filter(Boolean));
  const seen = new Set<string>();
  return groups.flatMap((group) => group.candidates).filter((candidate) => {
    const domain = normalizeDomain(candidate.domain || candidate.website);
    const key = `${domain}\0${candidate.sourceName}\0${candidate.sourceUrl ?? ""}`;
    if (!domain || !selectedDomains.has(domain) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function clampBatchCandidateLimit(value = 15) {
  return Math.min(15, Math.max(0, Math.floor(Number.isFinite(value) ? value : 15)));
}

export async function runBatch(connectors: ResearchConnector[], options: { maxCandidates?: number; budgetMs?: number } = {}) {
  const db = getClient(), run = (await db.query<{ id: string }>("INSERT INTO research_runs(type,status) VALUES('BATCH','RUNNING') RETURNING id")).rows[0];
  const startedAt = Date.now(), maxCandidates = clampBatchCandidateLimit(options.maxCandidates), budgetMs = options.budgetMs ?? 240_000;
  const finalizationReserveMs = Math.min(5_000, Math.max(0, budgetMs), Math.max(1, budgetMs * 0.1));
  const usableWorkMs = Math.max(0, budgetMs - finalizationReserveMs);
  const workDeadline = startedAt + usableWorkMs;
  const discoveryDeadline = startedAt + Math.min(usableWorkMs, 60_000, Math.max(1, usableWorkMs * 0.35));
  let discovered = 0, created = 0, checked = 0, attempted = 0;
  const groups: Array<{ sourceName: string; candidates: DiscoveredCompany[] }> = [];
  const queue: { id: string; sourceName: string }[] = [], queued = new Set<string>(), createdThisBatch = new Set<string>();
  try {
    const discoveryLimit = 5_000;
    for (const connector of connectors) {
      if (Date.now() >= discoveryDeadline) break;
      try {
        const candidates = await beforeDeadline(connector.discover(discoveryLimit, discoveryDeadline), discoveryDeadline);
        groups.push({ sourceName: connector.name, candidates });
      } catch (error) {
        await db.query("INSERT INTO research_errors(run_id,source_name,code,message,retryable) VALUES($1,$2,'CONNECTOR_ERROR',$3,true)", [run.id, connector.name, error instanceof Error ? error.message : String(error)]);
      }
    }
    const existing = await db.query<{ domain: string }>("SELECT domain FROM companies WHERE domain IS NOT NULL");
    const selected = selectBatchCandidates(groups, new Set(existing.rows.map((row) => row.domain)), maxCandidates);
    discovered = selected.length;
    for (const candidate of expandSelectedCandidateSources(selected, groups)) {
      if (Date.now() >= workDeadline) break;
      const saved = await upsertCandidate(candidate, { mergeExistingIds: createdThisBatch });
      if (saved.skipped) continue;
      if (saved.created) { created++; createdThisBatch.add(saved.id); }
      if (!queued.has(saved.id)) { queued.add(saved.id); queue.push({ id: saved.id, sourceName: candidate.sourceName }); }
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
