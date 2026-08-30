---
id: TL-5
title: "Dashboard: kolejka w godzinach, burndown per zakres, wiek i higiena"
type: code
labels: [pre-launch]
epic: ""
board: main
priority: P2
status: done
owner: claude
estimate: 4h
confidence: high
created: 2026-08-26
updated: 2026-08-26
blocked_by: []
blocks: []
related_docs:
  - backlog/README.md
verification:
  - bash: "node backlog/scripts/build-viewer.mjs"
  - manual: "Dashboard → karta „Kolejka w godzinach" (suma estimate, manual vs code, porównanie do okna), „Wiek otwartych tasków" (histogram × priorytet), „Higiena backlogu" (rozwijane wiersze)"
  - manual: "Burndown → przełącznik zakresu focus / pre-launch / post-launch / epic; wybór przeżywa reload"
---

## Cel

Dashboard liczył sztuki. „328 otwartych" nie mówi, ile to roboty, ile z niej
jest Twoja, jak długo kolejka to nosi ani gdzie backlog przeczy sam sobie.
Trzy karty i jeden przełącznik odpowiadają na te cztery pytania.

## Kontekst

Zakres wybrany przez foundera z listy propozycji (odrzucone w tej turze:
dzienny snapshot stanu i pełna karta blokad).

Pomiar przed implementacją, żeby nie budować karty na danych, których nie ma:
`estimate` ma **100% otwartych tasków** (0 bez), `confidence` też, więc suma
godzin jest policzalna, a ryzyko estymaty pokazywalne. Zmierzone wtedy: 2511 h
otwartej kolejki, 1280 h pre-launch, 496 h focus, 195 z 328 `unassigned`,
136 tasków starszych niż 30 dni.

Trzy decyzje, które zmieniły kształt kart:

1. **Godziny NIE dzielone na h/dzień.** Pierwsza wersja liczyła tempo jako
   `godziny domknięte / dni zakresu` i wyszło **60,4 h/dzień** z ETA 42 dni.
   Dzielenie jest poprawne, twierdzenie fałszywe: estymata to planowany wysiłek
   taska, nie czas zegarowy dnia foundera, a większość kolejki wykonuje agent —
   więc suma domknięta w oknie 60-dniowym spokojnie przekracza liczbę godzin,
   które w tym oknie istniały. Zostało porównanie bezjednostkowe („kolejka jest
   warta ≈ 0,7 tego okna") plus rozbicie `manual` vs `code`, bo to ono mówi
   founderowi, ile roboty jest jego.
2. **Nieparsowalna estymata nie może być zerem.** `dashHours()` zwraca `null`,
   a karta pokazuje osobny licznik „bez policzalnej estymaty". Zero cicho
   zmniejszałoby kolejkę.
3. **Predykat zakresu burndownu jest jeden** (`dashInScope`), używany i przez
   wykres, i przez panel dnia pod nim — inaczej panel pokazywałby inny zbiór
   niż liczy linia nad nim.

## Kroki

1. `dashHours()` / `dashSumHours()` + sumy w `computeDashboard`.
2. `dashInScope()` + pasek zakresu burndownu + persystencja w `localStorage`.
3. Karty: kolejka w godzinach, wiek otwartych, higiena backlogu.
4. `backlog/README.md` §2.2.

## Acceptance criteria

- [x] Kolejka w godzinach z rozbiciem i z licznikiem nieparsowalnych estymat.
- [x] Burndown przełączalny: focus / pre-launch / post-launch / epic.
- [x] Histogram wieku otwartych × priorytet, liczony od `created`.
- [x] Karta higieny: 8 klas naruszeń, każda rozwijana do listy tasków.
- [x] Klik w task z listy higieny otwiera go w widoku listy.

## Verification

- `node backlog/scripts/build-viewer.mjs` — build zielony.
- W przeglądarce (dark + light): 2516 h kolejki (1017 h manual / 1499 h code),
  burndown pre-launch 198 z 794, przełączenie na epic i z powrotem na focus,
  wybór zakresu przeżywa reload, klik w BL-1185 z higieny otwiera task.

## Notes

Trzy pułapki generatora, wszystkie z tego, że kod klienta żyje w template
literalu:

- `\s`/`\d` w regexie trzeba pisać jako `\\s`/`\\d` — inaczej template literal
  zjada backslash i `/^\s*(\d+)/` staje się `/^s*(d+)/`. Objaw: **wszystkie**
  estymaty nieparsowalne, kolejka 0 h, a build i lint zielone.
- `\"` w stringu HTML musi być `\\"` z tego samego powodu; inaczej generowany
  skrypt się nie parsuje.
- Backtick w komentarzu zamyka literal. Guard: `node --check` na skrypcie
  wyciągniętym z `viewer.html`, nie tylko na generatorze.

Osobno, defekt CSS: `.dash-table th` miało `position: sticky`, co przy tabeli
scrollującej się razem ze stroną (a nie w `.dash-scroll`) odklejało nagłówek i
wrzucało go w środek własnych wierszy. Sticky zawężone do kontenera ze scrollem.

## Log

- 2026-08-26: zaimplementowane i zweryfikowane w przeglądarce — claude.
