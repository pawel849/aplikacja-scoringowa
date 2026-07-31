DO $$
BEGIN
  UPDATE research_sources
  SET enabled=true, config='{"url":"https://www.loxone.com/plpl/sprzedaz/znajdz-partnera/"}'::jsonb
  WHERE name='Loxone'
    AND config->>'url' = 'https://www.loxone.com/plpl/';

  UPDATE research_sources
  SET enabled=true, config='{"url":"https://grenton.pl/dla-twojego-domu/mapa-znajdz-instalatora/"}'::jsonb
  WHERE name='Grenton'
    AND config->>'url' = 'https://grenton.pl/';

  UPDATE research_sources
  SET enabled=true, config='{"url":"https://ampio.com/pl/kontakt"}'::jsonb
  WHERE name='Ampio'
    AND config->>'url' = 'https://ampio.pl/';

  UPDATE research_sources
  SET enabled=false, config='{"url":"https://www.knx.org/find-an-installer","note":"Publiczny katalog KNX nie udostępnia stron WWW instalatorów."}'::jsonb
  WHERE name='KNX'
    AND config->>'url' = 'https://www.knx.org/';
END $$;
