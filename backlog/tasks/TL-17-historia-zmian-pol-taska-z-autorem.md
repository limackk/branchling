---
id: TL-17
title: Pokaż historię zmian pól taska wraz z autorem
type: code
labels: [pre-launch]
board: main
epic: "Backlog viewer"
priority: P2
status: done
owner: claude
estimate: 4h
confidence: medium
created: 2026-08-29
updated: 2026-08-29
blocked_by: [TL-16]
blocks: []
related_docs:
  - docs/backlog-field-editing-history.md
  - backlog/README.md
  - origin#qa/backlog-field-editing-history.yaml
verification:
  - bash: "node --test backlog/scripts/tests/history.test.mjs"
  - manual: "Zmień pole w viewerze — przy etykiecie pojawia się znacznik „founder · dziś\", a w sekcji Historia zmian wiersz stara → nowa"
---

## Cel

Plik taska mówi, JAKI jest stan, ale nie KTO go ustawił. `## Log` jest ręczny i nieregularny, a `git blame` nie odpowiada na pytanie „kto zmienił priorytet tego taska" — commit obejmuje kilkanaście plików i kilka pól naraz, a agent commituje jako founder. Po tym tasku każda zmiana pola ma wpis z autorem, a przy polu widać, kto zmienił je ostatnio.

## Kontekst

Pełna analiza (model danych, odrzucone alternatywy, granice wiarygodności, droga do wielu użytkowników): [`docs/architecture/backlog-field-editing-history.md`](../../docs/backlog-field-editing-history.md).

Sedno problemu nie jest w zapisie, tylko w **atrybucji**: nie każda zmiana idzie przez viewer. Agent pisze `.md` przez Edit/Write, człowiek przez edytor, `git checkout` przepisuje setki plików. Stąd trzy drogi i jedna zasada — autora podaje ten, kto go zna, a reszta jest jawnie `unknown`, nie zgadywana.

## Kroki

1. `backlog/scripts/history.mjs` — JSONL per task (`backlog/history/BL-NNNN.jsonl`), snapshot odniesienia, `recordEdit` (znane „przed/po") i `reconcile` (diff dysk vs snapshot).
2. `serve-backlog.mjs` — wpis przy każdym `POST /api/field`; `GET /api/history`; rekoncyliacja przy starcie i 2,5 s po zmianie pliku spoza viewera (`unknown`).
3. `history-record.mjs` + hook `regen-on-task-edit.sh` — zmiany agenta podpisane `claude`, zanim rekoncyliacja zdąży je zobaczyć jako anonimowe.
4. Viewer — przełącznik „Edytuję jako", znacznik `autor · kiedy` przy każdym polu, sekcja „Historia zmian" z osią czasu i filtrem po polu.
5. Testy — `backlog/scripts/tests/history.test.mjs`.

## Acceptance criteria

- [x] Zmiana pola w viewerze zapisuje wpis z `actor`, `field`, `from`, `to`, `ts`, `source`.
- [x] Zmiana pliku przez agenta (hook) jest podpisana `claude`, nie `unknown`.
- [x] Zmiana spoza obu dróg trafia do historii jako `unknown` — nie ginie i nie kłamie.
- [x] Ta sama zmiana nie jest liczona dwa razy (serwer vs rekoncyliacja).
- [x] Pierwszy przebieg na istniejącym backlogu NIE produkuje zmyślonych wpisów.
- [x] Uszkodzony wiersz JSONL nie zabiera reszty historii.
- [x] Historia widoczna w detalu taska; przy polu — kto zmienił ostatnio.

## Verification

```bash
node --test backlog/scripts/tests/history.test.mjs   # 13 testów
```

Ręcznie: `backlog` → zmień Status → rozwiń „Historia zmian" → wiersz `founder · Status: pending → in_progress · viewer`. Potem zmień to samo pole edytorem/agentem — po ~3 s dochodzi wiersz z autorem `claude` (hook) albo `unknown` (bez hooka).

## Notes

Świadomie NIE zrobione, uzasadnienie w doc §6–§7:
- backfill historii z gita (autor commita to zawsze founder — dałoby ładną nieprawdę),
- uwierzytelnianie aktora (dziś deklaracja, nie tożsamość),
- historia body taska (tylko frontmatter),
- wykrywanie konfliktu równoległego zapisu.

## Log

- 2026-08-29 done — claude — implementacja + testy + analiza w docs/architecture/
