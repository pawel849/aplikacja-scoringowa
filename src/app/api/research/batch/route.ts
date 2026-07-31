import { NextResponse } from "next/server";
import { getClient } from "@/db/client";
import { DirectoryConnector } from "@/research/connectors";
import { runBatch } from "@/research/pipeline";
export const maxDuration = 300;
export async function POST() {
  const rows = await getClient().query<{ name: string; enabled: boolean; config: Record<string, unknown> }>("SELECT name,enabled,config FROM research_sources WHERE enabled=true");
  const connectors = rows.rows.map((x) => new DirectoryConnector({ name: x.name, enabled: x.enabled, url: x.config.url as string | undefined }));
  return NextResponse.json(await runBatch(connectors, { maxCandidates: 30, budgetMs: 240_000 }));
}
