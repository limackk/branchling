---
id: TL-76
title: "Przechodni graf zależności wyliczany przy odczycie"
type: code
labels: [post-launch]
board: main
epic: "Integralność danych"
priority: P3
status: pending
owner: unassigned
estimate: 4h
confidence: high
created: 2026-08-31
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs: []
verification:
  - bash: "node --test scripts/tests/dependency-graph.test.mjs"
  - bash: "node scripts/cli.mjs query --graph TL-74"
---

## Cel

Detal taska pokazuje pełny, przechodni kontekst zależności: na co ten task czeka
(bezpośrednio i dalej) i co odblokuje. Graf jest wyliczany przy odczycie i nie
ląduje w żadnym pliku.

## Kontekst

Mamy `blocked_by` i `blocks` jako płaskie listy ID oraz guard
`check-backlog-refs.mjs`, który pilnuje, że wskazują na istniejące taski.
Brakuje przechodniości: „TL-80 czeka na TL-72, a TL-72 na TL-68" trzeba
dziś składać ręcznie, otwierając plik po pliku.

Graf jest wyliczany, nigdy zapisywany — II prawo. Zapisany zdążyłby stać się
prawdą i rozjechać się z listami, z których powstaje.

Cztery przypadki brzegowe, które muszą być obsłużone jawnie (wzięte z modelu
Backlog.md, bo są to dokładnie te miejsca, gdzie naiwna implementacja kłamie):

1. **Kierunek krawędzi.** Krawędź idzie od taska, który deklaruje zależność, do
   taska, od którego zależy. Wskazany blokuje wskazującego.
2. **Cykl** — oznaczony `(cykl)`, nie rozwijany w nieskończoność.
3. **Powtórzenie** — task pokazany raz; kolejne wystąpienie to `(wyżej)`.
4. **Nierozstrzygnięta tożsamość** — `nieznane ID` (nikt się nie zgłasza) i
   `niejednoznaczne ID` (zgłasza się więcej niż jeden). ŻADNE z nich nie liczy
   się jako spełnione i graf się za nie NIE przechodzi. Zły graf, który
   raportuje „odblokowane", jest gorszy niż brak grafu.

## Pre-flight reading

1. `scripts/check-backlog-refs.mjs:66-114` — `REF_FIELDS`, `auditRefs()`. Tu już
   jest połowa logiki: czytanie pól i rozstrzyganie, czy ID istnieje.
2. `scripts/query.mjs` — gdzie wpiąć wyjście tekstowe i JSON-owe.
3. `_template.md` — semantyka `blocked_by` i `blocks` w szablonie.

## Kroki

1. Wydziel z `check-backlog-refs.mjs` rozstrzyganie ID (istnieje / nieznane /
   niejednoznaczne) do modułu używanego przez guard i przez graf.
2. `scripts/dependency-graph.mjs` — budowa grafu z korzenia w obie strony,
   z obsługą cyklu, powtórzenia i nierozstrzygniętego ID.
3. Wyjście tekstowe: drzewko z nagłówkiem `N bezpośrednich, M łącznie`.
4. Wyjście JSON: `root`, `nodes`, `edges`; węzeł niesie głębokość w obu
   kierunkach (`null`, gdy nieosiągalny w danym kierunku).
5. Ten sam graf w detalu taska w viewerze.
6. `scripts/tests/dependency-graph.test.mjs` — po fixturze na każdy z czterech
   przypadków brzegowych. Zwłaszcza: niejednoznaczne ID NIE jest spełnione.

## Acceptance criteria

- [ ] Graf pokazuje zależności przechodnie w obu kierunkach, z rozróżnieniem bezpośrednich.
- [ ] Cykl i powtórzenie są oznaczone, nie rozwijane.
- [ ] Nieznane i niejednoznaczne ID nigdy nie liczy się jako spełnione ani nie jest przechodzone.
- [ ] Graf nie jest zapisywany do żadnego pliku taska.
- [ ] Test ma osobny fixture na każdy z czterech przypadków brzegowych.

## Log

2026-08-31 pending — agent:claude — założony z analizy Backlog.md (github.com/MrLesk/Backlog.md), punkt 4.
2026-09-01 pending — agent:claude — obniżony P2→P3 z analizy konkurencyjności — feature parity z liderem nie jest powodem migracji; graf może czekać za mechanizmem weryfikacji i launchem.
