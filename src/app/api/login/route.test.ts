import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ attempts: new Map<string, number>(), query: vi.fn() }));
vi.mock("@/db/client", () => ({ getClient: () => ({ query: state.query }) }));
import { POST } from "./route";
import { proxy } from "../../../proxy";

beforeEach(() => {
  state.attempts.clear();
  state.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    const key = String(params[0]);
    if (sql.includes("INSERT INTO login_attempts")) {
      const attempts = (state.attempts.get(key) ?? 0) + 1;
      state.attempts.set(key, attempts);
      return { rows: [{ attempts }] };
    }
    if (sql.includes("DELETE FROM login_attempts")) { state.attempts.delete(key); return { rows: [] }; }
    throw new Error(`Nieobsługiwane SQL w teście: ${sql}`);
  });
  process.env.VERCEL = "1";
});
afterEach(() => { delete process.env.APP_PASSWORD; delete process.env.VERCEL; });

function login(password: string, ip: string) {
  return POST(new NextRequest("https://app.test/api/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": ip },
    body: new URLSearchParams({ password, next: "/" })
  }));
}

describe("logowanie", () => {
  it("ogranicza seryjne nieudane próby dla jednego IP", async () => {
    process.env.APP_PASSWORD = "poprawne-haslo";
    for (let attempt = 0; attempt < 5; attempt++) expect((await login("zle", "192.0.2.10")).headers.get("location")).toContain("error=1");
    expect((await login("zle", "192.0.2.10")).headers.get("location")).toContain("error=rate");
  });

  it("czyści licznik po poprawnym logowaniu", async () => {
    process.env.APP_PASSWORD = "poprawne-haslo";
    await login("zle", "192.0.2.11");
    const response = await login("poprawne-haslo", "192.0.2.11");
    expect(response.headers.get("location")).toBe("https://app.test/");
    expect(response.cookies.get("app_session")?.httpOnly).toBe(true);
    expect(response.cookies.get("app_session")?.value).not.toBe("poprawne-haslo");
    const authenticated = await proxy(new NextRequest("https://app.test/", { headers: { cookie: `app_session=${response.cookies.get("app_session")?.value}` } }));
    expect(authenticated.status).toBe(200);
    expect(state.attempts.size).toBe(0);
  });

  it("atomowo ogranicza równoległe próby", async () => {
    process.env.APP_PASSWORD = "poprawne-haslo";
    const responses = await Promise.all(Array.from({ length: 20 }, () => login("zle", "192.0.2.12")));
    const locations = responses.map((response) => response.headers.get("location"));
    expect(locations.filter((location) => location?.includes("error=1"))).toHaveLength(5);
    expect(locations.filter((location) => location?.includes("error=rate"))).toHaveLength(15);
  });
});
