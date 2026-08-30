---
id: TL-124
title: "Karta taska wzietego w innym drzewie wyglada jak wolna"
type: task
labels: []
board: main
epic: "Backlog viewer"
priority: P2
status: done
owner: agent:claude
estimate: 2h
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - docs/worktrail-state-and-sync.md
verification:
  - id: suite
    bash: "node --test scripts/tests/viewer-elsewhere-card.test.mjs"
  - id: no-regression
    bash: "node --test scripts/tests/*.test.mjs"
  - id: manual-glance
    manual: "W repo z drugim worktree, gdzie task jest wzięty: na liście kart w viewerze ta karta jest wyraźnie przygaszona względem sąsiednich i po samym rzucie oka nie czyta się jako wolna do wzięcia"
---

## Cel

Task, który w innym drzewie ma inny status niż tutaj, jest odróżnialny na liście
kart BEZ czytania badge'ów. Dziś jego status lokalny i cała reszta karty wyglądają
identycznie jak u taska naprawdę wolnego.

## Kontekst

TL-73 rozstrzygnął semantykę i jej się nie podważa: status lokalny zostaje,
rozbieżność jest POKAZANA z nazwą źródła, narzędzie nigdy nie wybiera zwycięzcy
po cichu. Ten task nie rusza semantyki — rusza wyłącznie to, jak mocny jest ten
sygnał wizualnie.

Dziś jedynym nośnikiem jest badge `elsewhere` w stopce karty
(`scripts/build-viewer.mjs:2700-2707`, `elsewhereHtml()` w 3223), obok badge'y
statusu, typu, etykiet, boardu, epiku i estymaty. Badge numer siedem w rzędzie
przegrywa z pierwszym wrażeniem: karta ma normalny kontrast, normalny tytuł,
normalny status — i lista czyta się jako „te taski są wolne". Skutek jest
mierzalny: sesja bierze task, który ktoś już robi, i praca powstaje dwa razy —
ten sam tryb awarii, dla którego w CLAUDE.md stoi reguła o scalaniu gałęzi
(TL-74, 2026-09-01, ten sam task wydany dwóm sesjom w odstępie dwóch minut).

Rozstrzygnięcia, które NALEŻĄ do tego taska:

1. **Wyzwalaczem jest ISTNIENIE rozbieżności, nie konkretny status.** Nie wolno
   napisać „przygaś, gdy gdzie indziej jest `in_progress`" — `pending` i
   `in_progress` to WARTOŚCI projektu z `config.yaml`, nie fakty o kodzie
   (III prawo, `labels_closed`/statusy bywają inne w cudzym repo). Regułą jest
   niepuste `elsewhere`, czyli dokładnie to, co liczy `divergences()`.
2. **Przygaszenie nie może udawać wyszarzenia statusu zamkniętego.** Jeśli
   viewer ma już przygaszony wygląd dla czegokolwiek innego, ten musi być
   odróżnialny — inaczej powstaje drugie znaczenie tego samego wyglądu.
3. **Dostępność.** Sam kontrast nie jest sygnałem dla osoby z zaburzeniem
   widzenia barw: karta ma nieść też sygnał niekolorowy (obwódka/wzór/`title`),
   a badge zostaje jako tekst.
4. **Karta wybrana (`.active`) musi zostać czytelna** — przygaszenie nie może
   znosić zaznaczenia.

Poza zakresem: liczniki dashboardu (liczą po statusie lokalnym — świadomie,
`stats` ma osobne pole `divergent`) i widok tabeli. Jeśli okażą się potrzebne,
idą osobnym taskiem.

## Pre-flight reading

1. `scripts/build-viewer.mjs:2688-2712` — budowa karty i jej stopki.
2. `scripts/build-viewer.mjs:3223-3230` — `elsewhereHtml()`, jedyne dzisiejsze
   użycie `elsewhere` na karcie.
3. `scripts/build-viewer.mjs:761-800` — style `.task-card*`.
4. `scripts/branch-scan.mjs:389-400` — `divergences()`, definicja „różni się".

## Kroki

1. Klasa na karcie, gdy `t.elsewhere` jest niepuste; styl w tym samym miejscu co
   pozostałe `.task-card*`, z wariantem dla trybu ciemnego.
2. Sygnał niekolorowy + `title` mówiący, gdzie task jest widziany inaczej —
   tym samym zdaniem co badge, żeby nie powstały dwa sformułowania.
3. Sprawdzić kartę zaznaczoną i kartę przygaszoną naraz.
4. Test na wygenerowanym HTML/DOM: fixture z rozbieżnością daje klasę na karcie,
   fixture bez rozbieżności jej NIE daje (kontrola pozytywna i negatywna — guard
   bez niej przechodzi na zerowej próbce).

## Acceptance criteria

- [x] Karta taska z niepustym `elsewhere` jest wizualnie odróżniona od karty bez rozbieżności. [proof: suite, manual-glance]
- [x] Reguła nie zna nazw statusów — wyzwalaczem jest sama rozbieżność. [proof: suite]
- [x] Sygnał jest czytelny bez rozróżniania barw i nie znosi zaznaczenia karty. [proof: suite, manual-glance]
- [x] Test ma kontrolę pozytywną i negatywną. [proof: suite]
- [x] Pozostałe testy zielone. [proof: no-regression]
