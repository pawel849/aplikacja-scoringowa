CREATE INDEX IF NOT EXISTS companies_country_idx ON companies(country);
CREATE INDEX IF NOT EXISTS companies_region_idx ON companies(region);
CREATE INDEX IF NOT EXISTS companies_score_idx ON companies(score);
CREATE INDEX IF NOT EXISTS companies_technologies_gin_idx ON companies USING gin(technologies);
CREATE INDEX IF NOT EXISTS companies_source_names_gin_idx ON companies USING gin(source_names);
CREATE INDEX IF NOT EXISTS research_sources_enabled_idx ON research_sources(enabled);
