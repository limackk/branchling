# Backlog — rozdział kodu od danych i konfiguracja

**Status:** IMPLEMENTED 2026-08-29 ([TL-18](../backlog/tasks/TL-18-katalog-danych-backlogu-jako-argument.md), [TL-19](../backlog/tasks/TL-19-slowniki-backlogu-do-konfiguracji.md))
**SSOT kodu:** `backlog/scripts/paths.mjs`, `backlog/scripts/config.mjs`, `backlog/config.yaml`
**Testy:** `node --test backlog/scripts/tests/paths.test.mjs backlog/scripts/tests/config.test.mjs`

---

## 1. Po co

Moduł `backlog/` powstał jako część workspace'u the origin project i miał to wpisane w konstrukcję na dwa sposoby:

1. **Katalog danych wynikał z położenia kodu** — każdy skrypt liczył go jako `join(__dirname, "..")`. Kod i dane były jednym katalogiem, więc nie dało się ani wskazać innego backlogu, ani zainstalować narzędzia obok cudzego repozytorium.
2. **Słowniki były kodem** — `pre-launch`, `test_env`, `data-gated`, `owner: founder|claude`, siedem statusów, cztery priorytety i dwa typy stały wpisane w `task-fields.mjs`, `build-backlog.mjs` i CSS viewera.

Oba są w porządku dla narzędzia jednej firmy i oba są blokerem, gdy to ma być narzędzie. Dwa taski usunęły te założenia **bez** przenoszenia plików i bez wydzielania repozytorium — tak, żeby wydzielenie było później jednym `git subtree split`, a nie archeologią.

## 2. Gdzie są dane (TL-18)

`resolveBacklogDir()` w `paths.mjs`. Kolejność źródeł, od najbardziej jawnego:

| # | Źródło | `source` | Uwagi |
|---|---|---|---|
| 1 | `--dir <ścieżka>` | `explicit` | wskazanie, które nie jest backlogiem, jest **błędem**, nie przejściem dalej |
| 2 | `BACKLOG_DIR` | `env` | jak wyżej |
| 3 | wykrywanie w górę od `cwd` (`.` albo `./backlog`) | `discovery` | wymaga ZNACZNIKA |
| 4 | katalog nad plikiem skryptu | `colocated` | trzyma dzisiejszy układ i alias `backlog` |

**Wykrywanie wymaga znacznika** (`tasks/` **plus** `boards.yaml` / `config.yaml` / `_template.md`), a nie samego `tasks/`. Cudze repo z katalogiem o tej nazwie jest częstsze, niż się wydaje, a ciche wskazanie nie tego drzewa kończy się zapisem nie tam — to gorsze niż błąd.

Punkt 4 jest tym, co utrzymuje dzisiejsze zachowanie: alias `backlog` startuje serwer z dowolnego katalogu, także spoza workspace'u.

`backlogPaths(root)` jest jedynym miejscem, które zna nazwy plików w środku (`tasks/`, `history/`, `INDEX.yaml`, `viewer.html`…).

## 3. Co jest konfiguracją (TL-19)

Linia podziału, której trzeba się trzymać:

- **Kod zna KSZTAŁT** — jakie pola ma task, jakiego są typu, jak się je zapisuje do frontmattera, jak się je porównuje. To `FIELD_SHAPES` w `task-fields.mjs`.
- **Konfiguracja zna WARTOŚCI** — jakie statusy, labels, priorytety, typy i boardy istnieją w TYM projekcie.

`buildFieldSpecs(config)` skleja jedno z drugim w specy, z których serwer waliduje, a viewer rysuje edytory.

### Pliki

```
backlog/config.yaml   ← słowniki projektu (ten plik jest nowy)
backlog/boards.yaml   ← rejestr boardów (bez zmian; ma własny guard)
```

`config.mjs` czyta oba i zwraca **jeden** obiekt — reszta kodu nie wie, że to dwa pliki. Brak `config.yaml` = generyczne `DEFAULTS` (żadnego „pre-launch"), więc świeże repozytorium działa bez konfiguracji.

### Klucze

| Klucz | Znaczenie |
|---|---|
| `project_name` | nagłówki generowanych widoków i tytuł viewera |
| `statuses`, `archived_statuses` | workflow; `archived_statuses` decyduje, co wypada z `INDEX.yaml` do `archive/done.yaml` |
| `priorities` | **kolejność = kolejność sortowania widoków** |
| `types`, `confidence` | słowniki pól |
| `labels`, `labels_closed` | słownik labeli i to, czy jest zamknięty |
| `label_axis_timing`, `label_axis_env` | osie, z których viewer buduje facety „Faza" i „Środowisko"; **pusta oś = facet znika** |
| `roles` | KTO MOŻE wziąć task (`role:`), w odróżnieniu od `owner:` — kto go trzyma TERAZ. **Pusty słownik to ODPOWIEDŹ**, nie brak konfiguracji: projekt nie używa ról, więc niepuste `role:` w drzewie oblewa build zamiast tworzyć rolę-widmo, której żaden dyspozytor nie obsłuży |
| `owners`, `estimates` | podpowiedzi pól tekstowych (nie słownik zamknięty) |
| `actors` | podpowiedzi przełącznika „Edytuję jako" w historii zmian |
| `title_max_length` | walidacja tytułu |
| `epic_aliases` | scalanie wariantów zapisu epiku |
| `status_colors`, `priority_colors`, `label_colors`, `status_strikethrough` | prezentacja; brak wpisu = kolor z palety cyklicznej |
| `dashboard_open_statuses`, `dashboard_burndown_kind/value` | co znaczy „otwarte" i co wypala burndown |

`roles` jest jedynym słownikiem, którego PUSTA wartość coś znaczy. Każdy inny enum bez słownika `buildFieldSpecs` degraduje do wolnego tekstu — pole, którego nie da się na nic ustawić, nie jest enumem. Przy `role` wolny tekst to dokładnie ta dziura, którą pole ma zamknąć, więc zostaje enumem, w którym jedyną legalną wartością jest pusta (`dictionaryRequired` w `FIELD_SHAPES`).

**Nieznany klucz OBLEWA.** Literówka w słowniku jest nieodróżnialna od „ten projekt tak ma" — ta sama zasada, co przy nieznanej fladze w `query.mjs`.

**Niespójność między słownikami oblewa**: status archiwalny spoza `statuses`, `dashboard_open_statuses` spoza `statuses`, `default:` boarda spoza listy, duplikat sluga, label osi spoza zamkniętego słownika.

### Parser

Wąski i celowo taki: skalar, lista inline, lista blokowa, mapa blokowa. Moduł nie ma zależności, a „prawie YAML" psuje się gorzej niż parser, który po prostu nie znajdzie pola. Struktury zagnieżdżone głębiej niż jeden poziom **nie są obsługiwane** — dlatego klucze są płaskie (`dashboard_burndown_kind`, nie `dashboard: { burndown: {...} }`).

Przy okazji zniknął **trzeci** parser `boards.yaml`: ten sam kształt czytały niezależnie `build-backlog`, `build-viewer` i `check-backlog-boards`.

## 4. Jak to jest udowodnione

Trzy rodzaje dowodu, bo każdy łapie co innego:

1. **Parytet z kodem sprzed zmiany** — test sprawdza, że `config.yaml` the origin project odtwarza co do wartości słowniki, które były zaszyte. Dodatkowo: widoki wygenerowane po zmianie są **bajtowo identyczne** poza nagłówkiem, który teraz mówi nazwą projektu.
2. **Generyczność domyślnych** — test przechodzi po `DEFAULTS` i oblewa, gdy pojawi się w nich którekolwiek słowo the origin project.
3. **Bramka na wyniku** — `buildHtml()` z cudzą konfiguracją jest przeszukiwane pod kątem `pre-launch`, `test_env`, `on_queue`, `the origin project`… Ta jedna asercja łapie **każdy** nowy hardcode w viewerze, także taki, którego dziś nie ma.

Dowód end-to-end (zrobiony ręcznie 2026-08-29): katalog z `statuses: [todo, doing, review, shipped]`, `priorities: [now, next, later]`, `types: [feature, bug, chore]`, `labels: [ui, api]` uruchomiony przez `backlog --dir` — viewer pokazał tamte statusy w filtrach, na kartach i w edytorze pola, chipy statystyk mówiły `now / next / feature / bug / chore`, a facety „Faza" i „Środowisko" zniknęły, bo tamten projekt nie ma tych osi.

## 5. Czego to NIE robi

- **Nie przenosi plików.** Kod dalej mieszka w `backlog/scripts/`, dane w `backlog/`. Podział `bin/` + `lib/` przyjdzie razem z CLI.
- **Nie ma `init`** — katalog backlogu w cudzym repo trzeba dziś złożyć ręcznie (`tasks/`, `config.yaml`, `boards.yaml`).
- **Nie wydziela repozytorium** i nie tłumaczy dokumentacji.
- **Nie rusza rdzenia dashboardu** — `computeDashboard` dalej siedzi w template literalu viewera, więc jest nieuruchamialny poza przeglądarką. Jego rozbicia (godziny per faza, per typ) czytają już konfigurację, ale sama funkcja czeka na ekstrakcję; to warunek komendy `stats` w przyszłym CLI.
- **Nie zmienia `suggest-board.mjs`** poza ścieżką rejestru — reguły routingu `paths:` i tak mieszkają w `boards.yaml`, czyli w danych.

## 6. Nazwa narzędzia — wstępnie `worktrail`

Moduł ma kiedyś żyć poza tym repozytorium, a wtedy nazwa przestaje być kosmetyką: **binarka musi być wolna u każdego użytkownika**. Zmierzone 2026-08-29 na `registry.npmjs.org`:

| Pakiet | Stan | Binarka |
|---|---|---|
| `backlog` | zajęty (v1.4.56, 2026-05-10) | `backlog` |
| `backlog.md` | zajęty (v1.50.1, 2026-08-10) | `backlog` |
| `backlog-cli` | zajęty (2014, martwy) | `backlog` |

Czyli komenda `backlog` na maszynie z zainstalowanym [Backlog.md](https://github.com/MrLesk/Backlog.md) znaczy już coś innego. Stąd **`worktrail`** (npm wolne, brak kolizji w `PATH`) jako nazwa robocza: tyle samo znaków co dotychczasowa komenda, a nazywa wyróżnik — dopisywalną historię zmian pól z autorem, której nie ma żadne z sąsiednich narzędzi (`backlog.md`, `mdtask`, `taskmd`).

Stan wdrożenia: `scripts/worktrail` jest jedynym wrapperem. Alias zgodności `scripts/backlog`, skrypt `npm run backlog` i alias powłoki `backlog` zostały usunięte 2026-08-29 na decyzję foundera — dwie nazwy na jedno narzędzie utrwalałyby starą w dokumentach i pamięci mięśniowej. Nazwa **nie jest domknięta** — decyzja i ewentualna rezerwacja na npm: [TL-20](../backlog/tasks/TL-20-domknij-nazwe-narzedzia-przed-publikacja.md). Katalog `backlog/`, nazwy plików i `project_name` w konfiguracji zostały nietknięte; `project_name` opisuje BACKLOG the origin project, nie narzędzie.

## 7. Klasa buga, którą to zamyka

„Ten sam słownik w dwóch miejscach" — najczęstsza cicha usterka tego modułu. Przed zmianą lista statusów żyła w `serve-backlog.mjs`, w kliencie viewera i w README; rejestr boardów miał trzy parsery; labels the origin project były w `task-fields.mjs` **i** w CSS **i** w predykatach filtrów. Każde takie miejsce rozjeżdża się przy pierwszej zmianie słownika i nie zgłasza tego — po prostu jedna powierzchnia przestaje pokazywać wartość, którą druga akceptuje.
