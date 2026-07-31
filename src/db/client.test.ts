import { afterEach, describe, expect, it, vi } from "vitest";
import { sanitizeSqlString } from "./client";
afterEach(() => vi.unstubAllEnvs());

describe("sanityzacja parametrów Neon", () => {
  it("zastępuje rzeczywiste samotne surogaty, ale zachowuje poprawne pary", () => {
    expect(sanitizeSqlString(`A${String.fromCharCode(0xd800)}B`)).toBe("A�B");
    expect(sanitizeSqlString("A😀B")).toBe("A😀B");
  });

  it("zastępuje samotne escape unicode odrzucane przez HTTP Neon", () => {
    expect(sanitizeSqlString('{"text":"\\ud800"}')).toBe('{"text":"�"}');
    expect(sanitizeSqlString('{"text":"\\ud83d\\ude00"}')).toBe('{"text":"\\ud83d\\ude00"}');
  });

  it("nie uruchamia nietrwałej bazy bez DATABASE_URL na produkcji", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { getClient } = await import("./client");
    expect(() => getClient()).toThrow("Brak DATABASE_URL");
  });
});
