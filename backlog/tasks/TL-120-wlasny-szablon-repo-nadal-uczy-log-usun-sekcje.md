---
id: TL-120
title: "Własny szablon repo nadal uczy ## Log — usuń sekcję"
type: task
labels: []
board: main
epic: "Historia i atrybucja"
priority: P2
status: done
owner: agent:claude
estimate: 30m
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-field-editing-history.md
verification:
  - id: no-log-in-templates
    bash: "node --test scripts/tests/change-reason.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Cel

Task utworzony przez `worktrail new` w TYM repozytorium nie zawiera sekcji
`## Log`, a strażnik tego faktu ocenia KAŻDY szablon leżący na dysku, nie jeden
wskazany ścieżką.

## Kontekst

TL-105 przeniósł „dlaczego" ze zdania w pliku taska do pola `reason` rekordu
w `backlog/history/`. Usunął `## Log` z szablonu — ale z JEDNEGO. Weryfikacja
tamtego taska brzmiała:

```
grep -q '## Log' _template.md && { echo 'szablon nadal uczy ## Log'; exit 1; }
```

To jest ścieżka do szablonu, który JEDZIE W TARBALLU i który `worktrail init`
kopiuje do cudzych repozytoriów. Tymczasem `new-task.mjs:181` czyta
`join(root, "_template.md")`, gdzie `root` to rozwiązany katalog backlogu —
czyli tutaj `backlog/_template.md`. To DRUGI plik, o innej treści (polski,
932 B wobec 2,5 kB) i on sekcję zachował.

Skutek: strażnik był zielony, a narzędzie przez cały ten czas wpisywało
„Append-only. Format: `YYYY-MM-DD status — kto — notatka`." do każdego taska
zakładanego w tym repozytorium. Dowodem jest sam ten plik — powstał z wadliwego
szablonu i przyszedł na świat z sekcją `## Log`.

**Czego NIE trzeba ruszać.** `scripts/init-backlog.mjs` nie trzyma własnej kopii
szablonu: `TEMPLATE_PATH = join(HERE, "..", TEMPLATE_FILENAME)` i `readTemplate()`
czytają korzeniowy `_template.md` — decyzja z TL-50, żeby druga kopia nie
rozjechała się z pierwszą. Cudze repozytoria dostają więc szablon już czysty
i zmiana ich nie dotyczy. Usunięcie należy WYŁĄCZNIE do `backlog/_template.md`.

**Czego NIE wolno ruszać.** Istniejące taski z sekcją `## Log` zostają
(CLAUDE.md): to zdania, których nikt nie odtworzy. Ten task usuwa szablon,
nie historię.

**Klasa błędu, nie literówka.** Strażnik nazywający jedną ścieżkę jest tym
samym, przed czym ostrzega CLAUDE.md: zielony bez mocy dowodowej, bo przechodzi
na próbce, która pomija plik faktycznie używany. Dlatego lista szablonów ma być
WYLICZONA — korzeń repozytorium i katalog backlogu, zdjęte w jedno w układzie
ko-lokowanym — a nie wpisana.

## Pre-flight reading

1. `backlog/_template.md` — plik do zmiany; sekcja na końcu.
2. `_template.md` — szablon wysyłkowy, JUŻ czysty; punkt odniesienia dla treści.
3. `scripts/new-task.mjs:181` — dowód, że `new` czyta szablon z katalogu backlogu.
4. `scripts/init-backlog.mjs:132-150` — dowód, że `init` nie trzyma drugiej kopii.
5. `scripts/tests/change-reason.test.mjs` — nagłówek pliku nazywa zastępowaną
   konwencję; strażnik należy tutaj, a nie do nowego pliku.
6. `scripts/tests/_repo.mjs` — stąd bierze się katalog backlogu; nie licz go sam.

## Kroki

1. Usuń `## Log` wraz z linią „Append-only…" z `backlog/_template.md`.
2. W `scripts/tests/change-reason.test.mjs` dołóż strażnika: lista szablonów
   wyliczona z `REPO_ROOT` i `BACKLOG_DIR` (`_repo.mjs`), zdjęta przez `Set`,
   wzorzec dopasowuje NAGŁÓWEK (`/^##[ \t]+Log[ \t]*$/m`), nie słowo.
3. Dołóż test end-to-end: dla każdego szablonu załóż tymczasowy backlog przez
   `init --no-example`, nadpisz w nim `_template.md` badanym plikiem, uruchom
   `new` i sprawdź UTWORZONY task. Czytanie szablonu nie dowodzi, co zapisuje
   `new`.
4. Dołóż kontrolę pozytywną: dopisz sekcję z powrotem do szablonu w piaskownicy
   i sprawdź, że ten sam wzorzec ją WIDZI.
5. Popraw nieaktualny komentarz w `scripts/tests/new-task.test.mjs` (mówi
   o `YYYY-MM-DD` „w sekcji ## Log", której już nie ma).
6. Istniejących tasków nie dotykaj.

## Acceptance criteria

- [x] `backlog/_template.md` nie zawiera nagłówka `## Log`. [proof: no-log-in-templates]
- [x] Task z `worktrail new` nie ma `## Log` — dla każdego szablonu na dysku. [proof: no-log-in-templates]
- [x] Strażnik OBLEWA, gdy sekcja wróci do szablonu (kontrola pozytywna). [proof: no-log-in-templates]
- [x] Pełny pakiet testów jest zielony. [proof: suite-green]
