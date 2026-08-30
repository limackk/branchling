---
id: TL-40
title: "check z wyborem guardu i regen-hook w CLI"
type: code
labels: []
board: main
epic: "Powierzchnia CLI"
priority: P1
status: done
owner: claude
estimate: 4h
confidence: high
created: 2026-08-30
updated: 2026-08-30
blocked_by: []
blocks: []
related_docs: []
verification:
  - bash: "node --test scripts/tests/cli.test.mjs"
---

## Cel

Projekt, który konsumuje `worktrail` z instalacji, ma mieć **komendę** na każdą
rzecz, którą dziś robi wywołaniem pliku po ścieżce. Dziś dwie potrzeby nie mają
komendy, więc jedynym wyjściem jest sięgnięcie do `node_modules/worktrail/scripts/…`
— czyli dokładnie ta zależność od układu plików, którą instalacja miała usunąć.

## Kontekst

Zmierzone 2026-08-30 na realnym hooku `pre-commit` projektu, który wydzielił to
narzędzie. Trzy braki:

**1. `check` nie umie wybrać guardu.** Robi zawsze oba. Hook potrzebuje ich
osobno, bo mają **różny zakres z rozmysłem**: kolizja numerów jest właściwością
ZBIORU (czyta całe drzewo), a board jest właściwością JEDNEGO pliku (czyta pliki
ze stage'a — inaczej mój commit oblewałby przez cudzą pracę w toku). Zlanie ich w
jedno wywołanie kasuje tę różnicę.

**2. `check` nie przyjmuje listy plików.** Guard boardów w trybie plikowym
dostaje ścieżki jako argumenty pozycyjne. Bez tego hook musi wołać
`check-backlog-boards.mjs` po ścieżce.

**3. Nie ma komendy na hook PostToolUse.** `regen-on-task-edit.sh` liczy sąsiadów
przez `BASH_SOURCE`, więc *technicznie* zadziała też z `node_modules` — i to jest
pułapka, nie zaleta: wygląda na przenośne, a wymaga, żeby konsument znał ścieżkę
do wnętrza pakietu. Layout pakietu przestaje być wtedy szczegółem implementacji.

**Czwarta rzecz, znaleziona przy okazji:** `check` IGNORUJE nieznane flagi.
`worktrail check --help` uruchamia guardy zamiast pokazać pomoc. To ten sam cichy
no-op, dla którego powstało TL-25 — tyle że `check` powstał później i wypadł
poza tamtą siatkę.

## Pre-flight reading

1. `scripts/cli.mjs` — `runCheck()`; dziś czyta wyłącznie `--dir` i milczy o
   reszcie.
2. `scripts/check-backlog-boards.mjs` — `--all` kontra argumenty pozycyjne.
3. `scripts/check-backlog-id-collisions.mjs` — katalog jako `argv[2]`.
4. `scripts/regen-on-task-edit.sh` — kształt wejścia (JSON hooka na stdin).

## Kroki

1. `check` przyjmuje `--id-collisions` i `--boards` jako selektory. Brak
   selektora = oba, jak dziś (zgodność wstecz).
2. `check --boards <plik…>` przekazuje ścieżki do guardu; bez plików i bez
   `--all` — tryb `--all`.
3. Walidacja flag: nieznana flaga **oblewa** exit 2, `--help` drukuje użycie.
4. `regen-hook` — nowa komenda, czyta JSON hooka na stdin, robi to samo co
   `regen-on-task-edit.sh`. ~~Skrypt zostaje jako implementacja~~ — **zmienione w
   trakcie: skrypt USUNIĘTY**, powód w `## Log`.
5. Kod wyjścia: przy dwóch guardach wygrywa **gorszy**, nie ostatni.

## Acceptance criteria

- [x] `check --id-collisions` uruchamia TYLKO guard kolizji — dowodem jest
      wyjście, nie założenie.
- [x] `check --boards <plik>` sprawdza wskazany plik, nie całe drzewo.
- [x] `check --frobnicate` oblewa exit 2; `check --help` drukuje użycie i nie
      uruchamia guardów.
- [x] `regen-hook` regeneruje widoki i dopisuje historię z JSON-a na stdin.
- [x] `regen-hook` przy pliku spoza `tasks/BL-*.md` jest cichy i kończy 0.
- [x] Bez selektora `check` robi oba guardy i zwraca gorszy kod — test na parze
      (zielony, czerwony), nie na samej ścieżce szczęśliwej.

## Verification

```bash
# expected: pass
node --test scripts/tests/cli.test.mjs

# Nieznana flaga oblewa — expected: exit 2
node scripts/cli.mjs check --frobnicate; echo "exit=$?"

# Selektor zawęża — expected: jedna linia o kolizjach, ZERO o boardach
node scripts/cli.mjs check --id-collisions
```

## Notes

- Krok 3 jest tu, bo bez niego kroki 1–2 są niemierzalne: gdy nieznana flaga
  przelatuje, `check --id-collisions` na starym kodzie też „przechodzi" — robiąc
  oba guardy. Zielone przejście opisywałoby wtedy brak walidacji, nie selektor.

## Log

- 2026-08-30 done — claude — 8 testów w `cli.test.mjs`, 7 red-first (ósmy — „gorszy kod wyjścia" — był już poprawny i dostał siatkę). Pełna suita: 220/234, te same 14 znanych oblanych z TL-38, zero nowych.
- 2026-08-30 zmiana decyzji — claude — `regen-on-task-edit.sh` USUNIĘTY zamiast zostawiony. Powód: `regen-hook.mjs` nie jest jego opakowaniem, tylko drugą implementacją tej samej reguły („co jest taskiem" + „co po edycji"). Dwa miejsca znające jedną decyzję to gwarantowany rozjazd, a skrypt nie miał już żadnego wywołania w tym repo. Konsument (origin) woła własną kopię i przepina się w BL-1446.
- 2026-08-30 pomyłka w teście — claude — pierwsza wersja szukała śladu guardu wzorcem `/numer|board/`, który pada też w TEKŚCIE POMOCY `check`; test raportował uruchomiony guard tam, gdzie wypisała się sama pomoc. Wzorce zawężone do zdań, które drukuje wyłącznie guard.
- 2026-08-30 created — claude — brak zmierzony na hooku pre-commit projektu konsumującego (BL-1446); bez tych komend konsument musi wołać pliki z node_modules po ścieżce
