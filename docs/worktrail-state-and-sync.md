# worktrail — stan, synchronizacja i granica trybów

**Status:** FUNDAMENT WDROŻONY 2026-08-29 ([TL-21](../backlog/tasks/TL-21-fundament-logu-zdarzen-worktrail.md)) — **wszystkie 5 kroków z §7 zrobione; z §6 zrobione locki (TL-87, §6.1) i odczyt stanu z wielu gałęzi (TL-73, §6.2); §5 i reszta §6 (odwrócenie kierunku, SQLite, serwer) nadal projekt**
**Dotyczy:** `backlog/` jako przyszłe narzędzie `worktrail` (nazwa wstępna — [TL-20](../backlog/tasks/TL-20-domknij-nazwe-narzedzia-przed-publikacja.md))
**Poprzednicy:** [backlog-field-editing-history.md](backlog-field-editing-history.md) (log zmian pól), [backlog-config-and-portability.md](backlog-config-and-portability.md) (rozdział kodu od danych)

---

## 1. Po co ten dokument

Narzędzie ma docelowo działać w trzech trybach naraz:

1. **Lokalnie, open source** — `git clone && npx worktrail`, bez konta i bez serwera.
2. **Zespołowo, hostowane** — konto i plan płatny, jak Supabase czy the sync layer.
3. **Dla osób nietechnicznych** — analityk, support: bez klona repozytorium, przez przeglądarkę.

Te trzy tryby nakładają sprzeczne wymagania na jedno pytanie: **gdzie mieszka prawda o tasku.** Dokument zapisuje odpowiedź, pomiar, który do niej doprowadził, i te decyzje schematu, które są tanie dziś, a nieodwracalne po tym, jak dane powstaną u obcych ludzi.

Dokument NIE jest opisem stanu wdrożonego. Wdrożone są dziś §2 i §3 — reszta to projekt.

## 2. Pomiar — konflikt nie bierze się z tasków

Wszystkie liczby zmierzone na tym repozytorium 2026-08-29.

| Co | Wynik | Jak zmierzone |
|---|---|---|
| Żywe worktree'y | **7** równoległych gałęzi | `git worktree list` |
| Taski dotknięte przez więcej niż jedną gałąź | **0** | `git diff --name-only main...<branch> -- backlog/tasks/`, zliczone |
| Gałęzie dotykające widoków generowanych | **3 z 7** | jw. dla `INDEX.yaml`, `NOW.yaml`, `archive/done.yaml`, `boards/` |
| Próbny merge dwóch gałęzi **bez wspólnego taska** | **KONFLIKT w `INDEX.yaml`** | `git merge-tree --write-tree` |
| Commity 60 dni dotykające `tasks/` | 1142 | `git log --since` |
| …z tego dotykające widoków generowanych | **896 (78%)** | jw. |

Ostatnie dwa wiersze są sednem. `INDEX.yaml` i `archive/done.yaml` to **posortowane agregaty wszystkich 1362 tasków**, więc każda gałąź przepisuje ten sam plik — nawet gdy pracuje na zupełnie innym tasku. Konflikt jest strukturalny, nie przypadkowy.

> **Ból nie bierze się z tego, że taski są wersjonowane. Bierze się z tego, że wersjonujemy stan wyliczony z tasków.**

### 2.1. Co w taskach faktycznie się zmienia

Modyfikacje **istniejących** plików (`--diff-filter=M`, więc bez tworzenia nowych; z pominięciem jednorazowego backfillu `board:` = 1339):

```
status   639  ┐
owner    498  ├─  ~91% wszystkich mutacji
updated  272  ┘
blocked_by 85 ┐
title      43 ├─  treść: ~9%
reszta    <35 ┘
```

Ten rozkład jest fundamentem wszystkich decyzji niżej: **treść taska prawie się nie zmienia, stan taska zmienia się bez przerwy.** Dziś jedno i drugie leży w tym samym pliku, na tej samej gałęzi, pod tym samym mechanizmem scalania — architektura nie odwzorowuje granicy, która realnie istnieje.

## 3. Co już mamy (i czego nie wiedzieliśmy, że mamy)

[TL-17](../backlog/tasks/TL-17-historia-zmian-pol-taska-z-autorem.md) wprowadził wpis historii o kształcie:

```json
{"ts":"…","task":"BL-1401","field":"status","from":"pending","to":"done","actor":"unknown","source":"boot"}
```

To jest **LWW-Register per pole** — dokładnie prymityw, na którym buduje się synchronizację bez CRDT. Powstał jako mechanizm audytu, ale nadaje się na fundament stanu rozproszonego. Nie trzeba go wymyślać; trzeba go **odwrócić** (§5.1) i uzupełnić o `id` (§7.1).

Dziś jednak:

- **Kierunek jest odwrotny do potrzebnego** — źródłem prawdy o stanie jest plik `.md`, a log jest jego POCHODNĄ (rekoncyliacja diffuje plik względem snapshotu). Pochodnej nie da się synchronizować.
- **Wpisy nie mają identyfikatora** — bez niego scalanie i sync produkują duplikaty nieodróżnialne od prawdziwych powtórzeń.
- **`actor` to goły pseudonim** (`^[a-z0-9][a-z0-9._-]{0,31}$`), bez przestrzeni nazw — nie da się odróżnić zadeklarowanej „anny" od uwierzytelnionej Anny.
- **Ciało taska nie jest śledzone w ogóle** — `TRACKED_FIELDS` obejmuje wyłącznie pola frontmattera.
- **Brak `.gitattributes`** — dwie gałęzie dopisujące do tego samego pliku append-only będą konfliktować co znak. Dziś nie boli, bo historia ma 9 plików i jeden dzień życia.

## 4. Decyzja

> **Treść w git. Stan w append-only logu zdarzeń, który JEST źródłem prawdy o stanie. SQLite jako lokalny, odtwarzalny indeks — nigdy jako SSOT. Hosting = ten sam log + auth + role.**

### 4.1. Dlaczego nie „po prostu SQLite"

Baza z mutowalnymi wierszami działa lokalnie i **rozpada się w momencie dołożenia hostingu**. Dwa klienty zmieniają `status` tego samego taska offline — przy wierszach są dwie prawdy i żadnej reguły scalania. Wtedy dopisuje się `updated_at`, potem wektory wersji, potem CRDT — i po roku istnieje własny, gorszy the sync layer.

Log zdarzeń nie ma tego problemu, bo **konfliktu nie ma z definicji**: dwa zdarzenia to dwa zdarzenia. Stan to `fold(log)`, a regułą scalania jest LWW per pole (wygrywa najwyższy `ts` dla pary `(task, field)`).

### 4.2. Dlaczego nie „wszystko do bazy"

Przeniesienie całego taska do bazy kosztuje: przegląd treści w PR, tryb offline, wędrowanie taska z gałęzią i prostotę klonowania dla open source — a rozwiązuje problem, który wg §2.1 stanowi **9% ruchu**. Zła wymiana.

### 4.3. Dlaczego nie zewnętrzny serwis (Linear / Jira / Notion API)

Narzędzie open source musi działać po `git clone`, bez konta i bez tokenu. Zewnętrzny serwis łamie tryb 1, który jest rdzeniem projektu.

## 5. Model danych

### 5.1. Kto wygrywa przy rozjeździe — per klasa pola

To jest odpowiedź na pytanie z zestawu B („czy rekonsyliacja jest jednokierunkowa i która strona wygrywa"). Odpowiedź jest **różna dla różnych klas**, i to celowo — bo §2.1 mierzy dwie różne populacje zmian.

| Klasa | Pola | Kto pisze najczęściej | Kto wygrywa |
|---|---|---|---|
| **Koordynacja** (~91%) | `status`, `owner`, `updated`, etykiety, locki | wszyscy, w tym analityk i support | **Log**, LWW per pole |
| **Treść** (~9%) | `title`, ciało, kryteria akceptacji, `related_docs`, `epic` | developer, agent | **Serwer** (tryb hostowany) / **plik** (tryb lokalny), z kontrolą wersji bazowej |
| **Komentarze** | — | analityk, support | **Nikt** — append-only, nie konfliktują |
| **Załączniki / linki** | — | support | jw. |

Konsekwencja dla frontmattera: pola koordynacyjne stają się **projekcją logu**, nie oryginałem. Edycja `status:` w pliku przez agenta (Edit/Write) nie jest zapisem stanu — jest **propozycją zdarzenia**, wciąganą z `actor` i `ts`. Jeśli w logu istnieje nowsze zdarzenie dla tej pary `(task, field)`, frontmatter zostaje przepisany z powrotem.

Agenci muszą dalej edytować `.md` bezpośrednio — to jest cały sens narzędzia. Ingestia (dzisiejsza rekoncyliacja) zostaje; zmienia się to, która strona jest autorytatywna po ingestii.

### 5.2. Komentarze jako kanał zapisu dla osób nietechnicznych

Analityk i support nie przepisują kryteriów akceptacji taska inżynierskiego. Oni czytają, zakładają nowe taski, komentują, zmieniają status i przypisania — czyli piszą **w klasie koordynacyjnej i w komentarzach**, a obie są strukturalnie bezkonfliktowe.

To nie jest ograniczenie nałożone na te role. To opis tego, jak one pracują. Podział person **pokrywa się** ze zmierzonym podziałem pól — i dlatego jedna architektura obsługuje obie populacje bez kompromisu.

### 5.3. Edycja ciała — konflikt trafia do tego, kto umie go rozwiązać

- **Web UI (analityk, support):** zapis niesie hash wersji bazowej. Nie zgadza się z głową → **409 i „ktoś to zmienił, odśwież"**. Osoba nietechniczna **nigdy** nie widzi markera konfliktu, bo nigdy nie dostaje scalania do rozstrzygnięcia.
- **Git (developer, agent):** rozjazd materializuje się jako **zwykły konflikt w pliku**, rozwiązywany w edytorze — narzędziem, które ta osoba już zna.

Bez CRDT i bez zależności. CRDT rozwiązuje **jednoczesne pisanie w tym samym akapicie**, a nie „dwie osoby edytowały ten sam task w ciągu dnia". Log zdarzeń jest właściwym fundamentem, gdyby kiedyś trzeba było to dołożyć.

### 5.4. SQLite jako indeks, nie jako prawda

`node:sqlite` jest wbudowane w Node (≥22; zweryfikowane na v24.18.0 — `new DatabaseSync(':memory:')` działa bez żadnej zależności), więc nie łamie zasady zero-dependencies modułu.

Baza jest **w 100% odtwarzalna z logu** i leży **poza gitem** (`.worktrail/` albo `backlog/.state/`, gitignored). **Skasowanie pliku bazy ma być nieszkodliwe — i to jest test poprawności tej architektury.** Jeśli kiedykolwiek przestanie być nieszkodliwe, znaczy to, że baza po cichu stała się SSOT-em i decyzja z §4 została złamana.

## 6. Granica trybów

| | Lokalnie (open source) | Hostowane (plan płatny) |
|---|---|---|
| SSOT treści | pliki w repo | serwer (repo = replika) |
| SSOT stanu | log w repo | log na serwerze |
| Transport synchronizacji | **git** | serwer |
| Atrybucja | deklarowana | **uwierzytelniona** |
| Locki | w obrębie jednej maszyny (lockfile, TL-87) | **gwarantowane** |
| Dostęp bez repo | brak | **jest** (analityk, support) |
| Konto | niepotrzebne | wymagane |

### 6.1. Czego wersja lokalna nie da — i dlaczego to uczciwa granica płatna

**Prawdziwej wzajemnej wykluczalności bez pojedynczego pisarza.** Lock jest też zdarzeniem, a LWW rozstrzyga je dopiero po fakcie. Dwie maszyny połączone wyłącznie gitem mogą wziąć ten sam task i dowiedzą się o tym przy synchronizacji — nie wcześniej. Atomowy lock istnieje tylko tam, gdzie jest jeden pisarz: lokalnie system plików (co pokrywa dzisiejszy przypadek siedmiu worktree'ów na jednym dysku), w zespole dopiero serwer.

**Zrobione w TL-87** — `worktrail take` / `worktrail next`, `scripts/lock.mjs`. Pojedynczym pisarzem jest system plików, nie SQLite: `link()` z pliku tymczasowego pod docelową nazwę albo się udaje, albo oblewa na EEXIST, a baza byłaby zależnością i drugim źródłem prawdy dla jednego bitu. Dwie rzeczy zmierzone przy okazji, obie realne:

1. **`open(wx)` + zapis to NIE jest jeden krok.** Plik istnieje pusty przez czas zapisu, a proces, który trafi w to okno, czyta „lock bez treści", uznaje go za uszkodzony i przejmuje. Sześć równoległych `next` wydało ten sam task dwóm sesjom. `link()` zamyka okno: nazwa pojawia się dopiero z kompletną treścią.
2. **Locki muszą leżeć POZA repozytorium.** Każdy worktree ma własny `backlog/`, więc lock w katalogu backlogu byłby w każdym z nich innym plikiem i nie wykluczałby nikogo. Kluczem jest `git rev-parse --git-common-dir` — ta sama ścieżka ze wszystkich worktree'ów jednego repozytorium.

Granica jest w `take --help` i w README, a nie tylko tutaj: gwarancja obejmuje jedną maszynę i jedno konto użytkownika.

### 6.2. Odczyt stanu z wielu gałęzi — zrobione w TL-73

Lock rozstrzyga, kto BIERZE task. Osobnym problemem jest to, co widzi ten, kto **czyta** backlog: widok policzony z jednego checkoutu kłamie o reszcie repozytorium. Task ruszony na `feature/x` jest w kopii z `main` wciąż `pending`, więc `query --status pending` podawał go jako wolny — ten sam rozjazd stanu z gałęzią, dla którego odrzucono zewnętrzne trackery, tylko odwrócony.

`scripts/branch-scan.mjs` uogólnia skan, który od BL-1452 robił `next-backlog-id.mjs` dla NUMERÓW, na STAN. Jeden moduł, dwóch odbiorców — dwie kopie rozjechałyby się w pytaniu „które gałęzie istnieją", a to jest dokładnie ta różnica, przez którą jeden task trafia do dwóch sesji.

Cztery rozstrzygnięcia, których nie da się cofnąć po cichu:

1. **Rozbieżność jest POKAZANA, nie rozstrzygnięta.** `query`, `stats` i viewer podają oba statusy i nazywają gałąź (`elsewhere: [feature/x: in_progress]`). Wybór zwycięzcy byłby znowu jedną wartością udającą prawdę — czyli tą samą wadą co widok z jednego checkoutu, tylko trudniejszą do zauważenia.
2. **Tylko refy lokalne.** Żadnego `git fetch`. Pilnuje tego test podstawiający własny `git` na PATH i sprawdzający ZAREJESTROWANE wywołania — asercja na źródle przegapiłaby fetch przez alias albo helper.
3. **Okno aktywności** (`active_branch_days: 30`) ogranicza koszt, ale gałąź WYCIĄGNIĘTA w worktree czytana jest zawsze — stoi w niej ktoś, kto najpewniej trzyma task. Wyłącznik to `cross_branch_state`.
4. **Własna gałąź nie jest drugą opinią.** Niezacommitowany `take` na `main` nie ma raportować „main: pending" sam sobie; ostrzeżenie, które pada po każdym `take`, przestaje być czytane, a wtedy ginie to prawdziwe.

Czego to NIE robi: task istniejący wyłącznie na innej gałęzi nadal nie pojawia się na liście. To pytanie „jakie taski istnieją gdziekolwiek", a nie „co inni mówią o taskach w tym drzewie" — i jedyny jego kosztowny przypadek (zajęty numer) pokrywa `next-id`.

To jest **odczyt** przez gita jako transport, czyli §6 wiersz „Transport synchronizacji". Nie zastępuje logu z §4: stanem prawdziwym pozostaje plik na swojej gałęzi, a skan mówi tylko, że gałęzie się nie zgadzają.

Trzy rzeczy, których tryb lokalny **z definicji** nie umie — żadnej nie trzeba celowo okaleczać: zweryfikowana atrybucja, prawdziwe locki, dostęp bez repozytorium. Darmowa wersja zostaje w pełni użyteczna dla dewelopera z agentami, czyli dla rdzenia open source.

## 7. Decyzje schematu — tanie dziś, nieodwracalne po pierwszym obcym użytkowniku

Te punkty są w [TL-21](../backlog/tasks/TL-21-fundament-logu-zdarzen-worktrail.md). Powód, dla którego są RAZEM mimo różnej wagi: 1–3 opłacają się nawet gdyby serwer nigdy nie powstał (rozwiązują zmierzony dziś ból), a 4–5 kosztują dziś linijkę, a po wydaniu — migrację cudzych danych.

1. ✅ **`id` w każdym zdarzeniu** — **ULID** (48 bitów czasu + 80 losowości, Crockford base32, 26 znaków), `eventId()` w `history.mjs`. Hash treści odpadł: dwie repliki stemplują to samo zdarzenie własnym zegarem, więc i tak by się rozjechał, a ULID daje coś, czego hash nie ma — **porządek**, czyli gotowy kursor synchronizacji („daj zdarzenia po X"). Licznik odpadł, bo wymaga jednego pisarza, a dróg zapisu są trzy w osobnych procesach. Dedup po `id` siedzi w `readHistory()`; wpisy sprzed TL-21 (bez `id`) czytają się dalej i **nie są** deduplikowane — nie ma czym ich porównać, a zgadywanie po treści zlałoby dwie prawdziwe zmiany na tę samą wartość.
2. ✅ **`backlog/.gitattributes`: `history/*.jsonl merge=union`.** Plik leży **w katalogu backlogu**, nie w korzeniu repozytorium — gitattributes obowiązuje per katalog, więc reguła jedzie z backlogiem do cudzego repo. Reguła i punkt 1 działają **wyłącznie razem**: bez `id` union sklejałby log, którego nikt nie umie rozplątać.
3. ✅ **Widoki generowane do `.gitignore`** (`INDEX.yaml`, `NOW.yaml`, `archive/done.yaml`, `boards/*/`) + `git rm --cached`. Warunek konieczny dowieziony razem z nimi: `serve-backlog.mjs` regeneruje widoki **przed nasłuchem** (raz, poza `listen()`, które rekurencyjnie próbuje kolejnych portów), a hook robi to po każdej edycji taska.
4. ✅ **`actor` z przestrzenią nazw** — `local:<nick>` (zadeklarowany, niezweryfikowany), `agent:<nazwa>` (zapis automatyczny), `user:<id>` (konto uwierzytelnione), plus `unknown` jako jedyna wartość bez przestrzeni. Bez tego po wprowadzeniu kont nie da się odróżnić deklaracji od uwierzytelnienia, a to jest **dokładnie ta różnica, za którą płaci firma**.

   **Kod nie zgaduje przestrzeni.** Goła nazwa w NOWYM zapisie to brak deklaracji, więc ląduje jako `unknown` — hurtowe dopisanie `local:` przekwalifikowałoby agenta `claude` na człowieka, czyli byłoby ładną nieprawdą tej samej klasy co odrzucony backfill z gita (§6 [backlog-field-editing-history.md](backlog-field-editing-history.md)). Wpisy sprzed TL-21 zostają w logu bajt w bajt i przy ODCZYCIE dostają przestrzeń `legacy` — to prawda o nich, w przeciwieństwie do wciśnięcia ich w dzisiejszą kategorię.

   Degradacja musiała stać się GŁOŚNA w obu miejscach, gdzie mogła być cicha: `validateConfig` odrzuca gołego aktora w `config.yaml` z komunikatem podającym trzy dozwolone formy, a `history-record.mjs` kończy kodem 2 zamiast raportować „zapisano zmiany (kamil)" i zapisywać `unknown` — wyjście kłamałoby o autorze, czyli o jedynej rzeczy, dla której ta historia istnieje.
5. ✅ **Typ zdarzenia dopuszczający ciało i komentarze** — `__body__` i `__comment__` zarezerwowane obok `__created__` / `__deleted__` w `PSEUDO_FIELDS`. Lista mieszka w `task-fields.mjs`, bo ten plik jest wklejany źródłem do viewera; viewer miał do tej pory własną, ręcznie przepisaną kopię warunku `field === "__created__" || field === "__deleted__"` — klasa „ta sama decyzja w dwóch miejscach" zniknęła przy okazji.

   **`__comment__` jest ZAIMPLEMENTOWANY od TL-99**, `__body__` nadal nie. Pierwszym pisarzem jest `worktrail handoff`, ale kształt jest ogólny i nie wie nic o przekazywaniu: całą treścią jest `to`, `from` zostaje puste (komentarz niczego nie zastępuje), a dedup działa **wyłącznie po `id`** — reguła zdarzeniowa z `__created__` go NIE dotyczy, bo dwa identyczne zdania powiedziane w różnym czasie to dwie wypowiedzi, a nie jedno zdarzenie widziane dwa razy. Rezerwacja opłaciła się dokładnie tak, jak zakładano: doszedł zapis, nie migracja cudzych danych.

   Odczyt jest jedną regułą dla wszystkich zdarzeń — `historyEntryKind()` w `task-fields.mjs` rozstrzyga, czy wiersz czyta się jako `message` (cała treść w `to`), `event` (sama etykieta) czy `transition` (`from → to`). Powód jest ten sam, dla którego lista pseudo-pól tu mieszka: viewer wkleja ten plik źródłem, więc reguła nie może się rozjechać ze stroną, a test może ją wywołać zamiast asertować HTML.

### 7.1. Jednorazowy koszt przejścia (zmierzony)

Gałęzie utworzone **przed** krokiem 3 nadal mają widoki w indeksie, więc scalenie, które wnosi tę zmianę, **jeszcze raz zgłosi konflikt** — zmierzone na żywej gałęzi: `KONFLIKT (zawartość)` w `backlog/INDEX.yaml` i `backlog/archive/done.yaml`. Rozwiązanie jest jednorazowe i mechaniczne: przyjąć usunięcie (`git rm`) i zregenerować widoki. Od następnego scalenia problem nie wraca, bo pliku nie ma po żadnej stronie.

W dniu zmiany żyło **7 worktree'ów**, więc ta jedna operacja czeka każdy z nich przy najbliższym scaleniu z `main`.

### 7.2. Jak to jest udowodnione

Każdy z trzech kroków ma test z **kontrolą pozytywną** — bez niej zielony wynik jest nieodróżnialny od „ten mechanizm i tak nigdy nie failował":

| Krok | Dowód | Kontrola pozytywna |
|---|---|---|
| 1 | `history.test.mjs` — id, unikalność w tej samej milisekundzie, porządek leksykograficzny, dedup | „dedup NIE łączy dwóch różnych zdarzeń o tej samej treści" + „wpisy bez id nigdy nie są deduplikowane" |
| 2 | `history-merge.test.mjs` — **prawdziwe** scalenie dwóch gałęzi w repozytorium tymczasowym, z NASZYM plikiem atrybutów | to samo scalenie **bez** `.gitattributes` MUSI konfliktować |
| 3 | `views-not-versioned.test.mjs` — rozłączne gałęzie scalają się czysto; w tym repo widoki ignorowane **i nieśledzone** | wersjonowany agregat konfliktuje mimo rozłącznych tasków |
| 4 | `history.test.mjs` — walidacja, rozbiór, cała droga zapisu; `config.test.mjs` — konfiguracja z gołym aktorem oblewa | goła nazwa NIE jest promowana do `local:`; log sprzed TL-21 czyta się bajt w bajt; CLI kończy błędem zamiast cicho zapisać `unknown` |
| 5 | `history.test.mjs` — pseudo-pola przechodzą zapis i odczyt | `diffMeta` NIGDY ich nie produkuje (inaczej rekoncyliacja zmyślałaby zmiany ciała, którego nie czyta) |

Asercja „plik zawiera `merge=union`" byłaby bezwartościowa — sprawdzałaby, że regułę napisano, a nie że git ją stosuje.

## 8. Kolejność i ryzyko

Serwer buduje się **dopiero wtedy, gdy ktoś poza founderem używa wersji lokalnej.** Wcześniej optymalizuje się pod użytkownika, którego jeszcze nie ma, kosztem produktu, który już istnieje (the origin project).

To, co opisuje §6, to produkt SaaS z kontami, rolami, billingiem, synchronizacją i webowym UI — prowadzony przez jednoosobowy zespół obok the origin project. Dokument tego nie odradza; zapisuje, że **kolejność ma tu znaczenie większe niż wybór technologii**, a kroki 1–5 są właśnie tą częścią, która jest wartościowa niezależnie od tego, czy hosting powstanie.

## 9. Założenia do obalenia

Rzeczy, których NIE zmierzyłem, a które odwróciłyby część powyższego:

1. **Czy realny ból to konflikty, czy kolizje na tasku.** §2 mierzy tylko to, co doszło do commita. Agent, który wszedł w zajęty task i się wycofał, w gicie nie zostawia śladu. Gdyby dominowały kolizje, priorytetem byłyby locki (§6.1), a nie kroki 1–3.
2. **Czy osoby nietechniczne będą jednak edytować ciało.** §5.2 opiera się na obserwacji ról, nie na pomiarze. Gdyby analityk realnie przepisywał treść tasków, §5.3 przestaje wystarczać i wraca temat CRDT.
3. **Czy git wystarczy jako transport dla małego zespołu.** Zakłada, że wszyscy członkowie mają repo i regularnie synchronizują. Zespół z jedną osobą nietechniczną łamie to założenie od pierwszego dnia — i wtedy serwer jest potrzebny wcześniej, niż mówi §8.
