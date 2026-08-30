---
id: TL-74
title: "worktrail instructions — instrukcje workflow wydaje CLI, nie plik w cudzym repo"
type: code
labels: [post-launch]
board: main
epic: "Onboarding"
priority: P1
status: done
owner: agent:claude
estimate: 1d
confidence: high
created: 2026-08-31
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - .claude/skills/backlog-workflow/SKILL.md
verification:
  - id: guides
    bash: "node --test scripts/tests/instructions.test.mjs"
  - id: refusal
    bash: "! node scripts/cli.mjs instructions task-invention 2>/dev/null"
  - id: envelope
    bash: "node --test scripts/tests/json-envelope.test.mjs"
  - id: guards
    bash: "node scripts/cli.mjs check"
  - id: no-regression
    bash: "node --test scripts/tests/*.test.mjs"
---

## Cel

`worktrail instructions [temat]` wypisuje instrukcję pracy z backlogiem prosto z
CLI. Agent spoza Claude Code (Codex, Gemini CLI, gołe API) dostaje ten sam
workflow bez naszego pluginu, instrukcja wersjonuje się z narzędziem, a jej
treść mówi słownictwem CZYTANEGO backlogu, nie naszego.

## Kontekst

Mamy skill `backlog-workflow` — działa, ale wyłącznie w Claude Code i wyłącznie
u kogoś, kto ma nasz plugin. Użytkownik `npm i -g worktrail` nie dostaje nic:
`worktrail --help` mówi, JAKIE są komendy, nie mówi, JAK się pracuje.

Backlog.md rozwiązał to tak, że instrukcje wydaje CLI, a w `CLAUDE.md`/`AGENTS.md`
zostaje jedna linijka „uruchom `backlog instructions overview`". Zaleta jest
strukturalna: skopiowany plik z instrukcją zamarza w wersji z dnia kopiowania i
po pół roku uczy nieistniejących flag. Komenda nie może się rozjechać z
narzędziem, bo jest tym samym artefaktem.

**Analiza ich `src/guidelines/` (2026-08-31) dała cztery elementy konstrukcji,
które są ważniejsze niż sam fakt istnienia komendy.** Bez nich dostaniemy ten
sam tekst co dziś, tylko wypisany z innego miejsca:

1. **Instrukcja nie zna słownictwa projektu.** Ich pliki nigdy nie piszą
   „In Progress" — piszą `<active status>`, `<terminal status>`,
   `{{TASK_ID:123}}`, podstawiane przy renderowaniu z configu czytanego
   backlogu, a agentowi każą odczytać dopuszczalne wartości z `--help`. To jest
   III prawo zastosowane do TEKSTU. Nasz `SKILL.md` wpisuje `pending`,
   `in_progress`, `P0`, `TL-1234` literałem, czyli uczy wartości TEGO repozytorium
   jako stałych narzędzia — a w cudzym backlogu każda z nich oblewa.
2. **Rozdzielnia, nie jeden blok.** `overview` NIE zawiera procedury. Mówi, kiedy
   działać, i odsyła do jednego z trzech przewodników fazowych, z twardym
   „Required: read the matching guide, do not rely on this overview alone".
   Nasz `SKILL.md` to ~120 linii ładowanych zawsze w całości. Podział na fazy to
   mniej kontekstu i ostrzejsza instrukcja w chwili, gdy jest potrzebna.
3. **Wersja w nudge'u + komenda odświeżająca.** Wstrzyknięty do `CLAUDE.md`
   fragment niesie metadane wersji, a `agents --update-instructions` go
   odświeża. Bez tego `init` zostawia w cudzym repo tekst, który gnije.
4. **Jednopytaniowa heurystyka „czy w ogóle zakładać task":** *„Czy muszę
   pomyśleć, JAK to zrobić?"*. Nasz odpowiednik to lista wyjątków. Jedno pytanie
   stosuje się szybciej i myli rzadziej.

Odrzucona alternatywa: serwer MCP. Ich własny task `back-349` brzmi „Publish
Backlog.md as an Agent Skill with bundled guidance, **no MCP resources required
for instructions**" — sami przesunęli się z MCP na skill plus instrukcje z CLI.
Idziemy tam, dokąd doszli, zamiast powtarzać ich drogę.

Rozstrzygnięte: instrukcja jest JEDNYM źródłem. Skill `backlog-workflow` po tym
tasku odsyła do komendy albo jest z niej generowany — dwa teksty o tym samym,
które mogą się rozjechać, są wadą, nie redundancją.

## Pre-flight reading

1. `.claude/skills/backlog-workflow/SKILL.md` — treść do przeniesienia; materiał
   źródłowy, nie inspiracja. Zwróć uwagę na literały słownictwa do usunięcia.
2. `scripts/cli.mjs` — tablica komend i kształt `--help`.
3. `scripts/config.mjs` — jak sięgnąć po słownictwo projektu.
4. `scripts/init-backlog.mjs` — gdzie `init` pisze pliki i co już dopisuje.

## Kroki

1. `worktrail instructions` bez argumentu — lista tematów. Nieznany temat oblewa
   z listą znanych.
2. Tematy: `overview` (rozdzielnia — kiedy działać, dokąd iść), `task-creation`,
   `task-execution`, `task-finalization`. `overview` NIE powtarza procedury.
3. Szablonowanie: żadnego statusu, priorytetu, prefiksu ani przykładowego ID
   wpisanego literałem. Wartości podstawiane z `config.yaml` czytanego backlogu.
4. Heurystyka z punktu 4 kontekstu na początku `overview`.
5. `--json` (koperta z TL-72).
6. Rozstrzygnij duplikat ze skillem: odsyła albo jest generowany.
7. `worktrail init` dopisuje nudge z metadanymi wersji do `CLAUDE.md`/`AGENTS.md`,
   zachowując istniejącą treść. Komenda odświeżająca nudge do starszej wersji.
8. Rozstrzygnięcia z TL-84 (ręczna edycja) i TL-85 (polityka zakresu) mają
   wylądować TUTAJ, w jednym źródle — nie w skillu obok.
9. `scripts/tests/instructions.test.mjs`: każdy temat coś wypisuje; nieznany
   temat wychodzi !=0; **w wyjściu nie ma statusu spoza fixture'owego configu**
   (kontrola pozytywna — fixture ma mieć NIEDOMYŚLNE słownictwo, żeby literał
   w kodzie oblał test); nudge jest rozpoznawalny po wersji i odświeżalny.

## Acceptance criteria

- [x] `instructions` listuje tematy, `instructions <temat>` wypisuje treść, nieznany oblewa z listą. [proof: guides, refusal]
- [x] `overview` jest rozdzielnią i odsyła do przewodników fazowych; nie powtarza ich procedury. [proof: guides]
- [x] W żadnym temacie nie ma statusu, priorytetu ani prefiksu wpisanego literałem. [proof: guides]
- [x] Test oblewa, gdy w wyjściu pojawi się wartość spoza fixture'owego configu. [proof: guides]
- [x] Istnieje dokładnie jedno źródło treści instrukcji; skill do niego odsyła lub z niego powstaje. [proof: guides]
- [x] Nudge niesie wersję, da się go odświeżyć, a dopisanie nie kasuje treści pliku. [proof: guides]
- [x] Heurystyka „czy zakładać task" jest w `overview`. [proof: guides]
- [x] `instructions --json` odpowiada kopertą z `schemaVersion` i `kind`, a README dokumentuje ten rodzaj. [proof: envelope]
- [x] Guardy i cała sucha reszta zestawu zostają zielone. [proof: guards, no-regression]

## Log

2026-08-31 pending — agent:claude — założony z analizy Backlog.md, punkt 5.
2026-08-31 pending — agent:claude — przepisany po analizie `src/guidelines/`: dołożone szablonowanie słownictwem, podział na rozdzielnię i przewodniki fazowe, wersja nudge'a, heurystyka zakładania taska. Estymata 4h → 1d.
