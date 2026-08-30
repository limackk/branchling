---
id: TL-2
title: "Burndown focusa i filtr zakresu dat na dashboardzie backlogu"
type: code
labels: [pre-launch]
epic: ""
board: main
priority: P2
status: done
owner: claude
estimate: 3h
confidence: high
created: 2026-08-26
updated: 2026-08-26
blocked_by: []
blocks: []
related_docs:
  - backlog/README.md
verification:
  - bash: "node backlog/scripts/build-viewer.mjs"
  - manual: "Dashboard → pasek „Zakres dat": presety 30/60/90/cała historia + własne daty; wykresy, tempo, bilans i lead time idą za zakresem, a otwarte/epiki/rozkłady nie"
  - manual: "Karta „Burndown focusa" — linia ciągła (zostało) i kreskowana (zakres focusa), tekst o tempie wypalania, nota o fladze focus"
---

## Cel

Dashboard (TL-1) pokazywał stan całej historii i nie umiał odpowiedzieć na
„jak idzie bieżący focus" ani „co się działo w ostatnich 30 dniach". Dwa
brakujące elementy: burndown zestawu focus i filtr zakresu dat.

## Kontekst

Obie rzeczy uderzają w to samo ograniczenie źródła — **frontmatter nie ma
historii**, ma tylko stan bieżący plus `created`/`updated`:

- **Burndown focusa** musiał zostać zbudowany na `focus: true` jako fladze
  DZISIEJSZEJ. Nic nie zapisuje, kiedy task wszedł do focusa ani kiedy z niego
  wyszedł, więc wykres rekonstruuje przeszłość dzisiejszego zestawu: task
  dorzucony wczoraj jest rysowany tak, jakby był w focusie od dnia utworzenia,
  a task zdjęty z focusa nie istnieje na wykresie wcale. Dlatego oprócz linii
  „zostało" jest druga, kreskowana — „ile tasków tego zestawu wtedy istniało".
  Bez niej rosnąca linia wyglądałaby na regres, a jest rozrostem zakresu.
  Alternatywa (odczyt historii z gita) odpada: viewer to strona bez dostępu do
  repo, a serwer-mode musiałby liczyć `git log` po 1266 plikach na każdy render.
- **Zakres dat rządzi przepływem, nie stanem.** Gdyby filtrował też „otwarte",
  epiki i rozkłady, ten sam ekran raz znaczyłby „stan backlogu", a raz „stan
  tego, co powstało w lipcu" — bez niczego na ekranie, co by to rozróżniało.
  Pasek mówi ten podział wprost.

## Kroki

1. `computeDashboard(tasks, range)` — clamping zakresu, metryki przepływu w
   zakresie, `focusSeries`.
2. `dashFocusChart()` + karta burndownu.
3. Pasek zakresu: presety, dwa pola `date`, persystencja w `localStorage`.
4. Wykresy kumulatywny i dzienny czytają `rangeSeries`; wspólne etykiety osi X.
5. `backlog/README.md` §2.2.

## Acceptance criteria

- [x] Presety 30/60/90/cała historia + własny zakres; wybór przeżywa reload.
- [x] Zakres zmienia: burn-up, dzień po dniu, burndown focusa, tempo, bilans,
      próbkę lead time, prognozę. Nie zmienia: otwarte, epiki, rozkłady, listy.
- [x] Burndown pokazuje „zostało" i „zakres focusa" + tempo wypalania.
- [x] Nota o `focus` jako fladze bieżącej w UI i w README.

## Verification

- `node backlog/scripts/build-viewer.mjs` — build zielony, 1266 tasków.
- W przeglądarce (dark + light): presety, własny zakres, persystencja po
  reloadzie, i cztery przypadki brzegowe bez wyjątku — zakres odwrócony
  (zamiana stron), zakres spoza danych (przycięcie), jeden dzień, data z
  przyszłości.

## Notes

Trzy rzeczy, które wyszły dopiero na renderze:

- Wykres kumulatywny miał oś przybitą do zera. Na zakresie zaczynającym się od
  800 utworzonych cały wybrany tydzień ściskał się w górny pasek wykresu —
  czyli zakres ukrywał dokładnie ten ruch, dla którego się go wybiera. Oś
  liczy się teraz od `min(cumDone)` w zakresie.
- Oś X etykietowana miesiącami jest bezużyteczna na oknie 30-dniowym
  („2026-07 / 2026-08"). Wspólny `dashTimeTicks()`: ≤ 70 dni → etykiety dzienne.
- Zakres w całości poza danymi renderował etykietę „2026-05-23 → 2026-02-01"
  (od przycięte w górę, do zostawione) nad pustymi wykresami. Oba końce są
  teraz przycinane do przedziału danych.

## Log

- 2026-08-26: zaimplementowane i zweryfikowane w przeglądarce — claude.
