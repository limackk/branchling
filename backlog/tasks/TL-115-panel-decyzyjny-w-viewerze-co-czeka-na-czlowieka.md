---
id: TL-115
title: "Panel decyzyjny w viewerze: co czeka na czlowieka"
type: task
labels: []
board: main
epic: "Wyróżniki agentowe"
priority: P1
status: blocked
owner: unassigned
estimate: 1d
created: 2026-09-01
updated: 2026-09-01
blocked_by: [TL-113, TL-114]
blocks: []
related_docs:
  - docs/backlog-human-agent-decisions.md
verification:
  - bash: "node --test scripts/tests/decision-panel.test.mjs"
---

## Cel

Viewer dostaje panel „czeka na Ciebie": jedno miejsce, w którym człowiek
widzi wszystko, co wisi na decyzji człowieka, i może ją podjąć — co odblokuje
dalszą pracę agentów. Panel jest czystym widokiem wyliczonym z istniejących
danych (Prawo 2), a akcja w panelu pisze wyłącznie istniejącymi drogami
zapisu, więc atrybucja i historia przychodzą za darmo.

## Kontekst

Powstało z analizy human/agent (2026-09-01); rozstrzygnięcia w
[docs/backlog-human-agent-decisions.md](../../docs/backlog-human-agent-decisions.md) §4.

Panel składa się z trzech zapytań, żadne nie wymaga nowych danych:

1. **Taski czekające na człowieka** — otwarte, odblokowane (wszystkie
   `blocked_by` zamknięte), z `executor: human` (TL-113); obok nich taski
   z rolą bez wpisu w mapie agentów (ten sam sygnał, który raport `run`
   z TL-98 pokazuje w CLI).
2. **Otwarte pytania** — `openQuestions` z TL-114: pytanie, kto pytał,
   jak długo wisi.
3. **Co decyzja odblokuje** — przechodnie `blocks` per pozycja; „odblokowuje
   N tasków" jest jednostką priorytetu panelu i domyślnym sortowaniem.

Decyzje:
- **Panel liczy z żywych `tasks/*.md` i historii, nigdy z wygenerowanych
  widoków** (reguła z TL-108 — widoki są snapshotem ostatniego builda).
- **Akcja „podejmij decyzję" = `__decision__` (TL-114) + ewentualna zmiana
  pól** (status z `blocked`, handoff z powrotem do roli wykonawcy) — przez
  te same endpointy co edycja pól; żadnej drugiej ścieżki zapisu
  (lekcja z §5 docs/backlog-field-editing-history.md).
- **Filtr „na MNIE" działa na deklaracji aktora** (przełącznik viewera, po
  roli/ownerze). Twarda tożsamość to zaplanowany krok
  (docs/backlog-field-editing-history.md §7 pkt 2) i NIE blokuje MVP.
- **Tryb `file://`: panel widoczny, akcje wyłączone** — jak edycja pól;
  wysyłany komuś jeden plik ma pokazywać, co wisi, bez udawania, że da się
  z niego decydować.
- **Stan panelu (filtry) w URL** — spójnie z istniejącym mechanizmem stanu
  widoków, żeby dało się podlinkować „twoja kolejka decyzji".

## Pre-flight reading

- [docs/backlog-human-agent-decisions.md](../../docs/backlog-human-agent-decisions.md)
  §4 — trzy zapytania i semantyka akcji.
- `backlog/tasks/TL-113-…` i `backlog/tasks/TL-114-…` — pola i zdarzenia,
  z których panel liczy.
- `scripts/build-viewer.mjs` — jak dochodzi nowy widok; pułapka backslashy
  w template literalu (docs/backlog-field-editing-history.md §8).
- `scripts/serve-backlog.mjs` — istniejące endpointy zapisu, do reużycia.

## Kroki

1. Moduł liczący pozycje panelu (trzy zapytania + przechodnie `blocks`)
   uruchamialny w Node i wklejany źródłem do viewera (wzorzec
   `task-fields.mjs`) — jedna definicja dla testów i przeglądarki.
2. Widok panelu: lista pozycji z kontekstem (pytanie/powód, kto, od kiedy,
   co odblokuje), sortowanie po liczbie odblokowywanych, filtr roli/ownera.
3. Akcje: zapis decyzji (z `resolves`), zmiana statusu, handoff — przez
   istniejące endpointy; optymistycznie z wycofaniem przy odmowie serwera
   (jak edycja pól).
4. Licznik pozycji panelu widoczny z poziomu dashboardu (wejście do panelu).
5. Testy modułu liczącego na fixture: task `executor: human` odblokowany
   wchodzi, zablokowany nie; otwarte pytanie wchodzi, rozstrzygnięte znika;
   liczba odblokowywanych liczona przechodnio (kontrole pozytywne).

## Acceptance criteria

- [ ] Panel pokazuje wszystkie trzy klasy pozycji i nic ponadto
      (testy modułu liczącego, z kontrolami pozytywnymi).
- [ ] Podjęcie decyzji w panelu zapisuje `__decision__` z aktorem i domyka
      pytanie (`openQuestions` przestaje je zwracać).
- [ ] Panel liczy z żywych plików — zmiana statusu taska jest widoczna bez
      przebudowy widoków.
- [ ] W trybie `file://` panel jest widoczny, akcje nieaktywne.
- [ ] Stan filtrów panelu jest w URL.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-09-01 blocked — agent:claude — task założony z analizy human/agent;
  czeka na pole executor (TL-113) i zdarzenie decyzji (TL-114).
