# Radar Integratorów

Wewnętrzny, polskojęzyczny MVP do odkrywania firm w oficjalnych katalogach partnerów, publicznego researchu, deterministycznego scoringu i ręcznej kwalifikacji firm instalacyjnych oraz integratorów smart-home/BMS. System nie wysyła wiadomości i nie wymaga klucza wyszukiwarki ani LLM do katalogów Loxone, Grenton i Ampio, importu CSV, ręcznych URL-i, analizy stron, scoringu, dashboardu i eksportu.

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

Na produkcji `DATABASE_URL` i `APP_PASSWORD` są obowiązkowe. Aplikacja działa fail-closed: przy braku któregoś ustawienia zgłasza błąd konfiguracji zamiast uruchamiać nietrwałą bazę PGlite lub publiczny panel. Logowanie chroni całe UI i API (poza endpointem cron, który wymaga osobnego `CRON_SECRET`) ciasteczkiem `HttpOnly`, `Secure`, `SameSite=Strict` i atomowo ogranicza seryjne nieudane próby w PostgreSQL. Vercel dostarcza zaufany adres klienta; na innym hostingu trzeba ustawić `TRUSTED_CLIENT_IP_HEADER` zgodnie z nagłówkiem nadpisywanym przez zaufany reverse proxy. Bez `APP_PASSWORD` tylko lokalny development pozostaje otwarty; mutacje nadal odrzucają żądania z obcego `Origin`.

`vercel.json` uruchamia `/api/cron/research` w poniedziałek o 06:00 UTC. Endpoint jest chroniony, zbiera do 15 nowych firm z oficjalnych katalogów Loxone, Grenton i Ampio, deduplikuje je, przeplata wyniki źródeł i bada firmy w kontrolowanym budżecie czasu. Katalogi służą wyłącznie odkrywaniu kandydatów: batch nie traktuje ich jako kompletnego obrazu rynku i nie wygasza dowodów, statusów ani scoringu już zapisanych firm. Katalog KNX jest zapisany jako źródło potwierdzające certyfikację, ale jego publiczny endpoint nie udostępnia stron WWW instalatorów, dlatego sam nie dostarcza rekordów do crawlowania. W pozostałym budżecie cron sprawdza do pięciu starych firm i wybiera top 5. Błędy katalogów i ponownych sprawdzeń są audytowane. Nieoficjalny katalog można dodać na dashboardzie; konserwatywny parser odrzuca nawigację producentów, social media, sklepy, wsparcie i strony typu „Kariera”. `SEARCH_API_KEY` i `LLM_API_KEY` są wyłącznie opcjonalnymi placeholderami.

## Bezpieczeństwo i etyka

Crawler pobiera wyłącznie HTTP(S) z publicznych adresów, blokuje localhost, sieci prywatne, zastrzeżone i link-local. Każde połączenie jest przypięte do wcześniej zweryfikowanego wyniku DNS, co ogranicza DNS rebinding; te same zasady obejmują `robots.txt` i każdy cel ręcznie obsługiwanego przekierowania. Odpowiedzi są ograniczane strumieniowo do 1 MB HTML i 64 kB `robots.txt`, zanim zostaną w całości załadowane do pamięci. Crawler ma limity czasu, jeden retry z backoffem, limit per host, cache 24 h i limit 6 stron. Nie obchodzi logowania, CAPTCHA ani ochrony antybotowej. React domyślnie escapuje wyświetlany tekst; HTML stron nie jest renderowany.

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
