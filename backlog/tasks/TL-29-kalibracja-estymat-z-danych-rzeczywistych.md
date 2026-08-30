---
id: TL-29
title: "Kalibracja estymat z danych rzeczywistych"
type: code
labels: [post-launch]
board: main
epic: "Backlog — pomiar czasu pracy"
priority: P3
status: pending
owner: unassigned
estimate: 4h
confidence: medium
created: 2026-08-30
updated: 2026-08-30
blocked_by: [TL-28]
blocks: [TL-88]
related_docs:
  - docs/backlog-time-tracking.md
verification:
  - bash: "node --test backlog/scripts/tests/calibration.test.mjs"
  - bash: "node backlog/scripts/cli.mjs stats --calibration --correlation-only"
---

## Cel

Zamienić zebrane minuty w liczbę, która realnie poprawia estymowanie: rozkład rzeczywistego czasu **per kubełek estymaty**, z jawnym progiem wiarygodności — albo w udowodniony wniosek, że taka kalibracja jest bezwartościowa.

## Kontekst

1019 zamkniętych tasków ma estymatę i żadnego sprawdzenia. `confidence: medium` znaczy dziś „tak mi się wydawało" i po roku znaczy tyle samo.

Wartość nie leży w zdaniu „TL-27 zajął 3 h" — pojedynczy task nic nie mówi. Leży w rozkładzie: *taski estymowane na 2 h lądują między 1,4 a 4,1 h, mediana 2,6, n=23*. Dopiero to zmienia następną estymatę.

**Krok 0 jest bramką, nie formalnością.** Estymaty pisano w ramie „ile zajęłoby to człowiekowi", a mierzymy zegar agenta AI. Możliwe, że korelacji nie ma wcale (§14 pkt 1 dokumentu). Sprawdzenie jest tanie — rozrzut wewnątrz kubełka kontra różnica między kubełkami — i musi pójść **przed** budową raportu, żeby nie zbudować ładnej tabeli nad szumem.

Trzy reguły raportu z §11, wszystkie o tym samym: **nie udawać wiedzy, której nie ma.**

1. Poniżej progu `n` (domyślnie 8, z `config.yaml`) raport pisze „za mało danych", a nie liczbę.
2. Zawsze przedział, nigdy punkt — „2h taski trwają 2,6 h" jest fałszywie precyzyjne.
3. Rozbicia (board, `type`, `owner`) tylko tam, gdzie KAŻDA komórka spełnia próg.

Kalendarz sprzyja: rozkład estymat wśród zamkniętych to `1d`=259, `2h`=238, `4h`=201, `3h`=105, `1h`=62 przy ~95 zamknięciach tygodniowo, więc pięć górnych kubełków dobije do `n=8` **w kilka dni** od uruchomienia TL-28. Ogon (`1w`, `2d`, `15m`) nie zapełni się nigdy i ma na stałe raportować „za mało danych".

## Pre-flight reading

1. `docs/architecture/backlog-time-tracking.md` — §11 (kalibracja, trzy reguły), §11.1 (kiedy kubełki się zapełnią), §14 pkt 1 (założenie, które ten task ma rozstrzygnąć).
2. `backlog/scripts/estimate.mjs` — `estimateHours()` i kontrakt „`null`, nigdy zero". Kubełki muszą używać TEJ funkcji, nie własnego parsera.
3. `backlog/scripts/stats.mjs` + `stats-report.mjs` — rozdział arytmetyki od formatowania. Kalibracja idzie tą samą granicą.
4. `backlog/scripts/build-viewer.mjs` — wzorzec wklejania modułu ŹRÓDŁEM do viewera (`task-fields.mjs`, `estimate.mjs`), żeby dashboard i terminal nie mogły podać dwóch różnych liczb.

## Kroki

0. **Bramka korelacji.** `worktrail stats --calibration --correlation-only`: policz rozrzut wewnątrz kubełków kontra różnicę median między kubełkami i wydrukuj werdykt. Jeśli rozrzut wewnętrzny dominuje — **zatrzymaj się**, dopisz wniosek do §14 pkt 1 i nie buduj reszty. Negatywny wynik pomiaru jest wynikiem.
1. `backlog/scripts/calibration.mjs` — funkcja PURE: lista `{estimate, actual_minutes}` → kubełki z `n`, medianą, p80 i współczynnikiem `bias`. Bez dysku, bez importów spoza `estimate.mjs`.
2. Próg `n` z konfiguracji; poniżej progu kubełek zwraca `{n, insufficient: true}` — nie `null` i nie zero.
3. `activity/rollup/BL-NNNN.json` — wersjonowany agregat **per task** (`minutes`, `sessions`, `first`, `last`, `unknown_ratio`), generowany z surowych logów. To JEST konsument kompromisu prywatnościowego z §9: surowe stemple zostają lokalnie, kalibracja jeździ w repo. **Nigdy jeden plik zbiorczy** — zbiorczy byłby drugim `INDEX.yaml` i wracałby konflikt zmierzony przy TL-21 (§5.2).
4. `worktrail stats --calibration` — tabela kubełków w terminalu.
5. Kolumna „rzeczywisty" w viewerze przy tasku `done`, czytana z rollupu.
6. Podpowiedź przy zakładaniu taska: `worktrail new --estimate 2h` drukuje kalibrację tego kubełka, o ile przekracza próg.
7. Testy `calibration.test.mjs` — red-first, autor testu ≠ autor kodu. **Na fixture'ach, nie na produkcyjnych danych backlogu** (asercja o realnych danych zmienia werdykt sama z siebie, gdy danych przybędzie).

## Acceptance criteria

- [ ] Krok 0 wykonany i jego wynik zapisany w §14 pkt 1 dokumentu — niezależnie od tego, czy wyszedł pozytywny.
- [ ] Kubełek z `n` poniżej progu raportuje „za mało danych", nie liczbę — test na FIXTURZE.
- [ ] Raport podaje przedział (p20–p80 albo min–max), nie samą medianę.
- [ ] Rozbicie per board/type/owner pojawia się tylko wtedy, gdy każda komórka spełnia próg.
- [ ] Taski BEZ zmierzonego czasu są policzone osobno i widoczne w raporcie.
- [ ] Agregat jest per task (`rollup/BL-NNNN.json`) i wersjonowany; surowe `activity/*.jsonl` nadal nie są.
- [ ] Dwie gałęzie dotykające RÓŻNYCH tasków nie produkują konfliktu w rollupie — jest na to test (`git merge-tree`), bo to jest cała racja bytu podziału per task.
- [ ] Viewer i terminal podają tę samą liczbę dla tego samego taska (moduł wklejany źródłem, nie druga implementacja).
- [ ] `worktrail new --estimate 2h` nie drukuje kalibracji, gdy kubełek jest poniżej progu.
- [ ] Żadna bramka w Verification nie asertuje własności PRODUKCYJNYCH danych (przechodzi tak samo przy ubogim i bogatym backlogu).

## Verification

```bash
# 1. Testy kalibracji na fixture'ach — expected: pass, w tym kubełek poniżej progu
node --test backlog/scripts/tests/calibration.test.mjs

# 2. Bramka korelacji — expected: werdykt (pozytywny albo negatywny), kod wyjścia 0
node backlog/scripts/cli.mjs stats --calibration --correlation-only

# 3. Rollup nie konfliktuje między gałęziami różnych tasków — expected: brak konfliktu
node backlog/scripts/tests/rollup-merge-check.mjs

# 4. Jedno źródło liczby — expected: moduł kalibracji obecny w zbudowanym viewerze
node backlog/scripts/build-viewer.mjs && grep -c 'calibration' backlog/viewer.html

# 5. Prywatność nienaruszona — expected: surowe poza gitem, agregat w gicie
git check-ignore -q backlog/activity/TL-29.jsonl && echo 'surowe: poza gitem'
git check-ignore -q backlog/activity/rollup/TL-29.json || echo 'rollup: w gicie'
```

## Notes

- Regresja/model predykcyjny świadomie POZA zakresem — mediana i p80 per kubełek to wszystko, co uzasadnia `n` rzędu dziesiątek.
- Jeśli krok 0 wyjdzie negatywnie, ten task kończy się wnioskiem i zamknięciem, a osią kalibracji zostają tokeny (TL-30). To jest przewidziane zakończenie, nie porażka.

## Log

- 2026-08-30 created — claude — rozpisane z analizy pomiaru czasu (docs/architecture/backlog-time-tracking.md)
- 2026-08-30 revised — claude — po adwersarialnym przeglądzie: agregat per task zamiast zbiorczego `rollup.json` (wracał konflikt zmierzony przy TL-21), bramka korelacji jako krok 0, testy na fixture'ach zamiast asercji o produkcyjnych danych
