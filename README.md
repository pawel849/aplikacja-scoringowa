# Radar Integratorów

Wewnętrzny, polskojęzyczny MVP do publicznego researchu, deterministycznego scoringu i ręcznej kwalifikacji firm instalacyjnych oraz integratorów smart-home/BMS. System nie wysyła wiadomości i nie wymaga klucza wyszukiwarki ani LLM do importu CSV, ręcznych URL-i, analizy stron, scoringu, dashboardu i eksportu.

## Uruchomienie lokalne

Wymagany jest Node.js 22. Docker ani lokalny PostgreSQL nie są potrzebne.

```bash
npm install
cp .env.example .env.local
npm run db:migrate
npm run dev
```

Bez `DATABASE_URL` aplikacja używa plikowej, zgodnej z PostgreSQL bazy PGlite w `./data/leads`. Dane startowe można pobrać na żywo:

```bash
npm run demo:research
```

Polecenie faktycznie pobiera publiczne strony `https://inteli-home.pl/`, przestrzega robots.txt, zapisuje wynik, dowody i błędy, a następnie drukuje podsumowanie z utrwalonej bazy. Nie ma zakodowanych faktów ani oczekiwanego wyniku.

## Scoring i kompletność

Każda z pięciu kategorii ma 0–2 punkty: zespół/operacyjność, złożoność projektów, wzrost, marketing/sprzedaż, dojrzałość/wiarygodność. Dodatni punkt nie może powstać bez dowodu zawierającego URL, fragment, datę i poziom pewności. Progi: 7–10 osobisty audyt, 4–6 krótka rozmowa kwalifikacyjna, 0–3 pomiń.

Kompletność jest niezależna od jakości firmy. Każdy z dziesięciu niezależnych obszarów daje 10 punktów procentowych: tożsamość, kontakt (co najmniej jeden publiczny kanał), lokalizacja, opis usług, technologia, portfolio, zespół, wiarygodność/partnerstwo, publiczny decydent i aktualna oferta pracy. Strona WWW i samo jej pobranie nie są liczone podwójnie. Poniżej 50% rekomendacja zawsze ma wartość `NEEDS_MORE_RESEARCH`. Brak informacji oznacza brak punktu, nie negatywną ocenę firmy.

Automatyczny research pozostawia status kwalifikacji `UNQUALIFIED` (lub zachowuje wcześniej ręcznie ustawiony status końcowy). `ICP_CONFIRMED` i `DISQUALIFIED` mogą zostać ustawione tylko ręcznie po zapisaniu przynajmniej trzech odpowiedzi z rozmowy.

## CSV

Limit: 2 MB i 1000 rekordów. Kodowanie UTF-8, separator przecinek lub średnik. Kanoniczne nagłówki: `name, website, domain, phone, publicEmail, nip, krs, region, city, country, sourceName, sourceUrl`. Obsługiwane polskie odpowiedniki obejmują: `Nazwa firmy, Strona WWW, Telefon, E-mail, Województwo, Miasto, Kraj, Źródło, URL źródła`. Przykład: `public/sample/firmy.csv`.

Eksport chroni arkusze przed CSV formula injection przez poprzedzenie wartości zaczynających się od `=`, `+`, `-` lub `@` apostrofem.

## Produkcja: Vercel + Neon

1. Utwórz projekt Vercel i podłącz repozytorium.
2. Dodaj integrację Neon/Postgres i ustaw `DATABASE_URL`. To **poświadczenie bazy danych**, a nie klucz API do researchu lub wyszukiwania.
3. Ustaw długi losowy `CRON_SECRET`; Vercel przekazuje go jako Bearer do cotygodniowego crona.
4. Deployment uruchamia skrypt `vercel-build`, który najpierw wykonuje migracje względem produkcyjnego `DATABASE_URL`, a następnie buduje Next.js. Runner wykonuje w kolejności wszystkie pliki `drizzle/*.sql`; migracje są idempotentne. Migrację można też uruchomić ręcznie przez `npm run db:migrate` z ustawionym produkcyjnym `DATABASE_URL`.

Na Vercel `DATABASE_URL` jest obowiązkowe. Aplikacja celowo zgłosi czytelny błąd konfiguracji zamiast uruchomić nietrwałą bazę PGlite. Opcjonalne `APP_PASSWORD` włącza logowanie do całego UI i API (bez endpointu cron, który nadal wymaga `CRON_SECRET`) przez ciasteczko `HttpOnly`, `Secure`, `SameSite=Strict`. Bez `APP_PASSWORD` lokalny development pozostaje otwarty; mutacje nadal odrzucają żądania z obcego `Origin`.

`vercel.json` uruchamia `/api/cron/research` w poniedziałek o 06:00 UTC. Endpoint jest chroniony, zbiera do 30 pozycji z włączonych katalogów, deduplikuje je, sprawdza do pięciu starych firm i dopiero potem wybiera top 5. Błędy katalogu i rechecków są audytowane. Katalog można dodać i włączyć na dashboardzie; konserwatywny parser akceptuje tylko jasno nazwane, zewnętrzne strony firm. `SEARCH_API_KEY` i `LLM_API_KEY` są wyłącznie opcjonalnymi placeholderami.

## Bezpieczeństwo i etyka

Crawler pobiera wyłącznie HTTP(S) z publicznych adresów, blokuje localhost, sieci prywatne i link-local (również po DNS), ma limity czasu, jeden retry z backoffem, podstawowy limit per host, cache 24 h, limit 6 stron i 1 MB HTML. Sprawdza robots.txt i ręcznie waliduje SSRF każdy cel przekierowania (maksymalnie cztery). Nie obchodzi logowania, CAPTCHA ani ochrony antybotowej. React domyślnie escapuje wyświetlany tekst; HTML stron nie jest renderowany.

## Polecenia

```bash
npm run dev
npm run build
npm run lint
npm test
npm run db:migrate
npm run demo:research
```

Architektura rozdziela konektory (`src/research/connectors.ts`), pobieranie/parsing, enrichment/persistencję i scoring, dzięki czemu źródła z Wielkiej Brytanii, USA lub Australii mogą dostarczać ten sam neutralny `DiscoveredCompany`.
