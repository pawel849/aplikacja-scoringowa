import { PGlite } from "@electric-sql/pglite";
import { neon } from "@neondatabase/serverless";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type QueryResult<T> = { rows: T[] };
export interface SqlClient { query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>; exec?(sql: string): Promise<unknown> }

export function sanitizeSqlString(input: string) {
  let output = "";
  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = input.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        output += input[index] + input[index + 1];
        index++;
      } else output += "�";
    } else if (code >= 0xdc00 && code <= 0xdfff) output += "�";
    else output += input[index];
  }
  return output.replace(/\\u(d[89ab][0-9a-f]{2})(?:\\u(d[c-f][0-9a-f]{2}))?|\\u(d[c-f][0-9a-f]{2})/gi,
    (match, high: string | undefined, low: string | undefined) => high && low ? match : "�");
}

function sanitizeSqlParams(params: unknown[]) {
  return params.map((value) => typeof value === "string" ? sanitizeSqlString(value) : value);
}

let client: SqlClient | undefined;
export function getClient(): SqlClient {
  if (client) return client;
  if (process.env.DATABASE_URL) {
    const sql = neon(process.env.DATABASE_URL);
    client = { async query<T>(query: string, params: unknown[] = []) { const rows = await sql.query(query, sanitizeSqlParams(params)) as T[]; return { rows }; } };
  } else {
    if (process.env.VERCEL) throw new Error("Brak DATABASE_URL w środowisku Vercel. Skonfiguruj trwałą bazę Neon/Postgres przed uruchomieniem aplikacji.");
    const path = process.env.PGLITE_PATH ?? "./data/leads";
    mkdirSync(dirname(path), { recursive: true });
    client = new PGlite(path) as unknown as SqlClient;
  }
  return client;
}
