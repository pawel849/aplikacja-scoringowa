import { describe, expect, it } from "vitest";
import { sanitizeSqlString } from "./client";

describe("sanityzacja parametrów Neon", () => {
  it("zastępuje rzeczywiste samotne surogaty, ale zachowuje poprawne pary", () => {
    expect(sanitizeSqlString(`A${String.fromCharCode(0xd800)}B`)).toBe("A�B");
    expect(sanitizeSqlString("A😀B")).toBe("A😀B");
  });

  it("zastępuje samotne escape unicode odrzucane przez HTTP Neon", () => {
    expect(sanitizeSqlString('{"text":"\\ud800"}')).toBe('{"text":"�"}');
    expect(sanitizeSqlString('{"text":"\\ud83d\\ude00"}')).toBe('{"text":"\\ud83d\\ude00"}');
  });
});
