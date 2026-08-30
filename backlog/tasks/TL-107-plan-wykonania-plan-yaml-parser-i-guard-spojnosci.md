---
id: TL-107
title: "Plan wykonania: plan.yaml, parser i guard spójności"
type: task
labels: []
board: main
epic: "Plan wykonania"
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
estimate: 1d
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: [TL-108, TL-109]
related_docs: []
verification:                      # JAK sprawdzić, że task naprawdę jest zrobiony
  - bash: "node --test scripts/tests/plan.test.mjs"
  - bash: "node scripts/cli.mjs check --plan"
---

## Cel

Kolejność implementacji backlogu ma być DANYMI w repozytorium: jeden plik
`backlog/plan.yaml` opisujący fale (waves) wykonania, grupy „zrób razem"
i uzasadnienie kolejności. Po tym tasku istnieje parser tego pliku oraz guard
`worktrail check --plan`, który oblewa, gdy plan kłamie wobec grafu `blocked_by`.

Gdy task jest zrobiony, prawdą jest:
- format `plan.yaml` jest zdefiniowany i sparsowany jednym modułem
  (`scripts/plan.mjs`), z którego korzystają wszyscy konsumenci — bez drugiego
  parsera w viewerze czy guardzie (ta sama zasada co `parseBoardsYaml`
  w `scripts/config.mjs`),
- niespójny plan oblewa build, zamiast cicho pokazywać złą kolejność.

## Kontekst

Backlog ma ~70 tasków. Chcemy, by agent ustalał kolejność implementacji
(które taski robić najpierw, które razem), a viewer pokazywał wykonanie planu
na żywo. Analiza z 2026-09-01 (sesja Claude) rozstrzygnęła kluczowe decyzje:

- **Kolejność NIE jest boardem.** Board to partycja „kto/kontekst" (zamknięty
  słownik w `boards.yaml`); kolejność wykonania to inna oś. Odrzucone.
- **Kolejność NIE jest polem frontmattera** (`sequence:`). Przetasowanie planu
  zmieniałoby 70 plików naraz — nieczytelny diff, konflikt z każdą gałęzią.
  Odrzucone.
- **Kolejność jest osobnym plikiem `backlog/plan.yaml`.** Decyzje agenta
  (kolejność wśród tasków wolnych, grupy „razem", uzasadnienie) NIE są
  wyliczalne z drzewa — to dane w rozumieniu prawa 1 z CLAUDE.md, więc jadą
  w repo i przez review. Wyliczalna jest tylko ich WALIDACJA.
- **Plan jest doradczy, status jest prawdą.** Plan niczego nie blokuje twardo;
  jedyny twardy warunek to zgodność z `blocked_by` (task nie może stać w fali
  wcześniejszej niż jego blokada). Inaczej plan stałby się drugim źródłem
  prawdy o stanie.
- Sam plan UKŁADA agent (ręcznie/w sesji) — narzędzie go tylko waliduje.
  Automatyczne układanie planu to świadomie NIE jest zakres tego taska.

Proponowany format (do doprecyzowania w implementacji, klucze po angielsku —
to powierzchnia narzędzia, wartości to dane projektu):

```yaml
updated: 2026-09-01
rationale: "jedno zdanie: dlaczego taka kolejność"
waves:
  - name: "Fundament"
    tasks: [TL-27, TL-28]
  - name: "Konsumenci"
    tasks: [TL-29, TL-30]
    together: [[TL-29, TL-30]]   # wspólny branch / wspólne pliki
```

Reguły guarda (`worktrail check --plan`, dołączony też do zbiorczego
`worktrail check`):

1. Każde ID w planie istnieje w drzewie (jak `check-backlog-refs`).
2. Task w fali N nie ma w `blocked_by` taska z fali > N ani taska spoza planu,
   który jest otwarty. Blokada w tej samej fali = ostrzeżenie (może być
   sekwencją wewnątrz fali), w późniejszej = błąd.
3. ID w `together` należą do tej samej fali.
4. Duplikat ID w planie = błąd.
5. Task zamknięty (`done`/`cancelled`) w planie NIE jest błędem — plan
   historyczny ma prawo istnieć; to widok liczy „falę aktywną".
6. BRAK `plan.yaml` nie jest błędem — funkcja jest opcjonalna; guard mówi
   wtedy „no plan file" i przechodzi. Ale guard MUSI mieć kontrolę pozytywną
   w testach (fixture ze złym planem, który oblewa) — guard zielony na zerowej
   próbce nie dowodzi niczego (reguła z CLAUDE.md).

Czy `plan.yaml` jest wersjonowany: TAK (to dane, nie widok) — nie dopisywać go
do gitignore generowanych widoków.

## Pre-flight reading

1. `CLAUDE.md` — cztery prawa; szczególnie 1 (dane w repo) i 2 (wyliczone
   wolno skasować) — plan jest po stronie DANYCH.
2. `scripts/config.mjs` — `parseBoardsYaml` jako wzorzec: jeden parser
   ograniczonego kształtu YAML, zero zależności npm.
3. `scripts/check-backlog-refs.mjs` — wzorzec guarda na wiszące ID i sposób
   raportowania błędów.
4. `scripts/cli.mjs` — jak `check` agreguje guardy i jak dodaje się flagę.
5. `scripts/tests/dangling-refs.test.mjs` i `scripts/tests/_repo.mjs` —
   wzorzec testu guarda na fixture (katalog backlogu ZAWSZE z `_repo.mjs`).

## Kroki

1. Zdefiniuj i zaimplementuj parser `plan.yaml` w `scripts/plan.mjs`
   (kształt jak wyżej; nieznany klucz oblewa — spójnie z resztą configów).
2. Zaimplementuj walidację (reguły 1–6 z Kontekstu) w tym samym module,
   zwracającą listę problemów z poziomami error/warning.
3. Podepnij `worktrail check --plan` w `scripts/cli.mjs` i dołącz do zbiorczego
   `worktrail check`; komunikaty po angielsku, styl jak pozostałe guardy.
4. Testy: poprawny plan przechodzi; każdy typ błędu oblewa z czytelnym
   komunikatem; brak pliku = pass z adnotacją; kontrola pozytywna obecna.
5. Utwórz startowy `backlog/plan.yaml` dla tego epika (fale: TL-107 →
   TL-108/TL-109 → TL-110) — plan śledzi własną implementację.
6. Zaktualizuj `README.md` (sekcja o plikach backlogu) o `plan.yaml`.

## Acceptance criteria

- [ ] `node --test scripts/tests/plan.test.mjs` zielone, z kontrolą pozytywną
      (zły plan oblewa).
- [ ] `worktrail check --plan` istnieje, jest w `--help` i w zbiorczym `check`.
- [ ] Plan z taskiem ustawionym przed jego `blocked_by` oblewa build z
      komunikatem wskazującym oba ID i obie fale.
- [ ] Brak `plan.yaml` nie oblewa niczego.
- [ ] Istnieje `backlog/plan.yaml` opisujący fale tego epika i przechodzi
      własny guard.
- [ ] Cała nowa powierzchnia (kod, komunikaty, testy) po angielsku;
      `worktrail check --language` zielone.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

2026-09-01 pending — agent:claude — task założony z analizy „plan wykonania
z monitoringiem w viewerze"; rozstrzygnięcia projektowe w Kontekście.
