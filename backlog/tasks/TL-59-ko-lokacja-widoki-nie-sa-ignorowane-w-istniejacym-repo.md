---
id: TL-59
title: "Ko-lokacja: widoki nie są ignorowane w istniejącym repo"
type: bug
labels: [pre-launch]
board: main
epic: "Integralność danych"
priority: P1
status: done
owner: claude
estimate: 4h
confidence: high
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-config-and-portability.md
verification:
  - bash: "node --test scripts/tests/init-gitignore.test.mjs"
  - bash: "d=$(mktemp -d) && cd \"$d\" && git init -q . && printf 'node_modules/\\n' > .gitignore && node /Users/limack/workspace/tasklog/bin/worktrail.mjs init --dir . >/dev/null && git check-ignore -q INDEX.yaml && echo 'widoki ignorowane w istniejącym repo — OK'"
  - bash: "node --test scripts/tests/views-not-versioned.test.mjs"
---

## Cel

Po `worktrail init` widoki mają być ignorowane przez gita **w obu układach
katalogów** — także wtedy, gdy repozytorium ma już własny `.gitignore`.

## Kontekst

Zmierzone 2026-08-31, świeże repo z jednolinijkowym `.gitignore`:

```
$ worktrail init --dir .
  pominięte (już istniały, nie ruszam): .gitignore
$ worktrail new --title "Zadanie" && worktrail build
$ git check-ignore -v INDEX.yaml NOW.yaml
(pusto — NIE są ignorowane)
$ git status --porcelain
?? INDEX.yaml
?? NOW.yaml
```

Mechanizm: `init` pisze własny `.gitignore` z regułami na widoki, ale zasada
„istniejący plik jest POMIJANY, nigdy nadpisywany" — słuszna i nie do ruszenia —
sprawia, że w układzie **ko-lokowanym** (`--dir .`, czyli `tasks/` w korzeniu
repozytorium) reguły nie powstają wcale. Pominięcie jest wypisane, ale jako jedna
pozycja wśród dziewięciu, w linii, która czyta się jak informacja porządkowa.

W układzie zagnieżdżonym (`--dir ./backlog`) problemu nie ma, bo `backlog/.gitignore`
powstaje od zera. Oba układy są wspierane — rozstrzyga to `scripts/tests/_repo.mjs`
— więc bramka nie może działać tylko w jednym.

**Dlaczego to jest P1, a nie drobiazg.** Skutkiem jest zacommitowany `INDEX.yaml`,
czyli posortowany agregat WSZYSTKICH tasków. Wtedy każda gałąź przepisuje ten sam
plik i dwie gałęzie konfliktują nawet wtedy, gdy nie mają wspólnego taska — to
jest dokładnie ta awaria, dla której widoki w ogóle są nieversjonowane, i którą
`scripts/tests/views-not-versioned.test.mjs` udowadnia kontrolą pozytywną. Cena
jest płacona później i przez kogoś innego niż ten, kto uruchomił `init`.

Ten sam problem dotyczy `.gitattributes` (`history/*.jsonl merge=union`). Bez
tej reguły append-only log historii konfliktuje przy każdym scaleniu, mimo że
semantycznie sporu nie ma.

**Ograniczenie, które kształtuje rozwiązanie.** Nadpisanie cudzego `.gitignore`
jest niedopuszczalne. Dopisanie do niego też nie jest oczywiste — plik może być
generowany, może być współdzielony, a `init` pisze do cudzego katalogu i nie ma
cofnięcia. Bezpieczna wersja minimalna: **wykryj i powiedz głośno**, z gotowym
blokiem do wklejenia. Wersja wygodniejsza: dopisz blok oznaczony znacznikiem,
gdy plik nie jest tylko do odczytu, i wypisz dokładnie, co dopisano.

## Pre-flight reading

1. `scripts/init-backlog.mjs` — `GITIGNORE`, `GITATTRIBUTES`, pętla po `FILES` i zasada pomijania.
2. `scripts/tests/views-not-versioned.test.mjs` — dowód, dlaczego wersjonowany agregat konfliktuje.
3. `.gitignore` tego repozytorium — komentarz wyjaśniający powód; ta treść ma trafić do użytkownika.
4. `scripts/tests/_repo.mjs` — dlaczego oba układy katalogów muszą być obsłużone.

## Kroki

1. Po zapisie plików `init` sprawdza, czy widoki są faktycznie ignorowane w katalogu docelowym — nie „czy zapisałem `.gitignore`", tylko czy REGUŁA OBOWIĄZUJE. `git check-ignore` jest do tego właściwym narzędziem, bo zna też `.git/info/exclude` i pliki nadrzędne.
2. Gdy nie obowiązuje: wypisz to jako OSTRZEŻENIE (nie jako pozycję listy pominięć), z gotowym blokiem reguł i jednym zdaniem, dlaczego to ważne.
3. Rozstrzygnij dopisywanie: blok ze znacznikiem (`# worktrail: …`), tylko za jawną zgodą (`--gitignore` / pytanie), nigdy po cichu. Dopisanie ma być idempotentne — drugi `init` nie dokłada drugiego bloku.
4. To samo dla `.gitattributes` i reguły `merge=union`.
5. Jeśli katalog nie jest repozytorium gita, nie strasz — powiedz neutralnie, że reguły będą potrzebne po `git init`.
6. Test `scripts/tests/init-gitignore.test.mjs`: repo BEZ `.gitignore` (dziś działa) i repo Z `.gitignore` (dziś oblewa) — w obu przypadkach po `init` widoki są ignorowane albo użytkownik dostał ostrzeżenie. Kontrola pozytywna: bez poprawki drugi przypadek MUSI oblewać.

## Acceptance criteria

- [ ] Po `init` w repo z istniejącym `.gitignore` widoki są ignorowane ALBO użytkownik dostał wyraźne ostrzeżenie z gotowym blokiem.
- [ ] Istniejący `.gitignore` nigdy nie jest nadpisany.
- [ ] Dopisanie (jeśli zaimplementowane) jest idempotentne i oznaczone znacznikiem.
- [ ] To samo rozstrzygnięcie dla `.gitattributes`.
- [ ] Test pokrywa oba układy katalogów i ma kontrolę pozytywną.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 created — agent:claude — zmierzone na świeżym repo podczas audytu onboardingu
- 2026-08-31 in_progress — agent:claude — start implementacji
- 2026-08-31 done — agent:claude — `init` sprawdza `git check-ignore` po zapisie i dopisuje blok ze znacznikiem `# >>> worktrail` do istniejącego `.gitignore`/`.gitattributes`; `--no-gitignore` wyłącza i podaje reguły do wklejenia. Reguły wyciągnięte do `IGNORE_RULES`/`ATTRIBUTE_RULES` — jedno źródło dla zapisu i dopisania. Dodatkowo: śledzony już widok jest nazwany wprost, z `git rm --cached`, bo ignorowanie nie działa wstecz. Test `init-gitignore.test.mjs`, 10 asercji; moc dowodowa sprawdzona przez wyłączenie zachowania — wtedy oblewa asercja ko-lokacji, a układ zagnieżdżony nadal przechodzi. 273/273.
