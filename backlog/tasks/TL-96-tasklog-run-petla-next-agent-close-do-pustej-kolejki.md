---
id: TL-96
title: "worktrail run — petla next, agent, close do pustej kolejki"
type: task
labels: []
board: main
epic: "Wyróżniki agentowe"
priority: P1
status: pending
owner: unassigned
estimate: 1d
confidence: medium
created: 2026-08-31
updated: 2026-08-31
blocked_by: [TL-87, TL-93]
blocks: [TL-98]
related_docs:
  - docs/worktrail-global-tool.md
  - docs/worktrail-state-and-sync.md
verification:
  - bash: "node --test scripts/tests/run.test.mjs"
---

## Cel

`worktrail run` prowadzi backlog do pustej kolejki: w pętli bierze task
(`next`, TL-87), uruchamia komendę agenta z konfiguracji, po jej wyjściu
próbuje zamknąć task bramką weryfikacji (`close`, TL-93); task oblewający
weryfikację `run_max_attempts` razy idzie na `blocked` z powodem w logu
i pętla bierze następny. Na końcu raport przebiegu: zamknięte / zablokowane /
nietknięte, czas, a gdy adapter kosztu działa — tokeny per model.

Domknięcie scenariusza „jeden prompt → działający projekt": `seed` (TL-94/05)
zakłada backlog, `run` go wykonuje, a po przebiegu zostaje kwit — historia per
pole, dowody weryfikacji, sesje. Wyróżnik nie brzmi „zbudowało się", tylko
„zbudowało się i wszystko jest rozliczone".

## Kontekst

Powstało z decyzji produktowej (2026-08-31). Granice, które utrzymują ten task
w ryzach czterech praw:

- **worktrail nie jest agentem.** Komenda agenta to szablon w konfiguracji
  (np. `run_agent_command: "claude -p @{task_file}"`, `"codex exec …"`,
  `"aider --model ollama/qwen2.5-coder …"`), uruchamiany per task. Narzędzie
  dostarcza kolejkę, lock, bramkę i księgowość; ręce są wymienne (Prawo 4).
  Żadnej wiedzy o konkretnym hoście w kodzie pętli.
- **To nie jest demon**: proces żyje wyłącznie podczas przebiegu i kończy się
  z pustą kolejką albo gdy zostały same taski zablokowane; decyzja „bez
  demona" ([docs/worktrail-global-tool.md](../../docs/worktrail-global-tool.md)
  §10) nienaruszona.
- **Uczciwa porażka zamiast pętli w nieskończoność**: wyczerpane próby =
  `blocked` z wpisem, jakie weryfikacje oblały. Board po przebiegu pokazuje,
  gdzie i dlaczego stanęło — to jest obietnica, która się broni, gdy lokalny
  model utknie na tasku 7 z 20.
- **Sekwencyjnie w v1.** Równoległość (N procesów `run` na wspólnym drzewie
  albo worktree per agent) stoi na locku z TL-87 i jest osobnym taskiem —
  nie pakować jej tu; pierwszą wersję ma dać się rozumować.
- Wyjście agenta idzie do pliku logu per task (ścieżka w raporcie), nie na
  ekran — przebieg 20 tasków musi być czytelny.
- Przerwanie (Ctrl-C) zostawia bieżący task w `in_progress` z lockiem, który
  wygasa wg TTL z TL-87 — do odnotowania w wyjściu, nie do obsługi
  specjalnej.

## Pre-flight reading

- `backlog/tasks/TL-87-worktrail-next-atomowy-przydzial-taska-dla-agenta.md`
  — kontrakt next: selekcja, lock, kody wyjścia.
- `backlog/tasks/TL-93-bramka-weryfikacji-w-worktrail-close.md` — kontrakt
  close: kiedy status zostaje nietknięty, zdarzenie weryfikacji.
- [docs/worktrail-global-tool.md](../../docs/worktrail-global-tool.md) §3, §10 —
  Prawo 4 i decyzja „bez demona".

## Kroki

1. Klucze konfiguracji: `run_agent_command` (szablon z podstawieniem ścieżki
   pliku taska i ID), `run_max_attempts`, timeout pojedynczego uruchomienia
   agenta. Warstwa: komenda agenta to fakt o maszynie użytkownika —
   warstwa użytkownika.
2. Pętla: `next` → agent (wyjście do logu per task) → `close`; porażka
   weryfikacji dokleja jej wynik do kolejnej próby agenta (agent ma wiedzieć,
   CO oblało); wyczerpanie prób → `blocked` + wpis do `## Log` taska.
3. Warunki stopu: pusta kolejka, same zablokowane, `--max-tasks N`,
   `--dry-run` (pokazuje kolejność bez uruchamiania agenta).
4. Raport końcowy (tekst + `--json`): per task wynik i liczba prób, sumy,
   czas przebiegu; kolumny kosztowe warunkowo, wg trybów rozliczenia
   z TL-30.
5. Testy z agentem-atrapą (skrypt w fixture, nie LLM): przebieg szczęśliwy,
   task oblewający do `blocked` po limicie prób (kontrola pozytywna: status
   NIE jest done), timeout agenta, `--max-tasks`.

## Acceptance criteria

- [ ] Pętla nie zawiera żadnej wiedzy o konkretnym hoście agenta; testy
      przechodzą z atrapą będącą zwykłym skryptem.
- [ ] Task po `run_max_attempts` oblanych weryfikacjach jest `blocked`
      z powodem, nigdy `done`.
- [ ] Wynik oblanej weryfikacji trafia do wejścia kolejnej próby agenta.
- [ ] Przebieg kończy się także wtedy, gdy zostały wyłącznie taski
      zablokowane — bez wirowania na pustej selekcji.
- [ ] Raport w `--json` niesie per task: wynik, liczbę prób, ścieżkę logu.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 blocked — agent:claude — task założony pod scenariusz „jeden
  prompt → działający projekt"; czeka na dyspozytor (TL-87) i bramkę
  weryfikacji (TL-93). Równoległość świadomie poza zakresem v1.
