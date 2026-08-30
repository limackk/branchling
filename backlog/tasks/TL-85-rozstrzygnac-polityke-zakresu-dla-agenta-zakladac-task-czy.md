---
id: TL-85
title: "Rozstrzygnąć politykę zakresu dla agenta: zakładać task czy pytać"
type: task
labels: [post-launch]
board: main
epic: "Onboarding"
priority: P2
status: pending
owner: unassigned
estimate: 2h
confidence: medium
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - .claude/skills/backlog-workflow/SKILL.md
verification:
  - manual: "Instrukcja dla agenta zawiera jedną, jednoznaczną regułę na wypadek pracy wykrytej poza zakresem taska, a `## Log` tego taska niesie liczby z przeglądu backlogu, na których decyzja zapadła"
---

## Cel

Wiadomo, co agent ma zrobić, gdy w trakcie taska odkryje pracę poza jego
zakresem: założyć nowy task samodzielnie czy zatrzymać się i zapytać. Reguła
jest jedna i wynika z danych z naszego backlogu, nie z przeczucia.

## Kontekst

Nasz `backlog-workflow` mówi: *„If the scope grows, open a new task instead of
inflating this one"* — czyli agent zakłada taski sam, bez pytania.
Backlog.md mówi dokładnie odwrotnie, i to w dwóch miejscach: *„If you discover
work that is outside the task's acceptance criteria, stop and ask the user"*
oraz *„Do not create or start follow-up tasks without user approval"*.

Obie reguły są obronne i obie mają inny tryb awarii:

- **Nasza** produkuje szum. Agent, który zakłada taski bez pytania, zapełnia
  backlog pozycjami, których nikt nie zamówił, i rozmywa sygnał kolejki.
  Przy równoległych sesjach w worktree robi to w kilku miejscach naraz.
- **Ich** produkuje przerwania. Każde odkrycie poza zakresem zatrzymuje pracę i
  wymaga uwagi człowieka — tego samego zasobu, który cała ta konstrukcja miała
  oszczędzać.

Sposób rozstrzygnięcia jest empiryczny, nie doktrynalny — dlatego ten task jest
tani i ma konkretny materiał do przejrzenia. **Przejrzyj taski założone przez
`agent:claude`** i policz, ile z nich zostało zamkniętych, ile stoi w `pending`
od dawna, a ile skończyło jako `cancelled`. Jeśli większość została zrobiona,
nasza reguła się broni i zostaje. Jeśli większość leży — reguła produkuje śmieci
i wymaga zmiany. `history/*.jsonl` niesie aktora, więc te liczby są policzalne,
a nie do zgadnięcia.

Trzecia droga do rozważenia: agent zakłada task, ale w wyróżnionym stanie
(np. `status: pending` + etykieta wskazująca „niezamówione"), tak żeby dało się
to odsiać jednym zapytaniem. Zachowuje brak przerwań i przywraca sygnał.

## Pre-flight reading

1. `.claude/skills/backlog-workflow/SKILL.md`, sekcje „Work a task" i „What does
   not belong in the backlog" — dzisiejsza reguła i jej sąsiedztwo.
2. `backlog/history/*.jsonl` — atrybucja `agent:claude`; to jest źródło liczb.
3. `backlog/config.yaml` — `labels_closed` i lista etykiet, jeśli wyjdzie
   trzecia droga.

## Kroki

1. Policz taski założone przez `agent:claude`: zamknięte / stojące w `pending` /
   `cancelled`. Zapisz liczby w `## Log` — to jest dowód, nie ozdoba.
2. Rozstrzygnij regułę: samodzielnie / pytać / trzecia droga z oznaczeniem.
3. Wpisz ją do jednego źródła instrukcji (TL-74) i do skilla — jednym zdaniem,
   tym samym w obu.
4. Jeśli wyszła trzecia droga: dodaj etykietę do `config.yaml` i zapytanie, które
   ją odsiewa.

## Acceptance criteria

- [ ] Liczby z przeglądu tasków założonych przez agenta są zapisane w `## Log`.
- [ ] Reguła jest jedna i jednoznaczna, bez „to zależy".
- [ ] Instrukcja dla agenta i skill mówią to samo.
- [ ] Jeśli wybrano oznaczanie: etykieta jest w `config.yaml`, a odsianie to jedno zapytanie.

## Log

2026-08-31 pending — agent:claude — z analizy Backlog.md: ich task-execution i task-finalization zakazują agentowi zakładania tasków bez zgody; nasz skill mu to nakazuje. Rozbieżność wykryta, nierozstrzygnięta.
