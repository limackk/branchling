---
id: TL-15
title: "Zakoduj filtry listy zadań w URL viewera"
type: code
labels: [pre-launch]
board: main
epic: ""
priority: P2
status: done
owner: claude
estimate: 3h
confidence: high
created: 2026-08-29
updated: 2026-08-29
blocked_by: []
blocks: []
related_docs:
  - backlog/README.md
verification:
  - bash: "node --test backlog/scripts/tests/viewer-url.test.mjs"
  - manual: "W viewerze zaznacz Status=blocked + Epic, wklej URL z paska w nowe okno — ta sama lista, ten sam licznik"
---

## Cel

Widok `Zadania` gubi to, co ustawisz: filtry, szukajka, sortowanie i scope boarda
żyją w pamięci i w `localStorage`, więc „popatrz na te 12 blokerów z epiku Legal"
trzeba opisać słowami zamiast wysłać linkiem. Dashboard ma to od TL-13
(`#dashboard?range=…`); lista zadań ma dostać ten sam kontrakt.

## Kontekst

- Zgłoszenie foundera (2026-08-29): „przy dodaniu filtra i innych parametrów
  buduje się URL, który da się wysłać komuś i dostanie ten sam zestaw tasków".
- Precedens i wzorzec do skopiowania: `dashEncodeHash()` / `dashApplyHash()` /
  `dashSyncHash()` w `build-viewer.mjs` — łącznie z regułą, że parametr, który
  ma też źródło w `localStorage`, emitowany jest ZAWSZE (inaczej odbiorca z
  własnym zapisanym scope zobaczy podzbiór nadawcy i link skłamie).
- Stan przed zmianą: hash niesie tylko `#BL-NNN` (zaznaczony task) albo
  `#dashboard?…`. Scope boarda da się podać przez query `?board=`.
- Dlaczego kod URL-a wyjeżdża do osobnego modułu `viewer-url.mjs`: cały viewer
  jest jednym template literalem w `build-viewer.mjs`, więc nic z jego wnętrza
  nie da się uruchomić w teście — asercje na HTML regexem to detektor bez mocy
  dowodowej. Moduł jest importowany przez test i WKLEJANY do strony przy
  buildzie, więc przeglądarka i `node --test` wykonują ten sam kod, a nie dwie
  kopie, które się rozjadą.

## Kroki

1. `backlog/scripts/viewer-url.mjs` — czyste `encodeTasksHash()` / `parseTasksHash()`.
2. `backlog/scripts/tests/viewer-url.test.mjs` — round-trip, przecinek w nazwie
   epiku, pominięty parametr wraca do domyślnego, nieznany sort.
3. `build-viewer.mjs` — wstrzyknięcie źródła modułu do strony + spięcie z
   `render()`, `selectTask()`, szukajką, zakładkami i `handleHash()`.
4. `backlog/README.md` §2.1 — format linku.

## Acceptance criteria

- [x] Każda zmiana filtra / szukajki / sortowania / boarda / zaznaczenia przepisuje URL.
- [x] Otwarcie URL-a odtwarza dokładnie ten zestaw tasków — także u kogoś, kto ma
      w `localStorage` inny board.
- [x] Parametr nieobecny w linku wraca do wartości domyślnej (link nie zawęża się
      resztkami po stanie odbiorcy).
- [x] Stare linki `#BL-NNN` dalej działają.
- [x] `node --test backlog/scripts/tests/viewer-url.test.mjs` zielony.

## Verification

```bash
# Testy modułu URL — expected: pass, 0 fail
node --test backlog/scripts/tests/viewer-url.test.mjs
# Kontrakt boardów nadal zielony (ten sam plik generatora) — expected: pass
node --test backlog/scripts/tests/boards.test.mjs
```

## Log

- 2026-08-29 created — claude — zgłoszenie foundera: link z filtrami do wysłania
- 2026-08-29 in_progress — claude — start implementacji
- 2026-08-29 done — claude — `viewer-url.mjs` + 8 testów; zweryfikowane w przeglądarce na klikach, nie na kodzie: filtr/szukajka/sort/board/zaznaczenie budują URL, a ten sam URL u „odbiorcy" z `localStorage=backlog-project` odtworzył zestaw nadawcy (4/1349, ta sama kolejność, to samo zaznaczenie) i NIE nadpisał jego zapisanego scope. Drill-down z dashboardu daje teraz link zamiast czyszczenia hasha; stare `#BL-NNN` normalizuje się do pełnej postaci.
- 2026-08-29 follow-up — claude — przycisk „⧉ Kopiuj link" w headerze na prośbę foundera. Trzy drogi (clipboard API → execCommand → prompt), bo `file://` nie jest secure context. Zweryfikowane klikiem: toast „Link skopiowany ✓" na obu ścieżkach — druga sprawdzona z wyłączonym `navigator.clipboard`, żeby nie testować tylko tej, która i tak działa.
- 2026-08-29 renumber — claude — z BL-1389 na TL-15: `next-backlog-id.mjs` w worktree widzi tylko własne drzewo, a równoległa sesja zajęła 1389 w głównym checkoucie (`BL-1389-nazwa-aktywnego-dziecka-z-nieswiezej-listy.md`, wtedy jeszcze niezacommitowany). Numer ustąpiłem ja, bo tamten plik jest w cudzym stage'u, a mój siedział na własnej gałęzi.
