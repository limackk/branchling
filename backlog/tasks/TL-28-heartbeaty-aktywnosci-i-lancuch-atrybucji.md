---
id: TL-28
title: "Heartbeaty aktywności i łańcuch atrybucji"
type: code
labels: [post-launch]
board: main
epic: "Backlog — pomiar czasu pracy"
priority: P2
status: pending
owner: unassigned
estimate: 1d
confidence: low
created: 2026-08-30
updated: 2026-08-30
blocked_by: [TL-27]
blocks: [TL-29, TL-30, TL-31, TL-92]
related_docs:
  - docs/backlog-time-tracking.md
verification:
  - bash: "node --test backlog/scripts/tests/cluster.test.mjs backlog/scripts/tests/attribution.test.mjs"
  - bash: "node backlog/scripts/cli.mjs time --engaged --json | python3 -c \"import json,sys; d=json.load(sys.stdin); assert 'unknown_ratio' in d, 'raport bez udziału unknown'; print('unknown:', d['unknown_ratio'])\""
  - bash: "python3 -c \"import json,sys; h=json.load(open('.claude/settings.json'))['hooks']['PostToolUse']; ms=[e.get('matcher','') for e in h]; assert any(m in ('','*') or 'Bash' in m for m in ms), f'adapter aktywności nie widzi Bash: {ms}'; print('matcher pokrywa Bash — OK')\""
---

## Cel

Zacząć mierzyć **engaged time** — realny czas pracy nad taskiem, z wyciętymi przerwami, przypisany do właściwego taska. Bez tego kalibracja estymat (TL-29) nie ma wejścia, a to ona jest celem całego epiku.

## Kontekst

Po TL-27 istnieje warstwa danych i stemple ukończenia, ale nadal **zero** informacji o tym, jak długo praca trwała. Pomiar z §2 dokumentu pokazał, że tej liczby nie da się odzyskać z przeszłości — trzeba ją zacząć zbierać.

Trzy decyzje, które trzeba utrzymać, bo wszystkie są kontrintuicyjne, a dwie ostatnie wyszły dopiero z adwersarialnego przeglądu projektu:

**Heartbeaty, nie pary start/stop.** Para gubi awarię: sesja zabita, laptop uśpiony, `Ctrl-C` — interwał nigdy się nie domyka i task raportuje nieskończony czas. Heartbeat jest kompletny w chwili zapisu; brak następnego jest informacją, nie uszkodzeniem.

**Heartbeat z KAŻDEGO narzędzia, nie z podzbioru.** Istniejący hook backlogu ma matcher `Edit|Write|MultiEdit` (`.claude/settings.json`). Gdyby adapter aktywności poszedł tą samą drogą, nie zobaczyłby ani jednego uruchomienia testów, builda, gita, czytania ani szukania. Skutkiem nie byłoby równomierne zaniżenie, tylko zaniżenie **skorelowane z rodzajem pracy**: task spędzony na uruchamianiu testów wyszedłby prawie darmowy, a task spędzony na pisaniu plików — drogi. Zaniżenie skorelowane jest gorsze od równomiernego, bo wygląda jak sygnał i wprost przekrzywia kalibrację.

**Atrybucja jest trudniejsza niż pomiar** i musi być automatyczna. Przypisanie czasu do złego taska wygląda identycznie jak przypisanie do dobrego. Zmierzone ograniczenia łańcucha w tym repozytorium:

- noga „ścieżka pliku" strzela **dwa razy na task** (wzięcie, zamknięcie) — cała praca dzieje się w plikach sub-repo;
- noga „regex gałęzi" **nie strzela wcale** — gałęzie nazywają się `claude/task-<opis>`, bez numeru BL;
- zostaje `focus`, a ręczne `worktrail focus` na starcie sesji to ten sam błąd, który dyskwalifikuje `timetrace`: mechanizm zależny od tego, czy ktoś pamiętał.

Dlatego fokus ustawia się **sam** w chwili, gdy agent zapisuje `status: in_progress` — hook już wtedy działa i już to zapisuje do `history/`. **Zakresem musi być SESJA, nie stan globalny:** globalnie `in_progress` jest 45 tasków, 32 z `owner: claude`, więc globalnie to pytanie nie ma jednej odpowiedzi. W obrębie sesji ma, bo jedna sesja bierze jeden task.

## Pre-flight reading

1. `docs/architecture/backlog-time-tracking.md` — §5.3 (dlaczego heartbeaty), §6 (klastrowanie, trzy reguły), §7 (dlaczego wszystkie narzędzia + throttling), §8 (łańcuch atrybucji), §13 (czego to nie mierzy).
2. `backlog/scripts/activity.mjs` — zapis/odczyt z TL-27.
3. `backlog/scripts/regen-on-task-edit.sh` + `.claude/settings.json` — istniejący hook i jego matcher. Nowy adapter idzie obok, tą samą konwencją (cichy przy braku dopasowania, bez pętli), ale z **szerszym** matcherem.
4. `backlog/scripts/estimate.mjs` — `sumHours()` zwracające `{hours, unknown}`. Raport engaged time trzyma ten sam kontrakt.

## Kroki

1. `backlog/scripts/cluster.mjs` — funkcja PURE nad listą heartbeatów → klastry i minuty. Bez dysku i bez importów spoza modułu (ten sam rygor co `estimate.mjs`, żeby dała się wkleić do viewera).
2. Trzy reguły z §6, każda z osobnym testem: klaster jednoelementowy = 0 minut i osobna liczba w raporcie; gap dokładnie na progu należy do poprzedniego klastra; sesje równoległe sumują się (wysiłek) i osobno dają rozpiętość kalendarzową.
3. `backlog/scripts/attribution.mjs` — łańcuch pięcionożny z §8, zwracający `{task, attribution}`:
   `focus` → `session-state` → `path` → `branch` → `unknown`. Nigdy nie zwraca taska bez powiedzenia, którą nogą go ustalił.
4. `worktrail focus BL-NNNN` / `--clear` — wskaźnik sesji w pliku lokalnym (gitignored) + odczyt `BACKLOG_TASK` ze środowiska.
5. **Auto-fokus:** zapis `status: in_progress` przez hook ustawia fokus TEJ sesji. Rozstrzygnąć i przetestować, co się dzieje, gdy jedna sesja weźmie drugi task — wygrywa ostatni, a poprzedni zostaje w logu z własnymi wierszami (nie przepisujemy wstecz).
6. Adapter `backlog/scripts/activity-hook.sh` (PostToolUse) — emituje `kind: tool`. **Matcher obejmuje wszystkie narzędzia**, nie `Edit|Write|MultiEdit`.
7. **Throttling obowiązkowy** — najwyżej jeden heartbeat na `heartbeat_throttle_seconds` (domyślnie 60) per sesja. Bez tego log rośnie liniowo z gadatliwością agenta, a rozdzielczość i tak ogranicza próg klastrowania.
8. `worktrail activity record` — CLI przyjmujące flagi/stdin, żeby dowolny inny host (git hook, Cursor, WakaTime, prompt powłoki) mógł zasilać ten sam log. Rdzeń nie może zależeć od Claude Code'a.
9. `worktrail time --engaged` — minuty per task, per okres, plus **udział `unknown` jako pole pierwszoklasowe** i liczba klastrów jednoelementowych (to ona rozstrzygnie założenie §14 pkt 4).

## Acceptance criteria

- [ ] Matcher hooka pokrywa `Bash` (i resztę narzędzi), nie tylko `Edit|Write|MultiEdit` — jest na to bramka w Verification.
- [ ] Throttling działa: N wywołań narzędzi w ciągu jednego interwału daje jeden wiersz, nie N.
- [ ] Klaster jednoelementowy liczy się jako 0 minut i pojawia się w raporcie jako osobna liczba.
- [ ] Gap dokładnie równy `idle_gap_minutes` ma rozstrzygnięte i przetestowane zachowanie.
- [ ] Heartbeaty poza kolejnością czasową dają ten sam wynik co posortowane.
- [ ] Sesja bez „domknięcia" (brak ostatniego heartbeatu) nie produkuje nieskończonego czasu.
- [ ] Dwie równoległe sesje nad jednym taskiem dają sumę wysiłku ≠ rozpiętość kalendarzową; obie liczby są w raporcie.
- [ ] Zapis `status: in_progress` ustawia fokus sesji — jest na to test.
- [ ] Atrybucja NIE czyta globalnego stanu `in_progress` (45 tasków) — jest na to test negatywny: dwa taski `in_progress` w dwóch sesjach nie mieszają się.
- [ ] Łańcuch atrybucji ma test na KAŻDĄ z pięciu nóg.
- [ ] `unknown_ratio` jest w raporcie zawsze, także gdy wynosi 0.
- [ ] `worktrail activity record` działa bez Claude Code'a (test wołający samo CLI).
- [ ] Hook nie wywołuje pętli i milczy przy braku dopasowania.
- [ ] `qa/backlog-time-tracking.yaml` rozszerzone o przypadki klastrowania i atrybucji.

## Verification

```bash
# 1. Matematyka klastrów i atrybucja — expected: pass, w tym przypadki brzegowe
node --test backlog/scripts/tests/cluster.test.mjs backlog/scripts/tests/attribution.test.mjs

# 2. Adapter widzi Bash — expected: "matcher pokrywa Bash — OK"
python3 -c "import json; h=json.load(open('.claude/settings.json'))['hooks']['PostToolUse']; \
  ms=[e.get('matcher','') for e in h]; \
  assert any(m in ('','*') or 'Bash' in m for m in ms), f'nie widzi Bash: {ms}'; print('matcher pokrywa Bash — OK')"

# 3. Rdzeń bez hosta — expected: wiersz dopisany, kod wyjścia 0
node backlog/scripts/cli.mjs activity record --task TL-28 --kind tool --actor local:founder
tail -1 backlog/activity/TL-28.jsonl

# 4. Raport ZAWSZE podaje udział unknown — expected: klucz obecny
node backlog/scripts/cli.mjs time --engaged --json | python3 -c \
  "import json,sys; d=json.load(sys.stdin); assert 'unknown_ratio' in d; print('unknown:', d['unknown_ratio'])"

# 5. Nieznana flaga oblewa zamiast po cichu przejść — expected: exit=2
node backlog/scripts/cli.mjs activity record --frobnicate 2>/dev/null; test $? -eq 2 && echo 'nieznana flaga oblewa — OK'
```

## Notes

- Próg 10 minut pochodzi z praktyki WakaTime, nie z pomiaru na tych danych — to najsłabiej uzasadniona liczba w projekcie (§14 pkt 3). Po kilku tygodniach zbierania trzeba go dobrać z rozkładu odstępów i zapisać wynik w dokumencie.
- Jeśli po pierwszym miesiącu `unknown_ratio` przekracza ~30%, zły jest łańcuch atrybucji, a nie dane (§14 pkt 2).
- Throttling 60 s może gubić bardzo krótkie sesje (klaster jednoelementowy = 0 minut). Liczba takich klastrów jest raportowana właśnie po to, żeby dało się to rozstrzygnąć danymi, a nie opinią (§14 pkt 4).
- Świadomie poza zakresem: tokeny (TL-30), kalibracja (TL-29), retencja i `reassign` (TL-31). **TL-31 nie może zostać w tyle o więcej niż jedną iterację** — od tego taska zaczynają powstawać dane osobowe.

## Log

- 2026-08-30 created — claude — rozpisane z analizy pomiaru czasu (docs/architecture/backlog-time-tracking.md)
- 2026-08-30 revised — claude — po adwersarialnym przeglądzie: matcher na wszystkie narzędzia (zaniżenie skorelowane z rodzajem pracy), auto-fokus przy `in_progress` scope'owany do sesji (45 globalnych `in_progress` czyni stan globalny bezużytecznym), throttling z opcji na wymóg
