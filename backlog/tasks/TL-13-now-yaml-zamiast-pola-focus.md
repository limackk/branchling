---
id: TL-13
title: "NOW.yaml wyliczany zamiast pola focus — „co teraz” bez bitu do utrzymywania"
type: code
labels: [post-launch, ops-hardening]
board: main
epic: ""
priority: P2
status: done
owner: claude
estimate: 4h
confidence: high
created: 2026-08-29
updated: 2026-08-29
blocked_by: []
blocks: []
related_docs:
  - backlog/README.md
verification:
  - bash: "node --test backlog/scripts/tests/boards.test.mjs"
  - bash: "node backlog/scripts/build-backlog.mjs && head -25 backlog/NOW.yaml"
  - manual: "Viewer → Dashboard: burndown ma oś pre-launch/post-launch/board/epic, nigdzie nie ma słowa „focus”"
---

## Cel

Zastąpić ręczne pole `focus` wyliczanym `NOW.yaml`. Pytanie foundera brzmiało: „ktoś, kto dostanie ten backlog, nie zrozumie pola focus" — i pomiar to potwierdził, zanim cokolwiek zmieniłem.

## Kontekst

Stan przed zmianą (mierzony, nie szacowany): 55 aktywnych tasków z `focus: true` na 337 aktywnych, z czego 10 nietkniętych od maja; 11 flag siedziało na taskach `done`; jednocześnie **93 aktywne P0/P1 leżały poza focusem**. Plik odpowiadał więc na pytanie „co ktoś kiedyś zadeklarował", nie „co robimy teraz". Ręczny bit, którego nikt nie zdejmuje, zawsze dochodzi do tego stanu — wyliczenie nie ma jak zgnić, bo nie ma czego nie zdjąć.

`NOW.yaml` ma trzy sekcje, każda odpowiada na inne pytanie:
- `in_progress` — co jest **zaczęte** (43),
- `blocked` — co czeka na decyzję (12); to też praca: odblokować albo anulować,
- `next` — `pending` P0 (12), krytyczne jeszcze nietknięte.

Zwykły `pending` P1–P3 do NOW nie wchodzi — od tego jest INDEX.

**Bez capu, świadomie.** Ucięcie listy do 10 pozycji ukryłoby fakt, że zaczętych jest 43. Nagłówek go NAZYWA („43 zadań naraz w toku… część z nich to porzucone starty"), bo to jedyna rzecz, jaką plik może zrobić z WIP-leakiem, którego nie wolno mu zamaskować.

**Koszt po stronie viewera, rozstrzygnięty a nie przemilczany:** burndown miał `focus` jako domyślną oś. Nowa domyślna to `pre-launch` — odpowiada na pytanie, które founder zadaje tej krzywej najczęściej („ile jeszcze do wysyłki") — a do wyboru doszedł też **board**. Bez tej decyzji wykres pokazałby zero i kłamał, że nic nie zostało. Stare linki `#dashboard?burn=focus` wracają na domyślną oś zamiast rysować pustkę.

Zniknęły też: filtr „Focus" (7 facetów → 6), badge ★ na kartach i w detalu, KPI „Focus otwarte" (→ „W wybranym zakresie"), kolumna „Focus" w tabeli epików, pozycja „focus" w kolejce godzin oraz karta higieny „P0 poza focusem" (→ „P0 nietknięte", czyli dokładnie sekcja `next` z NOW). Zmienne `focus*` w dashboardzie opisywały zakres burndownu, nie pole — przemianowane na `burn*`, żeby nazwa nie sugerowała, że pole wróciło.

## Kroki

1. `build-backlog.mjs` — `writeNow()` zamiast `writeFocus()`, `focus` poza schemą, ostrzeżenie gdy pole wraca do frontmattera.
2. Migracja: `focus:` usunięte z 1145 tasków i z `_template.md`; `FOCUS.yaml` i `boards/*/FOCUS.yaml` skasowane.
3. `build-viewer.mjs` — usunięte wszystkie powierzchnie focusa, nowa domyślna oś burndownu, board jako oś.
4. README (§2, §2.2, §3.3, §3.5, §5, §6.1, §6.2, quick-reference) + workspace `CLAUDE.md`.

## Acceptance criteria

- [x] `NOW.yaml` powstaje z trzech sekcji, wyliczanych ze statusu i priorytetu; per board też.
- [x] `focus` nie występuje w żadnym tasku, w template, w generatorze ani w widokach.
- [x] `FOCUS.yaml` usunięty z repo.
- [x] Burndown ma działającą oś (pre-launch domyślnie; do wyboru post-launch, board, epic) — sprawdzone w przeglądarce.
- [x] Testy: 33/33 zielone (5 nowych przypadków NOW; 3 stare przepisane z FOCUS na NOW).

## Verification

```bash
node backlog/scripts/build-backlog.mjs && head -25 backlog/NOW.yaml
node --test backlog/scripts/tests/boards.test.mjs
```

Sprawdzone w przeglądarce na żywym viewerze (2026-08-29): burndown „pre-launch — 204 z 846 do zrobienia", KPI „W toku 43 — za dużo naraz, NOW.yaml ostrzega", pasek osi bez przycisku „focus", a jedyne słowo „focus" widoczne w UI to tytuł historycznego taska TL-2.

## Notes

Generator **ostrzega**, gdy `focus:` wróci do frontmattera (skopiowany stary task) — bez tego pole wróciłoby tylnymi drzwiami i zaczęłaby rosnąć druga, niewidoczna definicja „co teraz". To ostrzeżenie, nie guard: pole nic nie psuje, po prostu nic nie znaczy.

Rozmiary po serii TL-12 (odchudzenie INDEX-u) + TL-13: `INDEX.yaml` 69 KB (było 149 KB), `NOW.yaml` 12 KB (FOCUS.yaml miał 14 KB). Domyślny odczyt agenta to dziś ~3k tokenów i mówi prawdę o stanie pracy.

`AGENTS.md` w rootcie ma tę samą sekcję o backlogu co `CLAUDE.md`, ale jest plikiem nieśledzonym przez git (praca innej sesji) — nie ruszałem go; przy okazji jego commita trzeba tam powtórzyć zmianę.

## Log

- 2026-08-29 numer — claude — task powstał jako TL-12, ale równoległa sesja przenumerowała na ten numer swój wcześniejszy task (guard tożsamości złapał kolizję przy regeneracji); przepięty na TL-13
- 2026-08-29 done — claude — NOW.yaml + migracja 1145 tasków + viewer bez focusa; oś burndownu przeniesiona na pre-launch/board
