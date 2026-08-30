---
id: TL-72
title: "Koperta JSON: wersjonowany kontrakt zamiast gołej tablicy"
type: code
labels: [post-launch]
board: main
epic: "Powierzchnia CLI"
priority: P1
status: done
owner: agent:claude
estimate: 4h
confidence: high
created: 2026-08-31
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - docs/worktrail-global-tool.md
verification:
  - id: envelope-suite
    bash: "node --test scripts/tests/json-envelope.test.mjs"
  - id: query-envelope
    bash: "node scripts/cli.mjs query --status pending --json | node -e \"const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(d.schemaVersion!==1||d.kind!=='task-list'||!Array.isArray(d.tasks)) process.exit(1)\""
---

## Cel

Każda komenda czytająca zwraca `--json` w kopercie z `schemaVersion` i `kind`,
a nie surową tablicę. Po tym tasku da się dołożyć do odpowiedzi pole
(ostrzeżenie, użyty katalog, liczbę wyników) bez zerwania czyjegokolwiek
skryptu.

## Kontekst

IV prawo mówi, że `--json` JEST naszym API rozszerzeń — nie mamy API wtyczek,
więc kontrakt JSON-a jest jedyną powierzchnią, o którą ktoś może się oprzeć.
Dziś `query --json` zwraca gołą tablicę obiektów. Goła tablica nie ma miejsca na
metadane: jedyny sposób na dołożenie czegokolwiek to zmiana korzenia z tablicy
na obiekt, czyli zerwanie każdego istniejącego konsumenta. Im dłużej to stoi,
tym droższa staje się ta zmiana — dlatego P1 mimo braku widocznego objawu.

Wzorzec wzięty z Backlog.md (MrLesk), który ten sam problem rozwiązał kopertą
`{ schemaVersion, kind, tasks }` i spisanym kontraktem: pola nieobecne to
`null`, kolekcje puste to `[]`, dodanie pola jest wstecznie zgodne, a usunięcie,
przemianowanie lub zmiana znaczenia pola wymaga nowej `schemaVersion`.

Rozstrzygnięte przed startem: koperta obowiązuje WSZYSTKIE komendy czytające
(`query`, `stats`, `doctor`, `board`, `next-id`), nie tylko `query` — inaczej
mamy dwa kontrakty i użytkownik musi pamiętać, który jest gdzie. To jest zmiana
łamiąca dla `query --json`; wersja pakietu to `0.1.0` i nic jeszcze nie zostało
opublikowane, więc robimy ją TERAZ, bez ścieżki migracyjnej i bez flagi zgodności.

## Pre-flight reading

1. `scripts/query.mjs:205` — jedyne dziś miejsce emisji tablicy.
2. `scripts/doctor.mjs`, `scripts/stats-report.mjs`, `scripts/ui.mjs` — pozostałe
   emitery `--json`; sprawdź, jaki kształt zwraca każdy z nich dzisiaj.
3. `docs/worktrail-global-tool.md` §3 — brzmienie IV prawa, żeby kontrakt spisać
   tam, gdzie już mieszka uzasadnienie.

## Kroki

1. `scripts/json-envelope.mjs` — jedna funkcja `envelope(kind, payload)`, jedno
   miejsce, które zna numer wersji. Żaden emiter nie buduje koperty sam.
2. Przepnij wszystkie emitery `--json` na tę funkcję; nadaj `kind` każdej
   komendzie (`task-list`, `stats`, `doctor`, `board`, `next-id`).
3. Ustal i zaimplementuj reguły pustki: skalar nieobecny = `null`, kolekcja
   nieobecna = `[]`. Nie pomijaj kluczy.
4. Spisz kontrakt w README (sekcja o `--json`) — co gwarantujemy, co może
   przyrosnąć, co wymaga nowej wersji.
5. `scripts/tests/json-envelope.test.mjs` — dla KAŻDEJ komendy czytającej:
   parsuje się, ma `schemaVersion`, ma właściwy `kind`, klucze pustki są obecne.
   Test musi oblewać przy pustym backlogu inaczej niż przy niepustym (kontrola
   pozytywna — zerowa próbka nie może go zazielenić).

## Acceptance criteria

- [x] Każda komenda czytająca z `--json` zwraca obiekt z `schemaVersion` i `kind`. [proof: envelope-suite, query-envelope]
- [x] Numer wersji jest w jednym miejscu w kodzie, nie w każdym emiterze. [proof: envelope-suite]
- [x] Skalar nieobecny to `null`, kolekcja nieobecna to `[]` — nigdy brak klucza. [proof: envelope-suite]
- [x] README opisuje każdy rodzaj, który kod potrafi wyemitować. [proof: envelope-suite]
- [x] Test pokrywa wszystkie emitery i ma kontrolę pozytywną. [proof: envelope-suite]

## Log

2026-08-31 pending — agent:claude — założony z analizy Backlog.md (github.com/MrLesk/Backlog.md), punkt 1.
