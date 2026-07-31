import { NextRequest } from "next/server";
import { getClient } from "@/db/client";
import { csvCell } from "@/lib/validation";
import { buildCompanyWhere, parseCompanyFilters } from "@/lib/company-filters";
export async function GET(request: NextRequest) {
  const filters = parseCompanyFilters(request.nextUrl.searchParams), built = buildCompanyWhere(filters);
  const rows = await getClient().query<Record<string, unknown>>(`SELECT c.name,c.website,c.country,c.region,c.city,c.phone,c.public_email,c.score,c.completeness,c.recommendation,c.contact_status,c.technologies,c.source_names,
    COALESCE(c.decision_makers->0->>'name','') decision_maker,
    COALESCE((SELECT string_agg(e.scoring_category||': '||left(e.excerpt,180),' | ' ORDER BY e.scoring_category) FROM evidence e WHERE e.company_id=c.id AND e.awarded_points>0),'') evidence_summary
    FROM companies c ${built.sql} ORDER BY ${built.order},c.completeness DESC`, built.values);
  const headers = ["name","website","country","region","city","phone","public_email","decision_maker","score","completeness","recommendation","contact_status","technologies","source_names","evidence_summary"];
  const csv = "\uFEFF" + headers.join(",") + "\n" + rows.rows.map((r) => headers.map((h) => csvCell(Array.isArray(r[h]) ? (r[h] as string[]).join("|") : r[h])).join(",")).join("\n");
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="firmy.csv"' } });
}
