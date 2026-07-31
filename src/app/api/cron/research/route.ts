import { NextResponse } from "next/server";
import { getClient } from "@/db/client";
import { runBatch, researchCompany } from "@/research/pipeline";
import { DirectoryConnector } from "@/research/connectors";
export const maxDuration = 300;
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  try {
    const startedAt = Date.now();
    const db = getClient(), sources = await db.query<{ name: string; enabled: boolean; config: Record<string, unknown> }>("SELECT name,enabled,config FROM research_sources WHERE enabled=true");
    const batch = await runBatch(sources.rows.map((x) => new DirectoryConnector({ name: x.name, enabled: x.enabled, url: x.config.url as string | undefined })), { maxCandidates: 15, budgetMs: 150_000 });
    const stale = await db.query<{ id: string }>("SELECT id FROM companies WHERE website IS NOT NULL AND (checked_at IS NULL OR checked_at < now()-interval '30 days') ORDER BY checked_at NULLS FIRST LIMIT 5");
    let rechecked=0, recheckErrors=0;
    const deadlineMs = startedAt + 285_000;
    for (const company of stale.rows) {
      if (Date.now() >= deadlineMs) break;
      try { await researchCompany(company.id, undefined, deadlineMs); rechecked++; } catch (error) {
      recheckErrors++;
      await db.query("INSERT INTO research_errors(company_id,code,message,retryable) VALUES($1,'STALE_RECHECK_ERROR',$2,true)", [company.id,error instanceof Error?error.message:String(error)]);
      }
    }
    const top5=await db.query("SELECT id,name,score,completeness FROM companies WHERE recommendation IN ('PERSONAL_AUDIT','QUALIFICATION_CALL') AND contact_status NOT IN ('CLOSED','PAUSED') ORDER BY score DESC,completeness DESC LIMIT 5");
    return NextResponse.json({ ok: true, batch, rechecked, recheckErrors, top5:top5.rows });
  } catch(error) { return NextResponse.json({error:error instanceof Error?error.message:String(error)},{status:500}); }
}
