---
id: TL-98
title: "Role w dyspozytorze i petli: next --role, agent per rola"
type: task
labels: []
board: main
epic: "Wyróżniki agentowe"
priority: P1
status: blocked
owner: unassigned
estimate: 4h
confidence: medium
created: 2026-08-31
updated: 2026-09-01
blocked_by: [TL-87, TL-96, TL-97]
blocks: [TL-113]
related_docs:
  - docs/worktrail-global-tool.md
verification:
  - bash: "node --test scripts/tests/next.test.mjs scripts/tests/run.test.mjs"
---

## Cel

Dyspozytor i pętla rozumieją role:

- `worktrail next --role developer` wydaje wyłącznie taski z tą rolą lub bez
  roli (`--role-strict` ogranicza do dokładnie tej roli);
- w `worktrail run` komenda agenta staje się mapą per rola
  (`run_agent_commands: {developer: "…", docs: "…"}`); task z rolą, dla
  której mapa nie ma wpisu, jest POMIJANY z jawnym zliczeniem w raporcie —
  czeka na wykonawcę tej roli, np. człowieka.

Efekt: jedna kolejka obsługuje wyspecjalizowanych agentów i ludzi naraz,
a eskalacja do człowieka nie wymaga żadnego mechanizmu — jest brakiem wpisu
w mapie.

## Kontekst

Powstało z decyzji o rolach subagentów (2026-08-31). To rozszerzenie dwóch
istniejących kontraktów, nie nowy mechanizm: selekcja w `next` (TL-87)
dostaje jeden filtr więcej, konfiguracja `run` (TL-96) zamienia skalar na
mapę. Trzymać się granic tamtych tasków — lock, atrybucja i bramka weryfikacji
nie zmieniają się ani o linię.

Decyzje:
- **Zakres egzekwowania ról to WYŁĄCZNIE ten task**: selekcja `next` i mapa
  komend `run`. `take <ID>` (TL-87) i bezpośrednia praca agenta na plikach
  ról nie sprawdzają — wzięcie poza rolą jest odnotowywane w zdarzeniu, nie
  blokowane (zasada w TL-97). Test regresji: `take` taska z dowolną rolą
  przechodzi bez flag i bez konfiguracji ról.
- **Domyślna semantyka `--role r` = „r albo bez roli"**, bo task bez roli
  z definicji może wziąć każdy; wersja ścisła flagą. Odwrotny domyślny
  (tylko dokładna rola) głodziłby taski bez roli, gdy wszyscy wykonawcy
  wołają z flagą.
- **Zgodność wstecz:** skalarny `run_agent_command` (z TL-96) nadal działa
  jako wpis dla tasków bez roli; oba klucze naraz oblewają walidację
  konfiguracji (dwie odpowiedzi na jedno pytanie — klasa rozjazdu z Prawa 3).
- **Pominięcie nie jest ciszą.** Raport `run` zlicza taski pominięte per
  brakująca rola („3 taski czekają na rolę analyst — brak komendy w mapie").
  Cichy skip wyglądałby jak pusta kolejka — ta sama klasa błędu co cichy
  no-op.
- Nazwy ról w mapie muszą istnieć w słowniku `roles` projektu — literówka
  w warstwie użytkownika oblewa, zanim pętla wystartuje.

## Pre-flight reading

- `backlog/tasks/TL-87-worktrail-next-atomowy-przydzial-taska-dla-agenta.md`
  i `backlog/tasks/TL-96-worktrail-run-petla-next-agent-close-do-pustej-kolejki.md`
  — kontrakty, które ten task rozszerza.
- `backlog/tasks/TL-97-pole-role-taska-wymog-roli-ze-slownika-konfiguracji.md`
  — semantyka pola i słownika.
- [docs/worktrail-global-tool.md](../../docs/worktrail-global-tool.md) §3 —
  Prawo 3: mapa komend to warstwa użytkownika, słownik ról to warstwa
  projektu; walidacja spójności między nimi.

## Kroki

1. `next`: filtr roli w selekcji (domyślnie „rola albo brak", `--role-strict`
   dokładnie); bez `--role` zachowanie bez zmian.
2. Walidacja konfiguracji `run`: mapa vs skalar, klucze mapy wobec słownika
   `roles`, konflikt obu form.
3. Pętla: wybór komendy z mapy po roli taska; brak wpisu = pomiń task,
   zlicz per rola, nie próbuj ponownie w tym przebiegu.
4. Raport `run`: sekcja „czeka na rolę" z liczbami; `--json` analogicznie.
5. Testy: filtr ról w next (z i bez strict), przebieg z mapą dwóch ról
   i atrapami agentów, task z rolą bez wpisu pominięty i zliczony (kontrola
   pozytywna: NIE trafia do agenta innej roli), konflikt skalar+mapa oblewa.

## Acceptance criteria

- [ ] `next --role r` nigdy nie wydaje taska z inną niepustą rolą.
- [ ] Task z rolą bez wpisu w mapie nie jest wykonywany i jest zliczony
      w raporcie per rola.
- [ ] Skalarny `run_agent_command` działa jak dotąd; skalar + mapa naraz
      oblewa walidację.
- [ ] Klucz mapy spoza słownika `roles` oblewa przed startem pętli.
- [ ] Zachowanie `next` i `run` bez ról jest bajtowo niezmienione
      (regresja na istniejących testach).
- [ ] `take <ID>` działa identycznie z rolami i bez nich — role nie dotykają
      trybu bezpośredniego (test).

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 blocked — agent:claude — task założony z decyzji o rolach;
  czeka na pole role (TL-97) oraz kontrakty next (TL-87) i run (TL-96).
- 2026-08-31 revised — agent:claude — zakres egzekwowania ról zawężony
  jawnie do next/run; take i tryb bezpośredni poza nim.
- 2026-09-01 blocked — agent:claude — dopisany dependent TL-113 (pole
  executor rozszerza mechanikę pomijania i raportu z tego taska).
