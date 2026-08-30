---
id: TL-86
title: "Kryteria akceptacji odhaczane z verification, nie deklarowane ręcznie"
type: code
labels: [pre-launch]
board: main
epic: "Integralność danych"
priority: P0
status: done
owner: agent:claude
estimate: 3h
confidence: medium
created: 2026-08-31
updated: 2026-09-01
blocked_by: []
blocks: [TL-82]
related_docs:
  - _template.md
  - CLAUDE.md
verification:
  - id: mapping-tests
    bash: "node --test scripts/tests/criteria-mapping.test.mjs"
  - id: guard-green
    bash: "node scripts/cli.mjs check --criteria"
  - id: closed-untouched
    bash: 'grep -lE "^status: (done|cancelled)" backlog/tasks/*.md | xargs grep -l "\[proof:" && { echo "the mechanism was applied to a closed task"; exit 1; }; echo "no closed task carries a proof link"'
  - id: doc-distinction
    bash: "grep -q 'Wyliczone to nie to samo co odtwarzalne' docs/worktrail-global-tool.md"
---

## Cel

Kryterium akceptacji przestaje być czymś, co się deklaruje, i staje się czymś,
co się dostaje: wskazuje wpis `verification:`, który je dowodzi, a odhacza je
narzędzie po zielonym przebiegu. Checkbox przestaje móc kłamać.

## Kontekst

Pomiar na własnym backlogu (2026-08-31, 83 taski):

```
zamknięte (`done`):                       44
z NIEODHACZONYMI acceptance criteria:     12   (27%)
nieodhaczonych pozycji razem:             60
bez ani jednego wpisu `bash:`:             2
z literałem szablonu w `verification`:     1
```

Wzorcowy przypadek to TL-51: zamknięty, w commicie, sześć kryteriów
nieodhaczonych — przy `verification:` złożonym z trzech realnych komend, które
dokładnie te sześć rzeczy sprawdzają. Praca została zweryfikowana. Nieodhaczona
została dekoracja.

**Diagnoza: to nie jest niechlujstwo, tylko poprawna reakcja na projekt.** Mamy
dwie listy o tym samym „done" — `## Acceptance criteria` i `verification:` —
i żadnego zdefiniowanego związku między nimi. Realna jest jedna, więc druga jest
ignorowana. 27% to miara redundancji, nie dyscypliny.

Konsekwencja, której nie widać bez tego pomiaru: `worktrail done` z TL-82
przepuściłby TL-51 z sześcioma martwymi checkboksami, bo bramka patrzy
wyłącznie na `verification:`. Dlatego ten task blokuje tamten — inaczej
zachowanie zamknięcia zostanie zaprojektowane dwa razy.

Backlog.md ma ten sam problem i rozwiązuje go prozą: „check only the acceptance
criteria that the verification evidence proves". To jest prośba o uczciwość.
My możemy sprawić, że nie ma o co prosić — ta sama oś (instrukcja kontra
mechanizm), piętro niżej.

Odrzucona alternatywa: **usunąć `## Acceptance criteria` z szablonu** i zostawić
samo `verification:`. Tańsze i też usuwa redundancję, ale kryteria niosą
intencję po ludzku („nowa komenda bez pomocy oblewa"), a komenda niesie tylko
sprawdzenie. Strata dla kogoś, kto task dopiero czyta. Jeśli w trakcie okaże się,
że powiązanie jest droższe, niż wygląda — ta opcja wraca na stół, ale wtedy
świadomie i z zapisem w logu.

## Cztery rzeczy do rozstrzygnięcia — każda potrafi zatopić tę zmianę

1. **Czym kryterium jest identyfikowane.** Numer pozycji w liście markdown jest
   kruchy: dopisanie kryterium w środku przesuwa wszystkie powiązania po cichu.
   Rozważ stabilny identyfikator przy kryterium albo kierunek odwrotny — to
   kryterium wskazuje wpis weryfikacji, nie odwrotnie. Wybierz to, co przeżyje
   przestawienie listy.
2. **Migracja.** 39 aktywnych tasków nie ma żadnego powiązania. Włączenie
   wymagalności z dnia na dzień czyni je wszystkie NIEZAMYKALNYMI — to jest
   sposób, w jaki ta zmiana umiera w tydzień. Rozstrzygnij: wymóg tylko dla
   tasków założonych po zmianie, tryb ostrzeżenia przed trybem oblewania, czy
   jednorazowe uzupełnienie. Zamkniętych 44 nie ruszamy.
3. **Pusta lista kryteriów nie może przechodzić.** Task bez kryteriów przeszedłby
   przez tę bramkę trywialnie — dokładnie guard zielony na zerowej próbce, przed
   którym ostrzega CLAUDE.md. Brak kryteriów oblewa tak samo jak pusty
   `verification:`.
4. **Odhaczony checkbox jest zapisywany do wersjonowanego pliku**, choć jest
   wyliczony — pozorne napięcie z II prawem. Nie jest: to nie jest widok, tylko
   ZAPIS Z PRZEBIEGU, który się odbył. Widok wolno skasować i odtworzyć; wyniku
   przebiegu z przeszłości nie da się odtworzyć bez ponownego uruchomienia.
   Zapisz to rozróżnienie, żeby następny czytelnik nie uznał tego za wyłom.

## Pre-flight reading

1. `backlog/tasks/TL-51-*.md` — kanoniczny przykład rozjazdu; przeczytaj oba
   bloki obok siebie, zanim zaprojektujesz powiązanie.
2. `_template.md` — sekcja `## Acceptance criteria` i blok `verification:`.
3. `scripts/task-fields.mjs:146` — jak `verification` jest dziś walidowane;
   powiązanie musi przejść przez tę samą walidację.
4. `backlog/tasks/TL-82-*.md` — bramka zamknięcia, która to skonsumuje.
5. `docs/worktrail-global-tool.md` §3 — II prawo, dla rozstrzygnięcia z punktu 4.

## Kroki

1. Rozstrzygnij identyfikację kryterium (punkt 1) i zapisz uzasadnienie.
2. Rozszerz schemat `verification:` o powiązanie; nieznany klucz dalej oblewa.
3. `_template.md` — pokaż powiązanie na przykładzie, nie w komentarzu.
4. `worktrail check --criteria`: kryterium bez dowodu, dowód bez kryterium, pusta
   lista kryteriów. Najpierw jako ostrzeżenie, jeśli tak wyjdzie migracja.
5. Rozstrzygnij i zaimplementuj migrację (punkt 2). Zamkniętych tasków nie ruszaj.
6. Przekaż do TL-82: co bramka ma odhaczać i przy czym ma odmawiać.
7. `scripts/tests/criteria-mapping.test.mjs`: kryterium bez dowodu oblewa; pusta
   lista kryteriów oblewa; przestawienie kolejności kryteriów NIE psuje powiązań
   (to jest test na punkt 1 — jeśli przechodzi przy numerach pozycji, znaczy że
   testuje nie to, co trzeba); odhaczenie zapisuje się do pliku raz, idempotentnie.

## Acceptance criteria

- [x] Każde kryterium wskazuje dowód, a powiązanie przeżywa przestawienie listy kryteriów. [proof: mapping-tests]
- [x] Kryterium bez dowodu, dowód bez kryterium i pusta lista kryteriów są wykrywane przez `check`. [proof: mapping-tests]
- [x] Ścieżka migracji dla 39 aktywnych tasków jest rozstrzygnięta i nie czyni ich niezamykalnymi. [proof: guard-green]
- [x] Zamknięte taski nie są modyfikowane. [proof: closed-untouched]
- [x] Rozróżnienie „widok wolno skasować, zapis przebiegu nie" jest zapisane w dokumentacji. [proof: doc-distinction]
- [x] Test oblewa, jeśli powiązanie opiera się na kruchym numerze pozycji. [proof: mapping-tests]

## Log

2026-08-31 pending — agent:claude — założony po pomiarze własnego backlogu: 12 z 44 zamkniętych tasków ma łącznie 60 nieodhaczonych kryteriów, przy sprawnym `verification:`. Dwie listy o tym samym, realna jedna. Blokuje TL-82, bo zmienia to, co bramka ma sprawdzać.
2026-09-01 in_progress — agent:claude — wzięty jako pierwszy wykonalny P0: TL-48 czeka na właściciela (adres repozytorium), TL-81 jest z definicji taskiem decyzyjnym. Ten jest kodem i odblokowuje TL-82.
2026-09-01 done — agent:claude — CZTERY ROZSTRZYGNIĘCIA, każde z powodem, nie z gustu.
  (1) IDENTYFIKACJA — kryterium wskazuje dowód, nie odwrotnie; wpis `verification` dostaje opcjonalne `id:`, kryterium kończy się widocznym `[proof: <id>]`. Numer pozycji odpadł tak, jak mówił task. Z dwóch pozostałych kierunków wygrał ten, bo kryterium jest stroną RUCHOMĄ — jest przepisywane i przestawiane — a wpis weryfikacji stoi. Referencja trzymana na stronie ruchomej jedzie razem ze zdaniem, do którego należy, więc przestawienie listy jest no-opem Z KONSTRUKCJI, a nie dzięki czyjejś staranności. Kierunek odwrotny dodatkowo zmuszałby dowód do wyliczania swoich kryteriów — czyli dokładnie tej listy, która gnije przy skasowaniu kryterium. Znacznik jest WIDOCZNY, a nie komentarzem HTML: te pliki czyta się `cat`-em równie często jak w rendererze, komentarz HTML jest niewidoczny tylko w jednym z dwóch, a powiązania, którego nie widać, nikt nie utrzymuje.
  (2) MIGRACJA — polityka `criteria_links` w config.yaml: `off` / `warn` (domyślnie) / `require`, plus podział na błędy i ostrzeżenia. ZEPSUTE powiązanie (kryterium wskazuje nieistniejący `id`, duplikat `id`, nieznany klucz we wpisie) oblewa ZAWSZE, `off` włącznie — napisać je mógł wyłącznie ktoś, kto już używa mechanizmu, więc oblewanie na tym nie może uczynić starego taska niezamykalnym. BRAK powiązania oblewa dopiero przy `require`. Efekt zmierzony: 69 aktywnych tasków bez powiązań, `check` zielony, komunikat mówi ile ich jest. Odrzucone: wymóg po dacie `created` — reguła zależna od niewidocznego pola, przy której dwa taski obok siebie zachowują się inaczej bez śladu dlaczego.
  (3) PUSTA PRÓBKA — brak sekcji `## Acceptance criteria` i pusta lista są sądzone OSOBNO i przed resztą, z różnymi komunikatami. Bez tego task bez kryteriów przechodziłby bramkę trywialnie, czyli guard zielony na zerowej próbce.
  (4) ZAPIS PRZEBIEGU — rozróżnienie wpisane do `docs/worktrail-global-tool.md` §3, przy II prawie, z kryterium rozstrzygającym do wielokrotnego użytku: jeśli do odtworzenia czegoś wystarczą pliki tasków, to widok (kasuj); jeśli potrzeba jeszcze CZASU, w którym coś zaszło, to zapis zdarzenia i podlega I prawu.
  WYKONANE: `scripts/criteria.mjs` (parser + audyt + `applyProofs`), `scripts/check-backlog-criteria.mjs`, `check --criteria` w dyspozytorze (bez selektora leci w komplecie), `criteria_links` w config.mjs i w szablonie `init`, `_template.md` i przykładowy task z `init` POKAZUJĄ powiązanie zamiast je opisywać, `scripts/tests/criteria-mapping.test.mjs` (19 asercji). 394/394 zielone.
  PRZY OKAZJI, POZA ZAKRESEM: regex podmieniający blok `verification` w `new-task.mjs` łykał tylko linie `- `, więc przy dwuliniowym wpisie zostawiał sierotę; `createTask` przyjmuje teraz wpis jako obiekt `{id, bash|manual}`. `manual:` dołączone do dozwolonych kluczy — backlog już go używa (TL-82), a parser, który oblewa na własnych danych projektu, jest bezużyteczny.
  UWAGA DLA NASTĘPNEGO: `applyProofs` jest funkcją, nie komendą — NIC jej jeszcze nie woła w normalnym przebiegu. Odhaczanie włącza `worktrail done` z TL-82; do tego czasu checkbox dalej można postawić ręcznie i dalej może kłamać. Bramka `check --criteria` pilnuje POWIĄZANIA, nie prawdziwości odhaczenia.
  Własne kryteria tego taska odhaczone przez `applyProofs`, po zielonym przebiegu wszystkich czterech wpisów `verification` — nie ręcznie.
