---
id: TL-55
title: "Eksport viewera do jednego pliku do wysłania"
type: task
labels: [post-launch]
board: main
epic: "Backlog viewer"
priority: P3
status: pending
owner: unassigned
estimate: 4h
confidence: low
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - .claude/skills/worktrail-viewer/SKILL.md
verification:
  - bash: "d=$(mktemp -d) && node scripts/cli.mjs export --out \"$d/backlog.html\" >/dev/null && test -s \"$d/backlog.html\" && echo 'eksport powstaje — OK'"
  - bash: "d=$(mktemp -d) && node scripts/cli.mjs export --out \"$d/backlog.html\" >/dev/null && grep -q 'localhost\\|127.0.0.1\\|EventSource' \"$d/backlog.html\" && { echo 'eksport odwołuje się do serwera'; exit 1; }; echo 'eksport samodzielny — OK'"
  - manual: "Plik wysłany osobie bez terminala: otwiera się dwuklikiem, filtry i wyszukiwanie działają, edycja jest wyraźnie niedostępna."
---

## Cel

Dać nietechnicznemu odbiorcy backlog **bez terminala**: jeden plik, który da się
wysłać, otworzyć dwuklikiem i przefiltrować.

## Kontekst

Viewer jest już samodzielny — `build-viewer.mjs` osadza wszystkie dane w jednym
pliku HTML, bez pobierania czegokolwiek w trakcie działania, więc działa przez
`file://`. Brakuje **drogi do niego dla kogoś, kto nie ma terminala**:
`backlog/viewer.html` jest gitignorowany (i słusznie — to agregat wszystkich
tasków, więc wersjonowany konfliktowałby przy rozłącznych zmianach), a jedyne
wejście to `worktrail serve`, czyli polecenie w powłoce.

Skutek jest taki, że analityk albo menedżer musi kogoś poprosić o uruchomienie
serwera. To jest dokładnie ta rola, dla której przeglądarkowy widok w ogóle
powstał.

**Co trzeba rozstrzygnąć, zanim to powstanie — dlatego `confidence: low`:**

1. **Czy eksport jest tylko do odczytu.** Viewer potrafi edytować pola i zapisuje
   historię z aktorem. Plik wysłany mailem nie ma dokąd zapisać; przyciski, które
   nic nie robią, są gorsze od ich braku. Prawdopodobnie eksport = tryb tylko do
   odczytu, z widocznym oznaczeniem, i to jest decyzja produktowa, nie techniczna.
2. **Znacznik czasu.** Plik jest zdjęciem stanu z konkretnej chwili i po tygodniu
   kłamie. Data budowy musi być widoczna w samym dokumencie, nie w nazwie pliku,
   bo nazwa nie przeżyje przesłania dalej.
3. **Co się w nim znajdzie.** Wysłanie całego backlogu bywa niepożądane. Eksport
   powinien przyjmować te same filtry co `query`, żeby dało się wysłać przekrój,
   a nie wszystko.

Alternatywa, którą warto rozważyć zamiast eksportu ręcznego: publikacja na
GitHub Pages z CI. Nie wyklucza się z tym taskiem — obie drogi używają tego samego
generatora — ale ma inną cenę (backlog staje się publiczny) i dlatego jest osobną
decyzją, nie krokiem tutaj.

## Pre-flight reading

1. `scripts/build-viewer.mjs` — `buildHtml()`; strona już jest samodzielna.
2. `scripts/serve-backlog.mjs` — co dokłada serwer (SSE, zapisy) i co musi zniknąć w eksporcie.
3. `.claude/skills/worktrail-viewer/SKILL.md` — jeden renderer; eksport nie może być drugą kopią szablonu.
4. `scripts/query.mjs` — kontrakt filtrów do ponownego użycia.

## Kroki

1. `worktrail export --out <plik>` na tym samym generatorze co `viewer` i `serve`. Nie druga ścieżka renderowania.
2. Tryb tylko do odczytu: bez edytorów pól, bez SSE, bez odwołań do `127.0.0.1`. Widoczna informacja, że to migawka.
3. Data i godzina budowy w nagłówku dokumentu.
4. Filtry `query` jako opcjonalne zawężenie eksportu.
5. Test: eksport powstaje, nie zawiera odwołań do serwera, zawiera datę budowy.
6. README: jedno zdanie o tym, jak wysłać backlog komuś, kto nie otwiera terminala.

## Acceptance criteria

- [ ] `worktrail export --out <plik>` daje jeden samodzielny plik HTML.
- [ ] Plik nie odwołuje się do serwera ani nie pokazuje nieczynnych edytorów.
- [ ] Data budowy widoczna w dokumencie.
- [ ] Eksport przyjmuje filtry `query`.
- [ ] Ten sam generator co `viewer` i `serve`.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 created — agent:claude — z audytu ścieżki dla ról nietechnicznych
