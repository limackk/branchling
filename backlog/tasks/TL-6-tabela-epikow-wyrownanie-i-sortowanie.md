---
id: TL-6
title: "Tabela epików: wyrównanie nagłówków, sortowanie, scrollbary w motywie"
type: code
labels: [pre-launch]
epic: ""
board: main
priority: P2
status: done
owner: claude
estimate: 1h
confidence: high
created: 2026-08-26
updated: 2026-08-26
blocked_by: []
blocks: []
related_docs:
  - backlog/README.md
verification:
  - bash: "node backlog/scripts/build-viewer.mjs"
  - manual: "Dashboard → tabela Epiki: liczby stoją pod swoimi nagłówkami; klik w nagłówek sortuje, ponowny odwraca; „(bez epica)" zostaje na dole"
  - manual: "Scrollbary (tabela epików, panel dnia, listy higieny, cała strona) w kolorach motywu, nie systemowa jasna belka"
---

## Cel

Zgłoszone przez foundera na zrzucie: w tabeli epików liczby nie stały pod
swoimi nagłówkami, scrollbar odcinał się od strony, a tabeli nie dało się
posortować.

## Kontekst

Rozjazd nie był błędem danych ani szerokości kolumn: `th` miało domyślne
`text-align: left`, a `td.num` — `right`. Przy szerokiej kolumnie każdy
nagłówek wisiał nad lewą krawędzią komórki, więc wartość czytało się jako
należącą do kolumny obok. Widać to było najmocniej na P0/P1, gdzie czerwona
jedynka wyglądała, jakby stała pod P1. Poprawka to jedna reguła
`.dash-table th.num { text-align: right }` — i ta sama reguła prostuje tabelę
wieku tasków, która miała ten sam defekt.

Sortowanie: kolumny są zadeklarowane w `EPIC_COLUMNS` razem z akcesorem
wartości, więc nagłówek, sortowanie i komórka nie mogą się rozjechać co do
tego, czym jest „Blok.". Kierunek startowy zależy od kolumny (liczby malejąco,
nazwa A→Z), a remisy rozstrzyga nazwa — bez tego dwa epiki o tej samej liczbie
zamieniałyby się miejscami między renderami bez widocznego powodu. Wiersz
„(bez epica)" jest dopisywany po sortowaniu i zostaje na dole, bo nie jest
epikiem, tylko resztą.

Scrollbary: `scrollbar-width: thin` + `scrollbar-color` z tokenów motywu i
odpowiedniki `::-webkit-scrollbar`. Domyślna belka ignoruje motyw i w dark
mode była najjaśniejszym elementem strony.

## Acceptance criteria

- [x] Nagłówki kolumn liczbowych wyrównane do prawej, jak ich wartości.
- [x] Klik w nagłówek sortuje, ponowny odwraca kierunek, aktywna kolumna ma ▲/▼.
- [x] „(bez epica)" zawsze na dole.
- [x] Scrollbary w kolorach motywu w obu trybach.

## Verification

- W przeglądarce (dark + light): sortowanie po P0 (malejąco 4,4,3,2…), toggle na
  rosnąco, sortowanie alfabetyczne w obie strony, sortowanie po dacie ostatniego
  ruchu, „(bez epica)" na dole w każdym z tych układów.

## Log

- 2026-08-26: zaimplementowane i zweryfikowane w przeglądarce — claude.
