---
id: TL-4
title: "Klik w punkt wykresu — panel z taskami z tego dnia"
type: code
labels: [pre-launch]
epic: ""
board: main
priority: P2
status: done
owner: claude
estimate: 2h
confidence: high
created: 2026-08-26
updated: 2026-08-26
blocked_by: []
blocks: []
related_docs:
  - backlog/README.md
verification:
  - bash: "node backlog/scripts/build-viewer.mjs"
  - manual: "Dashboard → klik w punkt każdego z trzech wykresów: panel pod wykresem z taskami utworzonymi i zamkniętymi tego dnia; klik w tytuł otwiera task"
  - manual: "Ponowny klik w ten sam punkt zamyka panel; ✕ zamyka; przypięty dzień poza zakresem dat znika i wraca po poszerzeniu zakresu"
---

## Cel

Wykresy (TL-1, TL-2) i dymki (TL-3) mówiły ILE. Nie mówiły KTÓRE.
„2026-08-09: 41 nowych" to sygnał, ale bez listy tasków nie da się z nim nic
zrobić bez ręcznego grepowania po `created:`.

## Kontekst

Panel liczy taski dnia z tych samych dwóch definicji, z których rysowane są
wykresy: dzień utworzenia to `created`, a „zamknięte tego dnia" to
`status: done` + `updated` z tą datą. To nie jest kosmetyka — gdyby panel miał
własną definicję zamknięcia, lista pod słupkiem pokazywałaby inną liczbę niż
sam słupek, a użytkownik nie miałby jak rozstrzygnąć, która jest prawdziwa.
Z tego samego powodu klik i hover przechodzą przez wspólne
`dashChartPointAt()`: dwa niezależne wyliczenia indeksu mogłyby otworzyć inny
dzień, niż nazywa dymek pod kursorem.

Panel jest zakotwiczony pod TYM wykresem, w który kliknięto (`source` w
payloadzie), a nie w jednym stałym miejscu — dzięki temu nie gubi kontekstu i
na burndownie może zawęzić listę do focusa dokładnie tak, jak robi to wykres.

Odrzucone: filtrowanie listy zadań po dacie. Wymagałoby nowego facetu w
`FILTER_SPECS` (data to nie enum, więc i nowego typu kontrolki), a odpowiedź
i tak byłaby gorsza — jedna lista zamiast rozbicia na „utworzone" i
„zamknięte", które na wykresie są dwiema różnymi seriami.

## Kroki

1. `dashChartPointAt()` — wspólne wyliczenie punktu dla hovera i kliku.
2. `source` w payloadzie każdego wykresu.
3. `dashDayPanel()` / `dashDayPanelFor()` + `state.dashDay`.
4. Klik i ✕ w delegowanym handlerze, toggle przy powtórnym kliknięciu.
5. CSS panelu, `backlog/README.md` §2.2.

## Acceptance criteria

- [x] Klik w punkt każdego z trzech wykresów otwiera panel z listą tasków dnia.
- [x] Rozbicie na utworzone / zamknięte, ze statusem i priorytetem.
- [x] Klik w tytuł otwiera task w widoku listy.
- [x] Toggle na tym samym punkcie i ✕ zamykają panel.
- [x] Panel burndownu pokazuje tylko focus; panel poza zakresem dat znika.

## Verification

- `node backlog/scripts/build-viewer.mjs` — build zielony.
- W przeglądarce realnym kursorem: klik na wykresie dziennym (2026-08-13 → 4
  utworzone / 4 zamknięte) zgadza się co do liczby z dymkiem tego samego dnia
  (+4 nowych, 4 zamkniętych) — kontrola spójności panelu z wykresem. Klik w
  BL-1030 otworzył task z `created`/`updated` 2026-08-13. Toggle, ✕, panel
  focusowy i zachowanie przy zmianie zakresu sprawdzone osobno; dark + light.

## Log

- 2026-08-26: zaimplementowane i zweryfikowane w przeglądarce — claude.
