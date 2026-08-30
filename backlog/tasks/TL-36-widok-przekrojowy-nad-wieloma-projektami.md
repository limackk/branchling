---
id: TL-36
title: "Widok przekrojowy nad wieloma projektami"
type: code
labels: [post-launch]
board: main
epic: "Backlog — publikacja open source"
priority: P3
status: pending
owner: unassigned
estimate: 1d
confidence: low
created: 2026-08-30
updated: 2026-08-30
blocked_by: [TL-34]
blocks: []
related_docs:
  - docs/worktrail-global-tool.md
verification:
  - bash: "node --test backlog/scripts/tests/cross-project.test.mjs"
  - bash: "node backlog/scripts/cli.mjs query --all-projects --status in_progress --json | python3 -c \"import json,sys; r=json.load(sys.stdin); assert all('project' in t for t in r), 'wiersz bez nazwy projektu'; print('wierszy:', len(r))\""
---

## Cel

Jedna odpowiedź na pytanie **„nad czym pracuję we wszystkich projektach"** — dziś niemożliwe, bo żadne miejsce nie wie, że projektów bywa więcej niż jeden.

## Kontekst

To jedyny krok w projekcie narzędzia globalnego, który **daje użytkownikowi coś nowego**; TL-33/1440/1441 zdejmują z drogi rzeczy blokujące publikację. Dlatego jest ostatni, a nie pierwszy.

**Ma jawnie niepewnego odbiorcę** ([worktrail-global-tool.md §11](../../docs/worktrail-global-tool.md) pkt 1): dziś projekt jest jeden. Jeśli po kwartale od TL-34 rejestr nadal ma jeden wpis, ten task **nie powinien powstać** — a nie zostać zbudowany „na zapas". Wpisana tu estymata zakłada, że warunek się spełnił.

Ograniczenie, które kształtuje całą resztę: **to jest widok, nie druga prawda.** Przekrój czyta N katalogów backlogu i składa wynik w pamięci. Nie zakłada własnego magazynu, nie kopiuje tasków, nie cache'uje ich do pliku, który trzeba unieważniać. Skasowanie rejestru odbiera tylko ten widok (Prawo 2).

Wydajność jest realnym pytaniem, nie hipotetycznym: ten backlog ma 1389 tasków i `query.mjs` czyta `tasks/*.md` przy każdym wywołaniu. Przy pięciu projektach tej wielkości to ~7000 plików na komendę. Task ma **zmierzyć** czas przekroju i dopiero na podstawie liczby decydować, czy potrzebny jest indeks — a nie zbudować cache prewencyjnie.

## Pre-flight reading

1. `docs/architecture/worktrail-global-tool.md` — §3 Prawo 2 i 4, §7 (rejestr jako indeks), §11 pkt 1–2.
2. `backlog/scripts/query.mjs` — kontrakt filtrów, `--json`, `--count`, `--files`; nieznana flaga OBLEWA.
3. `backlog/scripts/build-backlog.mjs` — jak dziś powstają widoki jednego projektu.
4. `backlog/scripts/registry.mjs` (TL-34) — rewalidacja wpisów.

## Kroki

1. `--all-projects` w `query.mjs` — iteracja po rejestrze, każdy wynik z polem `project`. **Bez tego pola przekrój jest bezużyteczny**: „BL-12 in_progress" nic nie znaczy, gdy trzy projekty mają BL-12.
2. Kolizje ID: numery BL są unikalne **w obrębie projektu**, nie globalnie. Tożsamością w przekroju jest para `(projekt, id)` i tak ma być drukowana.
3. Projekt z rejestru, którego ścieżka nie istnieje albo nie przechodzi `looksLikeBacklogDir()`, jest **wypisany jako niedostępny**, a przekrój leci dalej. Cichy skip zamieniłby „przeniosłeś repo" w „ten projekt nie ma tasków".
4. Częściowa awaria jest **widoczna w wyniku**, także w `--json` (pole `unavailable`), a nie tylko na stderr — inaczej skrypt konsumujący JSON policzy niepełny zbiór jako pełny.
5. Pomiar: czas przekroju dla 1, 3 i 5 projektów wielkości tego backlogu, wynik zapisany w `## Log`. Indeks budujemy **tylko** jeśli liczba tego wymaga.
6. Widok w viewerze — przełącznik „projekt / wszystkie". Dopiero po CLI: przekrój ma najpierw działać w terminalu i mieć `--json`, bo to jest powierzchnia rozszerzeń (Prawo 4).

## Acceptance criteria

- [ ] `query --all-projects` zwraca wiersze z polem `project`; każdy wiersz identyfikowalny parą `(projekt, id)`.
- [ ] Kolizja numerów BL między projektami nie gubi ani nie scala wierszy — test na dwóch fixture'ach z tym samym `BL-001`.
- [ ] Niedostępny projekt jest raportowany **w wyniku**, także w `--json`; przekrój nie przerywa się na nim.
- [ ] Skasowanie rejestru odbiera wyłącznie `--all-projects`; komendy w repo działają bez zmian.
- [ ] Wszystkie istniejące filtry `query.mjs` działają z `--all-projects` (`--status`, `--board`, `--epic`, `--label`, `--owner`, `--type`, `--text`).
- [ ] Nieznana flaga nadal OBLEWA — przekrój nie rozluźnia kontraktu CLI.
- [ ] Czas przekroju zmierzony i zapisany w `## Log`; decyzja o indeksie **uzasadniona liczbą**, nie przeczuciem.
- [ ] Przekrój nie tworzy żadnego trwałego magazynu tasków (Prawo 2) — jest na to test: po `--all-projects` nie przybywa plików w katalogu domowym.

## Verification

```bash
# 1. Testy przekroju — expected: pass, w tym kolizja ID i projekt niedostępny
node --test backlog/scripts/tests/cross-project.test.mjs

# 2. Każdy wiersz zna swój projekt — expected: liczba wierszy, brak asercji
node backlog/scripts/cli.mjs query --all-projects --status in_progress --json | python3 -c \
  "import json,sys; r=json.load(sys.stdin); assert all('project' in t for t in r); print('wierszy:', len(r))"

# 3. Brak rejestru odbiera tylko przekrój — expected: query działa, --all-projects mówi dlaczego
WORKTRAIL_HOME=/tmp/tl-x node backlog/scripts/cli.mjs query --count
WORKTRAIL_HOME=/tmp/tl-x node backlog/scripts/cli.mjs query --all-projects --count; echo "exit=$?"

# 4. Pomiar czasu — expected: liczba do wpisania w ## Log
time node backlog/scripts/cli.mjs query --all-projects --count
```

## Notes

- **Bramka wejścia:** rejestr ma ≥2 realnie używane wpisy. Bez tego task jest budowaniem dla nikogo i należy go zamknąć jako `cancelled` z powodem, a nie trzymać otwarty w nieskończoność.
- **Bez własnego magazynu i bez demona** — przekrój jest widokiem czytanym na żądanie.
- Jeśli pomiar z kroku 5 wyjdzie źle, indeks jest osobnym taskiem z własnym uzasadnieniem liczbowym; SQLite jako odtwarzalny indeks jest już przewidziany w [worktrail-state-and-sync.md §5.4](../../docs/worktrail-state-and-sync.md) i to jest jego naturalne miejsce.

## Log

- 2026-08-30 created — claude — z projektu narzędzia globalnego (docs/architecture/worktrail-global-tool.md); jedyny krok zmieniający produkt, z jawnie niepewnym odbiorcą i bramką wejścia „≥2 wpisy w rejestrze"
