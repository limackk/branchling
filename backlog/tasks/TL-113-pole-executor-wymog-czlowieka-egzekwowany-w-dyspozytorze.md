---
id: TL-113
title: "Pole executor: wymog czlowieka egzekwowany w dyspozytorze"
type: task
labels: []
board: main
epic: "Wyróżniki agentowe"
priority: P1
status: blocked
owner: unassigned
estimate: 2h
created: 2026-09-01
updated: 2026-09-01
blocked_by: [TL-98]
blocks: [TL-115]
related_docs:
  - docs/backlog-human-agent-decisions.md
verification:
  - bash: "node --test scripts/tests/task-fields.test.mjs scripts/tests/next.test.mjs scripts/tests/run.test.mjs"
---

## Cel

Task dostaje opcjonalne pole frontmattera `executor: human` — wymóg mówiący,
że tego taska (zwykle: tej decyzji) nie wolno oddać agentowi, niezależnie od
roli. Brak pola = może wziąć każdy. Dyspozytor (`next`) i pętla (`run`)
wywołane przez aktora z przestrzeni `agent:` POMIJAJĄ taki task i zliczają go
jawnie w raporcie („N tasków czeka na człowieka"). Jawne `take` nie jest
blokowane, tylko odnotowane w historii — spójnie z zasadą z TL-97.

## Kontekst

Powstało z analizy human/agent (2026-09-01, sesja Claude); pełne
rozstrzygnięcia w [docs/backlog-human-agent-decisions.md](../../docs/backlog-human-agent-decisions.md) §2.

Kluczowe rozróżnienie, którego to pole pilnuje: ten sam analityk-agent może
odpowiedzieć na pytanie z dokumentacji, ale nie może podjąć decyzji
produktowej. Wymóg człowieka jest więc własnością KONKRETNEGO taska (dane,
jadą przez review — Prawo 1), a nie roli ani wdrożenia.

Decyzje:
- **NIE role typu `analyst-human`/`analyst-agent`.** Kartezjański rozrost
  słownika ról; dyspozytor traci „analityk dowolny"; miesza kompetencję
  (rola) z gatunkiem wykonawcy. Odrzucone.
- **NIE tylko brak wpisu w mapie `run_agent_commands`** (eskalacja z
  TL-98). Brak wpisu to fakt o WDROŻENIU użytkownika („nie mam
  agenta-analityka"), `executor: human` to fakt o TASKU. Dwie warstwy —
  Prawo 3, warstwy są rozłączne.
- **Wartości `human|agent` to KSZTAŁT pola, nie słownik projektu** — mogą
  żyć w kodzie (`task-fields.mjs`), bez klucza w `config.yaml`. Przestrzenie
  nazw aktorów są tak samo zamknięte w kodzie od TL-21. Wartość `agent`
  dopuszczona dla symetrii (task, którego człowiek nie powinien robić
  ręcznie, np. masowa migracja), ale scenariuszem projektującym jest `human`.
- **Dyspozytor NIE potrzebuje nowej konfiguracji, żeby znać gatunek
  wołającego** — przestrzeń nazw aktora (`agent:` vs `local:`/`user:`) już
  to koduje. `next --actor agent:claude` pomija `executor: human`;
  wywołanie bez aktora agentowego widzi wszystko.
- **Pominięcie nie jest ciszą** — raport `run`/`next` zlicza taski
  czekające na człowieka, wzorzec wprost z TL-98.
- **Jawne wzięcie bije podpowiedź pola** — `take TL-NNNN` przez agenta
  działa i jest odnotowane w historii, nie blokowane. Człowiek, który każe
  agentowi zrobić wskazany task, sam jest tą decyzją człowieka (zasada
  „rola bramkuje dyspozytor, nie jawne wzięcie" z TL-97).

## Pre-flight reading

- [docs/backlog-human-agent-decisions.md](../../docs/backlog-human-agent-decisions.md)
  — pełny model trzech osi i odrzucone alternatywy.
- `backlog/tasks/TL-97-pole-role-taska-wymog-roli-ze-slownika-konfiguracji.md`
  i `backlog/tasks/TL-98-role-w-dyspozytorze-i-petli-next-role-agent-per-rola.md`
  — kontrakty, które ten task rozszerza; semantyka pomijania i zliczania.
- `scripts/task-fields.mjs` — `FIELD_SHAPES`; wzorzec pola enum o stałym
  kształcie (bez słownika z konfiguracji).
- [docs/backlog-field-editing-history.md](../../docs/backlog-field-editing-history.md)
  §2 — przestrzenie nazw aktorów.

## Kroki

1. Pole `executor` w `FIELD_SHAPES` jako opcjonalny enum `human|agent`
   o stałym kształcie; edycja w viewerze i zapis historii przychodzą
   z istniejącej mechaniki pól.
2. `next`: aktor z przestrzeni `agent:` nie dostaje tasków `executor: human`
   (i odwrotnie dla `executor: agent` przy aktorze nieagentowym); pominięte
   zliczone w raporcie i w `--json`.
3. `run`: to samo pominięcie w pętli, sekcja raportu „czeka na człowieka"
   obok „czeka na rolę" z TL-98.
4. Filtr `worktrail query --executor human` (w tym `--executor ""` dla tasków
   bez pola).
5. `_template.md`: pole z komentarzem odróżniającym `executor` od `role`.
6. Testy: pominięcie i zliczenie (kontrola pozytywna: task NIE trafia do
   agenta), `take` działa bez zmian z odnotowaniem, zachowanie bez pola
   bajtowo niezmienione na istniejących testach.

## Acceptance criteria

- [ ] `next --actor agent:*` nigdy nie wydaje taska `executor: human`;
      raport zlicza pominięte.
- [ ] `take <ID>` działa identycznie z polem i bez — wzięcie poza wymogiem
      jest odnotowane w historii, nie zablokowane.
- [ ] Pole jest edytowalne w viewerze, zmiana zapisuje wpis historii —
      bez zmian w kodzie viewera poza schemą.
- [ ] `query --executor` filtruje; task bez pola nie znika z widoków.
- [ ] Zachowanie `next`/`run` bez pola `executor` bajtowo niezmienione
      (regresja na istniejących testach).

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-09-01 blocked — agent:claude — task założony z analizy human/agent;
  czeka na mechanikę pomijania i raportu z TL-98. Rozstrzygnięcia w
  docs/backlog-human-agent-decisions.md.
