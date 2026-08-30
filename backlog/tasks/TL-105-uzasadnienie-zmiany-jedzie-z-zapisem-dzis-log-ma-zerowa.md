---
id: TL-105
title: "Uzasadnienie zmiany jedzie z zapisem — dziś ## Log ma zerową adopcję"
type: code
labels: [pre-launch]
board: main
epic: "Historia i atrybucja"
priority: P1
status: done
owner: agent:claude
estimate: 4h
confidence: medium
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-field-editing-history.md
verification:
  - id: reason-contract
    bash: "node --test scripts/tests/change-reason.test.mjs"
  - id: guard-wired
    bash: "node scripts/cli.mjs check | grep -q 'reasons:'"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: log-section-gone
    bash: "grep -q '## Log' _template.md && { echo 'szablon nadal uczy ## Log'; exit 1; }; grep -rq '## Log' .claude/skills/backlog-workflow/SKILL.md && { echo 'skill nadal uczy ## Log'; exit 1; }; echo 'szablon i skill nie uczą ## Log — OK'"
---

## Cel

Powód zmiany jest zapisywany razem ze zmianą, w strukturze, którą da się
odpytać — a nie w sekcji prozy, której nikt nie wypełnia. Po tym tasku pytanie
„dlaczego ten task został anulowany" ma odpowiedź w danych, nie w pamięci
człowieka, który już nie pamięta.

## Kontekst

`history/*.jsonl` zapisuje CO się zmieniło: `field`, `from`, `to`, `actor`,
`source`, `ts`. Nie ma miejsca na DLACZEGO. Uzasadnienia miały mieszkać w
`## Log` (szablon deklaruje format `YYYY-MM-DD status — kto — notatka`, skill
każe dopisać linię przy każdej zmianie statusu).

> **KOREKTA (2026-09-01, przy wykonaniu tego taska).** Pomiar poniżej JEST BŁĘDNY
> i został przemierzony przed rozpoczęciem pracy. Prawdziwe liczby na tym samym
> drzewie: **8 ze 117** tasków bez datowanej linii (nie 67 z 87), **290** linii
> (nie 24), rozłożonych na cztery dni (29.08: 30, 30.08: 51, 31.08: 145, 01.09:
> 64) — więc nie „z jednej sesji"; **43 z 51** zamkniętych tasków ma linię, nie
> 0 z 44. W pełnym zadeklarowanym formacie jest 181 linii. Podejrzana przyczyna
> pierwotnego pomiaru: linie używają słowa `created`, którego NIE MA w słowniku
> `statuses`, więc parser kluczujący po konfiguracji je gubi.
>
> **Adopcja `## Log` wynosi ~93%, a nie zero.** Właściciel został o tym
> poinformowany przed rozpoczęciem i mimo to wybrał PEŁNY ZAKRES, łącznie
> z usunięciem `## Log`. Wykonane zgodnie z tą decyzją. Argument, który wobec
> tego NIE obowiązuje: „nikt tego nie wypełnia". Argument, który zostaje i sam
> wystarcza: dwa miejsca na tę samą rzecz, z których jedno jest prozą bez
> struktury — „dlaczego ten task został anulowany" nadal nie miało odpowiedzi
> w danych, bo 290 linii prozy nie da się odpytać.

**Pomiar na własnym drzewie (2026-09-01) — NIEAKTUALNY, patrz korekta wyżej:**

```
zmian pola `status` w historii:                 4
z jakimkolwiek polem uzasadnienia:              0   (schema go nie ma)

taski:                                         87
bez ani jednej datowanej linii w `## Log`:     67
datowanych linii `## Log` razem:               24   ← wszystkie z 31.08–01.09,
                                                     czyli z jednej sesji
zamkniętych tasków z linią w `## Log`:      0 z 44
```

Zero z czterdziestu czterech. Konwencja opisana w szablonie, powtórzona w
skillu i wymagana przez procedurę zamykania **nie została użyta ani razu** przez
cały czas życia projektu — łącznie z agentem, który tę dokumentację pisał.

**Diagnoza: to nie jest niedbalstwo, to jest wada projektu.** W tym samym
repozytorium, w tym samym okresie, `actor` ma stuprocentową obecność — bo
`history-record.mjs` ODRZUCA zapis bez aktora w przestrzeni nazw. Różnica między
`actor` a `## Log` nie leży w dyscyplinie piszących, tylko w tym, że jedno jest
wymagane w momencie zapisu, a drugie jest prośbą w dokumentacji. To ta sama
lekcja, którą dał pomiar kryteriów akceptacji w TL-86 (12 z 44 tasków z
martwymi checkboksami): **prośba o uczciwość przegrywa z wymogiem przy zapisie.**

Konsekwencja jest dokładnie tą dziurą, dla której to narzędzie powstało. Backlog
ma być pamięcią przeżywającą sesję agenta i kompaktację kontekstu — a
kompaktacja niszczy najpierw uzasadnienia decyzji. Jeśli warstwa „dlaczego" u
nas nie istnieje w danych, to backlog przechowuje dokładnie to samo co `git log`
i traci swój powód istnienia.

**Trzy rozstrzygnięcia do podjęcia:**

1. **Gdzie mieszka powód.** Rekomendacja: pole w rekordzie historii (strukturalne,
   odpytywalne, przy zdarzeniu), a `## Log` albo znika z szablonu, albo jest z
   historii GENEROWANY. Dwa niezależne miejsca na to samo już raz przegrały —
   patrz liczby wyżej. Jeśli wybierzesz inaczej, zapisz dlaczego.
2. **Kiedy powód jest WYMAGANY.** Nie przy każdej zmianie pola — wymóg przy
   poprawianiu literówki w tytule wyprodukuje 87 wpisów „aktualizacja" i zabije
   sygnał w tydzień. Rekomendacja: wymagany przy przejściach statusu, które
   niosą decyzję — `→ blocked`, `→ cancelled`, `→ done` przy niespełnionej
   weryfikacji, oraz przy każdym użyciu obejścia (`--force`). Reszta opcjonalna.
   Wypisz zamkniętą listę i uzasadnij ją, zamiast wymagać wszędzie.
3. **Zmiana schematu przed publikacją, nie po.** `history/*.jsonl` jest formatem
   TRWAŁYM i wersjonowanym w gicie. Dodanie pola po publikacji to migracja
   cudzych danych; dlatego `pre-launch` mimo braku widocznego objawu.

**Świadomie POZA zakresem:** gnicie `## Kontekst` (sekcja napisana przy
zakładaniu taska może zostać zaprzeczona przez to, co się faktycznie wydarzyło,
i nic tego nie sygnalizuje). To inny problem — dotyczy prozy pisanej z góry, nie
zdarzenia zapisywanego w locie. Jeśli w trakcie okaże się ważny, załóż osobny
task, nie doklejaj tutaj.

**Sprzężenie, nie blokada:** TL-82 (`worktrail done`) będzie pisać rekordy
historii. Jeśli wejdzie pierwszy, zrobi to w starym schemacie i te wpisy trzeba
będzie zmigrować — koszt kilku rekordów, więc świadomie NIE blokuję łańcucha
P0. Jeśli robisz TL-82 przed tym taskiem, zarezerwuj pole w rekordzie.

Odrębny, już istniejący problem: TL-68 łapie rozjazd w drugą stronę — `## Log`
twierdzi `done`, a frontmatter mówi `pending`. Nie duplikuj; jeśli `## Log`
zniknie, sprawdź, czy TL-68 nie traci przesłanki, i zapisz to w jego logu.

## Pre-flight reading

1. `scripts/history-record.mjs` — kształt rekordu i miejsce, w którym aktor bez
   przestrzeni nazw jest ODRZUCANY. To jest wzorzec do powtórzenia dla powodu.
2. `scripts/history.mjs` — rekoncyliacja zmian zrobionych poza narzędziem;
   tam powód często nie będzie znany i to musi być reprezentowalne.
3. `docs/backlog-field-editing-history.md` — rozstrzygnięcia o atrybucji;
   przestrzeń nazw aktorów zostaje nietknięta.
4. `_template.md` — sekcja `## Log` i jej deklarowany format.
5. `backlog/tasks/TL-86-*.md` — ta sama klasa błędu zmierzona na kryteriach.

## Kroki

1. Rozstrzygnij punkty 1–2 z kontekstu; zapisz uzasadnienia w tym tasku.
2. Rozszerz rekord historii o pole powodu; nieznany klucz dalej oblewa.
   Zmiana wykryta przez rekoncyliację (`source: external`) ma reprezentować
   „powód nieznany" JAWNIE, nie pustym stringiem udającym brak potrzeby.
3. Wymuś powód na zamkniętej liście przejść. Komunikat odmowy mówi, które
   przejście go wymaga i dlaczego — nie samo „brakuje pola".
4. Wejście wywoływalne: flaga na komendach piszących (IV prawo), spójna z
   `--append-` z TL-83.
5. Viewer: pole powodu przy zmianie statusu i pokazanie go na osi historii.
6. `worktrail check --reasons` — przejścia z wymaganym powodem, które go nie mają.
   Dla 87 istniejących tasków to będzie raport historyczny: **rozstrzygnij, czy
   ostrzega, czy oblewa**, żeby włączenie nie zablokowało całego drzewa naraz.
7. `## Log`: usuń z szablonu albo generuj z historii. Zaktualizuj skill i
   `instructions` (TL-74), żeby nie uczyły konwencji, której nie ma.
8. `scripts/tests/change-reason.test.mjs`: przejście wymagające powodu bez niego
   OBLEWA; z powodem zapisuje go w rekordzie; zmiana zewnętrzna zapisuje „powód
   nieznany" jawnie; zmiana spoza listy nie wymaga powodu; powód jest odpytywalny.
   Kontrola pozytywna: fixture z niedomyślnymi statusami — test oparty na
   literałach `done`/`blocked` ma oblać.

## Acceptance criteria

- [x] Powód jest polem rekordu historii, odpytywalnym, nie prozą w pliku. [proof: reason-contract]
- [x] Lista przejść wymagających powodu jest zamknięta, zapisana i uzasadniona — jako klucz `reason_required_statuses`, nie literał w kodzie. [proof: reason-contract]
- [x] Brak powodu przy takim przejściu oblewa, z komunikatem mówiącym które przejście i dlaczego. [proof: reason-contract]
- [x] „Powód nieznany" przy zmianie zewnętrznej jest reprezentowany jawnie, a nie pustym stringiem. [proof: reason-contract]
- [x] `check --reasons` raportuje luki, w przebiegu BEZ selektora; tryb (raportuje, nie oblewa) rozstrzygnięty i uzasadniony pod kątem istniejącego drzewa. [proof: guard-wired]
- [x] `## Log` nie istnieje w szablonie ani w tym, co pisze `done` — sekcje w starych taskach zostają jako proza historyczna. [proof: log-section-gone]
- [x] Szablon i skill nie uczą konwencji, której już nie ma. [proof: log-section-gone]
- [x] Test przechodzi na NIEDOMYŚLNYM słowniku statusów. [proof: reason-contract]
- [x] Pełna suita zielona. [proof: suite-green]

## Notes

**Czego świadomie NIE zrobiono z kroku 7.** `worktrail instructions` (TL-74)
jeszcze nie istnieje, więc nie ma czego aktualizować — kryterium mówi o szablonie
i skillu, bo tylko one dziś uczą czegokolwiek. Gdy TL-74 powstanie, ma nie
odtworzyć `## Log`; zapisane w jego logu.

**Sprzężenie z TL-68** (`## Log` mówi `done`, frontmatter mówi `pending`).
Ten task nie kasuje sekcji z istniejących plików, więc przesłanka TL-68 stoi
dla drzewa, które już jest — ale nowe taski nie mają jak wytworzyć tego rozjazdu,
bo nie mają sekcji. Zakres TL-68 kurczy się do danych historycznych.

## Log ma zerową adopcję"
type: code
labels: [pre-launch]
board: main
epic: "Historia i atrybucja"
priority: P1
status: in_progress
owner: agent:claude
estimate: 4h
confidence: medium
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-field-editing-history.md
verification:
  - id: reason-contract
    bash: "node --test scripts/tests/change-reason.test.mjs"
  - id: guard-wired
    bash: "node scripts/cli.mjs check | grep -q 'reasons:'"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: log-section-gone
    bash: "grep -q '## Log' _template.md && { echo 'szablon nadal uczy ## Log'; exit 1; }; grep -rq '## Log' .claude/skills/backlog-workflow/SKILL.md && { echo 'skill nadal uczy ## Log'; exit 1; }; echo 'szablon i skill nie uczą ## Log — OK'"
---

## Cel

Powód zmiany jest zapisywany razem ze zmianą, w strukturze, którą da się
odpytać — a nie w sekcji prozy, której nikt nie wypełnia. Po tym tasku pytanie
„dlaczego ten task został anulowany" ma odpowiedź w danych, nie w pamięci
człowieka, który już nie pamięta.

## Kontekst

`history/*.jsonl` zapisuje CO się zmieniło: `field`, `from`, `to`, `actor`,
`source`, `ts`. Nie ma miejsca na DLACZEGO. Uzasadnienia miały mieszkać w
`## Log` (szablon deklaruje format `YYYY-MM-DD status — kto — notatka`, skill
każe dopisać linię przy każdej zmianie statusu).

> **KOREKTA (2026-09-01, przy wykonaniu tego taska).** Pomiar poniżej JEST BŁĘDNY
> i został przemierzony przed rozpoczęciem pracy. Prawdziwe liczby na tym samym
> drzewie: **8 ze 117** tasków bez datowanej linii (nie 67 z 87), **290** linii
> (nie 24), rozłożonych na cztery dni (29.08: 30, 30.08: 51, 31.08: 145, 01.09:
> 64) — więc nie „z jednej sesji"; **43 z 51** zamkniętych tasków ma linię, nie
> 0 z 44. W pełnym zadeklarowanym formacie jest 181 linii. Podejrzana przyczyna
> pierwotnego pomiaru: linie używają słowa `created`, którego NIE MA w słowniku
> `statuses`, więc parser kluczujący po konfiguracji je gubi.
>
> **Adopcja `## Log` wynosi ~93%, a nie zero.** Właściciel został o tym
> poinformowany przed rozpoczęciem i mimo to wybrał PEŁNY ZAKRES, łącznie
> z usunięciem `## Log`. Wykonane zgodnie z tą decyzją. Argument, który wobec
> tego NIE obowiązuje: „nikt tego nie wypełnia". Argument, który zostaje i sam
> wystarcza: dwa miejsca na tę samą rzecz, z których jedno jest prozą bez
> struktury — „dlaczego ten task został anulowany" nadal nie miało odpowiedzi
> w danych, bo 290 linii prozy nie da się odpytać.

**Pomiar na własnym drzewie (2026-09-01) — NIEAKTUALNY, patrz korekta wyżej:**

```
zmian pola `status` w historii:                 4
z jakimkolwiek polem uzasadnienia:              0   (schema go nie ma)

taski:                                         87
bez ani jednej datowanej linii w `## Log`:     67
datowanych linii `## Log` razem:               24   ← wszystkie z 31.08–01.09,
                                                     czyli z jednej sesji
zamkniętych tasków z linią w `## Log`:      0 z 44
```

Zero z czterdziestu czterech. Konwencja opisana w szablonie, powtórzona w
skillu i wymagana przez procedurę zamykania **nie została użyta ani razu** przez
cały czas życia projektu — łącznie z agentem, który tę dokumentację pisał.

**Diagnoza: to nie jest niedbalstwo, to jest wada projektu.** W tym samym
repozytorium, w tym samym okresie, `actor` ma stuprocentową obecność — bo
`history-record.mjs` ODRZUCA zapis bez aktora w przestrzeni nazw. Różnica między
`actor` a `## Log` nie leży w dyscyplinie piszących, tylko w tym, że jedno jest
wymagane w momencie zapisu, a drugie jest prośbą w dokumentacji. To ta sama
lekcja, którą dał pomiar kryteriów akceptacji w TL-86 (12 z 44 tasków z
martwymi checkboksami): **prośba o uczciwość przegrywa z wymogiem przy zapisie.**

Konsekwencja jest dokładnie tą dziurą, dla której to narzędzie powstało. Backlog
ma być pamięcią przeżywającą sesję agenta i kompaktację kontekstu — a
kompaktacja niszczy najpierw uzasadnienia decyzji. Jeśli warstwa „dlaczego" u
nas nie istnieje w danych, to backlog przechowuje dokładnie to samo co `git log`
i traci swój powód istnienia.

**Trzy rozstrzygnięcia do podjęcia:**

1. **Gdzie mieszka powód.** Rekomendacja: pole w rekordzie historii (strukturalne,
   odpytywalne, przy zdarzeniu), a `## Log` albo znika z szablonu, albo jest z
   historii GENEROWANY. Dwa niezależne miejsca na to samo już raz przegrały —
   patrz liczby wyżej. Jeśli wybierzesz inaczej, zapisz dlaczego.
2. **Kiedy powód jest WYMAGANY.** Nie przy każdej zmianie pola — wymóg przy
   poprawianiu literówki w tytule wyprodukuje 87 wpisów „aktualizacja" i zabije
   sygnał w tydzień. Rekomendacja: wymagany przy przejściach statusu, które
   niosą decyzję — `→ blocked`, `→ cancelled`, `→ done` przy niespełnionej
   weryfikacji, oraz przy każdym użyciu obejścia (`--force`). Reszta opcjonalna.
   Wypisz zamkniętą listę i uzasadnij ją, zamiast wymagać wszędzie.
3. **Zmiana schematu przed publikacją, nie po.** `history/*.jsonl` jest formatem
   TRWAŁYM i wersjonowanym w gicie. Dodanie pola po publikacji to migracja
   cudzych danych; dlatego `pre-launch` mimo braku widocznego objawu.

**Świadomie POZA zakresem:** gnicie `## Kontekst` (sekcja napisana przy
zakładaniu taska może zostać zaprzeczona przez to, co się faktycznie wydarzyło,
i nic tego nie sygnalizuje). To inny problem — dotyczy prozy pisanej z góry, nie
zdarzenia zapisywanego w locie. Jeśli w trakcie okaże się ważny, załóż osobny
task, nie doklejaj tutaj.

**Sprzężenie, nie blokada:** TL-82 (`worktrail done`) będzie pisać rekordy
historii. Jeśli wejdzie pierwszy, zrobi to w starym schemacie i te wpisy trzeba
będzie zmigrować — koszt kilku rekordów, więc świadomie NIE blokuję łańcucha
P0. Jeśli robisz TL-82 przed tym taskiem, zarezerwuj pole w rekordzie.

Odrębny, już istniejący problem: TL-68 łapie rozjazd w drugą stronę — `## Log`
twierdzi `done`, a frontmatter mówi `pending`. Nie duplikuj; jeśli `## Log`
zniknie, sprawdź, czy TL-68 nie traci przesłanki, i zapisz to w jego logu.

## Pre-flight reading

1. `scripts/history-record.mjs` — kształt rekordu i miejsce, w którym aktor bez
   przestrzeni nazw jest ODRZUCANY. To jest wzorzec do powtórzenia dla powodu.
2. `scripts/history.mjs` — rekoncyliacja zmian zrobionych poza narzędziem;
   tam powód często nie będzie znany i to musi być reprezentowalne.
3. `docs/backlog-field-editing-history.md` — rozstrzygnięcia o atrybucji;
   przestrzeń nazw aktorów zostaje nietknięta.
4. `_template.md` — sekcja `## Log` i jej deklarowany format.
5. `backlog/tasks/TL-86-*.md` — ta sama klasa błędu zmierzona na kryteriach.

## Kroki

1. Rozstrzygnij punkty 1–2 z kontekstu; zapisz uzasadnienia w tym tasku.
2. Rozszerz rekord historii o pole powodu; nieznany klucz dalej oblewa.
   Zmiana wykryta przez rekoncyliację (`source: external`) ma reprezentować
   „powód nieznany" JAWNIE, nie pustym stringiem udającym brak potrzeby.
3. Wymuś powód na zamkniętej liście przejść. Komunikat odmowy mówi, które
   przejście go wymaga i dlaczego — nie samo „brakuje pola".
4. Wejście wywoływalne: flaga na komendach piszących (IV prawo), spójna z
   `--append-` z TL-83.
5. Viewer: pole powodu przy zmianie statusu i pokazanie go na osi historii.
6. `worktrail check --reasons` — przejścia z wymaganym powodem, które go nie mają.
   Dla 87 istniejących tasków to będzie raport historyczny: **rozstrzygnij, czy
   ostrzega, czy oblewa**, żeby włączenie nie zablokowało całego drzewa naraz.
7. `## Log`: usuń z szablonu albo generuj z historii. Zaktualizuj skill i
   `instructions` (TL-74), żeby nie uczyły konwencji, której nie ma.
8. `scripts/tests/change-reason.test.mjs`: przejście wymagające powodu bez niego
   OBLEWA; z powodem zapisuje go w rekordzie; zmiana zewnętrzna zapisuje „powód
   nieznany" jawnie; zmiana spoza listy nie wymaga powodu; powód jest odpytywalny.
   Kontrola pozytywna: fixture z niedomyślnymi statusami — test oparty na
   literałach `done`/`blocked` ma oblać.

## Acceptance criteria

- [ ] Powód jest polem rekordu historii, odpytywalnym, nie prozą w pliku.
- [ ] Lista przejść wymagających powodu jest zamknięta, zapisana i uzasadniona.
- [ ] Brak powodu przy takim przejściu oblewa, z komunikatem mówiącym które i dlaczego.
- [ ] „Powód nieznany" przy zmianie zewnętrznej jest reprezentowany jawnie.
- [ ] `check --reasons` raportuje luki; tryb (ostrzega/oblewa) jest rozstrzygnięty pod kątem 87 istniejących tasków.
- [ ] `## Log` jest usunięty albo generowany — nie istnieje jako druga, ręczna kopia.
- [ ] Szablon, skill i `instructions` nie uczą konwencji, której już nie ma.
- [ ] Test przechodzi na niedomyślnym słowniku statusów.

## Log

- 2026-09-01 pending — agent:claude — założony po pomiarze: 0 z 44 zamkniętych tasków ma linię w `## Log`, a wszystkie 24 istniejące linie pochodzą z jednej sesji. `actor` w tym samym repo ma 100% obecności, bo jest wymagany przy zapisie. Warstwa „dlaczego" nie istnieje w danych, co odbiera backlogowi jego powód istnienia wobec `git log`.
- 2026-09-01 in_progress — agent:claude — **PRZESŁANKA TASKA OBALONA PRZED STARTEM.** Przemierzone: 8/117 tasków bez datowanej linii, 290 linii na czterech dniach, 43/51 zamkniętych z linią. Właściciel poinformowany, wybrał PEŁNY ZAKRES mimo to — i to jest wykonana decyzja. Zapisuję obalenie w `## Kontekst`, bo task, który zostaje w drzewie z fałszywym pomiarem, uczy tego pomiaru dalej.
- 2026-09-01 in_progress — agent:claude — **ROZSTRZYGNIĘCIE 1 (gdzie mieszka powód): pole `reason` w rekordzie historii; `## Log` znika z szablonu, ze skilla, z CLAUDE.md i z tego, co pisze `done`.** Sekcje w ISTNIEJĄCYCH taskach zostają nietknięte — niosą zdania, których nikt nie odtworzy, a kasowanie cudzego pisania dla porządku kosztuje więcej niż porządek jest wart. Odrzucone „generowanie `## Log` z historii": to trzecia reprezentacja tej samej rzeczy, a nie mniej niż dwie.
- 2026-09-01 in_progress — agent:claude — **ROZSTRZYGNIĘCIE 2 (kiedy wymagany): lista jest KLUCZEM KONFIGURACJI `reason_required_statuses`, nie literałem w kodzie.** To nie jest ozdoba — `blocked`/`cancelled` to słownictwo TEGO projektu (prawo 3), a lista wpisana w skrypt narzuciłaby je cudzemu backlogowi. Brak klucza spada na `archived_statuses`: wyjście z kolejki jest decyzją, a domyślne `[]` uczyniłoby mechanizm opt-in, czyli powtórzyłoby dokładnie ten tryb, w którym konwencja nie ma egzekucji. Ten projekt ustawia `[blocked, cancelled]`. Wymóg dotyczy WYŁĄCZNIE przejść statusu: powód przy każdej zmianie pola wyprodukowałby „aktualizacja" przy każdej literówce w tytule i zabił sygnał w tydzień.
- 2026-09-01 in_progress — agent:claude — **DRUGI SENTINEL, `proven`.** Do domyślnego statusu zamykającego prowadzi `worktrail done`, który URUCHAMIA weryfikację i odmawia na pierwszej porażce — powodem tego przejścia jest przebieg, zapisany obok jako wpisy `__verified__`. Żądanie zdania w tym miejscu uczy wpisywania „zrobione" w pole powodu, czyli produkuje szum w polu, które ma go nie mieć. Do KAŻDEGO innego statusu archiwalnego (`cancelled`) przebieg nie prowadzi i tam powód jest wymagany. Oba sentinele (`unknown`, `proven`) są ZASTRZEŻONE przy zapisie: `--reason unknown` oblewa jako błąd użycia, bo odpowiedź maszyny przebrana za czyjeś zdanie jest gorsza niż brak odpowiedzi.
- 2026-09-01 in_progress — agent:claude — **ROZSTRZYGNIĘCIE 3 (`check --reasons`): RAPORTUJE, nie oblewa, i to nie jest miękkość.** Każda luka, którą może znaleźć, jest w PRZESZŁOŚCI i nikt jej dziś nie uzupełni. Guard, który oblewa, zostawia dwa wyjścia — wymyślić powody za kogoś albo wyłączyć guard — i oba są gorsze niż luka. Egzekucja siedzi PRZY ZAPISIE, gdzie osoba znająca odpowiedź jeszcze stoi. Raport rozdziela TRZY rodzaje braku (`unknown` = zmiana zobaczona, nie zrobiona; brak pola = wpis sprzed mechanizmu, log jest append-only; luka właściwa = ktoś pominął pytanie), bo zsumowane czytałyby się jako „wszyscy pomijają", a tylko trzeci jest czyjąkolwiek winą. Na tym drzewie: 4 z 4 to wpisy sprzed pola.
- 2026-09-01 in_progress — agent:claude — powód jest kopiowany na KAŻDY wpis jednego aktu (jeden akt rusza status i `updated` naraz), bo odpowiedź czytelna tylko z tego wpisu, który akurat był pierwszy, zależy od sposobu czytania logu. Pole jest na KAŻDYM wpisie, także tam, gdzie nie jest wymagane: pole obecne na części wierszy sprawia, że „nie podano" i „nie było potrzebne" mają na dysku ten sam kształt.
- 2026-09-01 in_progress — agent:claude — wejście na trzech trasach zapisu: `done --reason`, `history --reason` (jeden powód na przebieg — to jest granulacja, którą ta trasa faktycznie ma) i pole `reason` w `POST /api/field`. Viewer pyta INLINE w panelu taska, nie modalem: okno przyciemniające stronę zasłania rzecz, którą trzeba wytłumaczyć. Serwer odmawia niezależnie od przeglądarki, więc pytanie w UI jest wygodą, a nie egzekucją. Powód pokazany na osi historii jako DRUGA LINIA, nie tooltip — „dlaczego", po które trzeba najechać, jest „dlaczego", którego nikt nie czyta.
- 2026-09-01 in_progress — agent:claude — `scripts/tests/change-reason.test.mjs`, 17 asercji. Cały plik stoi na fixture ze słownikiem `open/parked/shipped/dropped` — kontrola pozytywna z kroku 8: test napisany na literałach `blocked`/`cancelled` przeszedłby na regule zaszytej w kodzie, czyli na dokładnie tej wadzie, którą to rozstrzygnięcie omija. Asercje na odmowach, nie na ścieżce szczęśliwej: plik taska nietknięty i zero historii po odmowie, bo odmowa po zapisie zostawiłaby task zmieniony i historię mówiącą „nie". 448/448 zielone.
