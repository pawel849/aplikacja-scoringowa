import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/db/client";
import { z } from "zod";
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const parsed = z.object({ enabled: z.boolean() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const result = await getClient().query("UPDATE research_sources SET enabled=$2 WHERE id=$1 RETURNING id,enabled", [(await context.params).id, parsed.data.enabled]);
  if (!result.rows[0]) return NextResponse.json({ error: "Nie znaleziono źródła." }, { status: 404 });
  return NextResponse.json(result.rows[0]);
}
