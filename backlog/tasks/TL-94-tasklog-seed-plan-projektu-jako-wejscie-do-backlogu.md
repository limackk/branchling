---
id: TL-94
title: "worktrail seed — plan projektu jako wejście do backlogu"
type: task
labels: []
board: main
epic: "Wyróżniki agentowe"
priority: P1
status: done
owner: agent:claude
estimate: 1d
confidence: medium
created: 2026-08-31
updated: 2026-09-01
blocked_by: []
blocks: [TL-95]
related_docs:
  - docs/worktrail-global-tool.md
verification:
  - id: seed-suite
    bash: "node --test scripts/tests/seed.test.mjs"
---

## Cel

`worktrail seed` przyjmuje na stdin strukturalny plan projektu (JSON: lista
tasków z tytułem, celem, krokami, zależnościami `blocked_by` i blokiem
`verification`) i zakłada z niego backlog istniejącą drogą zapisu — numeracja
przez mechanizm `new`, frontmatter przez `task-fields.mjs`, zdarzenia do
`history/`. Po `seed` backlog jest gotowy do autonomicznej pracy pętli
(TL-96): każdy task ma wykonywalną weryfikację i jawne zależności.

To pierwszy z trzech klocków scenariusza „jeden prompt → działający projekt";
`seed` jest częścią BEZ LLM i musi działać bez żadnego modelu.

## Kontekst

Powstało z decyzji produktowej (2026-08-31): efektem przyciągającym
użytkowników ma być bootstrap projektu z opisu, wykonany narzędziem od zera do
pierwszej działającej wersji. Podział na rdzeń (ten task) i adapter LLM
(TL-95) jest zastosowaniem Prawa 4
([docs/worktrail-global-tool.md](../../docs/worktrail-global-tool.md) §3):
każda komenda pisząca ma postać wywoływalną z zewnątrz, a inteligencja
przychodzi z zewnątrz przez stabilne wejście. Rdzeń nie może zależeć od
żadnego hosta LLM — ta sama zasada, którą TL-30 przyjął dla adaptera kosztu.

Decyzje zakresu:
- **Task bez wykonywalnej `verification:` OBLEWA cały seed** (walidacja przed
  pierwszym zapisem, nie w połowie). To jedyna rzecz odróżniająca plan nadający
  się do autonomicznej pracy od listy życzeń — i warunek sensu bramki
  z TL-93. Placeholder z szablonu też oblewa.
- **Walidacja całości przed zapisem czegokolwiek**: cykle w `blocked_by`,
  referencje do nieistniejących pozycji planu, duplikaty tytułów — wszystko
  raportowane naraz, zero tasków na dysku po błędzie. Częściowy seed to stan,
  którego nikt nie zamówił.
- **Numeracja należy do narzędzia.** Plan odwołuje się do pozycji po kluczach
  lokalnych (np. `plan_id`), a `seed` mapuje je na przydzielone TL-NNN —
  LLM nigdy nie wybiera numerów (ta sama zasada co zakaz `max+1` w skillu).
- **Docelowy katalog jak wszędzie**: `--dir` / wykrywanie; na pustym katalogu
  `seed` woła istniejący `init`, nie własną kopię.
- Format wejścia jest częścią powierzchni publicznej — opisać go w dokumencie
  (schemat pól, przykład), bo adaptery cudzych ludzi będą pisać do niego.

## Pre-flight reading

- `scripts/task-id.mjs` i mechanizm `new` — przydział numerów; seed MA go
  reużyć, nie powielić.
- `scripts/task-fields.mjs` — jedyna droga zapisu frontmattera.
- `_template.md` — kształt taska i placeholder weryfikacji, który trzeba
  rozpoznawać.
- [docs/worktrail-global-tool.md](../../docs/worktrail-global-tool.md) §3 —
  Prawo 4; seed jest jego wzorcowym przypadkiem.

## Kroki

1. Schemat wejścia: JSON z listą pozycji (`plan_id`, `title`, `goal`,
   `context`, `steps[]`, `blocked_by[]` po `plan_id`, `verification[]`,
   opcjonalnie `estimate`, `priority`); parser z komunikatami wskazującymi
   pozycję i pole.
2. Walidacja całości: weryfikacje wykonywalne (niepuste, bez placeholdera),
   graf zależności acykliczny, referencje domknięte; wszystkie błędy naraz,
   kod wyjścia 2, zero zapisów.
3. Zapis: mapowanie `plan_id` → TL-NNN, pliki przez istniejące mechanizmy,
   `__created__` do `history/` z aktorem z `--actor`, na końcu `build`.
4. `--dry-run`: pokazuje, co powstanie (tytuły, zależności po przydzielonych
   numerach), bez zapisu.
5. Testy: plan poprawny, plan z cyklem, plan bez weryfikacji (kontrola
   pozytywna: MUSI oblać i zostawić katalog nietknięty), plan do pustego
   katalogu (przechodzi przez init).

## Acceptance criteria

- [x] Plan z taskiem bez wykonywalnej weryfikacji nie zapisuje NICZEGO i wymienia wszystkie wadliwe pozycje. [proof: seed-suite]
- [x] Cykl w `blocked_by` jest wykrywany przed zapisem. [proof: seed-suite]
- [x] Numery przydziela narzędzie; wejście nie może ich narzucić. [proof: seed-suite]
- [x] Po `seed` na świeżym katalogu `worktrail check` przechodzi bez uwag. [proof: seed-suite]
- [x] `seed` nie importuje niczego, co wymaga LLM ani sieci. [proof: seed-suite]

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 pending — agent:claude — task założony pod scenariusz „jeden
  prompt → działający projekt"; rdzeń bez LLM, adapter osobno (TL-95).
