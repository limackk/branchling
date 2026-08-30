# Backlog — edycja pól i historia zmian

**Status:** IMPLEMENTED 2026-08-29 ([TL-16](../backlog/tasks/TL-16-edycja-kazdego-pola-taska-w-viewerze.md), [TL-17](../backlog/tasks/TL-17-historia-zmian-pol-taska-z-autorem.md))
**SSOT kodu:** `backlog/scripts/task-fields.mjs`, `backlog/scripts/history.mjs`, `backlog/scripts/serve-backlog.mjs`, `backlog/scripts/build-viewer.mjs`
**Testy:** `node --test backlog/scripts/tests/task-fields.test.mjs backlog/scripts/tests/history.test.mjs`

---

## 1. Cel

Dwie rzeczy, które backlog dotąd miał tylko w połowie:

1. **Edycja** — viewer umiał zmienić wyłącznie `status`. Każde inne pole (priorytet, owner, estymata, labels, epic, board, blocked_by, related_docs, tytuł) wymagało otwarcia `.md` w edytorze.
2. **Atrybucja** — plik taska mówi, *jaki jest stan*, ale nie *kto go ustawił*. Sekcja `## Log` jest ręczna i wypełniana nieregularnie, a `git blame` nie odpowiada na pytanie „kto zmienił priorytet tego taska", bo commit obejmuje zwykle kilkanaście plików i kilka pól naraz. Przy jednym founderze to niedogodność; przy founderze + agentach + kolejnych ludziach to brak dowodu.

Docelowo: kliknięcie w dowolne pole je edytuje, a przy polu widać, **kto** i **kiedy** zmienił je ostatnio.

---

## 2. Model danych

```
backlog/history/BL-NNNN.jsonl    ← append-only, WERSJONOWANE w gicie
backlog/history/.snapshot.json   ← ostatnio widziany frontmatter (gitignored)
backlog/history/.migrations.jsonl ← zmiany prefiksu ID, WERSJONOWANE (TL-111)
```

Jeden wiersz = jedna zmiana jednego pola:

```json
{"ts":"2026-08-29T13:17:10.970Z","task":"TASK-9999","field":"status",
 "from":"pending","to":"in_progress","actor":"local:founder","source":"viewer"}
```

- `from` / `to` — string albo tablica (pola listowe: `labels`, `blocked_by`, `blocks`, `related_docs`).
- `field` — klucz frontmattera albo pseudo-pole zdarzenia taska: `__created__`, `__deleted__`, `__verified__`, `__role_override__`, `__comment__`.
- `actor` — **`<przestrzeń>:<nazwa>`** (TL-21): `local:` zadeklarowany i niezweryfikowany, `agent:` zapis automatyczny, `user:` konto uwierzytelnione; `unknown` to jedyna wartość bez przestrzeni. **Słownik nazw jest OTWARTY** — walidujemy kształt, nie przynależność do listy — ale przestrzeń jest ZAMKNIĘTA i kod jej nie zgaduje: goła nazwa w nowym zapisie ląduje jako `unknown`. Wpisy sprzed TL-21 zostają nietknięte i przy odczycie dostają przestrzeń `legacy`. Model docelowy: [worktrail-state-and-sync.md](worktrail-state-and-sync.md) §7 krok 4.
- `id` — ULID (TL-21). Sortowanie po nim jest sortowaniem po czasie, więc jest gotowym kursorem synchronizacji; `readHistory()` deduplikuje po nim wpisy, które union-merge mógł wstawić dwa razy.

**`__created__` i `__deleted__` są ZDARZENIAMI TASKA, nie zmianami pola** (TL-39), i mają własną regułę deduplikacji przy odczycie:

- **Kluczem jest zdarzenie, nie zapis.** Jedno założenie taska ma dać jeden wpis, ilu by go obserwatorów nie zobaczyło. Dedup po `id` tego nie łapie, bo ULID identyfikuje ZAPIS — dwa zapisy o tym samym zdarzeniu mają różne ULID-y z definicji.
- **Kluczem nie jest `task + field + to`.** Przy `__created__` wartością `to` jest tytuł, a tytuł bywa zmieniony między jednym obserwatorem a drugim; wtedy duplikat przeszedłby bramkę opartą o treść.
- **Ale nie „najwyżej jedno na task".** Task skasowany i założony ponownie ma DWA prawdziwe założenia. Duplikatem jest powtórzenie, które nie zmienia stanu: sąsiadujące w czasie wpisy tego samego rodzaju, bez zdarzenia przeciwnego pomiędzy.
- **Przy duplikacie wygrywa wpis LEPIEJ PRZYPISANY** (`local:`/`agent:`/`user:` bije `unknown`), a przy remisie wcześniejszy. „Ostatni zapis wygrywa" byłoby tu najgorszym wyborem: drugi obserwator z definicji wie mniej niż ten, który zdarzenie widział.
- **Zwykłe pola tej reguły NIE mają.** Dwa przejścia `pending → in_progress` w różnym czasie to dwa zdarzenia; deduplikacja po wartości zjadałaby prawdziwą historię.
- **`__comment__` też jej nie ma, i to jest decyzja** (TL-99). Komentarz jest pseudo-polem, ale nie zdarzeniem taska: dwa razy to samo zdanie w różnym czasie to dwie wypowiedzi, a zjedzenie drugiej byłoby redagowaniem cudzej rozmowy. Zostaje sam dedup po `id`, ten sam co wszędzie. Całą treścią komentarza jest `to`; `from` jest puste, bo komentarz niczego nie zastępuje.
- `source` — którą drogą przyszła zmiana: `viewer` | `hook` | `external` | `boot` | `cli`. To jest metadana o wiarygodności `actor`, nie ozdoba (§4).

### Dlaczego JSONL per task, a nie jeden plik / SQLite / git

| Opcja | Odpada, bo |
|---|---|
| Jeden `history.jsonl` | Dwie sesje edytujące różne taski konfliktują w gicie w tej samej linii; odczyt historii jednego taska czyta całą historię backlogu (1350+ tasków). |
| SQLite | Backlog jest z założenia plikowy i wersjonowany razem z kodem (README §1). Baza binarna zabiera diff, code review i `grep`. |
| Sam `git log` | Nie wymaga niczego nowego, ale commit to zła jednostka: obejmuje wiele plików i wiele pól, a autor commita ≠ autor pola (agent commituje jako founder). Do **backfillu** historii sprzed tego mechanizmu git zostaje jedynym źródłem — patrz §6. |
| Sekcja `## Log` w `.md` | Była narracją („dlaczego"), ręczną i nieparsowalną maszynowo. Zniesiona w TL-105 przy zerowej adopcji: powód jedzie z ZAPISEM, w polu `reason`. Sekcje w starych taskach zostają. |

Snapshot (`.snapshot.json`) **nie jest źródłem prawdy** — to punkt odniesienia do diffa, odtwarzalny z plików tasków. Dlatego jest gitignored: gdyby wjechał do repo, każdy `git pull` produkowałby konflikt na pliku, którego nikt nie czyta.

`.migrations.jsonl` (TL-111) jest odwrotnością snapshotu: WERSJONOWANY, bo jego czytelnikiem jest KAŻDY klon. Jeden wiersz = jedna zmiana prefiksu ID:

```json
{"id":"01K…","ts":"2026-09-01T07:13:34.277Z","kind":"prefix",
 "from":"BL","to":"TL","actor":"local:founder","source":"migrate-prefix"}
```

Bez tego zapisu `migrate-prefix` był dla historii **skasowaniem całego backlogu i założeniem go od nowa**: snapshot zostawał na starych kluczach, a najbliższa rekoncyliacja uczciwie meldowała 74 zniknięcia i 74 nowe taski. Zmierzone w tym repozytorium: 42 pliki `history/BL-*.jsonl` z jednym rekordem `__deleted__`, wszystkie z jednego przebiegu. Ponieważ `history/*.jsonl` jedzie w gicie z regułą `merge=union`, nagrobki byłyby trwałe — a każdy wiek i tempo policzone z takiego logu wskazywałyby dzień migracji jako dzień narodzin backlogu.

Odrzucono ROZPOZNAWANIE migracji przez rekoncyliację („znikło `X-N`, pojawiło się `Y-N` o tej samej treści"): to zgadywanie, a ten mechanizm deklaruje uczciwość zamiast zgadywania (§4). Równość treści jest dokładnie tym, czego migracja nie gwarantuje — renumeracja w jednym commicie z edycją psuje dopasowanie, a dwa niezwiązane taski o tym samym numerze i tytule je fałszywie spełniają. Rekord jest FAKTEM do odczytania, nie heurystyką.

Klucz snapshotu przenosi się **tylko wtedy, gdy stary task zniknął z drzewa, a nowy w nim jest** — dzięki temu klon, który ma rekord, ale nie ma jeszcze przemianowanych plików (starszy checkout, migracja przerwana w połowie), nie wyprodukuje właśnie tej pary nagrobków, a przerwana migracja domyka się przy następnym przebiegu.

---

## 3. Trzy drogi zapisu, jedna definicja pola

Wszystko, co wie „czym jest pole taska", siedzi w `task-fields.mjs`: lista pól edytowalnych, ich typy, słowniki wartości, walidacja, zapis do frontmattera i porównanie dwóch wersji. Ten sam plik:

- waliduje żądania w `serve-backlog.mjs`,
- jest **wklejany źródłem** do wygenerowanego viewera (jak `viewer-url.mjs` od TL-15), więc przeglądarka rysuje edytory z tej samej schemy i nie może wysłać wartości, którą serwer odrzuci,
- jest uruchamiany przez `node --test`.

Konsekwencja praktyczna: **nowe pole albo nowy status dodaje się w jednym miejscu.** Wcześniej lista statusów żyła w trzech (server, viewer, README) — przy tej zmianie zostały zredukowane do jednej.

### 3.1 Viewer (autor: znany)

`POST /api/field {id, field, value, actor}` → walidacja → zapis `.md` → `updated: <dziś>` → wpis w historii → `build-backlog.mjs` (regeneracja NOW/INDEX/archive).

Historia powstaje z porównania stanu **sprzed zapisu** ze stanem **odczytanym po zapisie z pliku**, a nie z tego, co przysłała przeglądarka — wpis opisuje to, co naprawdę wylądowało na dysku.

`POST /api/status` został aliasem tej samej funkcji. Dwa endpointy piszące frontmatter oznaczałyby dwa miejsca decydujące o walidacji, o `updated:` i o historii.

### 3.2 Agent (autor: znany)

Hook `PostToolUse` (`worktrail regen-hook`) po każdym Edit/Write na `backlog/tasks/BL-*.md` woła:

```bash
node backlog/scripts/history-record.mjs --file <plik> --actor claude --source hook
```

To **jedyny moment, w którym system wie na pewno**, że task zmienił agent — sam plik tego nie mówi. `$BACKLOG_ACTOR` nadpisuje autora, gdy hook odpala kto inny.

### 3.3 Reszta świata (autor: `unknown`)

Serwer viewera obserwuje `tasks/` (`fs.watch`) i 2,5 s po zmianie robi rekoncyliację: diff wszystkich tasków wobec snapshotu, wpisy z `actor: "unknown"`, `source: "external"`. To łapie edytor, `git checkout`, `git pull` i agenta pracującego bez hooka. Ten sam przebieg leci przy starcie serwera (`source: "boot"`) — domyka lukę „serwer był wyłączony".

Opóźnienie 2,5 s jest po to, żeby hook agenta zdążył zapisać wpis **pierwszy**; wtedy rekoncyliacja nie widzi już różnicy i milczy. Kolejność, nie zgadywanie: „skoro nie viewer, to pewnie agent" dałoby wpisy podpisane kimś, kto ich nie zrobił.

---

## 4. Czego ten mechanizm NIE gwarantuje

Historia jest **dziennikiem obserwacji lokalnego narzędzia**, nie logiem audytowym. Świadome ograniczenia:

1. **`unknown` znaczy `unknown`.** Serwer widzi zmieniony bajt, nie rękę. Pole `source` mówi, ile warta jest atrybucja: `viewer`/`hook` = autor deklarowany przez proces, który wie; `external`/`boot` = nikt nie widział.
2. **Aktor w viewerze to deklaracja, nie uwierzytelnienie.** Przełącznik „Edytuję jako founder/claude" ustawia podpis; nie ma logowania ani sesji. Przy jednym userze na loopbacku to adekwatne — przy wielu trzeba tożsamości (§7).
3. **Zmiany przy wyłączonym serwerze i bez hooka trafiają do historii dopiero przy następnym starcie serwera**, zbiorczo i jako `unknown`. Nie giną, ale tracą i czas, i autora.
4. **Snapshot jest lokalny.** Świeży klon nie ma snapshotu → pierwszy przebieg tylko go zakłada i **nie dopisuje ani jednego wpisu**. To decyzja: 1350 zmyślonych „zmian" w dniu pierwszego uruchomienia byłoby gorsze niż brak historii sprzed niego.
5. **Nie wersjonujemy treści body.** Historia dotyczy frontmattera. Zmiany sekcji `## Cel`, `## Kroki` itd. zostają w gicie — pola są tym, po czym backlog filtruje, planuje i liczy dashboard.
6. **Snapshot jest lokalny, historia wspólna — i to trzeba było uzgodnić.** Task albo zmiana przyniesiona `git merge`/`git pull` nie istnieje w TWOIM snapshocie, więc rekoncyliacja brała ją za nową i zapisywała drugi raz — do tego samego, wersjonowanego pliku (zmierzone 2026-08-29 na `TL-18.jsonl` po merge'u worktree do `main`: dwa `__created__` o tej samej treści). Naprawione u przyczyny: zanim rekoncyliacja cokolwiek zapisze, pyta plik historii, co już wie — brak taska w snapshocie przy NIEPUSTEJ historii znaczy „przyszedł z zewnątrz", a zmiana pola, której `to` równa się ostatniemu zapisanemu wpisowi, jest pomijana. Świadoma cena: gdy ktoś ustawi lokalnie tę samą wartość, którą już ktoś inny zapisał, wpis nie powstanie drugi raz — stan i tak się zgadza, a autor pierwszego zapisu zostaje.
7. **Bramka na ZAPISIE nie wystarcza, bo jej przesłanka podróżuje osobnym kanałem.** Rekoncyliacja pyta plik historii, zanim dopisze `__created__` (punkt 6) — i działa, kiedy ma co czytać. `.md` jedzie gitem zawsze, `.jsonl` tylko wtedy, gdy ktoś go zacommitował; zmierzone 2026-08-31 w repozytorium konsumenta: 28 z 71 logów historii było nieśledzonych. Dlatego druga warstwa siedzi przy ODCZYCIE (§2) i działa też wtedy, gdy oba wpisy już powstały.
8. **Nie ma undo.** Wpis mówi, co było wcześniej; przywrócenie to zwykła edycja (która zapisze kolejny wpis).

---

## 5. UI

Detal taska renderuje wiersz per pole ze specu `EDITABLE_FIELDS`:

- **klik / Enter / Spacja** na wartości otwiera edytor odpowiedni dla typu: `select` (enum), `input` + datalist (tekst z podpowiedziami z realnych danych), checkboxy (labels — słownik zamknięty), textarea „jedna wartość na linię" (blocked_by / blocks / related_docs). **Esc** anuluje.
- przy etykiecie pola stoi znacznik **`autor · kiedy`** ostatniej zmiany; kliknięcie zawęża listę historii do tego pola.
- pod siatką pól: **Historia zmian (N)** — oś czasu od najnowszej: data, aktor, `pole: stara → nowa`, źródło.
- zapis jest optymistyczny i **cofa się do stanu poprzedniego, gdy serwer odrzuci** — pokazany stan ma zawsze odpowiadać plikowi.

**Edycja działa wyłącznie w trybie serwera** (`backlog` w terminalu). W trybie `file://` pola są tylko do odczytu, a historia widoczna (wbudowana w build). Powód: druga ścieżka zapisu przez File System Access API oznaczałaby drugi komplet reguł walidacji, drugie miejsce znające historię i regenerację widoków — przy pierwszej zmianie schemy rozjechałyby się po cichu. Przy okazji zniknęła istniejąca wcześniej duplikacja zapisu statusu (fetch + FS Access).

---

## 6. Backfill historii sprzed mechanizmu — świadomie NIE zrobiony

Da się odtworzyć historię pól z gita: `git log -p --follow backlog/tasks/BL-*.md`, diff frontmattera commit po commicie, `actor` z autora commita. Nie robimy tego teraz, bo:

- autor commita w tym repo to **zawsze founder**, także dla pracy agentów — backfill wyprodukowałby 1350 tasków „zmienionych przez foundera", czyli atrybucję ładną i nieprawdziwą;
- data commita ≠ data zmiany (praca bywa commitowana zbiorczo).

Gdyby backfill był potrzebny, jedyną uczciwą formą jest `actor: "unknown"`, `source: "git"` i `ts` commita. Warunkiem sensu jest wcześniejsze rozróżnianie autorów w commitach (np. trailer `Co-Authored-By`) — dopóki go nie ma, wynik nie niesie informacji, której szukamy.

---

## 7. Droga do wielu użytkowników

Kolejność kroków, gdy dojdą realni użytkownicy poza founderem i agentami:

1. **Rejestr aktorów** — `backlog/actors.yaml` (slug, nazwa, typ `human|agent`), guard pre-commit odrzucający wpis z aktorem spoza rejestru. Schema wpisu się nie zmienia; dochodzi walidacja przynależności.
2. **Tożsamość zamiast deklaracji** — przestrzeń nazw (`local:` vs `user:`) jest już w schemacie od TL-21, ale nikt jej nie EGZEKWUJE: serwer nadal ufa polu `actor` z żądania. Domknięcie: bierze je z sesji (choćby z nagłówka ustawianego przez reverse proxy albo z `git config user.email` przy dostępie lokalnym). Dopiero to zamienia dziennik w log audytowy.
3. **Historia jako źródło dla dashboardu** — mając `ts` przejść statusu, dashboard przestaje liczyć „ukończone dnia X" z `status: done` + `updated:` (dziś udokumentowane jako przybliżenie — patrz komentarz w `build-viewer.mjs`) i zaczyna liczyć z realnych przejść.
4. **Presence / konflikt zapisu** — przy równoległej edycji dwóch osób dochodzi test „czy plik zmienił się od odczytu" (ETag/mtime) i odmowa nadpisania. Dziś ostatni zapis wygrywa, co przy jednym userze jest właściwym uproszczeniem.

---

## 8. Klasy błędów, które ten mechanizm już złapał

- **Jedno zdarzenie, po jednym wpisie na obserwatora.** Task założony w worktree zapisywał `__created__` u siebie; drugi checkout, który tego wpisu nie miał, uznawał task za nowy i zapisywał własny — jako `unknown`/`external`. Trzy wystąpienia (TL-33, BL-1445, BL-1446), ostatnie **bez żadnego merge'a**: wystarczył drugi obserwator tego samego pliku. Każde znalezione ręcznie, żadne testem — mechanizm nie miał na tę klasę bramki, bo dedup po `id` z definicji jej nie widzi.
- **Zapis pola listowego kasował sąsiedni klucz.** Naiwne „podmień linię" przy `related_docs:` (lista blokowa) zjadało blok `verification:` poniżej. Test `lista blokowa nie zjada następnego klucza` pilnuje tego wprost; to ta sama klasa co „kotwica `replace` obejmująca sąsiada" — dopasowanie szersze niż zamierzone kasuje blok, którego nikt nie czytał.
- **Pętla render → fetch → render.** `renderDetail()` dociągał historię, a odpowiedź wywoływała `renderDetail()` — kasowało to otwarty edytor w trakcie pisania i biło w serwer bez końca. Historia jest teraz dociągana raz na task i przerysowuje widok tylko, gdy naprawdę się zmieniła.
- **Backslash w kodzie wklejanym do template literala.** Kod klienta viewera żyje w JS-owym template literalu — `\n` albo `\'` napisane wprost są zjadane przy generowaniu strony. Moduły wklejane **źródłem** (jak `task-fields.mjs`) tego problemu nie mają, bo są interpolowane, a nie parsowane; kod pisany w literale musi podwajać backslashe.
