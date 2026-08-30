---
id: TL-116
title: "Graf zmian taska w viewerze z osi historii"
type: task
labels: []
board: main
epic: "Wyróżniki agentowe"
priority: P2
status: blocked
owner: unassigned
estimate: 1d
created: 2026-09-01
updated: 2026-09-01
blocked_by: [TL-114]
blocks: []
related_docs:
  - docs/backlog-human-agent-decisions.md
  - docs/backlog-field-editing-history.md
verification:
  - bash: "node --test scripts/tests/task-graph.test.mjs"
---

## Cel

Detal taska w viewerze dostaje graf zmian: oś czasu z węzłami — utworzenie,
przejścia statusów, handoffy (zmiany `role`/`owner` z powodem), pytania
i decyzje — z kolorem rozróżniającym aktora `agent:` od człowieka. Użytkownik
otwiera task i widzi jednym spojrzeniem, którędy task szedł, kto go
przekazywał, kto o co pytał i kto zdecydował.

Graf jest czystą pochodną `history/TL-NNNN.jsonl` (Prawo 2): zero nowych
danych, zero nowych zapisów. Działa też w trybie `file://` (historia jest
wbudowana w build), więc graf da się wysłać komuś jednym plikiem.

## Kontekst

Powstało z analizy human/agent (2026-09-01); rozstrzygnięcia w
[docs/backlog-human-agent-decisions.md](../../docs/backlog-human-agent-decisions.md) §5.

Detal taska ma już oś historii jako LISTĘ (docs/backlog-field-editing-history.md
§5). Graf to drugi render tych samych zdarzeń, nie nowy mechanizm — lista
zostaje (jest gęstsza informacyjnie), graf jest widokiem przebiegu.

Decyzje:
- **Współdzielony silnik z TL-91** — fold historii per task (`stateAt`)
  planowany dla time-lapse'u boardu jest tym samym foldem; jeśli TL-91
  powstanie pierwszy, reużyć jego moduł, jeśli ten — wystawić fold tak,
  żeby TL-91 go reużył. Dwa foldy rozjadą się w definicjach.
- **Kolor human/agent z przestrzeni nazw aktora** — ta sama konwencja co
  TL-91; wpisy `unknown`/`legacy` mają własny, jawny kolor „nie wiadomo",
  nie udają człowieka.
- **Węzłem jest zdarzenie znaczące, nie każdy wpis** — przejścia `status`,
  zmiany `role`/`owner`, `__created__`/`__deleted__`, `__comment__`,
  `__decision__`. Pozostałe zmiany pól (priorytet, estymata…) zwinięte jako
  kropki między węzłami, rozwijalne — inaczej graf taska o długiej historii
  jest nieczytelny.
- **Para pytanie→decyzja jest połączona krawędzią** (`resolves` z TL-114);
  pytanie otwarte jest wizualnie oznaczone jako otwarte.
- **Granice danych pokazane, nie ukryte** — historia zaczyna się 2026-08-30
  (reguła z TL-91): początek osi opisany „historia od …", nie udaje
  pełnego życiorysu taska.

## Pre-flight reading

- [docs/backlog-human-agent-decisions.md](../../docs/backlog-human-agent-decisions.md)
  §5 — zakres węzłów i relacja do TL-91.
- [docs/backlog-field-editing-history.md](../../docs/backlog-field-editing-history.md)
  §2 i §5 — format wpisu, dedup, istniejący render osi.
- `backlog/tasks/TL-91-time-lapse-boardu-odtwarzany-z-logu-zdarzen.md`
  — współdzielony fold i konwencja kolorów.
- `scripts/build-viewer.mjs` — jak historia trafia do builda; pułapka
  backslashy w template literalu.

## Kroki

1. Fold zdarzeń taska do sekwencji węzłów grafu (klasyfikacja
   znaczące/zwinięte, parowanie `resolves`) jako czysta funkcja —
   uruchamialna w Node, wklejana źródłem do viewera.
2. Render grafu w detalu taska (SVG, przewijalny poziomo w kontenerze,
   nie rozpychający strony); kolor wg przestrzeni aktora; klik węzła
   zawęża listę historii do tego zdarzenia (istniejący mechanizm filtra
   per pole).
3. Testy foldu na fixture: kolejność, task skasowany i założony ponownie,
   para pytanie→decyzja, pytanie otwarte, wpisy `legacy` (kontrole
   pozytywne dla każdego rodzaju węzła).

## Acceptance criteria

- [ ] Fold jest czystą funkcją z testami poza przeglądarką.
- [ ] Graf nie wykonuje żadnych zapisów i działa w trybie `file://`.
- [ ] Zmiany `agent:` są wizualnie odróżnialne od ludzkich, a `unknown`
      od obu.
- [ ] Pytanie otwarte i para pytanie→decyzja są rozróżnialne na grafie.
- [ ] Początek historii jest opisany jawnie, nie wygląda jak początek taska.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-09-01 blocked — agent:claude — task założony z analizy human/agent;
  czeka na zdarzenie decyzji (TL-114). Współdzieli fold z TL-91.
