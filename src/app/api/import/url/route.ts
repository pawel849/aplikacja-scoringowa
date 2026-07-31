import { NextResponse } from "next/server";
import { urlInput } from "@/lib/validation";
import { ManualUrlConnector } from "@/research/connectors";
import { assertPublicUrl } from "@/research/security";
import { researchCompany, upsertCandidate } from "@/research/pipeline";
export const maxDuration = 60;
export async function POST(request: Request) {
  const body = await request.json().catch(() => null), parsed = urlInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  try {
    const deadlineMs = Date.now() + 55_000;
    await assertPublicUrl(parsed.data.url); const candidate = (await new ManualUrlConnector(parsed.data.url, parsed.data.name).discover(1, deadlineMs))[0];
    const saved = await upsertCandidate(candidate); const result = await researchCompany(saved.id, undefined, deadlineMs);
    return NextResponse.json({ id: saved.id, created: saved.created, result });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 422 }); }
}
