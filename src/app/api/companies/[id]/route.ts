import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/db/client";
import { companyUpdate } from "@/lib/validation";
import { normalizeDomain, normalizeName, normalizePhone } from "@/domain/dedup";
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params, parsed = companyUpdate.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getClient(), v = parsed.data;
  const exists = await db.query("SELECT id FROM companies WHERE id=$1", [id]);
  if (!exists.rows[0]) return NextResponse.json({ error: "Nie znaleziono firmy." }, { status: 404 });
  if (v.qualificationFinalStatus && ["ICP_CONFIRMED", "DISQUALIFIED"].includes(v.qualificationFinalStatus)) {
    const previous = (await db.query<Record<string, string | null>>("SELECT * FROM qualification_answers WHERE company_id=$1", [id])).rows[0] || {};
    const incoming = v.answers || {};
    const pick = (key: keyof typeof incoming, dbKey: string) => Object.hasOwn(incoming, key) ? incoming[key] : previous[dbKey];
    const answers = [pick("wantsMoreProjects", "wants_more_projects"), pick("capacityHiringPlan", "capacity_hiring_plan"),
      pick("inquiryOwner", "inquiry_owner"), pick("ownerBottleneck", "owner_bottleneck"),
      pick("desiredJobs", "desired_jobs"), pick("avoidedJobs", "avoided_jobs")];
    if (answers.filter((answer) => answer?.trim()).length < 3) return NextResponse.json({ error: "Status końcowy wymaga co najmniej trzech zapisanych odpowiedzi po rozmowie." }, { status: 422 });
  }
  try {
  await db.query("UPDATE companies SET notes=COALESCE($2,notes),contact_status=COALESCE($3,contact_status),qualification_final_status=CASE WHEN $4::text IS NULL OR $5::boolean THEN qualification_final_status ELSE $4::qualification_status END,updated_at=now() WHERE id=$1", [id, v.notes ?? null, v.contactStatus ?? null, v.qualificationFinalStatus ?? null, Boolean(v.answers)]);
  if (v.manual && Object.keys(v.manual).length) {
    const columns: Record<string, string> = { name:"name",website:"website",country:"country",region:"region",city:"city",phone:"phone",publicEmail:"public_email",nip:"nip",krs:"krs",technologies:"technologies",partnershipLevels:"partnership_levels",serviceDescription:"service_description",portfolioUrls:"portfolio_urls",reviewCount:"review_count",reviewSource:"review_source",decisionMakers:"decision_makers",publicJobPostings:"public_job_postings" };
    const entries = Object.entries(v.manual), params: unknown[] = [id], sets: string[] = [];
    for (const [key, value] of entries) {
      params.push(Array.isArray(value) ? JSON.stringify(value) : value);
      sets.push(`${columns[key]}=$${params.length}${Array.isArray(value) ? "::jsonb" : ""}`);
    }
    const overrides = Object.fromEntries(entries);
    params.push(JSON.stringify(overrides));
    sets.push(`manual_overrides=manual_overrides||$${params.length}::jsonb`);
    if ("name" in v.manual) { params.push(normalizeName(v.manual.name!)); sets.push(`normalized_name=$${params.length}`); }
    if ("website" in v.manual) { params.push(normalizeDomain(v.manual.website)); sets.push(`domain=$${params.length}`); }
    if ("phone" in v.manual) { params.push(normalizePhone(v.manual.phone)); sets.push(`normalized_phone=$${params.length}`); }
    await db.query(`UPDATE companies SET ${sets.join(",")},updated_at=now() WHERE id=$1`, params);
    await db.query("INSERT INTO evidence(company_id,scoring_category,awarded_points,context,source_url,excerpt,confidence,evidence_type) VALUES($1,'MANUAL',0,'Ręczna korekta użytkownika',$2,$3,'HIGH','MANUAL_CORRECTION')", [id, `${request.nextUrl.origin}/companies/${id}`, `Ręcznie zmienione pola: ${entries.map(([key]) => key).join(", ")}`]);
  }
  if (v.answers) await db.query(`WITH saved AS (
    INSERT INTO qualification_answers(company_id,wants_more_projects,capacity_hiring_plan,inquiry_owner,owner_bottleneck,desired_jobs,avoided_jobs) VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT(company_id) DO UPDATE SET
      wants_more_projects=CASE WHEN $8 THEN excluded.wants_more_projects ELSE qualification_answers.wants_more_projects END,
      capacity_hiring_plan=CASE WHEN $9 THEN excluded.capacity_hiring_plan ELSE qualification_answers.capacity_hiring_plan END,
      inquiry_owner=CASE WHEN $10 THEN excluded.inquiry_owner ELSE qualification_answers.inquiry_owner END,
      owner_bottleneck=CASE WHEN $11 THEN excluded.owner_bottleneck ELSE qualification_answers.owner_bottleneck END,
      desired_jobs=CASE WHEN $12 THEN excluded.desired_jobs ELSE qualification_answers.desired_jobs END,
      avoided_jobs=CASE WHEN $13 THEN excluded.avoided_jobs ELSE qualification_answers.avoided_jobs END,updated_at=now()
    RETURNING company_id
  ) UPDATE companies SET qualification_final_status=COALESCE($14::qualification_status,qualification_final_status),updated_at=now()
    WHERE id=$1 AND EXISTS(SELECT 1 FROM saved WHERE saved.company_id=companies.id)`,
    [id, v.answers.wantsMoreProjects ?? null, v.answers.capacityHiringPlan ?? null, v.answers.inquiryOwner ?? null, v.answers.ownerBottleneck ?? null,
      v.answers.desiredJobs ?? null, v.answers.avoidedJobs ?? null,
      Object.hasOwn(v.answers, "wantsMoreProjects"), Object.hasOwn(v.answers, "capacityHiringPlan"), Object.hasOwn(v.answers, "inquiryOwner"),
      Object.hasOwn(v.answers, "ownerBottleneck"), Object.hasOwn(v.answers, "desiredJobs"), Object.hasOwn(v.answers, "avoidedJobs"), v.qualificationFinalStatus ?? null]);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 422 });
  }
  return NextResponse.json({ ok: true });
}
