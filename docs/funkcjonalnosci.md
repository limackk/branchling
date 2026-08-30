# Funkcjonalności — stan i kierunek

Co `worktrail` robi dzisiaj i co ma robić. Stan na **2026-09-01**.

Ten dokument opisuje ZAKRES. Uzasadnienia decyzji mieszkają gdzie indziej:
[`docs/worktrail-global-tool.md`](worktrail-global-tool.md) (cztery prawa),
[`LINEAGE.md`](../LINEAGE.md) (kolejność decyzji), i w `## Kontekst` każdego
taska. Sekcja „Co będzie" jest migawką backlogu, nie obietnicą — źródłem prawdy
są `backlog/tasks/*.md`, a nie ta lista.

> `README.md` w korzeniu repozytorium jest jeszcze dokumentem projektu, z
> którego to narzędzie wydzielono: mówi `backlog` zamiast `worktrail`, `BL-NNN`
> zamiast `TL-NNN` i niesie słownictwo tamtego projektu. Wymienia go TL-49;
> do tego czasu ten plik jest dokładniejszy.

---

## 1. Czym to jest

Backlog w plikach markdown, obsługiwany z terminala. Jeden task to jeden plik
z frontmatterem YAML, wersjonowany w gicie razem z kodem, którego dotyczy.
Wszystko poza plikami tasków — indeksy, widoki, boardy, viewer — jest
WYLICZANE i nieśledzone w gicie.

Cztery reguły, z których bierze się reszta:

1. **Dane w repozytorium, wskaźniki globalnie.** Task jedzie z gałęzią i
   przechodzi przez review. Stan rozwiedziony z gałęzią to wada, dla której
   odrzucono zewnętrzne trackery.
2. **Co wyliczone, wolno skasować.** Jeśli skasowanie widoku boli, rzecz zdążyła
   zostać prawdą i to jest błąd projektu.
3. **Warstwy konfiguracji są ROZŁĄCZNE, nie priorytetowe.** Klucz w złej warstwie
   oblewa; warstwa użytkownika nie nadpisuje słownictwa projektu.
4. **Rozszerzalność przez kompozycję** — `--json` na każdej komendzie czytającej,
   wywoływalne wejście na każdej piszącej. Bez API wtyczek.

---

## 2. Co działa dzisiaj

### 2.1 Model danych

| Rzecz | Gdzie | Wersjonowane |
|---|---|---|
| Task | `backlog/tasks/TL-NNN-slug.md` | tak |
| Słowniki projektu | `backlog/config.yaml` | tak |
| Rejestr boardów | `backlog/boards.yaml` | tak |
| Historia zmian pól | `backlog/history/TL-NNN.jsonl` | tak |
| Szablon taska | `backlog/_template.md` | tak |
| Indeksy, boardy, viewer | `INDEX.yaml`, `NOW.yaml`, `archive/`, `viewer.html` | **nie** |

**Frontmatter taska** niesie: `id`, `title`, `type`, `labels`, `board`, `epic`,
`priority`, `status`, `owner`, `estimate`, `confidence`, `created`, `updated`,
`blocked_by`, `blocks`, `related_docs`, `verification`.

**Kod zna KSZTAŁT pola, `config.yaml` zna WARTOŚCI.** Statusy, priorytety,
etykiety, typy, właściciele, estymaty i prefiks ID są słownikami projektu.
Nieznany klucz oblewa build. `labels_closed: true` zamienia literówkę w etykiecie
w błąd zamiast w nową, cichą kategorię.

**Board to partycja, epic to grupa.** Każdy task ma dokładnie jeden `board:`
ze słownika zamkniętego (`boards.yaml`); `epic:` jest wolnym tekstem wewnątrz
boarda. Nie zastępują się nawzajem.

**`verification:` mówi, JAK sprawdzić, że task jest zrobiony** — listą komend
(`- bash: "…"`) albo kroków ręcznych (`- manual: "…"`). To jest pole, które
odróżnia to narzędzie od innych markdown-owych trackerów: „zrobione" ma być
sprawdzalne, nie deklarowane.

### 2.2 Komendy

Nieznana komenda i nieznana flaga **oblewają** — cichy no-op wygląda jak
działanie. `--dir <ścieżka>` działa w każdej komendzie; katalog danych rozwiązuje
`resolveBacklogDir()` z czterech źródeł: `--dir` → `BACKLOG_DIR` → wykrywanie
w górę od cwd → ko-lokacja.

**Czytające**

| Komenda | Co robi |
|---|---|
| `query` | pytania o taski prosto z `tasks/*.md`, więc widzi zmiany bez regeneracji; filtry po statusie, priorytecie, boardzie, etykiecie, epicu; `--json` / `--files` / `--count` |
| `stats` | stan backlogu na jednym ekranie: statusy, priorytety, blokery, godziny; `--json` |
| `doctor` | czy backlog jest dobrze ustawiony — konfiguracja, drzewo, git, guardy; `--json` |
| `board <plik>` | który board dla taska — z reguł ścieżek, nie ze zgadywania |
| `next-id` | następny wolny numer, liczony ze WSZYSTKICH gałęzi i worktree; `--explain` |
| `check` | guardy: kolizje numerów, partycja boardów, wiszące odwołania |

**Piszące**

| Komenda | Co robi |
|---|---|
| `new --title "…"` | zakłada task z szablonu; numer ze skanu wszystkich gałęzi, nie `max+1` |
| `init --dir <ścieżka>` | zakłada nowy backlog w pustym katalogu, z przykładowym taskiem |
| `history --actor …` | dopisuje do historii zmiany zrobione przy wyłączonym serwerze |
| `migrate-prefix --to X` | przenumerowuje cały backlog na inny prefiks (nazwy, ID, zależności, historia); `--dry-run` |

**Utrzymaniowe**

| Komenda | Co robi |
|---|---|
| `build` | przebudowuje widoki z `tasks/*.md` |
| `serve` | viewer na `127.0.0.1` (komenda domyślna) |
| `viewer` | przebudowuje `viewer.html` bez uruchamiania serwera |
| `regen-hook` | wejście dla hooka edytora: regeneracja po edycji taska (JSON na stdin) |

### 2.3 Widoki wyliczane

`build` produkuje: `INDEX.yaml` (aktywne), `NOW.yaml` (w toku), `archive/done.yaml`
(zamknięte), `boards/<slug>/{INDEX,NOW}.yaml` oraz `viewer.html`. Wszystkie są
w `.gitignore` — i to nie z estetyki: są posortowanymi agregatami WSZYSTKICH
tasków, więc każda gałąź przepisywałaby ten sam plik i dwie gałęzie konfliktowałyby
nawet bez wspólnego taska.

### 2.4 Viewer

Jedna samowystarczalna strona HTML plus lokalny serwer. Dla czytelnika, który
nie pracuje w terminalu.

- **Lista zadań** — filtry, szukajka, sortowanie, detal taska.
- **Board jako scope, nie filtr** — przełącza zakres list, liczników i dashboardu.
- **Stan widoku w URL-u** — każdy filtr, szukajka, sortowanie, scope i zaznaczony
  task lądują w hashu, więc widok da się podać dalej linkiem. Parametr nieobecny
  znaczy „domyślny", a nie „zostaw, co masz" — inaczej link kłamałby u odbiorcy.
- **Dashboard** — KPI, wykres kumulatywny, dzień po dniu, tabela epików, rozkłady,
  listy uwagi (stale, blocked, najstarsze P0-P1), prognoza. Ignoruje filtry listy
  (odpowiada na „jak stoi backlog", nie „co mam otwarte"), respektuje scope boarda.
  Drill-down: klik w epic, status, priorytet, etykietę ustawia filtr listy.
- **Edycja pól w miejscu**, z zapisem do pliku taska.
- **Historia zmian w detalu** — znacznik `autor · kiedy` przy każdym polu i oś czasu.
- **Live-mode** — SSE, viewer odświeża się po zmianie pliku.
- Dark mode, paleta wyprowadzona z `config.yaml`.

### 2.5 Guardy

`check` uruchamia trzy i wychodzi z NAJGORSZYM wynikiem:

- **Kolizje ID** — jeden `TL-NNN` = jeden task; właściwość ZBIORU, czyta całe drzewo.
- **Partycja boardów** — każdy task ma board z rejestru; właściwość JEDNEGO pliku,
  więc `--boards <pliki…>` sądzi tylko wskazane (tyle powinien robić pre-commit hook).
- **Wiszące odwołania** — `blocked_by` / `blocks` wskazują na istniejące taski.

`doctor` odpowiada na szersze pytanie „czy ten backlog jest dobrze ustawiony":
konfiguracja, drzewo, git, obecność guardów.

### 2.6 Historia zmian

Każda zmiana pola dopisuje wiersz do `history/TL-NNN.jsonl` (append-only,
wersjonowane): `ts`, `task`, `field`, `from`, `to`, `actor`, `source`.

**Aktor ma obowiązkową przestrzeń nazw** — `local:<nick>` (zadeklarowany,
niezweryfikowany), `agent:<nazwa>` (zapis automatyczny), `user:<id>` (konto
uwierzytelnione). Przestrzeń mówi, ILE ta atrybucja jest warta; `source` mówi,
którą drogą przyszła (`viewer`, `hook`, `manual`, `external`). Goła nazwa jest
odrzucana głośno, nie zgadywana.

### 2.7 Testy

```bash
node --test scripts/tests/*.test.mjs
```

**341/341 zielone** (2026-08-31), w 28 plikach. Dwie reguły, które utrzymują je uczciwymi: katalog backlogu
bierze się z `scripts/tests/_repo.mjs` (rozstrzyga oba układy — `<repo>/backlog`
i ko-lokowany), a testy nie asertują wartości cudzego projektu — statusy,
etykiety i slugi boardów to DANE, nie kontrakt narzędzia.

---

## 3. Co będzie

43 taski otwarte. Poniżej pogrupowane tematycznie; ID prowadzi do pliku
z pełnym uzasadnieniem.

### 3.1 Zamknięcie taska musi być dowiedzione — priorytet najwyższy

Dziś `verification:` jest zapisywane i walidowane, ale **żaden skrypt go nie
uruchamia**. Egzekucję pełni instrukcja dla agenta, czyli ten sam agent, którego
miała pilnować. To jest jedyna wyróżniająca cecha narzędzia i istnieje dziś jako
konwencja, nie mechanizm.

- **TL-86** — kryteria akceptacji odhaczane z `verification:`, nie deklarowane.
  Pomiar, który to wywołał: 12 z 44 zamkniętych tasków ma łącznie 60
  nieodhaczonych kryteriów, przy sprawnym `verification:`. Dwie listy o tym
  samym „done", realna jedna.
- **TL-82** — `worktrail done <ID>` uruchamia `verification:`, pokazuje wyjście
  i ODMAWIA zamknięcia przy porażce. Pusta lista i literał z szablonu też oblewają;
  `manual:` wymaga potwierdzenia zapisanego w historii.

### 3.2 Przed publikacją

- **TL-48** — LICENSE i metadane pakietu (dziś `private`, `UNLICENSED`).
- **TL-49** — README jest dokumentem cudzego projektu.
- **TL-81** — kanały dystrybucji i kolizja nazwy w `npx`.
- **TL-53** — CI, CONTRIBUTING, szablony zgłoszeń.
- **TL-56**, **TL-69** — słownik `types` rozjechał się z drzewem; szablon
  przemyca wartość spoza słowników.
- **TL-68** — log mówi `done`, frontmatter mówi `pending`, nikt tego nie łapie.
- **TL-57** — `--json` na `check`, `next-id`, `board`.
- **TL-84** — rozstrzygnąć i zapisać, czy ręczna edycja pliku taska jest drogą
  wspieraną, czy tolerowaną.

### 3.3 Kontrakt maszynowy

- **TL-72** — koperta JSON z `schemaVersion` i `kind` zamiast gołej tablicy.
  `--json` JEST naszym API rozszerzeń, a goła tablica nie może urosnąć o pole
  bez zerwania konsumentów.
- **TL-83** — enumy ze słowników w `--help --json` i `--append-<pole>` na
  komendach piszących (sandboksy agentowe odrzucają składnię `$'…\n…'`).
- **TL-76** — przechodni graf zależności wyliczany przy odczycie, z jawną
  obsługą cyklu, powtórzenia oraz nieznanego i niejednoznacznego ID.
- **TL-75** — `modified_files` i wyszukiwanie tasków po dotkniętym pliku.
- **TL-77** — completions do shella z wartościami ze słowników.
- **TL-79** — `board export` jako markdown do wklejenia.

### 3.4 Stan w poprzek gałęzi

- **TL-73** — stan taska liczony z aktywnych gałęzi, nie z bieżącego checkoutu.
  Skan gałęzi i worktree już istnieje (`next-id`); ten task uogólnia go z „jakie
  numery są zajęte" na „jaki jest stan taska". Rozbieżność jest pokazywana z nazwą
  gałęzi, nigdy rozstrzygana po cichu.

### 3.5 Powierzchnia dla agentów

- **TL-74** — `worktrail instructions`: instrukcje workflow wydaje CLI, nie plik
  gnijący w cudzym repo. Tekst szablonowany słownictwem czytanego backlogu,
  podzielony na rozdzielnię i przewodniki fazowe.
- **TL-104** — pętla autonomiczna: `next --claim`, odzyskiwanie porzuconych
  tasków, wzorzec świeżej sesji na task (kompaktacja kontekstu u vendorów jest
  stratna; pamięcią pętli jest plik taska).
- **TL-85** — rozstrzygnąć politykę zakresu: agent zakłada task sam czy pyta.
- **TL-54** — skill `backlog-workflow` jedzie w pakiecie do użytkownika.
- **TL-46** — `init --hooks`: bramka, która sama się instaluje.
- **TL-78** — `on_status_change`: konfigurowalna komenda przy zmianie statusu.
- **TL-80** — rozdział komentarzy, notatek wykonawczych i podsumowania końcowego.

### 3.6 Pomiar czasu pracy

Osobna oś, opisana w [`docs/backlog-time-tracking.md`](backlog-time-tracking.md).

- **TL-27** — fundament i uczciwy punkt zero.
- **TL-28** — heartbeaty aktywności i łańcuch atrybucji.
- **TL-31** — retencja, korekta atrybucji, prawo do usunięcia.
- **TL-35** — surowy log aktywności do katalogu domowego.
- **TL-29**, **TL-30** — kalibracja estymat z danych; adapter tokenów i kosztu.

### 3.7 Wiele projektów

- **TL-34** — katalog domowy: preferencje i rejestr projektów (wskaźniki
  globalnie, dane w repozytorium).
- **TL-36** — widok przekrojowy nad wieloma projektami.

### 3.8 Wejście i wyjście

- **TL-67** — import z GitHub Issues: jednorazowy, ze stdin, z `--dry-run`.
  Podniesiony do P2: ścieżka spróbowania bez kosztu migracji.
- **TL-55** — eksport viewera do jednego pliku do wysłania.
- **TL-37** — rozdzielenie dokumentów: mechanizm jedzie, pomiary zostają.
- **TL-32** — angielska powierzchnia publiczna (P1): warunek wejścia na rynek.

### 3.9 Launch

Z analizy konkurencyjności (2026-09-01): mechanizm bez demo jest niewidzialny,
a projekt w tej kategorii rośnie z jednego dobrego launchu.

- **TL-102** — demo pierwszego kontaktu: odmowa `worktrail done` w 60 sekund,
  w nagłówku README.
- **TL-103** — materiał launchowy: pomiar 27% jako teza, Show HN, każda liczba
  z komendą do powtórzenia.

### 3.10 Higiena

- **TL-43** — log historii bywa nieśledzony w gicie, bramka traci przesłankę.
- **TL-45** — bramka na martwe linki i `related_docs`.
- **TL-47** — brak backlogu wychodzi jako nieobsłużony wyjątek ze stack tracem.
- **TL-58** — wartość zaczynająca się od myślnika oblewa w `new`.

---

## 4. Czego świadomie nie będzie

Odrzucone przy analizie Backlog.md (2026-08-31) i wcześniej. Zapisane, żeby nie
wracały jako „a może jednak".

| Rzecz | Dlaczego nie |
|---|---|
| **Serwer MCP** | Druga powierzchnia z własnym cyklem życia. `worktrail instructions` (TL-74) daje ten sam zasięg za ułamek kosztu utrzymania. |
| **Warstwy konfiguracji z priorytetem** | Sprzeczne z III prawem. Wygodniejsze i cichsze — i dokładnie dlatego odrzucone. |
| **Drafts jako osobny byt** | To jest `status: pending`. Dodatkowy stan nie kupuje niczego. |
| **Milestones jako pliki z własnymi ID** | `epic:` jako wolny tekst wewnątrz boarda wystarcza i zdejmuje koszt operacji na cudzych ID. |
| **API wtyczek** | IV prawo: rozszerzalność przez kompozycję. `--json` i wywoływalne wejścia zamiast rejestru hooków. |
| **Zewnętrzny tracker jako źródło prawdy** | I prawo: stan rozwiedziony z gałęzią to wada, dla której ten projekt powstał. |

---

## 5. Jak sprawdzić, czy ten dokument jest aktualny

Nie jest źródłem prawdy — backlog nim jest. Migawkę odtworzysz:

```bash
node scripts/cli.mjs stats
node scripts/cli.mjs query --status pending --priority P0,P1
node scripts/cli.mjs check
```
