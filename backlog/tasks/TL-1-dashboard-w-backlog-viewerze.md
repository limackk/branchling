---
id: TL-1
title: "Dashboard backlogu w viewerze — stan, epiki, tempo dzień po dniu"
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
  - manual: "backlog → zakładka „Dashboard" (albo viewer.html#dashboard): KPI, wykres kumulatywny, dzień po dniu, tabela epików, rozkłady, listy uwagi, prognoza"
  - manual: "Klik w nazwę epica przenosi do listy zadań z ustawionym filtrem Epic; klik w tytuł taska otwiera jego detal"
---

## Cel

Viewer pokazywał listę zadań i pasek zbiorczych liczb, ale nie odpowiadał na
pytania „jak stoi backlog jako całość", „które epiki stoją" i „czy w ogóle
domykam szybciej, niż dopisuję". Te odpowiedzi trzeba było składać ręcznie z
`INDEX.yaml`. Dashboard liczy je z tego samego frontmattera, który czyta lista.

## Kontekst

Poproszone przez foundera: statystyki backlogu, stan epików, postęp z dnia na
dzień. Dwie rzeczy, które trzeba było rozstrzygnąć, zanim cokolwiek narysowałem:

1. **Nie ma daty zamknięcia.** Schema frontmattera (README §3) ma `created` i
   `updated`, nie ma `closed`. „Postęp z dnia na dzień" musiał się oprzeć na
   `status: done` + `updated`, czyli na ostatnim dotknięciu pliku. To jest
   proxy, nie pomiar — dashboard mówi to wprost na karcie wykresu i w README,
   zamiast udawać precyzję. Konsekwencja, którą widać w danych: 645 z 930
   domkniętych tasków ma `created == updated`, więc mediana lead time wychodzi
   0 dni. Sprawdzone na plikach, nie założone.
2. **Dashboard nie może dziedziczyć filtrów listy.** Gdyby dziedziczył, ten sam
   ekran raz znaczyłby „stan backlogu", a raz „stan mojego filtru", bez sygnału,
   która wersja jest na ekranie. Liczy zawsze na całym `TASKS`; drill-down idzie
   w drugą stronę — klik w epic/status/etykietę USTAWIA filtr i przełącza na
   listę.

Alternatywa odrzucona: osobny plik `dashboard.html`. Viewer i tak trzyma
komplet tasków w pamięci i ma live-mode (SSE + File System API); druga strona
oznaczałaby drugi odczyt i drugą definicję tych samych liczb.

## Kroki

1. `backlog/scripts/build-viewer.mjs` — CSS zakładek i kart dashboardu.
2. Zakładki `Zadania` / `Dashboard` w nagłówku + `<section id="dashboardView">`.
3. `computeDashboard()` + rendery (SVG bez bibliotek — plik ma działać offline).
4. Wpięcie w `render()` (żeby live-mode odświeżał też dashboard) i w routing hasha.
5. `backlog/README.md` §2.2 — co dashboard pokazuje i czego NIE wie.

## Acceptance criteria

- [x] Zakładka `Dashboard` + deep-link `#dashboard`.
- [x] KPI, wykres kumulatywny, wykres dzień-po-dniu, tabela epików, rozkłady,
      listy uwagi (stale / blocked / najstarsze P0-P1), prognoza.
- [x] Drill-down: epic, status, priorytet, typ, etykieta → filtr listy zadań;
      tytuł taska → detal.
- [x] Dashboard przeżywa live-refresh (`render()` przerysowuje go, gdy aktywny).
- [x] Ostrzeżenie o `updated`-jako-dacie-zamknięcia widoczne w UI i w README.

## Verification

- `node backlog/scripts/build-viewer.mjs` — build przechodzi, 1265 tasków.
- Zweryfikowane w przeglądarce (localhost:3020) w dark i light mode:
  render wszystkich 13 kart, 137 epików w tabeli, oba wykresy, klik w epic
  (57 kart = `total` tego epica), klik w task (detal `BL-061`), przełączanie
  zakładek tam i z powrotem.

## Notes

Dwa błędy złapane dopiero na renderze, nie w kodzie:

- `.bar-track` / `.bar-fill` to `<span>`-y — element inline ignoruje `width`
  i `height`, więc **każdy** słupek rysował się jako pusty tor. Wymuszony
  `display: block`.
- Wykres dzień-po-dniu miał początkowo osobną skalę dla każdej połówki (38 w
  górę, 75 w dół). Wyglądał dobrze i kłamał: 5 zamkniętych rysowało się tak
  wysoko jak 40 nowych. Jedna skala dla obu połówek, wysokość osi liczona z
  proporcji `maxUp : maxDown`.

## Log

- 2026-08-26: zaimplementowane i zweryfikowane w przeglądarce — claude.
