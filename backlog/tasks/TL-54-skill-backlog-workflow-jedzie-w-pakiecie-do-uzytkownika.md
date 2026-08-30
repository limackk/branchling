---
id: TL-54
title: "Skill backlog-workflow jedzie w pakiecie do użytkownika"
type: task
labels: [post-launch]
board: main
epic: "Backlog — publikacja open source"
priority: P2
status: pending
owner: unassigned
estimate: 4h
confidence: medium
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - .claude/skills/backlog-workflow/SKILL.md
  - docs/worktrail-global-tool.md
verification:
  - bash: "npm pack --dry-run 2>&1 | grep -q 'skills/backlog-workflow/SKILL.md' && echo 'skill w tarballu — OK'"
  - bash: "node --test scripts/tests/skills-install.test.mjs"
  - bash: "d=$(mktemp -d) && node scripts/cli.mjs init --dir \"$d/backlog\" --skills >/dev/null && test -f \"$d/.claude/skills/backlog-workflow/SKILL.md\" && echo 'instalacja skilla u użytkownika — OK'"
---

## Cel

Sprawić, żeby po instalacji narzędzia agent w cudzym repozytorium **umiał je
prowadzić** — bez przepisywania konwencji z README do własnych instrukcji.

## Kontekst

`.claude/skills/backlog-workflow/SKILL.md` powstał 2026-08-31 i opisuje pracę na
backlogu niezależnie od tego repozytorium: pytanie zamiast czytania widoków,
przejścia statusów, regeneracja po każdej zmianie frontmattera, zamknięcie przez
`verification:`, standard dobrze napisanego taska, numer z `worktrail new` zamiast
`max+1`. Dziś działa tylko tutaj, bo leży w `.claude/` tego repozytorium i nie
wchodzi do `files` w `package.json`.

**Dlaczego to jest dźwignia adopcji, a nie dodatek.** Narzędzie konkuruje z
Jirą i Linearem o uwagę dewelopera. Argument „zainstaluj, powiedz agentowi
«zacznij TL-1234» i on wie, co zrobić" jest czymś, czego tamte narzędzia nie mają
w tej formie — a jednocześnie jest to argument, którego nie da się wygłosić, jeśli
każdy użytkownik musi sobie napisać instrukcję sam. Cała reszta pracy nad
adopcją (README, kolory, `--help`) obniża tarcie; ta daje powód.

**Granica, której nie wolno przekroczyć.** Skill jest instrukcją, nie
konfiguracją. Nie może wpisywać statusów, priorytetów ani prefiksu ID, bo te są
wartościami projektu — ma odsyłać do `config.yaml`. Skill, który stwierdza „statusy
to pending/in_progress/…", zaczyna być drugą prawdą o słowniku i rozjeżdża się
przy pierwszym projekcie, który zdefiniuje własne. Ta sama granica co w Prawie 3.

**Instalacja musi być jawna.** Pisanie do `.claude/` cudzego repozytorium bez
pytania jest zaskoczeniem, a katalog może już zawierać cudzą wersję pliku. Stąd
osobna flaga i brak nadpisywania.

Otwarte pytanie do rozstrzygnięcia w tasku: `worktrail init --skills` czy osobna
komenda `worktrail skills install` (przydatna w repozytorium, w którym backlog już
istnieje). Prawdopodobnie oba, przy czym `init` woła to samo wejście.

## Pre-flight reading

1. `.claude/skills/backlog-workflow/SKILL.md` — treść, która ma pojechać.
2. `scripts/init-backlog.mjs` — jedyna komenda pisząca dziś do cudzego katalogu; wzorzec „pomijam to, co już istnieje".
3. `scripts/tests/packaging.test.mjs` — jak testowana jest zawartość pakietu.
4. `package.json` → `files` — lista dozwoleń.

## Kroki

1. Przenieś skill do katalogu pakietowego (`skills/backlog-workflow/SKILL.md`) i dopisz `skills/` do `files`. Rozstrzygnij, czy `.claude/skills/` tego repozytorium ma być kopią, czy dowiązaniem — dwie rozjeżdżające się kopie tego samego skilla to defekt, którym ten projekt zajmuje się od TL-19.
2. Przejrzyj treść pod kątem przenośności: żadnych ścieżek tego repozytorium, żadnych wartości słownika, prefiks ID pokazany jako konfiguracja.
3. Wejście instalujące: kopiuje do `.claude/skills/` katalogu docelowego, NIE nadpisuje istniejącego pliku, wypisuje co zrobiło i co pominęło.
4. `worktrail init --skills` woła to samo wejście.
5. Wspomnij o tym w README — bez tego nikt się nie dowie, że skill istnieje.
6. Test: skill jest w tarballu; instalacja zakłada plik; powtórna instalacja niczego nie nadpisuje.

## Acceptance criteria

- [ ] `skills/backlog-workflow/SKILL.md` jest w tarballu.
- [ ] Instalacja zakłada `.claude/skills/backlog-workflow/SKILL.md` w katalogu docelowym.
- [ ] Powtórna instalacja nie nadpisuje istniejącego pliku i mówi o tym.
- [ ] Treść skilla nie zawiera wartości słownika ani ścieżek tego repozytorium.
- [ ] Jedna kopia skilla w drzewie, nie dwie.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 created — agent:claude — z audytu gotowości do publikacji
