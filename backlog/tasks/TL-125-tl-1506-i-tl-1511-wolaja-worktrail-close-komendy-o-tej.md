---
id: TL-125
title: "TL-96 i TL-101 wolaja worktrail close — komendy o tej nazwie nie ma"
type: task
labels: []
board: main
epic: "Wyróżniki agentowe"
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
estimate: 30m                      # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: [TL-96, TL-101]
related_docs: []
verification:                      # JAK sprawdzić, że task naprawdę jest zrobiony
  - id: no-close-cmd
    bash: "! grep -rn 'worktrail close' backlog/tasks/ --exclude='TL-125-*' --exclude='TL-93-*'"
  - id: run-names-done
    bash: "! grep -qF 'close`, TL-93' backlog/tasks/TL-96-*.md"
  - id: gate-still-green
    bash: "node --test scripts/tests/verification-gate.test.mjs"
---

## Cel

Żaden task w `backlog/tasks/` nie każe wołać `worktrail close`. Komenda nazywa
się `done` i nigdy nie nazywała się inaczej — `close` to nazwa robocza z tasków
pisanych, zanim TL-82 ją zaimplementował.

## Kontekst

Wyszło przy zamykaniu TL-93 (2026-09-01). Dwa taski, które ten task właśnie
odblokował, niosą tę nazwę:

- **TL-101** — w bloku `verification:` ma wpis
  `grep -q 'worktrail close' .claude/skills/backlog-workflow/SKILL.md`.
  To nie jest literówka w prozie, tylko kontrakt zamknięcia: żeby go spełnić,
  wykonawca musiałby WPISAĆ do skilla nieistniejącą komendę. Bramka
  weryfikacji wymusiłaby wtedy wprowadzenie błędu do pliku, który jedzie do
  cudzych repozytoriów.
- **TL-96** — `## Cel` opisuje pętlę jako „próbuje zamknąć task bramką
  weryfikacji (`close`, TL-93)".

Prozy zamkniętego **TL-93** ten task NIE rusza — jest zapisem decyzji, która
zapadła, a nie długiem do posprzątania; dlatego jego plik jest wyłączony
z grepa razem z tym taskiem, który tę frazę cytuje.

Klasy błędu nie łapie żaden guard: `worktrail check` sprawdza id, boardy,
referencje, słownictwo, język i nazwę produktu, ale nie sprawdza, czy komenda
zawołana we `verification:` w ogóle istnieje. To osobne pytanie i osobny task —
tutaj chodzi wyłącznie o dwa znane wystąpienia.

## Kroki

1. W TL-101: wpis `verification:` i proza → `worktrail done`. Sprawdzić przy
   okazji, czego naprawdę ma dowodzić — grep po SKILL.md jest kontraktem na
   treść skilla, a skill od TL-87 odsyła do `worktrail instructions`.
2. W TL-96: `## Cel` → `done` zamiast `close`; odniesienie do TL-93 zostaje,
   bo to tam bramka została domknięta.
3. `worktrail build`.

## Acceptance criteria

- [ ] Żaden OTWARTY task nie woła `worktrail close`. [proof: no-close-cmd]
- [ ] Kontrakt TL-101 da się spełnić bez wpisania nieistniejącej komendy do `.claude/skills/`. [proof: no-close-cmd]
- [ ] `## Cel` TL-96 nazywa bramkę tak, jak nazywa się komenda. [proof: run-names-done]
- [ ] Bramka dalej zielona po zmianie. [proof: gate-still-green]
