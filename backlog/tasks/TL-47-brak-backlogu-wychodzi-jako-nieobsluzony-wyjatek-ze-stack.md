---
id: TL-47
title: "Brak backlogu wychodzi jako nieobsłużony wyjątek ze stack tracem"
type: bug
labels: []
board: main
epic: "Backlog — publikacja open source"
priority: P3
status: pending
owner: unassigned
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-config-and-portability.md
verification:
  - bash: "cd /tmp && node <ścieżka>/bin/worktrail.mjs query --count 2>&1 | head -3   # expected: sam komunikat, bez `at ...`"
---

## Cel

Przewidziany, opisany stan („nie ma tu backlogu") ma wychodzić jako komunikat i
kod wyjścia, a nie jako zrzut wyjątku.

## Kontekst

Zmierzone 2026-08-31 z pustego katalogu:

```
Error: Nie znalazłem katalogu backlogu. Wskaż go: --dir <ścieżka> albo
BACKLOG_DIR=<ścieżka>, albo uruchom z katalogu repozytorium, które ma backlog/tasks/.
    at resolveBacklogDir (file:///…/scripts/paths.mjs:119:9)
    at file:///…/scripts/query.mjs:81:34
    at ModuleJob.run (node:internal/modules/esm/module_job:439:25)
    …
Node.js v24.18.0
```

**Treść jest dobra, opakowanie nie.** Kod wyjścia to 1 i nic nie jest zapisywane
— zachowanie jest poprawne. Problem jest w tym, co to komunikuje: stack trace
mówi „narzędzie się wysypało", a nie „nie tu, spróbuj `--dir`". Dla użytkownika,
który właśnie zainstalował `worktrail` i wywołał go z katalogu domowego, jest to
**pierwszy kontakt z narzędziem**.

Ten sam stan jest w dokumentacji opisany jako projektowany, nie awaryjny — więc
prezentacja przeczy projektowi.

**Druga połowa problemu, zmierzona 2026-08-31 przy audycie onboardingu:** sama
treść komunikatu też jest niepełna. Wymienia trzy sposoby WSKAZANIA istniejącego
backlogu (`--dir`, `BACKLOG_DIR`, uruchomienie z repozytorium) i ani jednego na
ZAŁOŻENIE nowego. Człowiek, który przed chwilą zainstalował narzędzie i wywołał
je pierwszy raz, jest dokładnie w tym drugim przypadku — a `worktrail init --dir
<ścieżka>` nie pada w komunikacie ani razu. Rozstrzygnięcie, którą podpowiedź dać
pierwszą, można oprzeć na kontekście: katalog wygląda na korzeń repozytorium bez
backlogu → prawdopodobnie `init`; katalog domowy → prawdopodobnie `--dir`.

## Kroki

1. Znaleźć WSZYSTKIE wejścia, w których `resolveBacklogDir` może rzucić poza
   `try` — nie tylko `query`. Poprawka w jednej komendzie zostawiłaby resztę.
2. Rozstrzygnąć miejsce: łapanie w `cli.mjs` (jedno miejsce, ale omija
   bezpośrednie `node scripts/*.mjs`) czy typowany błąd rozpoznawany w każdym
   wejściu. Zapisać powód wyboru.
3. Zachować kod wyjścia i BRAK zapisu — to jest dziś poprawne i ma takie zostać.
4. Sprawdzić przy okazji, czy inne przewidziane stany (nieznana flaga, nieznana
   komenda, brak rejestru boardów) też nie wychodzą wyjątkiem.

## Acceptance criteria

- [ ] Wywołanie z katalogu bez backlogu: komunikat, kod ≠ 0, **zero linii `at `**.
- [ ] To samo dla wszystkich komend czytających, nie tylko `query` — test iteruje
      po słowniku `COMMANDS`, żeby nowa komenda nie wypadła z pokrycia po cichu.
- [ ] Prawdziwy błąd programisty (np. `TypeError`) **nadal** pokazuje stack —
      wyciszanie wszystkiego byłoby lekarstwem gorszym od choroby. Test negatywny.
- [ ] Komunikat podaje `worktrail init --dir <ścieżka>` jako drogę założenia
      backlogu, obok dzisiejszych trzech sposobów wskazania istniejącego.

## Log

- 2026-08-31 created — claude — znalezione przy uruchamianiu (nie czytaniu) bloku `verification` z TL-33; sam blok wskazywał wtedy ścieżkę, która już nie istnieje, i to jego naprawa odsłoniła ten defekt
- 2026-08-31 updated — agent:claude — dopisana druga połowa: komunikat nie wymienia `worktrail init`; zakres taska rozszerzony zamiast zakładania duplikatu
