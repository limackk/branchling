---
id: TL-114
title: "Zdarzenie __decision__ i komenda worktrail decide"
type: task
labels: []
board: main
epic: "Wyróżniki agentowe"
priority: P1
status: done
owner: agent:session
estimate: 4h
created: 2026-09-01
updated: 2026-09-02
blocked_by: [TL-99]
blocks: [TL-115, TL-116]
related_docs:
  - docs/backlog-human-agent-decisions.md
  - docs/backlog-field-editing-history.md
verification:
  - bash: "node --test scripts/tests/decide.test.mjs scripts/tests/history.test.mjs"
---

## Cel

Decyzja staje się zdarzeniem pierwszej klasy w historii taska: pseudo-pole
`__decision__` (obok `__created__`, `__deleted__`, `__body__`, `__comment__`)
z treścią decyzji, aktorem, ULID-em oraz opcjonalnym `resolves` wskazującym
ULID zdarzenia-pytania. Wejściem jest komenda
`worktrail decide TL-NNNN --reason "…" [--resolves <ULID>] --actor <a>`
oraz — tą samą drogą zapisu — akcja w viewerze.

Po tym tasku istnieje maszynowa definicja „otwartego pytania": zdarzenie
pytania (komentarz z handoffu TL-99), na które nie wskazuje żadne
`__decision__`. To jest cały stan, którego potrzebuje panel decyzyjny
(TL-115) i graf taska (TL-116) — wyliczalny z historii, zero nowych plików
stanu (Prawo 2).

## Kontekst

Powstało z analizy human/agent (2026-09-01); rozstrzygnięcia w
[docs/backlog-human-agent-decisions.md](../../docs/backlog-human-agent-decisions.md) §3.

Handoff (TL-99) zapisuje PYTANIE jako `__comment__`. Komentarz i decyzja
to jednak różne rzeczy: panel musi policzyć „pytania bez decyzji", a graf
rysuje decyzje jako węzły. Stąd osobny typ zdarzenia, nie flaga na
komentarzu.

Decyzje:
- **Decyzja agenta i człowieka wyglądają identycznie** — różni je tylko
  przestrzeń aktora. Audyt „które decyzje podjął agent" to jeden filtr po
  `actor`, bez osobnego schematu.
- **`--reason` obowiązkowy** — decyzja bez treści to dla czytelnika historia
  bez informacji; ta sama klasa co handoff bez powodu (TL-99).
- **`resolves` opcjonalny** — decyzja może istnieć bez wcześniejszego
  pytania (ktoś rozstrzyga z własnej inicjatywy); pytanie bez decyzji jest
  „otwarte". Wskazanie ULID-a nieistniejącego w historii taska oblewa przed
  zapisem.
- **Dedup po `id` jak zwykłe zdarzenia** — dwie identyczne decyzje w różnym
  czasie to dwa zdarzenia; reguła dedupu `__created__` NIE obowiązuje
  (analogicznie do `__comment__`, patrz kroki TL-99).
- **Linia w `## Log` pliku taska** — decyzja jest też narracją; wpis
  w historii jest maszynowy, linia w logu ludzka. Obie z jednego wywołania.
- **UI panelu jest POZA zakresem** (TL-115); tu tylko zdarzenie, komenda,
  render wiersza decyzji w istniejącej osi historii viewera.

## Pre-flight reading

- [docs/backlog-human-agent-decisions.md](../../docs/backlog-human-agent-decisions.md)
  §3 — format zdarzenia i definicja otwartego pytania.
- [docs/backlog-field-editing-history.md](../../docs/backlog-field-editing-history.md)
  §2 — pseudo-pola, ULID, reguły dedupu.
- `backlog/tasks/TL-99-worktrail-handoff-przekazanie-taska-z-powodem-i-sladem.md`
  — implementacja `__comment__`, którą ten task rozszerza o parę
  pytanie→decyzja.
- `scripts/task-fields.mjs` (`PSEUDO_FIELDS`), `scripts/history.mjs` —
  zapis/odczyt zdarzeń.

## Kroki

1. `__decision__` w `PSEUDO_FIELDS`; zapis przez `history.mjs` z polami
   `to` (treść), `resolves` (opcjonalne), aktor, ULID; walidacja `resolves`
   wobec istniejących wpisów taska.
2. Funkcja `openQuestions(taskId)` w module historii: zdarzenia pytań bez
   wskazującego `__decision__` — jedna definicja dla CLI, panelu i grafu.
3. Komenda `decide` w `scripts/cli.mjs`: walidacja, zapis zdarzenia, linia
   w `## Log`, `build`; kody wyjścia i komunikaty jak w `handoff`.
4. Render wiersza decyzji w osi historii viewera (nowy rodzaj wiersza,
   z widocznym powiązaniem z pytaniem, gdy `resolves` jest ustawione).
5. Testy: zapis/odczyt/dedup zdarzenia, `resolves` na nieistniejący ULID
   oblewa, `openQuestions` na fixture z parą pytanie→decyzja i pytaniem
   otwartym (kontrola pozytywna: otwarte pytanie jest wykrywane).

## Acceptance criteria

- [ ] `worktrail decide` bez `--reason` kończy się kodem 2 i niczego nie
      zapisuje.
- [ ] Po `decide --resolves <id>` pytanie znika z `openQuestions`; pytanie
      bez decyzji jest w nim widoczne (kontrola pozytywna).
- [ ] `--resolves` z ULID-em spoza historii taska oblewa przed zapisem.
- [ ] Wiersz decyzji jest widoczny w osi historii viewera.
- [ ] W `## Log` taska pojawia się linia z decyzją i aktorem.
- [ ] Cała nowa powierzchnia po angielsku; `worktrail check --language`
      zielone.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-09-01 blocked — agent:claude — task założony z analizy human/agent;
  czeka na implementację `__comment__` z TL-99. Rozstrzygnięcia w
  docs/backlog-human-agent-decisions.md.
