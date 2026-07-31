DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM companies WHERE normalized_phone IS NOT NULL GROUP BY normalized_phone HAVING count(*) > 1) THEN
    RAISE WARNING 'Pominięto unikalny indeks telefonu: istnieją duplikaty wymagające ręcznego scalenia.';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS companies_normalized_phone_unique_idx ON companies(normalized_phone) WHERE normalized_phone IS NOT NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM companies WHERE length(normalized_name) >= 8 GROUP BY normalized_name HAVING count(*) > 1) THEN
    RAISE WARNING 'Pominięto unikalny indeks nazwy: istnieją duplikaty wymagające ręcznego scalenia.';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS companies_normalized_name_unique_idx ON companies(normalized_name) WHERE length(normalized_name) >= 8;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS research_locks (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  token uuid NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  key text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now()
);
