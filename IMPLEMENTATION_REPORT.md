# Raport implementacji

Data końcowej weryfikacji: 2026-07-31 UTC. Nie wykonano push ani deploymentu.

## Zrealizowane poprawki

Parser i scoring nie traktują opinii klientów ani ogólnego, pojedynczego słowa „ekipa” jako dowodu zespołu. TEAM 1 wymaga jawnego kontekstu zespołu z wieloma osobami/współpracownikami albo oferty pracy; TEAM 2 wymaga wielu ekip lub rozdzielenia roli prowadzącej od wykonania. Kontakty pochodzą z widocznego tekstu, `mailto`, bezpiecznie odczytanego JSON-LD i HTML; placeholdery oraz telefony maskowane/niepełne są odrzucane. Publiczne NIP, KRS, lokalizacja, opis usług, partnerstwa, technologie i portfolio są utrwalane bez zgadywania.

Dowód zachowuje URL konkretnej sparsowanej strony, fragment, pewność i datę. Widoczny proces kontaktu może dać MARKETING 1 bez literalnego `<form>`; aktywne reklamy nigdy nie są wnioskowane. Kompletność obejmuje dziesięć niezależnych obszarów opisanych w README i nie liczy strony oraz pobrania jako dwóch pól.

Dodano pełną korektę ręczną wszystkich wymaganych pól, walidację Zod i `manual_overrides`; recheck nie nadpisuje ręcznych wartości. Dashboard ma wspólny, parametryzowany builder filtrów wyszukiwania, kraju, regionu, technologii, źródła, wyniku i sortowania. Ten sam builder obsługuje API oraz eksport widoku. Eksport zachowuje filtry, jest formula-safe i zawiera kontakt, decydenta, źródła i streszczenie dowodów. Kolejka obejmuje niezamknięte rekomendacje audytu/rozmowy.

Dodano zarządzanie katalogami, bezpieczne pobieranie przez wspólną ochronę SSRF/robots/retry/cache/rate-limit, konserwatywny parser zewnętrznych firm i audytowalny błąd pustego wyniku. Batch/cron zapisują błędy i końcowe statusy, unikają zagnieżdżonych runów batcha, recheckują stare rekordy i wybierają top 5 po odświeżeniu.

Mutacje są chronione kontrolą same-origin. Opcjonalne `APP_PASSWORD` chroni UI/API bezpiecznym ciasteczkiem; cron pozostaje oddzielnie chroniony `CRON_SECRET`. Produkcja Vercel bez `DATABASE_URL` zgłasza jasny błąd i nigdy nie przechodzi na PGlite. Runner wykonuje idempotentnie wszystkie migracje; dodano `0001_operational_indexes.sql`. Widoczne rekomendacje, kwalifikacje, kontakty i poziomy pewności mają polskie etykiety.

## Końcowa weryfikacja

- `npm run db:migrate` — sukces: `0000_initial.sql` i `0001_operational_indexes.sql`.
- `npm test` — sukces: 6 plików, 27/27 testów.
- `npm run lint` — sukces, bez błędów i ostrzeżeń.
- `npm run build` — sukces; kompilacja, typy i generowanie 12 stron zakończone.
- `npm run demo:research` — sukces, 4 strony, 0 błędów fetch.
- Produkcyjny `npm start`, bez `APP_PASSWORD`:
  - dashboard 200 (15 757 B),
  - szczegóły firmy 200 (24 262 B),
  - lista źródeł API 200,
  - filtrowane API firm 200,
  - filtrowany eksport 200 i tylko pasujący rekord,
  - kolejka kontaktu 200,
  - cron bez sekretu 401,
  - obcy `Origin` dla mutacji 403,
  - korekta nieistniejącej firmy 404.
- Produkcyjny `npm start`, z `APP_PASSWORD`:
  - UI bez sesji 307 do `/login`,
  - API bez sesji 401,
  - poprawne logowanie 303 i cookie `Secure; HttpOnly; SameSite=strict`,
  - API z cookie 200,
  - cron bez `CRON_SECRET` nadal 401.

Próba automatycznego smoke przez browser-harness została wykonana, ale środowisko nie miało uruchomionego Chrome ani aktywnego połączenia CDP (`browser-harness --doctor`: FAIL). Nie oznaczono jej jako sukcesu; pełne trasy produkcyjne sprawdzono przez HTTP jak wyżej.

## Live Inteli Home

Świeża lokalna baza została utworzona ponownie przed końcowym live research. Wynik nie jest zakodowany:

- score 4/10, kompletność 70%, rekomendacja `QUALIFICATION_CALL`,
- TEAM 0 — testimonial „Bardzo fachowa ekipa” nie jest dowodem,
- COMPLEXITY 2 — BMS/Loxone, publiczny fragment, `https://inteli-home.pl/`, MEDIUM, data w bazie,
- GROWTH 0 — brak publicznego dowodu,
- MARKETING 1 — widoczna wiadomość/odpowiedź w 24 h i pola kontaktowe, `https://inteli-home.pl/`, MEDIUM, data w bazie,
- MATURITY 1 — publiczne realizacje/portfolio; powtarzające się linki nie są liczone jako wiele niezależnych realizacji, `https://inteli-home.pl/`, MEDIUM, data w bazie.

Utrwalone fakty: `kontakt@inteli-home.pl`, NIP `5833465151`, KRS `0001005412`, Gdańsk/pomorskie, BMS i Loxone, opis usług, `Loxone Partner`/`Loxone Silver Partner` oraz publiczne URL-e realizacji. W aktualnym pobranym HTML telefon był jawny i kompletny (`+48 793 386 450`), więc został zapisany; maskowany wariant byłby pominięty. Brak publicznego decydenta, wiarygodnej liczby opinii i aktualnych ofert pracy pozostaje jawnie oznaczony. Pytania o popyt, moce, zatrudnienie, obsługę zapytań, wąskie gardło właściciela oraz pożądane/unikane zlecenia są drukowane jako dane wyłącznie z rozmowy.

Po niezależnym przeglądzie dodano osobny test regresyjny dojrzałości: wynik nie może rosnąć do 2 punktów przez duplikaty tego samego URL portfolio. Końcowy przebieg po tej poprawce: 7 plików i 31/31 testów, lint bez uwag, build produkcyjny zakończony sukcesem. Ponowny live research zwrócił wynik 4/10 pokazany powyżej.
