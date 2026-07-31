import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/db/client";
import { buildCompanyWhere, parseCompanyFilters } from "@/lib/company-filters";
export async function GET(request: NextRequest) {
  try {
    const filters = parseCompanyFilters(request.nextUrl.searchParams), built = buildCompanyWhere(filters);
    const result = await getClient().query(`SELECT * FROM companies ${built.sql} ORDER BY ${built.order}, completeness DESC LIMIT 200`, built.values);
    return NextResponse.json(result.rows);
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Nieprawidłowe filtry." }, { status: 400 }); }
}
