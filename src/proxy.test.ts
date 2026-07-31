import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";
beforeEach(() => { delete process.env.APP_PASSWORD; });
afterEach(() => { delete process.env.APP_PASSWORD; });
describe("ochrona aplikacji", () => {
 it("pozostaje wyłączona lokalnie bez APP_PASSWORD", async () => expect((await proxy(new NextRequest("http://localhost/"))).status).toBe(200));
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
