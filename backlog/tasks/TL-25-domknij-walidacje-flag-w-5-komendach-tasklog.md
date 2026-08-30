---
id: TL-25
title: "Domknij walidację flag w 5 komendach worktrail (build/viewer/next-id/board/history)"
type: code
labels: [pre-launch]
board: main
epic: "worktrail — narzędzie"
priority: P2
status: done
owner: claude
estimate: 2h
confidence: high
created: 2026-08-30
updated: 2026-08-30
blocked_by: []
blocks: []
related_docs:
  - backlog/README.md
verification:
  - bash: "worktrail history --frobnicate  # ma OBLEWAĆ, dziś robi pełną rekoncyliację"
  - bash: "worktrail build --frobnicate     # ma OBLEWAĆ, dziś ignoruje i buduje"
  - bash: "worktrail viewer --frobnicate    # ma OBLEWAĆ"
  - bash: "worktrail next-id --frobnicate   # ma OBLEWAĆ"
  - bash: "worktrail board --frobnicate     # ma OBLEWAĆ"
---

## Cel

TL-22 naprawił dokładnie jeden objaw jednej klasy błędu: serwer ignorował nieznane flagi i po cichu otwierał kartę przeglądarki zamiast czegokolwiek zrobić. Ta sama klasa żyje dalej w pięciu komendach, które dispatcher (`cli.mjs`) tylko OWIJA, nie zmienia — bo TL-22 naprawiał serwer, a TL-23/1413 walidację dostały dopiero nowe skrypty (`init-backlog.mjs`, `stats-report.mjs`, `new-task.mjs`).

**Znalezione podczas aktualizacji README** — ręcznym sprawdzeniem każdej komendy `--frobnicate`, nie zgadywaniem:

| Komenda | Nieznana flaga | Skutek |
|---|---|---|
| `serve`, `query`, `new`, `init`, `stats` | OBLEWA (exit ≠ 0) | ✅ jak być powinno |
| `build`, `viewer`, `next-id`, `board` | ignorowana | komenda i tak wykonuje swoje zwykłe działanie — mylące, ale bez efektu ubocznego poza tym, co zrobiłaby normalnie |
| `history` | ignorowana | **z efektem ubocznym**: `arg("--file", "")` w `history-record.mjs` po prostu nie znajduje `--file`, więc leci ścieżką „cały katalog" i wykonuje PRAWDZIWĄ rekoncyliację — dopisuje wpisy historii na dysku |

`worktrail history --help` w tej sesji naprawdę dopisał wpisy do `backlog/history/BL-1170.jsonl` (zmiany `status` i `owner` zrobione przez inną sesję) — nie fabrykację, tylko realny, ale NIEZAMIERZONY efekt uboczny sprawdzenia pomocy. To jest gorsze niż `build`/`viewer`/`next-id`/`board`, które w najgorszym razie coś niepotrzebnie przebudują.

## Kroki

1. `next-backlog-id.mjs` — dodać listę znanych flag (`--explain`, `--dir`) i odrzucać resztę, wzorem `serve-backlog.mjs` z TL-22.
2. `suggest-board.mjs` — flagi `--paths`, `--registry`, `--dir` + pozycyjny plik; reszta oblewa.
3. `build-backlog.mjs` — `--dir`/`--root` + reszta oblewa.
4. `build-viewer.mjs` — `--dir` + reszta oblewa (uwaga: ma tryb `invokedDirectly`, sprawdzić, że walidacja nie łamie importu jako modułu przez inne skrypty).
5. `history-record.mjs` — **priorytet w tej piątce**: `--file`, `--actor`, `--source`, `--dir`, `--quiet` + reszta oblewa PRZED wejściem w `reconcile()`.
6. Test w `cli.test.mjs` albo nowym pliku: każda z pięciu komend z `--frobnicate` kończy się `status !== 0` i nie ma efektu ubocznego (dla `history`: `git status` / stan pliku historii nietknięty).

## Acceptance criteria

- [x] Wszystkie 11 komend `worktrail` reagują tak samo na nieznaną flagę: exit ≠ 0, komunikat z listą dozwolonych, ZERO efektu ubocznego.
- [x] `history --frobnicate` NIE dopisuje nic do `backlog/history/*.jsonl` — sprawdzone na realnym backlogu (`git status backlog/history/` identyczny przed i po).
- [x] README zaktualizowane — tabela „Stan walidacji wejścia” zastąpiona jednym zdaniem: wszystkie 11 komend OBLEWAJĄ jednolicie.
- [x] Testy regresji dla całej piątki (16 przypadków w `flag-validation.test.mjs`), nie tylko dla `history`.

## Notes

Nie robione teraz świadomie: user poprosił o aktualizację README z pełną listą komend, nie o fix. Ten task istnieje, żeby znalezisko nie wyparowało z rozmowy — README już je nazywa i linkuje tutaj.

## Log

- 2026-08-30 created — claude — znalezione ręcznym sprawdzeniem `--frobnicate` na każdej komendzie przy okazji aktualizacji README; `history --help` naprawdę dopisało wpisy historii w tej sesji
- 2026-08-30 board — claude — `suggest-board.mjs <plik-taska>` dał default (bo `related_docs` wskazywał tylko README); `--paths backlog/scripts/history-record.mjs` potwierdził `backlog-project` — zostawione ręcznie ustawione.
- 2026-08-30 done — claude — walidacja domknięta we wszystkich pięciu skryptach. `suggest-board.mjs` okazał się mieć TRZY luki, nie jedną: moje pierwsze testy (skopiowane z listy z tego taska) łapały tylko przypadek „flaga przed plikiem", a ten akurat wychodził na zielono PRZEZ PRZYPADEK (sztywny indeks `argv[2]`), nie dzięki walidacji. Ręczne sprawdzenie ujawniło, że flaga PO pliku i flaga wmieszana w `--paths` przechodziły bez błędu — dopisane jako osobne testy, potem naprawione jednym mechanizmem. `next-backlog-id.mjs` ujawnił przy okazji inny, nieopisany w tym tasku defekt: backlog leżący W KORZENIU repozytorium git (ścieżka względna pusta) cicho podstawia 'backlog' zamiast pustej ścieżki i nic nie znajduje — realny scenariusz dla `worktrail init --dir .`, ale to ODDZIELNY problem od walidacji flag; nie naprawiony tutaj, test dla next-backlog-id świadomie zagnieżdża backlog w podkatalogu repo, żeby nie mierzyć złej rzeczy.
