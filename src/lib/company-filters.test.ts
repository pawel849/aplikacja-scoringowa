import { expect, it } from "vitest";
import { buildCompanyWhere, parseCompanyFilters } from "./company-filters";

it("buduje parametryzowane filtry JSONB dla technologii i źródła", () => {
  const built = buildCompanyWhere(parseCompanyFilters(new URLSearchParams("tech=KNX&source=Katalog&minScore=4")));
  expect(built.sql).toContain("technologies @> $1::jsonb");
  expect(built.sql).toContain("source_names @> $2::jsonb");
  expect(built.values).toEqual(['["KNX"]', '["Katalog"]', 4]);
  expect(built.sql).not.toContain("? ?");
});
