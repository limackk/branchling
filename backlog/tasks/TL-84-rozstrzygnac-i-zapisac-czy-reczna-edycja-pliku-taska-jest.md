---
id: TL-84
title: "Rozstrzygnąć i zapisać: czy ręczna edycja pliku taska jest drogą wspieraną"
type: task
labels: [pre-launch]
board: main
epic: "worktrail — narzędzie"
priority: P2
status: pending
owner: unassigned
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - CLAUDE.md
  - docs/worktrail-global-tool.md
verification:
  - manual: "W README i w instrukcji dla agenta stoi jedno, to samo zdanie o ręcznej edycji pliku taska — i da się wskazać, gdzie zapisano uzasadnienie"
  - bash: "grep -rn 'ręczn\\|manual' README.md docs/worktrail-global-tool.md | head"
---

## Cel

Mamy zapisaną, jawną odpowiedź na pytanie „czy wolno edytować plik taska
ręcznie" — jedną, tę samą w README, w instrukcji dla agenta i w zachowaniu
narzędzia.

## Kontekst

Backlog.md odpowiada na to pytanie twardo i powtarza odpowiedź w trzech
miejscach (nudge, overview, execution guide): *„Do not edit Backlog markdown
files directly. Use the CLI so metadata, relationships, and history stay
consistent."* U nich CLI jest jedyną legalną drogą zapisu.

My mamy model odwrotny i mamy go **niejawnie**. Plik JEST prawdą; `worktrail
history --source manual` istnieje dokładnie po to, żeby obsłużyć zmiany zrobione
poza narzędziem; `_template.md` jest szablonem do wypełnienia ręką. Nigdzie
jednak nie jest napisane, że to jest droga WSPIERANA, a nie tolerowana — więc
przy każdej kolejnej komendzie piszącej pytanie wraca i jest rozstrzygane od
nowa, za każdym razem inaczej.

To nie jest task o kodzie. To jest task o zapisaniu decyzji, zanim TL-80,
TL-82 i TL-83 zaczną ją rozstrzygać po cichu i niespójnie.

Co trzeba rozważyć, żeby odpowiedź nie była życzeniem:

1. **Cena naszego modelu.** Ręczna edycja rozjeżdża pola wyliczane i omija
   historię. `history --source manual` łata to po fakcie i tylko wtedy, gdy ktoś
   pamięta ją uruchomić.
2. **Cena ich modelu.** Backlog przestaje być zwykłym markdownem — bez
   zainstalowanego narzędzia nie da się poprawić literówki, a task w cudzym
   pull requeście przestaje być czytelną, edytowalną treścią.
3. **Trzecia opcja:** ręczna edycja wspierana, ale narzędzie wykrywa rozjazd i
   mówi o nim samo (`doctor` / `check`), zamiast wymagać pamiętania o `history`.
   Sprawdź, ile z tego już robi `doctor`.
4. Cokolwiek wyjdzie, ma trafić do **jednego** źródła instrukcji z TL-74 —
   nie do trzech tekstów, które mogą się rozjechać.

## Pre-flight reading

1. `scripts/history.mjs` i `scripts/history-record.mjs` — co dziś wychwytuje
   zmianę zrobioną poza narzędziem i czego nie wychwytuje.
2. `scripts/doctor.mjs` — ile z wykrywania rozjazdu już istnieje.
3. `.claude/skills/backlog-workflow/SKILL.md`, sekcja „Editing outside the viewer".
4. `docs/worktrail-global-tool.md` §3 — cztery prawa; sprawdź, czy któreś z nich
   już tę odpowiedź implikuje, zamiast wymyślać ją od zera.

## Kroki

1. Wypisz, co realnie psuje się przy ręcznej edycji (nie hipotetycznie — sprawdź
   na pliku: pola wyliczane, historia, `updated`).
2. Sprawdź, ile z tego wykrywa dziś `doctor`/`check` bez pamiętania o `history`.
3. Rozstrzygnij: wspierana / tolerowana / niewspierana. Zapisz uzasadnienie.
4. Wpisz odpowiedź do README i do źródła instrukcji z TL-74 — jednym zdaniem,
   tym samym w obu miejscach.
5. Jeśli wyszła opcja 3: załóż osobny task na wykrywanie rozjazdu. Nie rób go tutaj.

## Acceptance criteria

- [ ] Decyzja jest zapisana wraz z uzasadnieniem i listą tego, co realnie się psuje.
- [ ] README i instrukcja dla agenta mówią to samo, jednym zdaniem.
- [ ] Sprawdzone (nie założone), ile rozjazdu wykrywa dziś `doctor`/`check`.
- [ ] Ewentualna praca nad wykrywaniem rozjazdu jest osobnym taskiem, nie doklejona tutaj.

## Log

2026-08-31 pending — agent:claude — z analizy Backlog.md: oni zakazują ręcznej edycji i powtarzają to w trzech miejscach; my mamy model odwrotny i nigdzie go nie zapisaliśmy.
