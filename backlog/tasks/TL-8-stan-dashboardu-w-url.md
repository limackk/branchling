---
id: TL-8
title: "Stan dashboardu w URL — widok da się podać dalej"
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
  - manual: "Dashboard → zmień zakres, zakres burndownu, przypnij dzień, posortuj tabelę; URL odzwierciedla każdą z tych rzeczy"
  - manual: "Otwórz ten URL w nowej karcie (albo po zmianie localStorage) — widok odtwarza się dokładnie; samo #dashboard zostawia stan sesji nietknięty"
---

## Cel

Dashboard miał jeden adres (`#dashboard`) na wszystkie swoje stany. Widoku nie
dało się podać dalej — ani drugiej osobie, ani agentowi, ani sobie do jutra.

## Kontekst

Wybrane przez foundera z listy propozycji „co pokaże, że dashboard jest też pod
agentów AI" (odrzucone w tej turze: karta podziału pracy człowiek/agent,
kontrakt agent-readiness tasków, maszynowe wyjście JSON, rozbicie słupków
dziennych na agenta i człowieka).

Trzy decyzje:

1. **Zakres dat i zakres burndownu są emitowane ZAWSZE**, dzień i sortowania
   tylko gdy ustawione. Dzięki temu link jest dokładny: odbiorca z innym
   zakresem w `localStorage` zobaczy zakres nadawcy, a nie swój.
2. **URL wygrywa z `localStorage`, ale go nie nadpisuje.** Otwarcie cudzego
   linku nie ma prawa skasować Twojego ustawienia — nadpisze je dopiero Twoja
   własna zmiana w UI.
3. **Samo `#dashboard` celowo nie niesie stanu** i zostawia bieżący nietknięty.
   To jest to, co produkuje przycisk zakładki; gdyby oznaczało „domyślne",
   klik w zakładkę kasowałby zakres wybrany minutę wcześniej.

Synchronizacja idzie przez `history.replaceState`, nie przez przypisanie do
`location.hash` — przypisanie odpala `hashchange`, co wjechałoby z powrotem w
`handleHash` i zaaplikowało stan, który właśnie został ustawiony.

## Acceptance criteria

- [x] Zakres, zakres burndownu, przypięty dzień i sortowania w hashu.
- [x] Link odtwarza widok i wygrywa z `localStorage`, nie nadpisując go.
- [x] `#dashboard` bez parametrów zostawia stan sesji.
- [x] Deep-link do taska (`#BL-NNN`) działa jak dotąd.

## Verification

- W przeglądarce: hash rośnie przy każdej zmianie stanu; otwarcie
  `#dashboard?range=30&burn=label:pre-launch&day=2026-08-13:daily&sort=epics:p0:desc,barsStatus:value:desc`
  przy `localStorage` ustawionym na 90 dni daje 30 dni, burndown pre-launch,
  panel dnia 2026-08-13, epiki po P0, statusy po wartości — a `localStorage`
  zostaje na 90. Data-śmieć w `day=` jest odrzucana (panel się nie pojawia,
  hash sam się prostuje). Przejście na zakładkę Zadania i z powrotem zachowuje
  stan; `#BL-1030` nadal otwiera task.

## Log

- 2026-08-26: zaimplementowane i zweryfikowane w przeglądarce — claude.
