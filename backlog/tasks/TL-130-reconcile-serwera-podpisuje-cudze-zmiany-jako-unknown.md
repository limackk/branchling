---
id: TL-130
title: "Reconcile serwera podpisuje cudze zmiany jako unknown/external, zanim sesja zdazy je przypisac"
type: task
labels: []
board: main
epic: "Historia i atrybucja"
priority: P2
status: pending
owner: unassigned
estimate: 4h
confidence: medium
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-field-editing-history.md
verification:
  - id: attribution-race
    bash: "node --test scripts/tests/history.test.mjs"
---

## Cel

Zmiana zrobiona ręcznie i przypisana sobie przez sesję (`worktrail history
--actor <ns:name> --source manual --reason "…"`) ma trafić do historii Z TYM
autorem i tym powodem — także wtedy, gdy w tle chodzi `worktrail serve`.
Dzisiaj przegrywa wyścig i ląduje jako `actor: unknown`, `source: external`,
`reason: unknown`, a komenda przypisująca mówi „no changes to record".

## Kontekst

Zmierzone przy TL-97 (2026-09-01). Sesja zmieniła `status: blocked` →
`pending` w TL-99 i TL-100, po czym wykonała udokumentowaną drogę:

```
worktrail history --actor agent:claude-code --source manual --reason "…"
→ worktrail history: no changes to record
```

W `backlog/history/TL-99.jsonl` stoi natomiast wpis o 16:28:28 z
`"actor":"unknown","source":"external","reason":"unknown"`. Zapisał go
`scripts/serve-backlog.mjs:252` — pętla `scheduleReconcile()` działającego
serwera viewera. Reconcile aktualizuje snapshot, więc kolejne wywołanie
`history` nie widzi już RÓŻNICY i milczy: atrybucja jest stracona bezpowrotnie,
bo log jest append-only i nie przepisujemy go.

**Dlaczego to nie jest kosmetyka.** `worktrail instructions task-execution`
podaje `worktrail history --actor … --source manual` jako drogę dla zmian
zrobionych ręcznie. W repozytorium z uruchomionym serwerem ta droga NIE DZIAŁA
i mówi, że nie miała nic do zrobienia — czyli wygląda na wykonaną. Efekt jest
odwrotny do celu całego mechanizmu: `actor` miał mieć stuprocentową obecność
dlatego, że jest wymuszany przy zapisie.

Komentarz w `serve-backlog.mjs:238-244` pokazuje, że problem był przewidziany:
`RECONCILE_DELAY_MS = 2500` istnieje po to, żeby hook agenta zdążył zapisać swój
wpis pierwszy. To działa dla HOOKA, który pisze w milisekundach, i nie działa dla
człowieka ani dla sesji, która edytuje plik i przypisuje sobie zmianę minutę
później. Opóźnienie jest zakładem o czas, nie regułą.

Kierunki do rozważenia (żaden nie jest przesądzony — to jest ta decyzja
projektowa, dla której powstał osobny task):

1. **Odroczenie zamiast zgadywania**: reconcile widzi różnicę, ale zapisuje ją
   dopiero po oknie karencji dużo dłuższym niż 2,5 s, a viewer pokazuje ją jako
   „nieprzypisana" do czasu zapisu.
2. **Wpis do przypisania**: `external/unknown` zostaje, ale `worktrail history
   --actor … --reason …` potrafi DOPISAĆ wpis atrybucji do już zapisanego
   zdarzenia (nowy wpis wskazujący `id` poprzedniego), zamiast szukać różnicy
   w drzewie. Log zostaje append-only.
3. **Reconcile serwera tylko do odczytu**: serwer wykrywa różnicę i sygnalizuje
   ją SSE, ale zapisuje ją TYLKO ten, kto zna autora.

## Pre-flight reading

1. `scripts/serve-backlog.mjs` — `scheduleReconcile()`, `RECONCILE_DELAY_MS`
   i komentarz nad nimi (238-265).
2. `scripts/history.mjs` — `reconcile()`, zwłaszcza aktualizacja snapshotu, bo
   to ona zamyka drogę drugiemu pisarzowi.
3. `scripts/history-record.mjs` — droga `--actor … --source manual`.
4. `docs/backlog-field-editing-history.md` — po co `actor` i `source` w ogóle są.

## Acceptance criteria

- [ ] Kontrola pozytywna: test odtwarza wyścig — zmiana w pliku, reconkiliacja „serwera", potem `history --actor … --reason …` — i dziś OBLEWA. [proof: attribution-race]
- [ ] Po zmianie autor i powód podany przez sesję są w historii, a nie `unknown/unknown`. [proof: attribution-race]
- [ ] Log pozostaje append-only: żaden istniejący wpis nie jest przepisany ani usunięty. [proof: attribution-race]
- [ ] `worktrail history` nie mówi „no changes to record" w sytuacji, w której zmiana jest, a brakuje jej tylko atrybucji. [proof: attribution-race]
