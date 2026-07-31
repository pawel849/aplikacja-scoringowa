import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ calls: [] as { sql: string; params: unknown[] }[], previous: {} as Record<string, string | null> }));
vi.mock("@/db/client", () => ({ getClient: () => ({ query: async (sql: string, params: unknown[] = []) => {
  state.calls.push({ sql, params });
  if (sql.includes("SELECT id FROM companies")) return { rows: [{ id: "company-1" }] };
  if (sql.includes("SELECT * FROM qualification_answers")) return { rows: [state.previous] };
  return { rows: [] };
} }) }));
import { PATCH } from "./route";

const context = { params: Promise.resolve({ id: "company-1" }) };
function request(body: object) {
  return new NextRequest("https://app.test/api/companies/company-1", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("odpowiedzi kwalifikacyjne", () => {
  beforeEach(() => { state.calls.length = 0; state.previous = {}; });

  it("nie liczy wyczyszczonej odpowiedzi przy nadawaniu statusu końcowego", async () => {
    state.previous = { wants_more_projects: "tak", capacity_hiring_plan: "plan", inquiry_owner: "właściciel" };
    const response = await PATCH(request({ qualificationFinalStatus: "ICP_CONFIRMED", answers: { wantsMoreProjects: "" } }), context);
    expect(response.status).toBe(422);
  });

  it("zapisuje pusty ciąg jako świadome wyczyszczenie pola", async () => {
    const response = await PATCH(request({ answers: { wantsMoreProjects: "" } }), context);
    expect(response.status).toBe(200);
    const saved = state.calls.find((call) => call.sql.includes("INSERT INTO qualification_answers"));
    expect(saved?.params[1]).toBe("");
    expect(saved?.params[7]).toBe(true);
  });
});
