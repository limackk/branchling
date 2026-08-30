---
id: TL-22
title: "worktrail jako jedno wejście: dispatcher komend zamiast ośmiu ścieżek"
type: code
labels: [pre-launch]
board: main
epic: "worktrail — narzędzie"
priority: P1
status: done
owner: claude
estimate: 4h
confidence: high
created: 2026-08-29
updated: 2026-08-29
blocked_by: []
blocks: []
related_docs:
  - docs/worktrail-state-and-sync.md
  - backlog/README.md
verification:
  - bash: "./scripts/worktrail query --status blocked --priority P0,P1  # lista tasków, NIE otwarta przeglądarka"
  - bash: "./scripts/worktrail querry  # exit 2 z listą komend"
  - bash: "./scripts/worktrail serve --frobnicate  # exit 2, serwer NIE startuje"
  - bash: "node --test backlog/scripts/tests/cli.test.mjs"
---

## Cel

Zdjąć defekt zgłoszony przez foundera: **każda „komenda" inna niż serwer po cichu otwierała stronę** zamiast cokolwiek zrobić.

## Kontekst

`scripts/worktrail` miał 15 linii i kończył się `exec node serve-backlog.mjs "$@"` — był na sztywno przypięty do JEDNEGO skryptu. Serwer czytał tylko znane sobie flagi (`--port`, `--no-open`, `--dir`) i **ignorował resztę**, po czym `probeExisting()` widział działającą instancję i robił jedyną rzecz, jaką umiał: otwierał kartę.

Efekt: `worktrail query --status blocked` kończyło się na `http://127.0.0.1:4321/#tasks?board=__all__`. **Cichy no-op z efektem ubocznym jest gorszy od błędu, bo wygląda jak działanie.**

To nie była decyzja projektowa, tylko zaszłość: wrapper powstał, gdy jedyną rzeczą do odpalenia był serwer, a osiem kolejnych zdolności dorosło obok jako osobne `node backlog/scripts/<coś>.mjs`, każda z własną konwencją flag.

Druga pułapka tej samej klasy, znaleziona przy okazji: `check-backlog-boards.mjs` bez `--all <katalog>` kończył **zielono na „0 tasków sprawdzonych"** — zielony wynik przy zerowej mocy dowodowej.

**Odrzucona alternatywa — flagi bez podkomend** (`worktrail --status blocked`, o co founder pytał wprost). `worktrail --port 4400` już znaczyło „uruchom serwer". Gdyby komendę wybierała flaga, `--status` znaczyłoby „pytaj", `--port` „serwuj", a `--dir` — przyjmowane przez OBIE — nie znaczyłoby nic rozstrzygającego. Rozstrzyganie komendy po tym, którą flagę ktoś akurat wpisał, to gwarantowany rozjazd. Podkomenda usuwa niejednoznaczność i **zachowuje nawyk**: `worktrail` bez argumentów to nadal serwer.

**Odrzucona alternatywa — import zamiast spawn.** Skrypty są samodzielnymi programami z własną walidacją flag i kodami wyjścia. Przepisanie ich na biblioteki + cienkie `main` to osobna robota; dispatcher, który je woła i PROPAGUJE kod wyjścia, daje jedno wejście bez ruszania pięciu działających programów.

## Kroki

1. `backlog/scripts/cli.mjs` — tabela komend, `helpText()`, PURE `resolveCommand()`, `main()` propagujący kod wyjścia.
2. `serve-backlog.mjs` — nieznana flaga i nieoczekiwany argument OBLEWAJĄ (exit 2) zamiast być ignorowane.
3. `check` jako komenda złożona: dokłada `--all <tasksDir>` i pozycyjny katalog, bo dwa guardy mają dwie różne konwencje wejścia.
4. `scripts/worktrail` → mostek do `cli.mjs`; `package.json` → `node backlog/scripts/cli.mjs`.

## Acceptance criteria

- [x] `worktrail query --status blocked` zwraca taski — sprawdzone na realnym drzewie, zwróciło 5 blokerów.
- [x] Nieznana komenda: exit 2 + lista dostępnych, ZERO odwołań do `127.0.0.1`.
- [x] `worktrail serve --frobnicate` kończy 2 i nie startuje serwera (test z timeoutem, żeby regresja nie wieszała suity na 127 s).
- [x] Kod wyjścia podkomendy propagowany (literówka we fladze `query` dalej oblewa).
- [x] `worktrail --help` wymienia KAŻDĄ komendę z tabeli — generowane z niej, nie ręczna lista.
- [x] `worktrail check` sprawdza realne taski (1368), nie zero.
- [x] `worktrail` bez argumentów dalej uruchamia serwer (HTTP 200 na `/api/ping`).
- [x] 13 testów `cli.test.mjs`; pełna suita backlogu zielona.

## Notes

**Świadomie POZA zakresem:**

- `worktrail init` (założenie świeżego backlogu) i `worktrail stats` — wymagają wydzielenia rdzenia dashboardu; osobny task, gdy dojdzie do wydzielenia repo.
- Per-komendowe `--help` z `usage` z tabeli — dziś `--help` leci do skryptu, który ma własną pomoc (albo jej nie ma).
- Przepisanie skryptów na biblioteki + cienkie `main` — patrz „odrzucone alternatywy".

**Klasa buga do zapamiętania:** parser, który ignoruje nieznane wejście, zamienia literówkę w ciche wykonanie czegoś innego. Walidacja wejścia jest tańsza niż tłumaczenie, dlaczego narzędzie „nic nie robi".

## Log

- 2026-08-29 created — claude — zgłoszenie foundera: „wszystkie komendy odpalają stronę"
- 2026-08-29 done — claude — dispatcher + walidacja flag serwera + `check` bez fałszywej zieleni
