---
id: TL-103
title: "Materiał launchowy — pomiar 27% jako teza i Show HN"
type: task
labels: [pre-launch]
board: main
epic: "Backlog — publikacja open source"
priority: P1
status: pending
owner: unassigned
estimate: 4h
confidence: low
created: 2026-09-01
updated: 2026-09-01
blocked_by: [TL-102]
blocks: []
related_docs:
  - docs/funkcjonalnosci.md
verification:
  - bash: "test -f docs/launch/post.md && grep -qi 'verification' docs/launch/post.md"
  - manual: "Post da się przeczytać w 3 minuty, otwiera się pomiarem z własnego backlogu (z komendą do powtórzenia), a nie opisem funkcji; tytuł Show HN i pierwsze zdanie nazywają problem, nie narzędzie"
---

## Cel

Gotowy materiał launchowy: post (do repo i na blog/HN) z pomiarem z własnego
backlogu jako tezą, tytuł Show HN i plan publikacji. Projekt w tej kategorii
rośnie z jednego dobrego launchu, nie z SEO — ten task robi ten launch
przygotowanym artefaktem, a nie improwizacją w dniu publikacji.

## Kontekst

Mamy historię, której konkurencja nie ma, bo wymaga odwagi zmierzenia siebie:
**12 z 44 zamkniętych tasków własnego backlogu miało łącznie 60 nieodhaczonych
kryteriów akceptacji — przy sprawnym `verification:`** (pomiar 2026-08-31,
metodologia i komenda w `## Kontekst` TL-86). Wniosek posta: checkbox
odhaczany przez wykonawcę nie niesie informacji, gdy wykonawcą jest agent;
dlatego u nas „done" jest kodem wyjścia procesu, a kryteria odhacza narzędzie
z dowodów.

Rama posta: **problem → pomiar → mechanizm → demo**. NIE „przedstawiamy
narzędzie do zarządzania taskami" (kategoria zajęta, czytelnik zamyka kartę),
tylko „agent mówi zrobione i to nieprawda — zmierzyliśmy, jak często, i
zbudowaliśmy bramkę". Narzędzie pojawia się jako konsekwencja tezy, w drugiej
połowie.

`confidence: low`, bo pomiar trzeba POWTÓRZYĆ przed publikacją: liczby z
2026-08-31 będą w dniu launchu stare, a post z komendą do samodzielnego
powtórzenia nie może podawać wyniku, którego ta komenda już nie daje. Jeśli
po wdrożeniu TL-86 świeży pomiar da inną liczbę — post używa świeżej i mówi
o poprawie, co jest nawet lepszą historią.

Zasada nadrzędna: **każda liczba w poście ma obok komendę, którą czytelnik
powtórzy pomiar na własnym backlogu.** To odróżnia pomiar od marketingu i jest
spójne z całym charakterem narzędzia.

## Pre-flight reading

1. `backlog/tasks/TL-86-*.md`, sekcja `## Kontekst` — pomiar źródłowy i jego
   metodologia; post nie może twierdzić więcej, niż pomiar pokazał.
2. `docs/funkcjonalnosci.md` §4 — czego świadomie nie będzie; post nie obiecuje
   rzeczy z tej listy.
3. `backlog/tasks/TL-81-*.md` — ustalona nazwa pakietu i kanały; post musi
   podawać działającą komendę instalacji.

## Kroki

1. Powtórz pomiar na bieżącym drzewie; zapisz skrypt pomiaru w `docs/launch/`.
2. Napisz `docs/launch/post.md` w ramie problem → pomiar → mechanizm → demo,
   po angielsku, ≤3 minuty czytania.
3. Tytuł Show HN + 2–3 warianty; pierwszy komentarz autora (kontekst, ograniczenia,
   czego narzędzie NIE robi — uczciwość gra na HN lepiej niż entuzjazm).
4. Plan publikacji: kolejność (repo → post → HN), dzień tygodnia, kto odpowiada
   na komentarze w pierwszych godzinach.
5. Przejdź listę twierdzeń posta i sprawdź każde na bieżącej wersji narzędzia.

## Acceptance criteria

- [ ] Post otwiera się pomiarem, nie opisem narzędzia; każda liczba ma obok komendę do powtórzenia.
- [ ] Pomiar jest powtórzony na drzewie z dnia publikacji, skryptem zapisanym w repo.
- [ ] Tytuł i pierwsze zdanie nazywają problem, nie kategorię produktu.
- [ ] Komenda instalacji w poście działa (zależność od rozstrzygnięć TL-81).
- [ ] Istnieje przygotowany pierwszy komentarz autora z ograniczeniami narzędzia.

## Log

2026-09-01 pending — agent:claude — założony z analizy konkurencyjności: launch to artefakt do przygotowania, nie zdarzenie; teza posta to pomiar 27% z TL-86, do powtórzenia przed publikacją.
