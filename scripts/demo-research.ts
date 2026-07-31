import { readFile } from "node:fs/promises";
import { getClient } from "../src/db/client";
import { ManualUrlConnector } from "../src/research/connectors";
import { researchCompany, upsertCandidate } from "../src/research/pipeline";

async function main() {
 const migration = await readFile(new URL("../drizzle/0000_initial.sql", import.meta.url), "utf8");
 const db = getClient();
 if (db.exec) await db.exec(migration); else for (const statement of migration.split(/;\s*\n(?=(?:CREATE|INSERT|DO)\b)/i).filter(Boolean)) await db.query(statement);
 const candidate = (await new ManualUrlConnector("https://inteli-home.pl/", "Inteli Home").discover())[0];
 const saved = await upsertCandidate(candidate);
 const result = await researchCompany(saved.id);
 const company = (await getClient().query<Record<string, unknown>>("SELECT * FROM companies WHERE id=$1", [saved.id])).rows[0];
 const evidence = await getClient().query<Record<string, unknown>>("SELECT scoring_category,awarded_points,excerpt,source_url,found_at,confidence FROM evidence WHERE company_id=$1 ORDER BY scoring_category", [saved.id]);
 console.log(JSON.stringify({
  companyId: saved.id, created: saved.created, name: company.name, website: company.website,
  score: result.score, completeness: result.completeness, recommendation: result.recommendation,
  technologies: result.technologies, pagesFetched: result.pages, evidence: evidence.rows,
  missing: [
    !company.public_email && "publicEmail", !company.phone && "phone",
    !(company.decision_makers as object[]).length && "decisionMakers",
    company.review_count == null && "reliableReviewCount",
    !(company.public_job_postings as object[]).length && "publicJobPostings"
  ].filter(Boolean),
  conversationOnlyQuestions: [
    "Czy firma chce więcej projektów?",
    "Jakie ma obecne moce wykonawcze i plany zatrudnienia?",
    "Kto obsługuje i domyka zapytania?",
    "Czy właściciel jest wąskim gardłem?",
    "Jakich zleceń firma szuka, a jakich unika?"
  ],
  fetchErrors: result.errors
 }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
