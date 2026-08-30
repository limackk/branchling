---
id: TL-24
title: "worktrail new — założenie taska z numerem ze skanu wszystkich gałęzi"
type: code
labels: [pre-launch]
board: main
epic: "worktrail — narzędzie"
priority: P2
status: done
owner: claude
estimate: 3h
confidence: high
created: 2026-08-29
updated: 2026-08-29
blocked_by: []
blocks: []
related_docs:
  - backlog/README.md
verification:
  - bash: "./scripts/worktrail new --title \"Test\" --priority P3  # numer zgodny z `worktrail next-id`"
  - bash: "node --test backlog/scripts/tests/new-task.test.mjs"
---

## Cel

Domknąć ostatnią komendę z listy odłożonej w [TL-23](TL-23-worktrail-init-i-stats.md): założenie taska z szablonu, z numerem, slugiem i wypełnionym frontmatterem.

## Kontekst

Zakładanie taska było dotąd ręczne: skopiuj `_template.md`, odpal `next-backlog-id.mjs`, wpisz numer, wymyśl slug, wypełnij daty. Pięć kroków, z których **jeden jest niebezpieczny**.

**Ryzykiem tej komendy jest NUMER, nie plik.** Reguła workspace'u brzmi „nigdy max+1 z własnego drzewa", bo cudza sesja potrafi trzymać kolejne ID na swojej gałęzi, zanim jakikolwiek plik powstanie — dwa taski z tym samym numerem wychodzą dopiero przy merge'u. Stąd trzy zabezpieczenia:

1. Numer bierze `next-backlog-id.mjs`, skanujący WSZYSTKIE worktree i gałęzie.
2. Gdy tamten skan nie zadziała (świeży backlog bez ani jednego `BL-*`, katalog poza repozytorium gita), wchodzi awaryjny skan lokalny — i komenda **głośno mówi**, że zeszła na tę ścieżkę. Lokalny max+1 jest dokładnie tym, przed czym ostrzega reguła; przemilczenie zamieniłoby znane ryzyko w niewidoczne.
3. Zapis jest **wyłączny** (`flag: "wx"`) — zajęty numer kończy się błędem, nigdy nadpisaniem cudzego taska.

**Bug znaleziony w trakcie, przez test:** pierwsza wersja liczyła numer z repozytorium, w którym stoi POWŁOKA, a nie z tego, które zawiera wskazany backlog — `next-backlog-id.mjs` ustala repo przez `git rev-parse --show-toplevel` na bieżącym katalogu. `worktrail new --dir /gdzies/indziej` dostawał numery z the origin project. Naprawione przez `cwd: root` przy wywołaniu.

## Kroki

1. `new-task.mjs`: `slugify` (diakrytyki → ASCII, przycinanie po granicy wyrazu), rozstrzyganie numeru z jawnym źródłem, walidacja wartości ze SŁOWNIKÓW konfiguracji, wypełnienie szablonu, zapis wyłączny.
2. Rejestracja w tabeli komend `cli.mjs`.

## Acceptance criteria

- [x] `worktrail new --title "Zażółć gęślą jaźń"` daje `BL-N-zazolc-gesla-jazn.md` — diakrytyki schodzą do ASCII, nie znikają.
- [x] Numer zgodny z `worktrail next-id`; sprawdzone na realnym drzewie (1413, potem next-id = 1414).
- [x] Pusty backlog daje `BL-1` zamiast błędu, a awaryjne źródło numeru jest ZAPOWIEDZIANE.
- [x] Zajęty numer NIE nadpisuje pliku (test kładzie `BL-1-cudzy.md` i sprawdza bajty).
- [x] Brak `--title`, tytuł bez ani jednej litery, wartość spoza słownika i nieznana flaga OBLEWAJĄ; żaden z tych przypadków nie zostawia pliku.
- [x] Board spoza rejestru oblewa — słownik boardów jest ZAMKNIĘTY; bez `--board` wchodzi `default` i jest to wypisane.
- [x] Utworzony task PRZECHODZI `check`, wchodzi do `build` i jest widoczny w `stats` — asercja na „reszta narzędzia go przyjmuje", nie na „plik istnieje".
- [x] 17 testów `new-task.test.mjs`; pełna suita zielona.

## Notes

**Poprawka testu, nie kodu:** pierwsza asercja „w pliku nie ma `YYYY-MM-DD`" oblewała na poprawnym pliku — ten ciąg występuje też w sekcji `## Log` szablonu jako OPIS FORMATU. Asercja została zawężona do frontmattera; szersza myliła dokumentację z niewypełnionym polem.

**Świadomie poza zakresem:** `--body` / edytor po utworzeniu, automatyczne `suggest-board` (router czyta ŚCIEŻKI, których nowy task jeszcze nie ma), rezerwacja numeru między równoległymi sesjami (wymaga locka — [worktrail-state-and-sync.md §6.1](../../docs/worktrail-state-and-sync.md)).

## Log

- 2026-08-29 created — claude — ostatnia komenda z listy odłożonej w TL-23
- 2026-08-29 done — claude — `new` + naprawa źródła numeru przy `--dir`
