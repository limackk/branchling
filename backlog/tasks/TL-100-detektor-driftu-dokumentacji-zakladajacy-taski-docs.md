---
id: TL-100
title: "Detektor driftu dokumentacji zakladajacy taski docs"
type: task
labels: []
board: main
epic: "Wyróżniki agentowe"
priority: P2
status: pending
owner: unassigned
estimate: 1d
confidence: low
created: 2026-08-31
updated: 2026-09-01
blocked_by: [TL-97]
blocks: []
related_docs:
  - docs/backlog-time-tracking.md
verification:
  - bash: "node --test scripts/tests/docs-drift.test.mjs"
---

## Cel

`worktrail docs-drift` wskazuje dokumenty, które prawdopodobnie zestarzały się
względem projektu, i na żądanie (`--seed-tasks`) zakłada dla nich taski z rolą
`docs` — z listą sygnałów w treści. Pętla `run` z komendą agenta dla roli
docs (TL-98) bierze te taski i aktualizuje dokumentację przez tę samą
bramkę weryfikacji co każdą inną pracę.

Sedno podziału: narzędzie NIE pisze dokumentacji — wykrywa, że umiera,
i zamienia to w pozycję kolejki z dowodem zamknięcia. Pisze wymienny agent
w roli docs.

## Kontekst

Powstało z decyzji produktowej (2026-08-31): pomysł „agent utrzymujący
dokumentację" odwrócony tak, by nie łamać granicy z TL-96 (worktrail nie
jest agentem). Trudną połową problemu nie jest pisanie, tylko WIEDZIEĆ, że
dokument się zestarzał — a to jest wyliczalne z danych, które już są
(git + taski + `related_docs:`).

Sygnały driftu, każdy jako osobny, testowalny detektor:
1. **Taski wokół dokumentu młodsze niż dokument** — dokument wymieniony
   w `related_docs:` tasków zamkniętych PO jego ostatniej zmianie w gicie;
   próg liczby tasków w konfiguracji.
2. **Martwe odwołania** — dokument linkuje pliki lub taski, które nie
   istnieją.
3. **Status kłamie** — nagłówek `**Status:** PROJEKT …` (konwencja docs/
   tego repo), podczas gdy taski wymienione w nagłówku są `done`;
   wzorce nagłówka statusu w konfiguracji, nie w kodzie.

Zasady uczciwości — warunek, żeby raport nie stał się szumem, który wszyscy
ignorują (odwrotność „zielonego bez mocy dowodowej"):
- każdy wskazany dokument ma wypisane KONKRETNE sygnały (które taski, które
  martwe linki), nigdy sam werdykt;
- poniżej progu sygnałów dokument nie jest raportowany — klasa „za mało
  sygnału" jest jawna w podsumowaniu, jak „za mało danych" w kalibracji
  ([docs/backlog-time-tracking.md](../../docs/backlog-time-tracking.md) §11);
- `--seed-tasks` jest idempotentne: dokument z otwartym taskiem docs nie
  dostaje drugiego (klucz: ścieżka dokumentu w `related_docs:` otwartego
  taska z rolą docs);
- zakładany task wymaga wykonywalnej `verification:` — minimum: detektory
  1–2 dla tego dokumentu przechodzą po aktualizacji; sygnał 3 bywa
  nieweryfikowalny automatycznie i wtedy ląduje w treści, nie w bramce.

Poza zakresem: analiza treści dokumentu przez LLM (to praca agenta docs,
nie detektora), obserwowanie plików na żywo, jakiekolwiek zapisy poza
`--seed-tasks`.

## Pre-flight reading

- `backlog/tasks/TL-97-pole-role-taska-wymog-roli-ze-slownika-konfiguracji.md`
  — rola docs w słowniku.
- `backlog/tasks/TL-90-worktrail-audit-deklaracje-kontra-slady-aktywnosci.md`
  — bliźniacza komenda (deklaracje vs ślady); wspólny styl raportu i kodów
  wyjścia, rozważyć współdzielenie odczytu tasków+historii.
- `docs/` tego repo — nagłówki **Status:**, format linków względnych;
  detektory mają być zbudowane na tej konwencji, ale z wzorcami
  w konfiguracji.

## Kroki

1. Detektory 1–3 jako czyste funkcje nad (taski, git log dokumentów,
   treść dokumentów); progi i wzorce w `config.yaml`.
2. Raport: per dokument sygnały z konkretami, sekcja „za mało sygnału";
   `--json`; kody wyjścia jak `audit` (0 czysto / 1 znaleziono / 2 błąd).
3. `--seed-tasks`: idempotentne zakładanie tasków z rolą docs przez
   istniejący mechanizm `new`, sygnały w treści, weryfikacja = ponowny
   przebieg detektorów 1–2 dla dokumentu.
4. Testy na fixture'ach (repo tymczasowe z docs + taskami): każdy detektor
   z przypadkiem pozytywnym i negatywnym; idempotencja seeda (drugi przebieg
   nie zakłada nic); dokument świeży nie jest raportowany.

## Acceptance criteria

- [ ] Każdy detektor ma test, w którym coś znajduje, i test, w którym
      słusznie milczy.
- [ ] Wskazanie zawsze zawiera konkretne sygnały; nie istnieje wynik
      „dokument stary" bez listy powodów.
- [ ] Podwójny `--seed-tasks` nie tworzy duplikatu taska dla tego samego
      dokumentu.
- [ ] Task założony przez seeda przechodzi `worktrail check` i ma wykonywalną
      weryfikację.
- [ ] Progi i wzorce nagłówka statusu pochodzą z konfiguracji; żadnej nazwy
      dokumentu ani frazy tego projektu w kodzie.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 blocked — agent:claude — task założony z decyzji o utrzymaniu
  dokumentacji; detekcja driftu zamiast agenta w narzędziu, wykonawcą rola
  docs (TL-97/1508).
