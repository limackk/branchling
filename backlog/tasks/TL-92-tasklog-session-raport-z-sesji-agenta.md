---
id: TL-92
title: "worktrail session — raport z sesji agenta"
type: task
labels: []
board: main
epic: "Wyróżniki agentowe"
priority: P2
status: blocked
owner: unassigned
estimate: 1d
confidence: medium
created: 2026-08-31
updated: 2026-08-31
blocked_by: [TL-28]
blocks: []
related_docs:
  - docs/backlog-time-tracking.md
  - docs/backlog-field-editing-history.md
verification:
  - bash: "node --test scripts/tests/session-report.test.mjs"
---

## Cel

Czarna skrzynka pracy agentów:

- `worktrail sessions --since yesterday` — lista sesji: kto, jaki task, jak
  długo, czym się skończyło;
- `worktrail session <id>` — narracja jednej sesji: wzięte taski, zmienione pola
  (z historii), klastry aktywności, tokeny/koszt gdy adapter je dał.

Scenariusz docelowy: rano po nocnej pracy floty agentów jedna komenda mówi, co
każda sesja dowiozła — Z SESJAMI PUSTYMI włącznie. Sesja z heartbeatami i bez
żadnego przejścia statusu to sygnał („agent pracował i nic nie zamknął"),
nie cisza.

## Kontekst

Powstało z przeglądu wyróżników wobec Backlog.md (2026-08-31). Klucz `session`
jest już w projekcie heartbeatu
([docs/backlog-time-tracking.md](../../docs/backlog-time-tracking.md) §5) —
ten task tylko skleja po nim dwa istniejące logi: `activity/` (heartbeaty,
klastry, atrybucja) i `history/` (zmiany pól z aktorem). Nie dodaje żadnego
nowego zapisu; jest czystym odczytem, jak `stats`.

Zasady przejęte z dokumentów źródłowych:
- klastrowanie i minuty liczone JEDNĄ implementacją z TL-28 — nie kopiować
  liczydła (klasa „ta sama decyzja w dwóch miejscach");
- `unknown` i klastry jednoelementowe raportowane wprost (§6, §8.2);
- surowe heartbeaty są danymi prywatnymi maszyny (§9) — raport per sesja
  pokazuje czas i zdarzenia, ale komenda działa na maszynie właściciela logu;
  nie budować z tego eksportu czyjegoś kalendarza.

Naturalne rozszerzenie na później (nie w tym tasku): `worktrail standup` —
zbiorcza notatka ze wszystkich aktorów za wczoraj.

## Pre-flight reading

- [docs/backlog-time-tracking.md](../../docs/backlog-time-tracking.md) §5–§8
  — format heartbeatu, klastrowanie, łańcuch atrybucji, rola `session`.
- [docs/backlog-field-editing-history.md](../../docs/backlog-field-editing-history.md)
  §2 — wpisy historii; korelacja z sesją wymaga, żeby hook zapisywał
  identyfikator sesji także przy zmianie pola — jeśli TL-28 tego nie
  przewidział, zgłosić tam, nie obchodzić tutaj.
- `scripts/history.mjs` — odczyt i dedup.

## Kroki

1. Odczyt sesji: grupowanie heartbeatów po `session`, złączenie z wpisami
   `history/` tego samego aktora i okna czasowego (lub identyfikatora sesji,
   jeśli TL-28 go tam dopisuje).
2. `sessions`: tabela sesji z filtrem `--since` / `--actor` / `--task`;
   sesje bez przejść statusu oznaczone jawnie.
3. `session <id>`: chronologiczna narracja — fokus, zmiany pól, klastry
   z minutami, suma tokenów (kolumna warunkowa) wraz z polem `model`
   z wiersza aktywności — „280k tokenów" znaczy co innego dla Sonneta przez
   API, agenta w abonamencie i lokalnej llamy na Ollamie, więc liczba bez
   modelu jest niedointerpretowalna. Kwota wg trybów rozliczenia z TL-30
   (kwota / tokeny-bez-kwoty / zero zadeklarowane / null).
4. `--json` na obu komendach.
5. Testy na fixture'ach: dwie sesje równoległe na jednym tasku nie zlewają
   się; sesja pusta jest widoczna; brak kolumny kosztu ≠ zero.

## Acceptance criteria

- [ ] Dwie równoległe sesje na tym samym tasku raportują się osobno.
- [ ] Sesja bez przejść statusu pojawia się w `sessions` z jawnym oznaczeniem.
- [ ] Minuty liczy implementacja klastrowania z TL-28 — w tym tasku nie ma
      drugiego liczydła.
- [ ] Brak danych kosztu nie jest raportowany jako 0.
- [ ] Suma tokenów w narracji sesji jest zawsze opatrzona modelem; sesja
      z heartbeatami z więcej niż jednego modelu raportuje tokeny per model,
      nie jedną sumę.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 blocked — agent:claude — task założony z przeglądu wyróżników
  agentowych; czeka na heartbeaty i pole session z TL-28.
- 2026-08-31 revised — agent:claude — tokeny w narracji zawsze z modelem
  i per model; kwoty wg trybów rozliczenia z TL-30.
