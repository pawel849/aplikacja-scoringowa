import { NextResponse } from "next/server";
import { researchCompany } from "@/research/pipeline";
export const maxDuration = 60;
export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  try { return NextResponse.json(await researchCompany((await context.params).id, undefined, Date.now() + 55_000)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 422 }); }
}
