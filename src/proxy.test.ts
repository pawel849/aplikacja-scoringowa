import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";
beforeEach(() => { delete process.env.APP_PASSWORD; delete process.env.VERCEL; });
afterEach(() => { delete process.env.APP_PASSWORD; delete process.env.VERCEL; vi.unstubAllEnvs(); });
describe("ochrona aplikacji", () => {
 it("pozostaje wyłączona lokalnie bez APP_PASSWORD", async () => expect((await proxy(new NextRequest("http://localhost/"))).status).toBe(200));
 it("odmawia działania na Vercel bez APP_PASSWORD", async () => {
  process.env.VERCEL="1";
  expect((await proxy(new NextRequest("https://app.test/"))).status).toBe(503);
 });
 it("odmawia działania na produkcji poza Vercel bez APP_PASSWORD", async () => {
  vi.stubEnv("NODE_ENV", "production");
  expect((await proxy(new NextRequest("https://app.test/"))).status).toBe(503);
 });
 it("chroni UI i API po ustawieniu hasła, ale nie przejmuje crona", async () => {
  process.env.APP_PASSWORD="sekret";
  expect((await proxy(new NextRequest("https://app.test/"))).status).toBe(307);
  expect((await proxy(new NextRequest("https://app.test/api/companies"))).status).toBe(401);
  expect((await proxy(new NextRequest("https://app.test/api/cron/research"))).status).toBe(200);
 });
 it("odrzuca mutację z obcego origin także bez hasła", async () => {
  expect((await proxy(new NextRequest("https://app.test/api/research/batch",{method:"POST",headers:{origin:"https://evil.test"}}))).status).toBe(403);
 });
});
