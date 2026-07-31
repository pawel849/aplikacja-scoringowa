import { NextResponse } from "next/server";
import { CsvConnector } from "@/research/connectors";
import { runBatch } from "@/research/pipeline";
export const maxDuration = 60;
export async function POST(request: Request) {
  const form = await request.formData(), file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Brak pliku CSV." }, { status: 400 });
  if (file.size > 2_000_000) return NextResponse.json({ error: "Limit pliku to 2 MB." }, { status: 413 });
  try { return NextResponse.json(await runBatch([new CsvConnector(await file.text())], { maxCandidates: 1_000, budgetMs: 50_000 })); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 422 }); }
}
