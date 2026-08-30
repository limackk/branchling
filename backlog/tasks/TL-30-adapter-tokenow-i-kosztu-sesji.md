---
id: TL-30
title: "Adapter tokenów i kosztu sesji"
type: code
labels: [post-launch]
board: main
epic: "Backlog — pomiar czasu pracy"
priority: P3
status: pending
owner: unassigned
estimate: 4h
confidence: low
created: 2026-08-30
updated: 2026-08-31
blocked_by: [TL-28]
blocks: []
related_docs:
  - docs/backlog-time-tracking.md
verification:
  - bash: "node --test backlog/scripts/tests/cost-adapter.test.mjs"
  - bash: "node backlog/scripts/cli.mjs time --cost --json | python3 -c \"import json,sys; d=json.load(sys.stdin); assert d['tokens'] is None or isinstance(d['tokens'], int), 'brak adaptera musi dawać null, nie zero'; print('tokeny:', d['tokens'])\""
---

## Cel

Dołożyć drugą oś pomiaru wysiłku agenta: tokeny i wywołania narzędzi. Zegar agenta AI zależy od prędkości modelu i od tego, ile razy człowiek przerwał sesję; tokeny są od tego niezależne i przeliczają się wprost na koszt.

## Kontekst

Engaged time (TL-28) mierzy kalendarz pracy, nie jej rozmiar. Dwa taski po 40 minut mogą różnić się kilkukrotnie liczbą tokenów, a to ta druga liczba mówi, ile pracy naprawdę było — i ile kosztowała.

Ograniczenie, które definiuje kształt tego taska: **rdzeń modułu nie może zależeć od Claude Code'a.** Moduł idzie open source i ma działać nad cudzym procesem. Adapter jest więc opcjonalną wtyczką, a nie warunkiem działania — i jego brak musi dawać `null`, nie zero. Zero znaczyłoby „zmierzone i wyszło darmo", czyli nieprawdę; to ten sam kontrakt, który trzyma `estimateHours()`.

## Pre-flight reading

1. `docs/architecture/backlog-time-tracking.md` — §3 (koszt jako czwarta wielkość), §7 (adapter, nie zależność), §10 (koszt jako druga oś).
2. `backlog/scripts/activity.mjs` — kształt wiersza z TL-27; pola kosztowe są OPCJONALNE i muszą takie zostać.
3. `backlog/scripts/estimate.mjs` — kontrakt „`null`, nigdy zero".

## Kroki

1. Rozszerzyć kształt wiersza o opcjonalne `tokens_in`, `tokens_out`, `model` — obecność nieobowiązkowa, brak ≠ zero.
2. Adapter Claude Code: odczyt zużycia z transkryptu sesji (`SessionEnd`) i dopisanie zbiorczego wiersza `kind: "session"` z atrybucją z TL-28.
3. `worktrail time --cost` — tokeny i szacunkowy koszt per task/okres; `null` i jawny komunikat, gdy adapter nie działał.
4. Cennik modeli w `config.yaml` (dane, nie kod) — bez niego raport podaje tokeny bez kwoty, zamiast zgadywać stawkę. Wpis cennika przyjmuje stawkę za token **albo** znacznik trybu rozliczenia: `subscription` (Claude Code / Codex w abonamencie — koszt krańcowy taska w dolarach jest fikcją, raport pokazuje tokeny bez kwoty z podaniem powodu) lub `local` (model lokalny, np. Ollama — stawka jest ZADEKLAROWANYM zerem, odróżnialnym od `null`). Trzy rozróżnialne wyjścia raportu: kwota / tokeny-bez-kwoty-bo-subskrypcja / zero-zadeklarowane; czwarte pozostaje `null` (brak adaptera lub brak wpisu w cenniku).
5. Dokument: dopisać do §8, czy tokeny okazały się stabilniejszym predyktorem niż czas (§12 pkt 1).

## Acceptance criteria

- [ ] Rdzeń działa bez adaptera — jest na to test uruchamiający `worktrail time --cost` na logu bez pól kosztowych.
- [ ] Brak danych kosztowych daje `null` i komunikat, nigdy `0`.
- [ ] Cennik jest daną w `config.yaml`, nie liczbą w kodzie.
- [ ] Nieznany model w logu nie wywraca raportu — jest liczony osobno jako „bez stawki".
- [ ] Tryby `subscription` i `local` dają w raporcie wyjścia rozróżnialne od siebie i od `null` — jest na to test dla każdego z trzech przypadków.
- [ ] Adapter nie jest wymagany przez żaden inny skrypt modułu (test importów).

## Verification

```bash
# 1. Testy adaptera — expected: pass, w tym przebieg BEZ adaptera
node --test backlog/scripts/tests/cost-adapter.test.mjs

# 2. Brak adaptera daje null, nie zero — expected: "tokeny: None"
node backlog/scripts/cli.mjs time --cost --json | python3 -c \
  "import json,sys; d=json.load(sys.stdin); assert d['tokens'] is None or isinstance(d['tokens'], int); print('tokeny:', d['tokens'])"

# 3. Niezależność rdzenia — expected: brak trafień
grep -rl "cost-adapter" backlog/scripts/ --include=*.mjs | grep -v tests | grep -v cost-adapter
```

## Notes

- Świadomie poza zakresem: adaptery dla innych hostów (Cursor, Copilot). Kontrakt `worktrail activity record` z TL-28 już je umożliwia — pisanie ich bez użytkownika byłoby zgadywaniem.
- Jeśli tokeny okażą się WYRAŹNIE lepszym predyktorem niż czas, to zmienia domyślną oś raportu z TL-29 i wymaga osobnego taska, nie cichej podmiany.
- Ten task staje się osią GŁÓWNĄ, nie dodatkową, jeśli bramka korelacji z TL-29 (krok 0) wyjdzie negatywnie — wtedy priorytet idzie w górę.
- Wiersz z tokenami opisuje sesję, więc podlega tej samej retencji i temu samemu `forget` co reszta logu ([TL-31](TL-31-retencja-korekta-atrybucji-i-prawo-do-usuniecia.md)).

## Log

- 2026-08-30 created — claude — rozpisane z analizy pomiaru czasu (docs/architecture/backlog-time-tracking.md)
- 2026-08-30 revised — claude — po adwersarialnym przeglądzie: wiązanie z bramką korelacji z TL-29 i z retencją z TL-31
- 2026-08-31 revised — agent:claude — cennik rozszerzony o tryby rozliczenia (api / subscription / local): kwota, tokeny-bez-kwoty i zadeklarowane zero muszą być rozróżnialne od siebie i od null
