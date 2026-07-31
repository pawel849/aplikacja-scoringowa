import { companyFilters } from "./validation";

export function parseCompanyFilters(input: URLSearchParams | Record<string, string | undefined>) {
  const raw = input instanceof URLSearchParams ? Object.fromEntries(input) : input;
  return companyFilters.parse(raw);
}

export function buildCompanyWhere(filters: ReturnType<typeof parseCompanyFilters>) {
  const values: unknown[] = [], clauses: string[] = [];
  const add = (sql: string, value: unknown) => { values.push(value); clauses.push(sql.replace("$?", `$${values.length}`)); };
  if (filters.q) add("(name ILIKE $? OR COALESCE(domain,'') ILIKE $?)".replace(/\$\?/g, () => `$${values.length + 1}`), `%${filters.q}%`);
  if (filters.country) add("country=$?", filters.country);
  if (filters.region) add("region=$?", filters.region);
  if (filters.tech) add("technologies @> $?::jsonb", JSON.stringify([filters.tech]));
  if (filters.source) add("source_names @> $?::jsonb", JSON.stringify([filters.source]));
  if (filters.minScore !== undefined) add("score >= $?", filters.minScore);
  if (filters.best === "1") clauses.push("recommendation='PERSONAL_AUDIT'");
  if (filters.queue === "contact") clauses.push("recommendation IN ('PERSONAL_AUDIT','QUALIFICATION_CALL') AND contact_status NOT IN ('CLOSED','PAUSED')");
  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", values, order: filters.sort === "asc" ? "score ASC" : "score DESC" };
}
