---
id: TL-14
title: "query.mjs — pytanie do backlogu zamiast czytania całego widoku"
type: code
labels: [post-launch, ops-hardening]
board: main
epic: ""
priority: P2
status: done
owner: claude
estimate: 2h
confidence: high
created: 2026-08-29
updated: 2026-08-29
blocked_by: []
blocks: []
related_docs:
  - backlog/README.md
verification:
  - bash: "node --test backlog/scripts/tests/boards.test.mjs"
  - bash: "node backlog/scripts/query.mjs --status blocked --epic Legal"
---

## Cel

Trzeci krok serii po TL-12 (odchudzenie INDEX-u) i TL-13 (NOW.yaml): zamienić **stały** koszt odczytu na koszt dopasowany do pytania.

## Kontekst

`INDEX.yaml` to dziś ~17k tokenów, `NOW.yaml` ~3k — i płaci się je w całości niezależnie od tego, o co się pyta. „Co jest zablokowane w Legal compliance" to jeden wiersz; zmierzone: **193 B odpowiedzi (~48 tokenów) w 58 ms** zamiast 17k tokenów.

Dwie decyzje, które wyszły przy pisaniu:

**Czyta `tasks/*.md`, nie widoki.** Widoki są generowane; gdyby to one były źródłem odpowiedzi, świeżo zmieniony status byłby niewidoczny aż do regeneracji i zapytanie mylnie potwierdzałoby, że zmiana „nie zadziałała". Cena to ~1350 odczytów plików — 58 ms, mniej niż trwa spojrzenie w wynik. Test pilnuje tej własności wprost (zmiana pliku bez regeneracji musi być widoczna).

**Literówka we fladze oblewa (exit 2).** `--prioryty P0` zwracające zero wyników jest nieodróżnialne od „nic takiego nie ma" — i czyta się jak odpowiedź. To ta sama klasa co pomiar bez kontroli pozytywnej. Z tego samego powodu `--limit` **mówi**, ile odciął (`# pokazano 5 z 12 pasujących`), zamiast po cichu podać wycinek jako komplet.

Bez jawnego `--status` pytanie dotyczy tylko aktywnych: 1009 z 1346 tasków jest zamkniętych i zalałyby każdą odpowiedź. `--status done` wchodzi w archiwum świadomie.

## Acceptance criteria

- [x] Filtry `--status --priority --board --label --epic --owner --type --blocked-by --text`; AND między osiami, OR po przecinku wewnątrz osi.
- [x] Wyjścia: linia na task (jak w INDEX-ie), `--json`, `--files` (pod `xargs`), `--count`; `--sort priority|id|id-desc`.
- [x] Nieznana flaga → exit 2 z jej nazwą; `--limit` raportuje obcięcie.
- [x] Czyta taski, nie widoki — świeża zmiana widoczna bez regeneracji.
- [x] README §2/§3.3/§7 + workspace `CLAUDE.md`; testy 33/33 zielone (7 nowych przypadków).

## Verification

```bash
node --test backlog/scripts/tests/boards.test.mjs
node backlog/scripts/query.mjs --status pending --priority P0 --limit 5
node backlog/scripts/query.mjs --blocked-by BL-002        # kontrola pozytywna: BL-003
```

Kontrola pozytywna wykonana 2026-08-29: `--blocked-by BL-003` zwróciło 0 — sprawdzone niezależnym grepem, że to prawdziwe zero, a nie cichy błąd filtra (`--blocked-by BL-002` zwraca BL-003, zgodnie z `grep -l "blocked_by:.*BL-002"`).

## Notes

Bilans serii TL-12 → TL-14: domyślny odczyt spadł z 14 KB deklarowanego focusa do 12 KB wyliczanego NOW, indeks ze 149 KB do 69 KB, a pytania punktowe kosztują dziesiątki tokenów zamiast tysięcy.

Świadomie poza zakresem: `query.mjs` nie umie sortować po `updated`/`created` ani filtrować po zakresie dat — do „co się nie ruszało od 90 dni" służy dashboard viewera (sekcja Wiek / Higiena).

## Log

- 2026-08-29 done — claude — filtry + trzy formaty wyjścia; twarde oblewanie na literówce we fladze i jawne raportowanie obcięcia
