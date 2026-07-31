# Dodawanie źródła researchu

Źródło ma wyłącznie odkrywać kandydatów. Nie przyznaje punktów i nie zgaduje danych.

1. Zaimplementuj `ResearchConnector` z `src/research/connectors.ts`. `discover(limit)` zwraca neutralne rekordy `DiscoveredCompany`, koniecznie z nazwą źródła oraz publicznym URL-em źródłowym, jeśli istnieje.
2. Dla katalogu skonfiguruj `DirectoryConnector`. Startery Loxone, KNX, Grenton, Ampio, OSFIS, PSIW, PISA, list targowych i ofert pracy istnieją w tabeli `research_sources`, ale są celowo wyłączone. Włączaj je dopiero po sprawdzeniu regulaminu, robots.txt i stabilnego parsera.
3. Parser musi zwracać wyłącznie informacje obecne na stronie. Blokada, nieobsługiwany układ lub brak wymaganych pól ma dać pusty wynik albo audytowalny `ResearchError`, nigdy wymyślony rekord.
4. Nie umieszczaj scoringu w konektorze. Pipeline scala kandydata według domeny, NIP/KRS, telefonu i konserwatywnej nazwy; crawler zbiera dowody, a deterministyczny scorer je ocenia.
5. Dodaj fixture HTML bez danych osobowych i testy parsera: poprawny rekord, pustą stronę, zmieniony układ, HTTP error oraz limit.
6. Dla nowego kraju zachowaj `country` jako ISO alpha-2 (`GB`, `US`, `AU`) i dodaj osobny moduł normalizacji identyfikatorów/telefonów, zamiast zmieniać ogólny kontrakt konektora.

Źródła wymagające logowania, CAPTCHA, obchodzenia blokad albo niepublicznego API są niedopuszczalne. Aktywnych reklam nie wolno wnioskować z kodu strony lub tekstu marketingowego; wymagany jest bezpośredni, wiarygodny dowód.
