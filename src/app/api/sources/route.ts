import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/db/client";
import { sourceInput } from "@/lib/validation";
import { assertPublicUrl } from "@/research/security";

export async function GET() {
  const rows = await getClient().query("SELECT id,name,type,enabled,config,created_at FROM research_sources ORDER BY name");
  return NextResponse.json(rows.rows);
}
export async function POST(request: NextRequest) {
  const parsed = sourceInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  try {
    await assertPublicUrl(parsed.data.url);
    const row = await getClient().query("INSERT INTO research_sources(name,type,enabled,config) VALUES($1,'DIRECTORY',$2,$3) RETURNING *",
      [parsed.data.name, parsed.data.enabled, JSON.stringify({ url: parsed.data.url })]);
    return NextResponse.json(row.rows[0], { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 422 }); }
}
