---
id: TL-16
title: Edytuj każde pole taska kliknięciem w viewerze
type: code
labels: [pre-launch]
board: main
epic: "Backlog viewer"
priority: P2
status: done
owner: claude
estimate: 4h
confidence: high
created: 2026-08-29
updated: 2026-08-29
blocked_by: []
blocks: [TL-17]
related_docs:
  - docs/backlog-field-editing-history.md
  - backlog/README.md
verification:
  - bash: "node --test backlog/scripts/tests/task-fields.test.mjs"
  - manual: "W viewerze (backlog) kliknij Owner w detalu taska, wpisz wartość, Tab — pole zapisane w .md, INDEX.yaml zregenerowany"
---

## Cel

Viewer umiał zmienić dokładnie jedno pole — `status`. Każda inna zmiana (priorytet, owner, estymata, labels, epic, board, blocked_by, related_docs, tytuł) wymagała otwarcia pliku `.md` w edytorze, czyli wyjścia z narzędzia, w którym właśnie się patrzy na task. Po tym tasku każde pole frontmattera edytowalne jest kliknięciem.

## Kontekst

- Zapis szedł dwiema drogami: `fetch("api/status")` w trybie serwera i File System Access API w trybie `file://`. Dwie implementacje jednej decyzji („co ustawić przy zmianie statusu") — klasyczny rozjazd czekający na pierwszą zmianę reguł.
- Słownik statusów istniał w trzech miejscach: `serve-backlog.mjs`, `build-viewer.mjs`, README.
- Decyzja foundera (2026-08-29): edycja **tylko przez lokalny serwer**. W `file://` pola są read-only. Powód w [`docs/architecture/backlog-field-editing-history.md`](../../docs/backlog-field-editing-history.md) §5.

## Kroki

1. `backlog/scripts/task-fields.mjs` — schema pól (`EDITABLE_FIELDS`), słowniki, walidacja (`normalizeValue`), zapis do frontmattera (`setFrontmatterField`), diff (`diffMeta`). Bez importów: źródło jest wklejane do viewera, jak `viewer-url.mjs` od TL-15.
2. `serve-backlog.mjs`: `POST /api/field` jako jedyna droga zapisu; `POST /api/status` jako jej alias; `GET /api/fields`.
3. `build-viewer.mjs`: usunięcie kopii parsera frontmattera po obu stronach, render wierszy z `EDITABLE_FIELDS`, edytory per typ (select / input+datalist / checkboxy / textarea), Esc = anuluj, optymistyczny zapis z rollbackiem.
4. Testy kontraktu zapisu — `backlog/scripts/tests/task-fields.test.mjs`.

## Acceptance criteria

- [x] Każde pole z `EDITABLE_FIELDS` da się zmienić kliknięciem w detalu taska.
- [x] Wartość spoza słownika jest odrzucana po stronie serwera i po stronie UI tym samym kodem.
- [x] Zapis pola listowego nie kasuje sąsiedniego klucza frontmattera (`verification:`).
- [x] Tytuł z dwukropkiem zapisuje się w cudzysłowie i wraca bez niego.
- [x] Po zapisie regeneruje się NOW/INDEX/archive.
- [x] `updated:` ustawiane na dziś przy każdej edycji.
- [x] Tryb `file://` nie udaje, że umie zapisać — pola read-only + podpowiedź.

## Verification

```bash
node --test backlog/scripts/tests/task-fields.test.mjs   # 26 testów
```

Ręcznie: `backlog` → wybierz task → kliknij Owner → wpisz `founder` → Tab. W terminalu serwera log `BL-NNN · owner → founder (founder) [widoki zregenerowane]`.

## Log

- 2026-08-29 done — claude — implementacja + testy; edycja tylko przez serwer (decyzja foundera)
