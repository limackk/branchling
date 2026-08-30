---
id: TL-27
title: "Pomiar czasu pracy — fundament i uczciwy punkt zero"
type: code
labels: [post-launch]
board: main
epic: "Backlog — pomiar czasu pracy"
priority: P2
status: pending
owner: unassigned
estimate: 1d
confidence: medium
created: 2026-08-30
updated: 2026-08-30
blocked_by: []
blocks: [TL-28, TL-31]
related_docs:
  - docs/backlog-time-tracking.md
verification:
  - bash: "node --test backlog/scripts/tests/activity.test.mjs"
  - bash: "node backlog/scripts/cli.mjs time --json | python3 -c \"import json,sys; d=json.load(sys.stdin); assert d['completed'] > 900, d; print('ukończonych ze stemplem:', d['completed'])\""
  - bash: "git check-ignore -q backlog/activity/TL-27.jsonl && echo 'surowy log poza gitem — OK'"
---

## Cel

Postawić warstwę danych pod pomiar czasu pracy (`backlog/activity/`) i domknąć jedyną część historii, która jest odtwarzalna uczciwie: **moment ukończenia** tasków. Po tym tasku `worktrail time` odpowiada na pytania o przepustowość na 1023 zamkniętych taskach, a fundament pod engaged time (TL-28) stoi.

## Kontekst

Backlog ma 1016 tasków `done` z wpisaną estymatą i **zero** liczb mówiących, ile ta praca zajęła. Estymaty są nieweryfikowalne.

Pomiar wykonany 2026-08-30 przed projektem (pełna tabela: [`backlog-time-tracking.md §2`](../../docs/backlog-time-tracking.md)) obalił trzy „oczywiste" źródła danych historycznych:

- log zmian pól (`history/*.jsonl`) ruszył 2026-08-30 — 9 tasków, 13 wpisów, **1** z parą `in_progress`+`done`;
- frontmatter `created`→`updated` ma rozdzielczość dobową, a **71% tasków** kończy się tego samego dnia, w którym powstało — zero dla 7 na 10;
- rozpiętość commitów na pliku taska jest zanieczyszczona masowymi backfillami pól (mediana 722 h przy 71% „tego samego dnia" — dwa rzędy wielkości rozjazdu, więc żadne z dwóch nie mierzy pracy).

Co pomiar POTWIERDZIŁ: `git log -S"status: done"` trafia **20/20** z rozdzielczością sekundową, ~60 s dla całego katalogu. Natomiast `-S"status: in_progress"` trafia **3/20** — agent zwykle commituje `pending → done` jednym ruchem, więc stan pośredni nigdy nie powstał.

Stąd granica tego taska, i jest ona świadoma: **backfillujemy stempel ukończenia, NIE backfillujemy czasu pracy.** Czas pracy sprzed dnia zero nie istnieje i wywnioskowanie go byłoby tą samą klasą ładnej nieprawdy, dla której [`backlog-field-editing-history.md §6`](../../docs/backlog-field-editing-history.md) odrzucił backfill autorstwa z gita.

## Pre-flight reading

1. `docs/architecture/backlog-time-tracking.md` — §2 (pomiar), §4 (model danych), §7 (prywatność). Bez §2 zakres tego taska wygląda na sztucznie okrojony.
2. `backlog/scripts/history.mjs` — `eventId()`, `appendEntries()`, `readHistory()` z dedupem po `id`. Nowy moduł ma powtórzyć te wzorce, nie wymyślić własne.
3. `backlog/scripts/estimate.mjs` — kontrakt „`null`, nigdy zero" i `sumHours()` zwracające `{hours, unknown}`. To jest wzorzec raportowania, którego trzyma się `worktrail time`.
4. `backlog/scripts/cli.mjs` — tabela `COMMANDS`, sposób dokładania podkomendy.
5. `backlog/.gitignore` — gdzie i jak wykluczamy artefakty lokalne.

## Kroki

1. `backlog/scripts/activity.mjs` — zapis/odczyt `backlog/activity/BL-NNNN.jsonl`: `appendActivity()`, `readActivity()` (dedup po `id`, uszkodzony wiersz nie kasuje reszty), `activityPath()`. ULID i przestrzenie nazw aktora importowane z `history.mjs`, nie kopiowane.
2. Kształt wiersza z §4 dokumentu: `{id, ts, task, kind, actor, source, session, attribution}`. `kind` ∈ `tool|prompt|commit|edit` — nieznane oblewa.
3. `backlog/scripts/backfill-completions.mjs` — jedno przejście `git log --format --name-only` po katalogu + pickaxe `-S"status: done"` per task `done`. Zapisuje `kind: "commit"`, `source: "git-backfill"`, `attribution: "path"`. **Nie zapisuje niczego o czasie trwania.**
4. Guard idempotencji: powtórny backfill nie dokłada drugiego stempla (dedup po `id` nie wystarczy — ULID jest losowy; klucz to `(task, kind=commit, ts)`). Flaga `--dry-run` drukuje, ile wierszy BY dopisała, i nie dotyka plików — to jest ta bramka, którą sprawdza Verification.
5. `backlog/scripts/time-report.mjs` + podkomenda `time` w `cli.mjs`: lead time (mediana/p80/p95), throughput per tydzień, liczba tasków BEZ stempla. Ostatnia liczba jest obowiązkowa — suma bez niej udaje kompletną.
6. `backlog/.gitignore`: `activity/*.jsonl` (surowe stemple lokalnie). Katalog `activity/rollup/` zostaje **wersjonowany** — agregat jest PER TASK (`rollup/BL-NNNN.json`), nigdy jednym plikiem zbiorczym, bo zbiorczy byłby drugim `INDEX.yaml` (uzasadnienie zmierzone, komentarz w tym samym `.gitignore`).
7. `config.yaml` — komplet kluczy epiku od razu, bo nieznany klucz OBLEWA i rozbijanie tego na cztery taski oznaczałoby cztery zmiany schemy: `activity_privacy: local`, `idle_gap_minutes: 10`, `heartbeat_throttle_seconds: 60`, `min_report_n: 8`, `activity_retention_days: 90`. Używają ich dopiero TL-28/1426/1429.
8. Testy `backlog/scripts/tests/activity.test.mjs` — red-first, autor testu ≠ autor kodu.

## Acceptance criteria

- [ ] `node backlog/scripts/cli.mjs time` drukuje lead time i throughput na realnym backlogu.
- [ ] Raport podaje liczbę tasków `done` BEZ stempla ukończenia (nie pomija ich po cichu).
- [ ] Backfill uruchomiony dwa razy pod rząd daje ten sam stan (idempotencja) — jest na to test.
- [ ] `activity/*.jsonl` jest gitignored, a `activity/rollup/` NIE jest; `git check-ignore` potwierdza oba kierunki.
- [ ] Nieznane `kind` oblewa zapis zamiast trafić do pliku.
- [ ] Uszkodzony wiersz JSONL nie wywraca odczytu — jest na to test.
- [ ] Nowe pole w `config.yaml` nie oblewa `config.mjs` (nieznany klucz oblewa — trzeba je DODAĆ do schemy).
- [ ] `docs/architecture/backlog-time-tracking.md` §10 zaktualizowane o stan „wdrożone".
- [ ] `qa/backlog-time-tracking.yaml` założone.

## Verification

```bash
# 1. Testy jednostkowe — expected: wszystkie pass
node --test backlog/scripts/tests/activity.test.mjs

# 2. Backfill + raport — expected: >900 tasków ze stemplem (1023 done, część sprzed konwencji)
node backlog/scripts/backfill-completions.mjs
node backlog/scripts/cli.mjs time

# 3. Idempotencja — expected: druga liczba identyczna z pierwszą
node backlog/scripts/backfill-completions.mjs --dry-run | tail -1

# 4. Prywatność — expected: surowe poza gitem, agregat W gicie
git check-ignore -q backlog/activity/TL-27.jsonl && echo 'surowy log: poza gitem — OK'
git check-ignore -q backlog/activity/rollup/TL-27.json || echo 'agregat: wersjonowany — OK'

# 5. Guardy modułu nadal zielone
node backlog/scripts/cli.mjs check
```

## Notes

- Poza zakresem świadomie: heartbeaty (TL-28), kalibracja (TL-29), tokeny (TL-30), retencja i korekta atrybucji (TL-31).
- Backfill `in_progress` NIE jest robiony — pokrycie 15% i rozrzut 0,2 h ÷ 554 h czynią z niego szum udający dane.
- `min_report_n` i `idle_gap_minutes` lądują w konfiguracji już tutaj, żeby TL-28 nie musiał ruszać schemy config przy okazji logiki klastrowania.

## Log

- 2026-08-30 created — claude — rozpisane z analizy pomiaru czasu (docs/architecture/backlog-time-tracking.md)
- 2026-08-30 revised — claude — po adwersarialnym przeglądzie: agregat per task zamiast zbiorczego `rollup.json`, komplet kluczy config w jednym miejscu, `--dry-run` domówiony w krokach (bramka go wołała, spec nie zamawiał)
