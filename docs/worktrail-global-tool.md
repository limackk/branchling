# worktrail jako narzędzie globalne — katalog domowy, rejestr projektów, rozszerzalność

**Status:** PROJEKT (2026-08-30) — nic z tego nie jest wdrożone
**Dotyczy:** `backlog/` jako narzędzie `worktrail` ([TL-20](../backlog/tasks/TL-20-domknij-nazwe-narzedzia-przed-publikacja.md) — nazwa wstępna)
**Poprzednicy:** [backlog-config-and-portability.md](backlog-config-and-portability.md) (katalog danych jest argumentem), [worktrail-state-and-sync.md](worktrail-state-and-sync.md) (gdzie mieszka prawda), [backlog-time-tracking.md](backlog-time-tracking.md) (pomiar czasu — zmienia mu się lokalizacja logu)
**Taski:** [TL-33](../backlog/tasks/TL-33-packaging-instalacja-globalna-i-npx.md) · [TL-34](../backlog/tasks/TL-34-katalog-domowy-preferencje-i-rejestr-projektow.md) · [TL-35](../backlog/tasks/TL-35-surowy-log-aktywnosci-do-katalogu-domowego.md) · [TL-36](../backlog/tasks/TL-36-widok-przekrojowy-nad-wieloma-projektami.md)

---

## 1. Pytanie

Czy `worktrail` ma być narzędziem **globalnym** — zainstalowanym raz dla użytkownika, z własnym katalogiem domowym i rejestrem projektów — czy dalej modułem żyjącym wewnątrz jednego repozytorium?

Odpowiedź: **globalnym, ale wyłącznie jako program i wskaźniki. Dane tasków zostają w repozytoriach.** Ten dokument zapisuje granicę między jednym a drugim, prawa, które jej pilnują, i punkty rozszerzeń, przez które narzędzie ma rosnąć bez łamania zgodności.

## 2. Stan zastany — większość tej pracy jest zrobiona

| Zdolność | Stan | Gdzie |
|---|---|---|
| Katalog danych jest **argumentem**, nie właściwością położenia kodu | ✅ zrobione (TL-18) | `paths.mjs`: `--dir` → `BACKLOG_DIR` → wykrywanie w górę od cwd → ko-lokacja |
| Wykrywanie wymaga **znacznika**, nie samego `tasks/` | ✅ zrobione | `looksLikeBacklogDir()` — cudze repo z katalogiem `tasks/` jest częstsze, niż się wydaje |
| Kod zna KSZTAŁT, konfiguracja zna WARTOŚCI | ✅ zrobione (TL-19) | `config.yaml`, nieznany klucz OBLEWA |
| `init` do cudzego katalogu, bez zgadywania i bez nadpisywania | ✅ zrobione (TL-23) | `init --dir` obowiązkowe, istniejący plik pomijany i raportowany |
| **Instalacja** — `package.json`, `bin/`, `npx worktrail` | ❌ **BRAK** | dokumentacja obiecuje `npx worktrail`, a moduł nie jest instalowalny |
| Katalog domowy użytkownika, rejestr projektów | ❌ brak | żadnego `homedir()` ani `XDG_` w całym module |

> Wniosek: „zrobienie z tego narzędzia globalnego" to w 80% **spakowanie tego, co już działa**, a nie przebudowa. Jedyny twardy brak na tej drodze to packaging.

## 3. Cztery prawa

Rozszerzalność bierze się z niewielkiej liczby reguł, które trzymają się przy każdej nowej funkcji — nie z API wtyczek. Te cztery są kontraktem tego modułu i każda przyszła zmiana ma się o nie opierać.

### Prawo 1 — dane w repozytorium, wskaźniki globalnie

Taski, historia pól i konfiguracja projektu mieszkają w repo, przy kodzie. Katalog domowy trzyma **wyłącznie**: preferencje użytkownika, rejestr ścieżek do projektów i dane prywatne dla maszyny (§6).

Dlaczego nie odwrotnie: task w gicie jedzie z gałęzią, przechodzi przez review w PR, klonuje się razem z repozytorium, a `git log` na jego pliku jest jego historią. Przeniesienie tasków do `~/.worktrail/projects/foo/` daje dokładnie tę wadę, dla której [worktrail-state-and-sync.md §4.3](worktrail-state-and-sync.md) odrzucił Jirę i Lineara: **stan rozwiedziony z gałęzią**. To, że pliki byłyby lokalne zamiast w cudzej chmurze, zmienia tylko właściciela rozjazdu, nie sam rozjazd.

### Prawo 2 — co wyliczone, wolno skasować

Widoki (`INDEX.yaml`, `NOW.yaml`, `boards/`), przyszły indeks SQLite, rejestr projektów, agregaty aktywności — **każde z nich musi dać się skasować bez utraty czegokolwiek**. Odtworzenie jest komendą, nie odzyskiwaniem.

To jest test poprawności, nie deklaracja: jeśli skasowanie rejestru boli, znaczy że rejestr zdążył zostać prawdą, i wtedy błąd jest w projekcie, a nie w użytkowniku, który go skasował.

**Wyliczone to nie to samo co odtwarzalne** (TL-86). Odhaczony checkbox w `## Acceptance criteria` jest WYLICZONY — stawia go narzędzie po zielonym przebiegu `verification`, nie człowiek — a mimo to jedzie do wersjonowanego pliku i nie wolno go skasować. To nie jest wyłom w tym prawie, tylko granica, po której ono biegnie: widok da się **odtworzyć z tasków jedną komendą**, a wynik przebiegu, który już się odbył, da się odtworzyć wyłącznie przez ponowne uruchomienie — przeciw drzewu, które w międzyczasie się ruszyło. To nie jest to samo pytanie i nie ma tej samej odpowiedzi.

Kryterium rozstrzygające brzmi więc: *czy do odtworzenia tego wystarczą pliki tasków?* Jeśli tak — to widok, kasuj do woli. Jeśli potrzeba jeszcze CZASU, w którym coś zaszło — to zapis zdarzenia, tej samej klasy co linia w `## Log` albo wpis w historii pól, i podlega prawu 1, nie prawu 2.

### Prawo 3 — warstwa dokłada tylko to, czego druga nie może wiedzieć

Dwie warstwy konfiguracji to gwarantowany rozjazd, o ile obie mogą mówić o tym samym. Granica jest więc **rozłączna, nie priorytetowa**:

| Warstwa | Trzyma | Przykłady |
|---|---|---|
| **użytkownik** (`~/.worktrail/config.yaml`) | to, co jest faktem o CZŁOWIEKU i jego maszynie | tożsamość aktora, edytor, motyw, domyślny port, format daty |
| **projekt** (`<repo>/backlog/config.yaml`) | to, co jest faktem o PROJEKCIE | statusy, priorytety, typy, labels, boardy, kolory, `title_max_length` |

**Warstwa użytkownika nie ma prawa nadpisać słownictwa projektu.** Gdyby mogła, dwie osoby zobaczyłyby różne boardy dla tego samego repozytorium, a moduł właśnie skończył wyprowadzać te wartości do `config.yaml` po to, żeby były jedną prawdą. Klucz zadeklarowany w złej warstwie **OBLEWA**, tak jak dziś oblewa nieznany klucz — literówka w warstwie jest nieodróżnialna od „ten projekt tak ma".

### Prawo 4 — rozszerzalność przez kompozycję, nie przez API wtyczek

API wtyczek to kontrakt zgodności, którego nie da się złamać po pierwszym zewnętrznym użytkowniku, a utrzymuje go jedna osoba. Zamiast tego:

- **każda komenda czytająca ma `--json`** — to jest powierzchnia rozszerzeń. Od TL-72 odpowiedź jest KOPERTĄ (`schemaVersion`, `kind`, ładunek), a nie gołą tablicą: goła tablica nie ma gdzie pomieścić metadanych, więc każde dołożenie pola byłoby zerwaniem kontraktu. Kształt kopert deklaruje `scripts/json-envelope.mjs`, kontrakt spisuje README;
- **każda komenda pisząca ma postać wywoływalną z zewnątrz** (`activity record`, `new`, `set`), więc cudzy skrypt, hook czy inny host zasila `worktrail` bez wiedzy o jego wnętrzu;
- słownik podkomend (`COMMANDS` w `cli.mjs`) pozostaje **zamknięty**, bo nieznana komenda ma oblewać, a nie milczeć.

Efekt: integracja z WakaTime, cudzym CI czy dowolnym edytorem jest skryptem nad stabilnym wejściem/wyjściem, a nie wtyczką w cudzym procesie. Wersja płatna/hostowana z [worktrail-state-and-sync.md §6](worktrail-state-and-sync.md) wchodzi tą samą drogą.

## 4. Rozbicie pomysłu — dwie rzeczy dobre, jedna zła

| Składnik | Werdykt | Powód |
|---|---|---|
| Globalny binarny (`npm i -g`, `npx`) | ✅ TAK | brakujący element; wymagany i tak do publikacji |
| `~/.worktrail/` — preferencje + rejestr **wskaźników** | ✅ TAK | odblokowuje widok przekrojowy i atrybucję pomiaru czasu |
| Taski przeniesione do katalogu domowego | ❌ NIE | łamie Prawo 1 |

### 4.1. Czego rejestr NIE kupuje

**Nie kupuje „znajdowania backlogu".** Wykrywanie w górę od cwd już to robi i robi dobrze. Rejestr zbudowany po to byłby drugą odpowiedzią na pytanie, które ma już jedną — czyli dokładnie tym rozjazdem, przed którym ostrzega Prawo 3.

### 4.2. Co rejestr kupuje naprawdę

1. **Widok przekrojowy** — „nad czym pracuję we wszystkich projektach". Dziś niemożliwy, bo żadne miejsce nie wie, że projektów jest więcej niż jeden.
2. **Atrybucję pomiaru czasu poza repo.** Heartbeat z [TL-28](../backlog/tasks/TL-28-heartbeaty-aktywnosci-i-lancuch-atrybucji.md) musi wiedzieć nie tylko *który task*, ale *który projekt*. Bez rejestru `activity record` wymaga `--dir` przy każdym wywołaniu; z rejestrem mapuje cwd → projekt.
3. **Prywatność surowego logu aktywności** — §6. To jest najmocniejszy pojedynczy argument za katalogiem domowym.

## 5. Gdzie ten katalog leży

Nie `~/.worktrail` na sztywno. Kolejność, spójna z tym, czego użytkownicy Linuksa oczekują, a reszty nie boli:

```
1. WORKTRAIL_HOME                                  → jawnie, wygrywa wszystko (i to jest hak testowy)
2. $XDG_CONFIG_HOME/worktrail  + $XDG_DATA_HOME/worktrail   → gdy zmienne ustawione
3. ~/.config/worktrail + ~/.local/share/worktrail    → Linux/macOS domyślnie
4. %APPDATA%\worktrail                             → Windows
```

Rozdział **config vs data** jest tu istotny, nie kosmetyczny: preferencje to plik, który człowiek edytuje i backupuje, a log aktywności to dane maszyny, których nie chce mieć w dotfile'ach.

Nazwa katalogu pochodzi z **jednej stałej**, bo `worktrail` jest nazwą wstępną ([TL-20](../backlog/tasks/TL-20-domknij-nazwe-narzedzia-przed-publikacja.md)) — zmiana nazwy narzędzia nie może wymagać przeszukiwania kodu.

## 6. Surowy log aktywności przenosi się do katalogu domowego

[backlog-time-tracking.md §5](backlog-time-tracking.md) umieszcza go dziś w `backlog/activity/` i broni gitignorem. To działa, dopóki nikt nie zrobi `git add -A` w cudzym repozytorium — a wtedy prywatne stemple czasu jednej osoby trafiają do publicznej historii i **nie da się ich stamtąd usunąć**.

W katalogu domowym ten wypadek jest **niemożliwy**, a nie tylko odradzany:

```
<data>/activity/<projekt>/BL-NNNN.jsonl   ← surowe heartbeaty, poza jakimkolwiek repo
<repo>/backlog/activity/rollup/BL-NNNN.json ← agregat per task, wersjonowany (bez zmian)
```

Podział ról zostaje ten sam co w projekcie pomiaru: surowe zostaje przy człowieku, agregat jedzie z projektem. Zmienia się tylko to, że „zostaje przy człowieku" przestaje zależeć od poprawnego `.gitignore`. Zakres: [TL-35](../backlog/tasks/TL-35-surowy-log-aktywnosci-do-katalogu-domowego.md).

## 7. Rejestr projektów — indeks, nie prawda

```yaml
# <config>/projects.yaml
projects:
  - name: origin
    path: /Users/x/workspace/origin/backlog
  - name: acme-api
    path: /Users/x/code/acme/backlog
```

Reguły, wszystkie wynikające z Prawa 2:

- **Wpis jest rewalidowany przy użyciu** (`looksLikeBacklogDir()`), nigdy przyjmowany na wiarę.
- **Brakująca ścieżka jest RAPORTOWANA, nie pomijana po cichu.** Cichy skip zamienia „przeniosłeś repo" w „ten projekt nie ma tasków", a to jest ten sam kształt błędu co cichy no-op w CLI.
- **Skasowanie `projects.yaml` jest nieszkodliwe** — komendy w repo działają dalej przez wykrywanie; ginie tylko widok przekrojowy. To jest test Prawa 2.
- **`init` rejestruje projekt**, ale rejestracja nie jest warunkiem działania.
- Nazwa projektu jest **lokalna dla użytkownika** (jego etykieta na jego maszynie), nie tożsamością projektu. Tożsamością jest ścieżka repo; dwie osoby mogą nazwać ten sam projekt inaczej i nic z tego nie wynika.

## 8. Przypadek brzegowy, który trzeba przetestować: workspace wielorepozytoryjny

Ten workspace jest nim: root to repozytorium **bez remote'a** trzymające `backlog/`, a w środku dziewięć osobnych repozytoriów z własnym `.git`. Uruchomienie `worktrail` z sub-repo wchodzi w górę i trafia w backlog workspace'u — i **tak ma być**.

Naiwny rejestr z założeniem „jedno repo = jeden projekt" rozjechałby się z tym układem, dając dziewięć projektów bez backlogu i jeden z nim. Stąd wymóg: jednostką rejestru jest **katalog backlogu**, nie repozytorium git. Test na tym układzie jest obowiązkowy, bo to nie jest egzotyka — monorepo i workspace'y wielorepozytoryjne są częstsze niż pojedyncze repo z jednym `.git` na wierzchu.

## 9. Kolejność

| Krok | Task | Co dowozi | Ryzyko |
|---|---|---|---|
| 1 | [TL-33](../backlog/tasks/TL-33-packaging-instalacja-globalna-i-npx.md) | `package.json` + `bin/` + `npx worktrail` | niskie, niczego nie przesądza |
| 2 | [TL-34](../backlog/tasks/TL-34-katalog-domowy-preferencje-i-rejestr-projektow.md) | katalog domowy, preferencje, rejestr | średnie — Prawo 3 jest tu do złamania |
| 3 | [TL-35](../backlog/tasks/TL-35-surowy-log-aktywnosci-do-katalogu-domowego.md) | surowe stemple poza repo | zależy od TL-28 |
| 4 | [TL-36](../backlog/tasks/TL-36-widok-przekrojowy-nad-wieloma-projektami.md) | widok nad wieloma projektami | jedyny krok zmieniający produkt |

Kroki 1–3 zdejmują z drogi rzeczy, które i tak blokują publikację. Krok 4 jest jedynym, który daje użytkownikowi coś nowego — i dlatego jest ostatni, a nie pierwszy.

## 10. Czego świadomie NIE robimy

- **Demona w tle.** Rejestr i heartbeaty nie wymagają procesu rezydentnego; wprowadzenie go dokłada cykl życia, logi, restart i awarie, żeby oszczędzić odczyt pliku YAML.
- **Synchronizacji katalogu domowego między maszynami.** To jest ten sam problem, który [worktrail-state-and-sync.md §6](worktrail-state-and-sync.md) przypisuje wersji hostowanej. Lokalnie: katalog domowy jest lokalny i tyle.
- **API wtyczek** — Prawo 4.
- **Migracji istniejących instalacji.** Nie ma zewnętrznych użytkowników; jedyną instalacją jest ta. Kiedy będą, migracja stanie się osobnym taskiem z prawdziwym kontraktem.
- **Hooka pre-commit w TYM repozytorium** (decyzja 2026-08-31). Kuszące przez symetrię z konsumentem, ale symetria to zły powód. Sprawdzian, który tę propozycję obalił: z czterech błędów popełnionych w sesji, w której ją zgłoszono, **żadnego** nie złapałaby żadna z trzech bramek `check` — bo psuły się proza, regex, linki i nieśledzone pliki, a nie kolizje ID, boardy czy odwołania. U konsumenta te bramki zarabiają na siebie skalą (1363 taski, siedem równoległych worktree'ów, cztery kolizje ID, które przeżyły w `main` miesiące); tutaj jest 45 tasków i jeden piszący.

  **Warunek, przy którym ta decyzja się odwraca — jeden i konkretny:** gdy w tym drzewie zacznie pisać więcej niż jedna sesja naraz. Kolizja ID powstaje wyłącznie tak: dwie sesje pytają o numer, obie dostają ten sam. Do tego czasu `worktrail check` jest jedną komendą i człowiek widzi jej wynik.

  To **nie jest** decyzja o bramkach w produkcie — one już są w paczce (§10.1).

### 10.1. Trzy różne rzeczy, które łatwo pomylić z jedną

Rozróżnienie zapisane, bo w rozmowie 2026-08-31 zlało się w jedno słowo „bramki":

| | Gdzie żyje | Kto to dostaje |
|---|---|---|
| **Kod bramek** — `check-backlog-{id-collisions,boards,refs}.mjs` | `scripts/`, objęte `files` w `package.json` | **każda instalacja**, jako `worktrail check` |
| **`.githooks/pre-commit` konsumenta** | repozytorium konsumenta | nikt poza nim; z ~25 kroków dwa wołają `worktrail check` |
| **Hook dogfoodingowy tutaj** | byłby w tym repo, POZA paczką | tylko ten, kto klonuje źródło — świadomie nie robimy (§10) |

Wniosek, który z tego wynika i jest osobną decyzją produktową: skoro bramki jadą do każdej instalacji, a hook — do żadnej, to brakującym elementem nie jest hook u nas, tylko **umiejętność narzędzia, żeby zainstalować hooka SWOJEMU użytkownikowi**. Ten problem ma każdy, nie my. Zapisane jako TL-46.

## 11. Założenia do obalenia

1. **Że rejestr będzie miał więcej niż jeden wpis.** Dziś projekt jest jeden. Jeśli po kwartale nadal jest jeden, krok 4 nie miał odbiorcy i lepiej go nie budować — a kroki 1–3 bronią się same.
2. **Że wykrywanie w górę od cwd wystarcza w praktyce**, więc rejestr nigdy nie stanie się drogą główną. Falsyfikacja: jeśli komendy zaczną wymagać `--project`, znaczy że rejestr po cichu został prawdą i Prawo 2 zostało złamane.
3. **Że rozdział config/data (§5) nikogo nie zdziwi.** Prostsze `~/.worktrail/` dla wszystkiego jest łatwiejsze do wytłumaczenia; XDG jest poprawniejsze. Jeśli pierwsze zgłoszenia będą o „gdzie to w ogóle jest", odpowiedzią jest `worktrail where`, a nie porzucenie XDG.
