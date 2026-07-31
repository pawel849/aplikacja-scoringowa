import { PGlite } from "@electric-sql/pglite";
import { neon } from "@neondatabase/serverless";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type QueryResult<T> = { rows: T[] };
export interface SqlClient { query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>; exec?(sql: string): Promise<unknown> }
let client: SqlClient | undefined;
export function getClient(): SqlClient {
  if (client) return client;
  if (process.env.DATABASE_URL) {
    const sql = neon(process.env.DATABASE_URL);
    client = { async query<T>(query: string, params: unknown[] = []) { const rows = await sql.query(query, params) as T[]; return { rows }; } };
  } else {
    if (process.env.VERCEL) throw new Error("Brak DATABASE_URL w środowisku Vercel. Skonfiguruj trwałą bazę Neon/Postgres przed uruchomieniem aplikacji.");
    const path = process.env.PGLITE_PATH ?? "./data/leads";
    mkdirSync(dirname(path), { recursive: true });
    client = new PGlite(path) as unknown as SqlClient;
  }
  return client;
}
