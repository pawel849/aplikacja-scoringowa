DO $$ BEGIN CREATE TYPE confidence AS ENUM ('LOW','MEDIUM','HIGH'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE qualification_status AS ENUM ('UNQUALIFIED','NEEDS_RESEARCH','ICP_CONFIRMED','DISQUALIFIED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS companies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, normalized_name text NOT NULL, domain text UNIQUE, website text, country text NOT NULL DEFAULT 'PL',
 region text, city text, phone text, normalized_phone text, public_email text, nip text UNIQUE, krs text UNIQUE, source_names jsonb NOT NULL DEFAULT '[]',
 source_urls jsonb NOT NULL DEFAULT '[]', technologies jsonb NOT NULL DEFAULT '[]', partnership_levels jsonb NOT NULL DEFAULT '[]', service_description text,
 portfolio_urls jsonb NOT NULL DEFAULT '[]', review_count integer, review_source text, public_job_postings jsonb NOT NULL DEFAULT '[]', decision_makers jsonb NOT NULL DEFAULT '[]',
 checked_at timestamptz, score integer NOT NULL DEFAULT 0 CHECK(score BETWEEN 0 AND 10), completeness integer NOT NULL DEFAULT 0 CHECK(completeness BETWEEN 0 AND 100),
 recommendation text NOT NULL DEFAULT 'NEEDS_MORE_RESEARCH', classification text, contact_status text NOT NULL DEFAULT 'NEW',
 qualification_final_status qualification_status NOT NULL DEFAULT 'UNQUALIFIED', notes text, manual_overrides jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS companies_normalized_phone_idx ON companies(normalized_phone);
CREATE INDEX IF NOT EXISTS companies_normalized_name_idx ON companies(normalized_name);
CREATE TABLE IF NOT EXISTS evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE, scoring_category text NOT NULL,
 awarded_points integer NOT NULL DEFAULT 0 CHECK(awarded_points BETWEEN 0 AND 2), context text, source_url text NOT NULL, excerpt text NOT NULL,
 found_at timestamptz NOT NULL DEFAULT now(), confidence confidence NOT NULL, evidence_type text NOT NULL
);
CREATE TABLE IF NOT EXISTS score_breakdowns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE, category text NOT NULL,
 points integer NOT NULL CHECK(points BETWEEN 0 AND 2), rationale text NOT NULL, evidence_ids jsonb NOT NULL DEFAULT '[]', updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id, category)
);
CREATE TABLE IF NOT EXISTS qualification_answers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE, wants_more_projects text,
 capacity_hiring_plan text, inquiry_owner text, owner_bottleneck text, desired_jobs text, avoided_jobs text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS research_sources (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE, type text NOT NULL, enabled boolean NOT NULL DEFAULT false, config jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS research_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type text NOT NULL, status text NOT NULL DEFAULT 'RUNNING', started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, stats jsonb NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS research_errors (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid REFERENCES research_runs(id) ON DELETE SET NULL, company_id uuid REFERENCES companies(id) ON DELETE CASCADE, source_name text, url text, code text NOT NULL, message text NOT NULL, retryable boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS fetch_cache (url text PRIMARY KEY, status integer NOT NULL, content text, content_type text, fetched_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL);
INSERT INTO research_sources(name,type,enabled,config) VALUES
('Loxone','DIRECTORY',false,'{"url":"https://www.loxone.com/plpl/"}'),('KNX','DIRECTORY',false,'{"url":"https://www.knx.org/"}'),
('Grenton','DIRECTORY',false,'{"url":"https://grenton.pl/"}'),('Ampio','DIRECTORY',false,'{"url":"https://ampio.pl/"}'),
('OSFIS','DIRECTORY',false,'{}'),('PSIW','DIRECTORY',false,'{}'),('PISA','DIRECTORY',false,'{}'),
('Targi branżowe','EXHIBITOR_LIST',false,'{}'),('Oferty pracy','JOB_LIST',false,'{}')
ON CONFLICT(name) DO NOTHING;
