---
id: TL-134
title: "Guard: status blocked, choc wszystkie blocked_by sa zamkniete"
type: task
labels: []
board: main
epic: "Integralność danych"
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
estimate: 2h                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs: []
verification:                      # JAK sprawdzić, że task naprawdę jest zrobiony
  - id: guard-fails-on-stale
    bash: "node --test scripts/tests/dangling-refs.test.mjs"
  - id: guard-green-on-tree
    bash: "node scripts/cli.mjs check --refs"
---

## Cel

`worktrail check` ma **zgłaszać** task, który ma `status: blocked`, choć każdy
jego `blocked_by` jest już zamknięty (`done` / `cancelled`). Dziś przechodzi
bez słowa.

## Kontekst

Zmierzone 2026-09-01 na tym repozytorium, przy układaniu fal dla epika
„Wyróżniki agentowe". Cztery taski — TL-95, TL-96, TL-101, TL-114 —
stały na `blocked`, a wszystkie ich blokady były `done` od wielu commitów.

**Dlaczego to nie jest kosmetyka.** `blocked` jest w
`reason_required_statuses` (`backlog/config.yaml`), a `worktrail next` z zasady
NIE wydaje statusów z tej listy — bo wejście w nie było czyjąś decyzją, której
agent bez nadzoru nie ma prawa cofać. Zwietrzały `blocked` jest więc czymś
gorszym niż złe pole: **wyjmuje task z kolejki na zawsze**, i to po cichu.
`worktrail plan` pokazywał falę jako gotową do wzięcia, a `next` nie miał czego
z niej wydać.

To ta sama klasa co TL-41 (wiszące `blocked_by` nie oblewały żadnej bramki),
ale **inny przypadek**: tam odwołanie wskazywało na nieistniejący task, tutaj
wszystkie odwołania są poprawne i zamknięte. Guard z TL-41 tego nie łapie —
sprawdzono.

**Czego ten task NIE obejmuje.** Automatycznego przestawiania statusu. Wyjście
z `blocked` to zmiana stanu i ma przejść przez zapis z powodem, tak jak każda
inna; guard ma POWIEDZIEĆ, a decyzję zostawić człowiekowi albo komendzie
piszącej.

## Kroki

1. W `scripts/check-backlog-refs.mjs` (albo w osobnym module, jeśli tam nie
   pasuje) dołóż regułę: `status` == status oznaczający blokadę **i** każdy
   `blocked_by` zamknięty → zgłoszenie.
2. Rozstrzygnij poziom: OBLEWA czy ostrzega. Argument za ostrzeżeniem —
   sekwencja zamknięcia blokady i odblokowania jest z natury dwoma zapisami,
   więc chwilowy rozjazd jest normalny w połowie pracy.
3. Statusy bierz ze `config.yaml`, nie z literału `"blocked"` — nazwa statusu
   to słownictwo cudzego projektu (prawo 3).
4. Kontrola pozytywna w teście: fixture z takim taskiem MUSI zgłosić. Guard,
   który przechodzi na zerowej próbce, jest zielony bez mocy dowodowej.

## Acceptance criteria

- [ ] Task ze statusem blokady i wszystkimi `blocked_by` zamkniętymi jest zgłaszany przez `worktrail check`. [proof: guard-fails-on-stale]
- [ ] Nazwa statusu pochodzi z `config.yaml`, nie z literału w kodzie. [proof: guard-fails-on-stale]
- [ ] Test ma kontrolę pozytywną — fixture, na którym guard MUSI zgłosić. [proof: guard-fails-on-stale]
- [ ] Guard jest zielony na obecnym drzewie tego repozytorium. [proof: guard-green-on-tree]
- [ ] Guard niczego nie przestawia — zgłasza i kończy. [proof: guard-fails-on-stale]
