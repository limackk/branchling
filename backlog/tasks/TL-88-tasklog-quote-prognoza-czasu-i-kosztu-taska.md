---
id: TL-88
title: "worktrail quote — prognoza czasu i kosztu taska"
type: task
labels: []
board: main
epic: "Wyróżniki agentowe"
priority: P2
status: blocked
owner: unassigned
estimate: 1d
confidence: medium
created: 2026-08-31
updated: 2026-08-31
blocked_by: [TL-29]
blocks: []
related_docs:
  - docs/backlog-time-tracking.md
verification:
  - bash: "node --test scripts/tests/quote.test.mjs"
---

## Cel

`worktrail quote TL-NNNN` odpowiada PRZED oddaniem taska agentowi: „taski o tej
estymacie i typie kończą się w 1,4–4,1 h i 250–400k tokenów (n=41)". Kalibracja
z TL-29 liczy bias po fakcie; ta komenda odwraca ją w prognozę — odpowiedź na
pytanie, którego nie zadaje żadne narzędzie backlogowe: **ile będzie kosztowało
puszczenie agenta na ten task**.

## Kontekst

Powstało z przeglądu wyróżników wobec Backlog.md (2026-08-31). Cała mechanika
jest pochodną kalibracji: te same kubełki (estymata × typ × board), te same
progi wiarygodności. Komenda nie liczy niczego nowego — czyta rozkład, który
TL-29 już policzył, i dobiera kubełek do wskazanego taska.

Reguły przejęte wprost z
[docs/backlog-time-tracking.md](../../docs/backlog-time-tracking.md) §11,
bo tu kłamie się najłatwiej:
- poniżej progu `n` odpowiedź brzmi „za mało danych", nie liczba;
- zawsze przedział (p20–p80), nigdy punkt;
- koszt w tokenach tylko, gdy adapter kosztu (TL-30) dostarczył kolumnę —
  brak adaptera = brak kolumny, nie zero;
- **tokeny są osią główną prognozy, kwota jest pochodną warunkową.** Kwota
  pojawia się wyłącznie, gdy KAŻDY wiersz źródłowy kubełka ma stawkę API
  z cennika; dane z trybu `subscription` dają tokeny bez kwoty (z powodem),
  z trybu `local` — zadeklarowane zero (tryby rozliczenia: TL-30 krok 4).
  Użytkownik na abonamencie Claude Code / Codex albo na Ollamie ma dostać
  prognozę tak samo użyteczną jak użytkownik API — tylko bez fikcyjnych
  dolarów;
- **kubełek nie miesza modeli.** Tokeny Sonneta przez API i lokalnej llamy to
  nieporównywalne jednostki wysiłku; wiersz aktywności niesie pole `model`
  (TL-30), więc przy danych z więcej niż jednego modelu kubełek tnie się
  dodatkowo po modelu, a komórki poniżej progu `n` mówią „za mało danych"
  zamiast uśredniać w poprzek;
- udział `unknown` w danych źródłowych jest częścią odpowiedzi: prognoza z
  danych, w których 60% czasu jest nieprzypisane, ma to napisać.

Rozszerzenie opcjonalne (osobny task, gdy quote się przyjmie): pole `budget:`
we frontmatterze i ostrzeżenie hooka przy przekroczeniu wielokrotności
prognozy. Nie pakować tego tutaj.

## Pre-flight reading

- [docs/backlog-time-tracking.md](../../docs/backlog-time-tracking.md) §11
  — format raportu kalibracji, progi `n`, reguła przedziałów.
- `backlog/tasks/TL-29-kalibracja-estymat-z-danych-rzeczywistych.md` — gdzie
  i w jakim kształcie kalibracja składa wyniki; quote MA je czytać, nie liczyć
  ponownie.
- `scripts/task-fields.mjs` — odczyt estymaty i typu wskazanego taska.

## Kroki

1. Dobór kubełka: estymata + typ wskazanego taska; przy braku komórki
   spełniającej próg `n` — degradacja do samej estymaty, jawnie opisana w
   wyjściu.
2. Wyjście tekstowe i `--json`: przedział czasu, przedział tokenów (jeśli
   dane są), `n`, udział `unknown`, użyty kubełek.
3. Task bez estymaty: komunikat wskazujący, że prognoza wymaga estymaty —
   błąd wejścia, nie pusta odpowiedź.
4. Testy na fixture'ach z syntetycznym rollupem: kubełek pełny, kubełek pod
   progiem, dane bez kolumny tokenów, wysoki `unknown_ratio`, dane z dwóch
   różnych modeli (cięcie po modelu, bez uśredniania w poprzek), źródła
   w trybie `subscription` i `local` (kwota nie powstaje / powstaje zero
   zadeklarowane).

## Acceptance criteria

- [ ] Kubełek z `n` poniżej progu daje „za mało danych", nigdy liczbę.
- [ ] Odpowiedź jest zawsze przedziałem; żadnej pojedynczej średniej.
- [ ] Brak adaptera kosztu = brak kolumny tokenów w wyjściu.
- [ ] Kwota w dolarach nie powstaje z danych `subscription`; dane `local` dają
      zero zadeklarowane, odróżnialne od braku danych.
- [ ] Kubełek z danymi więcej niż jednego modelu nie uśrednia tokenów
      w poprzek modeli.
- [ ] `--json` niesie te same pola co wyjście tekstowe.
- [ ] Testy nie asertują wartości z danych tego projektu — fixture'y własne
      (reguła z CLAUDE.md).

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 blocked — agent:claude — task założony z przeglądu wyróżników
  agentowych; czeka na kalibrację TL-29 (a pośrednio na dane z TL-27/25).
- 2026-08-31 revised — agent:claude — uwzględnione tryby rozliczenia
  (API / subskrypcja / model lokalny) i cięcie kubełków po modelu; tokeny
  osią główną, kwota pochodną warunkową.
