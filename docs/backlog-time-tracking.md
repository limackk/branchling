# Backlog — pomiar czasu pracy nad taskiem

**Status:** PROJEKT (2026-08-30, zrewidowany 2026-08-30 po adwersarialnym przeglądzie) — nic z tego nie jest wdrożone
**Dotyczy:** `backlog/` jako przyszłe narzędzie `worktrail` ([TL-20](../backlog/tasks/TL-20-domknij-nazwe-narzedzia-przed-publikacja.md))
**Poprzednicy:** [backlog-field-editing-history.md](backlog-field-editing-history.md) (log zmian pól), [worktrail-state-and-sync.md](worktrail-state-and-sync.md) (log zdarzeń jako SSOT), [backlog-config-and-portability.md](backlog-config-and-portability.md) (kod zna kształt, konfiguracja wartości)
**Taski:** [TL-27](../backlog/tasks/TL-27-pomiar-czasu-fundament-i-uczciwy-punkt-zero.md) · [TL-28](../backlog/tasks/TL-28-heartbeaty-aktywnosci-i-lancuch-atrybucji.md) · [TL-29](../backlog/tasks/TL-29-kalibracja-estymat-z-danych-rzeczywistych.md) · [TL-30](../backlog/tasks/TL-30-adapter-tokenow-i-kosztu-sesji.md) · [TL-31](../backlog/tasks/TL-31-retencja-korekta-atrybucji-i-prawo-do-usuniecia.md)

---

## 1. Pytanie

Backlog ma 1387 tasków, z czego 1026 `done`, a **1019 z nich ma wpisaną estymatę**. Nie ma ani jednej liczby mówiącej, ile ta praca faktycznie zajęła. Estymaty są więc dziś nieweryfikowalne: `confidence: medium` znaczy „tak mi się wydawało" i po roku znaczy dokładnie tyle samo.

Cel: **zbierać czas pracy agenta AI nad taskiem tak, żeby dało się skalibrować estymaty** — i zrobić to w module, który idzie open source, więc nad cudzymi repozytoriami i cudzymi ludźmi.

## 2. Pomiar — dlaczego nie ma tu drogi na skróty

Wszystkie liczby zmierzone na tym repozytorium 2026-08-30, przed napisaniem jednej linijki projektu. Ta sekcja istnieje, bo trzy „oczywiste" źródła danych historycznych wyglądają na wystarczające, dopóki się ich nie policzy.

| Hipoteza źródła | Wynik pomiaru | Werdykt |
|---|---|---|
| Log zmian pól (`history/*.jsonl`) już to ma | **9 tasków, 13 wpisów, 1** z parą `in_progress` + `done` | Log ruszył 2026-08-30. Pokrycie ≈ 0,1% |
| Frontmatter `created` → `updated` | 1016 tasków parsowalnych, mediana **0 dni**, **71% ukończonych tego samego dnia** | Rozdzielczość dobowa. Zero dla 7 na 10 tasków |
| Git — rozpiętość commitów na pliku taska | mediana **722 h** przy 71% „tego samego dnia" we frontmatterze | Zanieczyszczone masowymi backfillami pól (`board:` dotknęło 1390 plików jednego dnia) |
| Git — pickaxe `-S"status: done"` | **20/20** trafień, dokładnie 1 commit, rozdzielczość sekundowa, ~60 s dla 1023 tasków | ✅ Moment UKOŃCZENIA da się odtworzyć |
| Git — pickaxe `-S"status: in_progress"` | **3/20** (15%); wartości 0,2 h / 142 h / 554 h | Moment STARTU nie istnieje w danych |

Ostatnie dwa wiersze rozstrzygają projekt. Agent zwykle zapisuje `pending → done` jednym commitem, więc **stan pośredni nigdy nie powstał** — nie „zgubił się", tylko go nie było. A tam, gdzie był, rozrzut 0,2 h ÷ 554 h pokazuje, że to i tak czas kalendarzowy, nie wysiłek.

> **Wniosek, który zmienia plan: historia sprzed dnia zero nie istnieje i nie da się jej wywnioskować.** Można odtworzyć *kiedy* task się skończył (git, dokładnie), nie można *ile trwał*. Każdy backfill „czasu pracy" byłby ładną nieprawdą — dokładnie tą klasą, dla której [backlog-field-editing-history.md §6](backlog-field-editing-history.md) odrzucił backfill autorstwa z gita.
>
> Rozróżnienie, którego trzymamy się dalej: **stempel ukończenia backfillujemy** (git jest dowodem), **czasu pracy nie** (git nie jest dowodem).

## 3. Co właściwie mierzymy

„Czas implementacji" to cztery różne wielkości. Mieszanie ich w jedną liczbę jest najczęstszym błędem tej klasy narzędzi.

| Wielkość | Definicja | Skąd | Do czego dobra |
|---|---|---|---|
| **lead time** | `created` → `done` | git (backfill) + log | przepustowość kolejki |
| **cycle time** | `in_progress` → `done` | log zdarzeń, od dnia zero | ⚠️ w tym repozytorium **bezwartościowa**, patrz §3.1 |
| **engaged time** | suma realnych sesji pracy, przerwy wycięte | heartbeaty (§6–§7) | **estymacja** |
| **koszt** | tokeny, wywołania narzędzi, model | adapter hosta (§10) | budżet, odporne na prędkość modelu |

### 3.1. Cycle time jest tu miarą-pułapką

W chwili pisania **45 tasków ma jednocześnie `status: in_progress`, z czego 32 z `owner: claude`.** To nie znaczy, że 32 agenty pracują naraz — `in_progress` jest w tym repozytorium stanem **parkingowym**: task w nim zostaje, gdy sesja się skończy, gdy praca czeka na decyzję, gdy coś odłożono.

Cycle time liczony z takiego stanu zmierzy więc parkowanie, nie pracę, i będzie tym większy, im gorszą ma się higienę backlogu. **Raportujemy go wyłącznie jako miarę higieny kolejki (jak długo task stoi w robocie), nigdy jako miarę wysiłku.** To jest ta sama pułapka, co „liczba otwartych ticketów" udająca obciążenie zespołu.

### 3.2. Dlaczego mimo wszystko engaged time, a nie same tokeny

Zegar agenta AI zależy od modelu, od tego, ile razy człowiek przerwał sesję, i od tego, czy dwa agenty pracowały równolegle. Tokeny są stabilniejsze, tylko nie przeliczają się na godziny człowieka — a `estimate:` we frontmatterze **jest w godzinach człowieka** i kalibracja musi być w tej samej jednostce.

Zbieramy więc oba, domyślnie raportujemy engaged time, a to, czy ta jednostka w ogóle się broni, jest jawnie założeniem do obalenia (§14 pkt 1).

## 4. Dlaczego nie gotowe narzędzie

Pytanie, które zada pierwszy zewnętrzny użytkownik. Odpowiedź nie brzmi „bo chcemy swoje".

| Narzędzie | Co robi dobrze | Czemu nie wystarcza |
|---|---|---|
| **WakaTime / Wakapi** | dojrzały model heartbeatów, wtyczki do edytorów, self-hosted (Wakapi) | mierzy **plik i język**, nie **task**. Nie ma pojęcia „TL-27", więc nie da się z tego zrobić kalibracji estymat — a to jest cały cel |
| **ActivityWatch** | pomiar całego pulpitu, prywatność lokalna | granulacja aplikacji/okna; wymaga demona na maszynie użytkownika; nadmiarowy wobec pytania „ile trwał ten task" |
| **timetrace / watson / timewarrior** | proste CLI, tagi, zero infrastruktury | **ręczny start/stop**. Człowiek pamięta albo nie; agentowi AI nie ma kto przypomnieć, a nieodpalony timer daje ciszę nieodróżnialną od zera |
| **git-time-metric** | zero konfiguracji, czyta commity | wnioskuje czas z odstępów między commitami. Nasz pomiar (§2) pokazuje, że tutaj odstępy commitów są zanieczyszczone masowymi backfillami — mediana 722 h przy 71% pracy „tego samego dnia" |
| **Jira / Linear cycle time** | gotowe raporty przepływu | mierzy przejścia statusów, czyli dokładnie tę wielkość, którą §3.1 właśnie zdyskwalifikował; poza tym wymaga porzucenia plików w gicie jako SSOT |

Wspólny mianownik: **istniejące narzędzia mierzą albo aktywność bez taska, albo task bez aktywności.** Brakujący element to atrybucja aktywności do taska (§8) — i to jest jedyna rzecz, którą ten moduł ma zrobić sam. Reszta (klastrowanie heartbeatów, próg bezczynności) to świadomie zapożyczony model WakaTime, nie wynalazek.

Konsekwencja praktyczna: `worktrail activity record` jest **otwartym wejściem** (§7). Kto ma już WakaTime, może z niego zasilać ten log, zamiast pisać drugi zbieracz.

## 5. Model danych

```
backlog/activity/BL-NNNN.jsonl        ← heartbeaty, append-only, DOMYŚLNIE gitignored (§9)
backlog/activity/rollup/BL-NNNN.json  ← agregat PER TASK, wersjonowany (§9)
backlog/history/BL-NNNN.jsonl         ← bez zmian: zmiany pól, wersjonowane
```

> **Lokalizacja surowego logu ZMIENIA SIĘ w [TL-35](../backlog/tasks/TL-35-surowy-log-aktywnosci-do-katalogu-domowego.md).** Heartbeaty przenoszą się do katalogu domowego użytkownika (`<data>/activity/<projekt>/BL-NNNN.jsonl`), bo w repo ich ochrona zależy od poprawnego `.gitignore` w każdym repozytorium, do którego narzędzie kiedykolwiek trafi — a jeden `git add -A` w cudzym drzewie wpisuje czyjś kalendarz pracy do publicznej historii nieodwracalnie. **Agregat `rollup/` zostaje w repo bez zmian.** Uzasadnienie: [worktrail-global-tool.md §6](worktrail-global-tool.md).

Jeden wiersz = jeden dowód aktywności:

```json
{"id":"01M18TSCBMECG6E6D42E6AE0J6","ts":"2026-08-30T09:14:42.326Z","task":"TL-27",
 "kind":"tool","actor":"agent:claude","source":"hook","session":"85bcc80f","attribution":"focus"}
```

- `id` — ULID, ta sama funkcja co w `history.mjs`: sortowanie leksykograficzne = porządek czasowy, więc jest gotowym kursorem synchronizacji.
- `kind` — `tool` | `prompt` | `commit` | `edit` | `reassign`. Klasa dowodu, nie waga.
- `session` — identyfikator sesji hosta. Bez niego dwa agenty pracujące równolegle nad jednym taskiem zlewają się w jedną sesję i czas jest liczony raz zamiast dwa razy. Jest też **kluczem zakresu atrybucji** (§8).
- `attribution` — **którą nogą łańcucha (§8) task został ustalony.** To jest metadana o wiarygodności wiersza, dokładnie jak `source` przy autorze w logu zmian pól.

### 5.1. Dlaczego osobny plik, a nie `history/`

`history/` jest semantycznym logiem „kto co zmienił" i viewer go renderuje przy polach. Heartbeaty idą w tysiącach na task. Wrzucenie ich tam zalałoby UI i spowolniło `readHistory()`. Ta sama dyscyplina (ULID, przestrzenie nazw aktora, append-only, dedup po `id`), inny plik.

### 5.2. Dlaczego agregat PER TASK, a nie jeden `rollup.json`

Bo jeden zbiorczy plik byłby drugim `INDEX.yaml` — a ten moduł już raz za to zapłacił. `backlog/.gitignore` trzyma zmierzone uzasadnienie: agregat wszystkich tasków sprawia, że **każda gałąź przepisuje ten sam plik**, `git merge-tree` dwóch gałęzi **bez ani jednego wspólnego taska** dawał konflikt, a 78% commitów dotykających `tasks/` dotykało też widoków.

Agregat czasu ma dokładnie tę samą charakterystykę: rośnie z każdym taskiem, zmienia się przy każdej sesji, a scala się źle. `activity/rollup/BL-NNNN.json` sprawia, że gałąź dotyka wyłącznie plików własnych tasków — konflikt jest wtedy realnym konfliktem, a nie skutkiem ubocznym agregacji.

### 5.3. Dlaczego heartbeaty, a nie pary start/stop

Para gubi przypadek awarii: sesja zabita, laptop uśpiony, `Ctrl-C` — interwał nigdy się nie domyka i task raportuje nieskończony czas. Heartbeat jest **kompletny w momencie zapisu**; brak następnego jest informacją, nie uszkodzeniem.

### 5.4. Współbieżny zapis

`history.mjs` używa `appendFileSync`. Dla wierszy tej wielkości (~200 B) POSIX gwarantuje atomowość dopisania poniżej `PIPE_BUF`, więc równoległe sesje nie przeplotą sobie linii — ale **to jest gwarancja ograniczona i trzeba ją nazwać**, bo na Windowsie nie obowiązuje w tej postaci. Stąd wymóg, żeby czytnik przeżywał uszkodzony wiersz (pomija go i liczy dalej), zamiast zakładać, że uszkodzenie nie wystąpi.

## 6. Od heartbeatów do minut

Czasu **nie zapisujemy** — wyprowadzamy go, tak jak `INDEX.yaml` wyprowadza się z tasków, a `estimateHours()` z tekstu estymaty.

```
klaster  := maksymalny ciąg heartbeatów tej samej sesji,
            w którym sąsiedzi dzieli mniej niż idle_gap (domyślnie 10 min)
minuty   := Σ (last(klaster) − first(klaster))
```

Trzy reguły, które muszą mieć testy, bo każda z nich to miejsce, w którym takie liczydła po cichu kłamią:

1. **Klaster jednoelementowy liczy się jako 0** i raportuje osobno jako liczbę. Nie doklejamy „nominalnych 5 minut" — to byłoby zmyślanie proporcjonalne do rozdrobnienia pracy.
2. **Gap dokładnie na progu** należy do poprzedniego klastra (`<` vs `≤` rozstrzygnięte jawnie, nie przypadkiem).
3. **Sesje równoległe sumują się.** Dwa agenty × 30 min to 60 minut wysiłku i 30 minut kalendarza. Raport pokazuje obie liczby, bo odpowiadają na dwa różne pytania.

Progi (`idle_gap_minutes`, `min_session_minutes`) idą do `config.yaml` — kod zna kształt, konfiguracja wartości.

## 7. Skąd biorą się heartbeaty — i dlaczego z KAŻDEGO narzędzia

Rdzeń to `worktrail activity record --task BL-N --kind tool` — zwykłe CLI czytające flagi i stdin. Adaptery to cienkie wtyczki nad nim: hook Claude Code'a, git hook, WakaTime, prompt powłoki. **Rdzeń nie może wymagać żadnego z nich**, bo moduł ma działać nad cudzym procesem.

Jedna decyzja, która wygląda na szczegół, a jest warunkiem sensowności danych:

> **Heartbeat musi lecieć z każdego wywołania narzędzia, nie z podzbioru.**

Istniejący hook backlogu ma matcher `Edit|Write|MultiEdit` (`.claude/settings.json`). Gdyby adapter aktywności poszedł tą samą drogą, **nie zobaczyłby ani jednego uruchomienia testów, builda, gita, czytania ani szukania**. Skutkiem nie jest równomierne zaniżenie — jest zaniżenie **skorelowane z rodzajem pracy**: task spędzony na uruchamianiu testów wyszedłby prawie darmowy, a task spędzony na pisaniu plików drogi. Zaniżenie skorelowane jest gorsze od równomiernego, bo wygląda jak sygnał i wprost przekłada się na przekrzywioną kalibrację (§11).

Stąd: matcher obejmujący wszystkie narzędzia + **throttling** (nie więcej niż jeden heartbeat na `heartbeat_throttle_seconds`, domyślnie 60, per sesja). Throttling jest tu obowiązkowy, nie optymalizacyjny — bez niego log rośnie liniowo z gadatliwością agenta, a rozdzielczość i tak jest ograniczona progiem klastrowania z §6.

## 8. Atrybucja — łańcuch pierwszeństwa i uczciwe `unknown`

Najtrudniejsze pytanie nie brzmi „ile", tylko **„nad czym"**. Tu takie systemy kłamią najczęściej, bo przypisanie do złego taska wygląda identycznie jak przypisanie do dobrego.

Kolejność, pierwsze trafienie wygrywa:

| # | Noga | `attribution` | Uwaga |
|---|---|---|---|
| 1 | `worktrail focus BL-NNNN` — jawny wskaźnik sesji, albo `BACKLOG_TASK` w środowisku | `focus` | ustawiany też AUTOMATYCZNIE — §8.1 |
| 2 | ostatnie w tej **sesji** przejście taska na `status: in_progress` przez tego aktora | `session-state` | §8.1 |
| 3 | ścieżka edytowanego pliku, gdy to `backlog/tasks/BL-NNNN-*.md` | `path` | |
| 4 | regex z nazwy gałęzi/worktree (`task_id_pattern` z konfiguracji) | `branch` | |
| 5 | **`unknown`** | `unknown` | zapisane, nie zgadnięte |

### 8.1. Dlaczego nogi 1 i 2 muszą być automatyczne

Bez tego łańcuch nie działa — i to jest zmierzone, nie przewidywane:

- **Noga 3 strzela dwa razy na task.** Odpala się tylko przy edycji `backlog/tasks/BL-*.md`, czyli przy wzięciu i zamknięciu. Cała realna praca dzieje się w plikach sub-repo, których ta noga nie widzi.
- **Noga 4 w tym repozytorium nie strzela wcale.** Gałęzie nazywają się `claude/task-<opis>`, bez numeru BL. Zostaje dla cudzych repozytoriów, gdzie konwencja bywa inna.

Zostaje więc noga 1 — a ręczne `worktrail focus` na starcie każdej sesji to dokładnie ten sam błąd, który dyskwalifikuje `timetrace` (§4): mechanizm zależny od tego, czy ktoś pamiętał.

Rozwiązanie: **agent i tak deklaruje, nad czym pracuje.** Protokół każe mu przy wzięciu taska ustawić `status: in_progress` + `owner:`, a hook już to przechwytuje i zapisuje do `history/`. To jest darmowy, istniejący sygnał `focus` — wystarczy, żeby zapis `in_progress` ustawiał również fokus sesji.

**Krytyczny warunek: zakresem jest SESJA, nigdy stan globalny.** Globalnie w tej chwili `in_progress` jest 45 tasków, 32 z `owner: claude` — pytanie „który task jest w toku" nie ma globalnie jednej odpowiedzi i nigdy nie będzie miało. Ma jednoznaczną odpowiedź w obrębie jednej sesji, bo jedna sesja bierze jeden task (jedna sesja = jeden worktree). Ta sama liczba, która psuje cycle time (§3.1), psułaby atrybucję — o ile liczyć ją globalnie.

### 8.2. `unknown` jest liczbą, nie awarią

**Udział `unknown` jest pierwszoklasową liczbą w każdym raporcie.** Jeśli 60% zmierzonego czasu jest nieprzypisane, metryka nie jest wiarygodna i raport ma to napisać, zamiast pokazać ładną sumę. Ta sama zasada, co `estimateHours()` zwracające `null` zamiast zera i `sumHours()` zwracające `{hours, unknown}`.

## 9. Prywatność, retencja i korekta — warunek, bez którego to nie idzie open source

Log aktywności to zapis **o której godzinie konkretny człowiek pracował**, dzień po dniu. W publicznym repozytorium to metadane nadzoru, a nie telemetria projektu. W repo firmowym to dane pracownicze, a w UE — dane osobowe z wszystkim, co z tego wynika.

Trzy mechanizmy, wszystkie w [TL-31](../backlog/tasks/TL-31-retencja-korekta-atrybucji-i-prawo-do-usuniecia.md):

**Minimalizacja.** Surowe stemple zostają na maszynie, która je wyprodukowała: dziś przez gitignore (`backlog/activity/*.jsonl`, jak `history/.snapshot.json`), docelowo przez położenie **poza jakimkolwiek repozytorium** ([TL-35](../backlog/tasks/TL-35-surowy-log-aktywnosci-do-katalogu-domowego.md)) — bo procedura utrzymywana przez każdego przyszłego użytkownika jest słabsza niż konstrukcja. Wersjonowany jest tylko agregat per task (§5.2): `minutes`, `sessions`, `first`, `last`, `unknown_ratio`. Tyle wystarcza do kalibracji, a nie odtwarza kalendarza nikogo. `activity_privacy: local | aggregate | full` — `full` istnieje dla zespołów, które świadomie tego chcą, i nigdy nie jest domyślne.

**Retencja.** `activity_retention_days` (domyślnie 90, wzorem retencji snapshotów diagnostycznych w tym workspace). Surowe heartbeaty starsze niż okno są kasowane; **agregat przeżywa**, bo nie jest już danymi o osobie w tej rozdzielczości. Bez tego log rośnie w nieskończoność i nie ma odpowiedzi na pytanie „jak długo to trzymacie".

**Prawo do usunięcia i do sprostowania.** `worktrail activity forget --actor <a>` kasuje surowe wiersze aktora i przelicza agregaty. Osobno `worktrail activity reassign --from BL-A --to BL-B --session S` dopisuje zdarzenie `kind: "reassign"` — log jest append-only, więc korekta jest **nowym zdarzeniem, nie edycją historii**. Bez tej ścieżki pierwsza pomyłka atrybucji zostaje na zawsze, a to gwarantowany pierwszy zgłoszony błąd.

> **Powierzchnia publiczna po angielsku.** Ten dokument i taski są po polsku zgodnie z konwencją workspace'u, ale publiczne README, opis formatu zdarzenia i teksty CLI muszą być EN, zanim moduł wyjdzie na zewnątrz — łącznie z sekcją o retencji z tego paragrafu. Osobny task: [TL-32](../backlog/tasks/TL-32-angielska-powierzchnia-publiczna-modulu.md) (zmierzone: 667 linii komentarzy + 350 stringów + 415 linii README; słownik `DEFAULTS` jest już angielski, więc nie ma migracji danych).

## 10. Koszt jako druga oś (opcjonalna)

Adapter, który potrafi, dokłada do wiersza `tokens_in`, `tokens_out`, `model`. Kalibracja kosztowa jest wtedy pochodną, a nie osobnym mechanizmem. Brak adaptera = **brak kolumny, nie zero** — zero znaczyłoby „zmierzone i wyszło darmo".

## 11. Kalibracja — po co to wszystko

Wartość nie jest w zdaniu „TL-27 zajął 3 h". Jest w rozkładzie per kubełek estymaty:

```
estymata   n    mediana   p80    bias
30m        41   0h48m     1h30m  ×1.6
2h         23   2h36m     4h06m  ×1.3
1d          6   —         —      za mało danych
```

Trzy reguły raportu:

1. Poniżej progu `n` (domyślnie 8) raport pisze **„za mało danych"**, nie liczbę. Mediana z trzech obserwacji jest liczbą, nie wiedzą.
2. Zawsze przedział, nigdy punkt. „2h taski lądują 1,4–4,1 h" jest użyteczne; „2h taski trwają 2,6 h" jest fałszywie precyzyjne.
3. Rozbicia (board, `type`, `owner`) tylko tam, gdzie każda komórka spełnia próg `n`.

**Nic z tego nie ląduje we frontmatterze.** Żadnego pola `actual: 3h`, które za miesiąc rozjedzie się ze źródłem. Frontmatter trzyma to, co zdecydował człowiek (`estimate`, `confidence`); actuals są wyliczane, jak widoki.

### 11.1. Kiedy kubełki się zapełnią (zmierzone)

Rozkład estymat wśród 1026 zamkniętych tasków i tempo zamykania z ostatnich 8 tygodni:

| estymata | n (done) | | tydzień | zamkniętych |
|---|---|---|---|---|
| `1d` | 259 | | 2026-08-03 | 134 |
| `2h` | 238 | | 2026-08-10 | 74 |
| `4h` | 201 | | 2026-08-17 | 95 |
| `3h` | 105 | | 2026-08-24 | 142 |
| `1h` | 62 | | **średnia** | **~95/tydz.** |

Pięć górnych kubełków to ~84% zamkniętych tasków, a tempo wynosi ~95 zamknięć tygodniowo. Próg `n = 8` **dla tych kubełków jest osiągalny w kilka dni od uruchomienia fazy 1**, nie w kilka tygodni. Ogon (`1w`, `2d`, `15m`) nie zapełni się nigdy i ma na stałe raportować „za mało danych" — to jest cecha, nie brak.

## 12. Kolejność wdrożenia

| Faza | Task | Co dowozi | Wartość samodzielna |
|---|---|---|---|
| 0 | [TL-27](../backlog/tasks/TL-27-pomiar-czasu-fundament-i-uczciwy-punkt-zero.md) | `activity/` + `worktrail time` + backfill **samych stempli ukończenia** z gita | velocity i throughput z 1026 tasków |
| 1 | [TL-28](../backlog/tasks/TL-28-heartbeaty-aktywnosci-i-lancuch-atrybucji.md) | heartbeaty ze WSZYSTKICH narzędzi, klastrowanie, atrybucja z auto-fokusem | engaged time zaczyna istnieć |
| 1b | [TL-31](../backlog/tasks/TL-31-retencja-korekta-atrybucji-i-prawo-do-usuniecia.md) | retencja, `forget`, `reassign` | **warunek wypuszczenia poza tę maszynę** |
| 2 | [TL-29](../backlog/tasks/TL-29-kalibracja-estymat-z-danych-rzeczywistych.md) | kalibracja w `worktrail stats` + kolumna w viewerze | estymaty przestają być nieweryfikowalne |
| 3 | [TL-30](../backlog/tasks/TL-30-adapter-tokenow-i-kosztu-sesji.md) | adapter tokenów/kosztu | druga oś, odporna na prędkość modelu |

TL-31 jest **1b, nie 4**: dane osobowe zaczynają powstawać w chwili uruchomienia fazy 1, więc mechanizm ich kasowania nie może przyjść „później". Może zostać za fazą 1 w kolejności prac, o ile do jego domknięcia nic nie opuszcza jednej maszyny.

## 13. Czego ten mechanizm NIE gwarantuje

- **Nie mierzy myślenia.** Czas, w którym founder rozważa problem bez dotykania narzędzi, nie produkuje heartbeatów. Engaged time jest dolnym oszacowaniem i tak ma być raportowany.
- **Nie odróżnia pracy od czekania w sesji.** Agent czekający na `flutter test` produkuje heartbeaty jak agent piszący kod.
- **Nie widzi pracy poza hostem z adapterem.** Task zrobiony ręcznie w edytorze bez hooka jest `unknown`, nie zerem.
- **Nie mierzy wysiłku przez cycle time** — §3.1.
- **Nie jest ewidencją czasu pracy.** Ani do rozliczeń, ani do oceny ludzi. Rozdzielczość i luki z punktów wyżej czynią z niego narzędzie kalibracji estymat i nic więcej. Gdyby miał kiedyś służyć do czegokolwiek innego, wymaga gwarancji, których dziś nie ma — a §9 jest po to, żeby nie dało się w to wejść przypadkiem.

## 14. Założenia do obalenia

1. **Że engaged time koreluje z estymatą w godzinach człowieka.** Estymaty pisano w ramie „ile zajęłoby to człowiekowi", a mierzymy zegar agenta — możliwe, że korelacji nie ma wcale i jedyną użyteczną osią okażą się tokeny. Falsyfikacja jest tania i **idzie PIERWSZA w TL-29**: jeśli rozrzut wewnątrz kubełka jest większy niż różnica między kubełkami, kalibracja po czasie jest bezwartościowa i nie warto budować dla niej raportu.
2. **Że `unknown` da się utrzymać nisko.** Jeśli po fazie 1 przekracza ~30%, zły jest łańcuch atrybucji (§8), a nie dane.
3. **Że próg 10 minut jest właściwy.** Wzięty z praktyki WakaTime, nie z pomiaru na tych danych. Po fazie 1 da się go dobrać z rozkładu odstępów między heartbeatami — i wtedy trzeba, bo dziś to najsłabiej uzasadniona liczba w tym dokumencie.
4. **Że throttling 60 s nie gubi krótkich sesji.** Praca krótsza niż jeden interwał daje klaster jednoelementowy, czyli zero minut (§6 reguła 1). Jeśli takich klastrów okaże się dużo, próg throttlingu jest za wysoki albo reguła 1 za surowa — rozstrzyga liczba klastrów jednoelementowych, którą raport ma podawać właśnie po to.

## 12. What is implemented (2026-09-02, TL-27)

This section is in English because it is new text; the rest of the document is
translated by TL-137. What exists now:

- `scripts/activity.mjs` — the append-only row store (§5) and the per-task
  rollup. `kind` and `attribution` are closed sets in the code; an unknown value
  is refused before anything is appended, because the file cannot be edited
  afterwards. A corrupt line is skipped and the rest of the task's rows are
  returned (§5.4).
- `scripts/backfill-completions.mjs` and `worktrail backfill-completions` — the
  completion stamp recovered with `git log -S"status: <archived>"`, written as
  one `commit` row per closed task. Idempotent by EVENT, not by row id: a ULID
  is fresh on every run, so the key is `(task, kind, ts)`.
- `scripts/time-report.mjs` and `worktrail time` — lead time (median, p80, p95
  by nearest rank) and throughput per ISO week, always with the number of closed
  tasks that have NO stamp.
- `backlog/.gitignore` — `activity/*.jsonl` is out of git, `activity/rollup/` is
  in it, and `worktrail init` writes the same rule into a new backlog.
- `config.yaml` — `activity_privacy`, `idle_gap_minutes`,
  `heartbeat_throttle_seconds`, `min_report_n`, `activity_retention_days`. The
  whole set at once, because an unknown key fails: adding them one task at a time
  would be four schema changes, each rejecting a config written for the next.

**What is deliberately NOT implemented:** engaged time. Nothing here records how
long anybody was at the keyboard. The stamps give calendar time only, and
`worktrail time` says so on every report rather than leaving it to be worked out.
That measurement starts at the first heartbeat and is TL-28's.

**A limit that belongs to THIS repository, not to the tool.** The git history was
flattened to a single commit at extraction ([`LINEAGE.md`](../LINEAGE.md)), so
for every task closed before that commit the pickaxe finds the flattening, not
the work. The stamps here are therefore truthful about the file and misleading
about the calendar for anything older than the squash — the numbers are real
measurements of a history that was rewritten. In a repository whose history was
never flattened the same command reads the real dates. The report cannot detect
this and does not pretend to; it is recorded here instead.
