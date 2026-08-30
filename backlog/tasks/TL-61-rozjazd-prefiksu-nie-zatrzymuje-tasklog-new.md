---
id: TL-61
title: "Rozjazd prefiksu nie zatrzymuje worktrail new"
type: bug
labels: [pre-launch]
board: main
epic: "Integralność danych"
priority: P1
status: done
owner: claude
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-config-and-portability.md
verification:
  - bash: "node --test scripts/tests/prefix-mismatch-on-write.test.mjs"
  - bash: "d=$(mktemp -d); T=/Users/limack/workspace/tasklog/bin/worktrail.mjs; node $T init --dir \"$d\" >/dev/null; node $T new --dir \"$d\" --title Pierwszy >/dev/null 2>&1; sed -i '' 's/^task_id_prefix: .*/task_id_prefix: INNY/' \"$d/config.yaml\"; node $T new --dir \"$d\" --title Drugi >/dev/null 2>&1 && { echo 'new nadal zapisuje mimo rozjazdu'; exit 1; }; echo 'new odmawia przy rozjeździe — OK'"
---

## Cel

Zastosować istniejącą bramkę rozjazdu prefiksu do ścieżki, która naprawdę pisze
task — dziś chroni tylko przebudowę widoków.

## Kontekst

Zmierzone 2026-08-31, świeży backlog, prefiks zmieniony PO utworzeniu taska:

```
$ sed -i 's/ACME/OPS/' config.yaml
$ worktrail build
✗ backlog: konfiguracja mówi `task_id_prefix: OPS`, ale w …/tasks
  nie ma ANI JEDNEGO taska o tym prefiksie — są za to: ACME
  Przerywam PRZED zapisem. […] albo przenumeruj drzewo: `worktrail migrate-prefix --to OPS`

$ worktrail new --title "Drugie"
[worktrail new] …/tasks/OPS-1-drugie.md
```

Drzewo ma teraz `ACME-1` i `OPS-1` obok siebie, dwie przestrzenie numerów i
numerację, która zaczęła się od nowa.

Komunikat z `build` jest wzorcowy — mówi co, dlaczego przerywa przed zapisem i
podaje dwie drogi wyjścia, w tym `migrate-prefix --dry-run`. Problem polega na
tym, gdzie mieszka: `detectPrefixMismatch()` jest wołane **wyłącznie** w
`build-backlog.mjs`. `new-task.mjs` go nie woła.

**Skąd nieporozumienie.** Zasada zapisana w `CLAUDE.md` brzmi „rozjazd
konfiguracji z drzewem OBLEWA przed zapisem" i jest spełniona — ale chodzi w niej
o zapis WIDOKÓW. Zapis, który robi użytkownik, to zapis TASKA, i ten nie jest
chroniony. Nazwa zasady jest szersza niż jej wdrożenie, więc czytający kod ma
prawo sądzić, że jest bezpieczny.

**Dlaczego trafia to akurat nowego użytkownika.** Zmiana prefiksu na własny
(`TASK` → `ACME`) jest jedną z pierwszych rzeczy, które robi zespół
dostosowujący narzędzie. Zrobiona przed pierwszym taskiem jest darmowa i działa
czysto — sprawdzone. Zrobiona po kilku taskach po cichu rozszczepia backlog, a
objaw (`build` oblewa) pojawia się dopiero przy następnej regeneracji i wskazuje
na rozjazd, nie na to, że właśnie powstał drugi prefiks.

`migrate-prefix` istnieje dokładnie po to. Brakuje tylko czegoś, co skieruje do
niego w chwili, w której jest potrzebny.

## Pre-flight reading

1. `scripts/task-id.mjs` — `detectPrefixMismatch()`, `prefixMismatchMessage()`; komunikat jest gotowy do ponownego użycia.
2. `scripts/build-backlog.mjs` ~215 — jedyne dzisiejsze wywołanie bramki.
3. `scripts/new-task.mjs` — `main()`, `nextId()`; tu ma trafić sprawdzenie, PRZED wyliczeniem numeru.
4. `scripts/migrate-prefix.mjs` — droga wyjścia, na którą kieruje komunikat.

## Kroki

1. W `new-task.mjs`, przed wyliczeniem numeru i przed zapisem, sprawdź rozjazd tą samą funkcją i wypisz ten sam komunikat. Ta sama treść w obu miejscach jest zaletą, nie duplikacją — użytkownik ma zobaczyć to samo zdanie niezależnie od tego, która komenda go zatrzymała.
2. Przejrzyj pozostałe ścieżki piszące (`serve-backlog.mjs` zapisuje pola, `history-record.mjs` dopisuje historię) i rozstrzygnij, czy potrzebują tej samej bramki. Wynik zapisz w `## Log`.
3. Rozważ, czy komunikat w kontekście `new` nie powinien dodawać jednej linii: „jeśli backlog jest jeszcze pusty, wystarczy poprawić `task_id_prefix`" — bo dla nowego użytkownika to jest najczęstszy przypadek i najtańsze wyjście.
4. Test `scripts/tests/prefix-mismatch-on-write.test.mjs`: po zmianie prefiksu na drzewie z taskami `new` odmawia i nic nie zapisuje; na PUSTYM drzewie `new` działa bez przeszkód (kontrola pozytywna — bez niej bramka mogłaby blokować normalny start).

## Acceptance criteria

- [ ] `worktrail new` odmawia zapisu przy rozjeździe prefiksu z drzewem.
- [ ] Nic nie jest zapisywane, gdy odmawia.
- [ ] Na pustym drzewie zmiana prefiksu nadal działa bez przeszkód.
- [ ] Komunikat kieruje do `migrate-prefix --dry-run`.
- [ ] Pozostałe ścieżki piszące przejrzane, wynik w `## Log`.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 created — agent:claude — zmierzone podczas audytu onboardingu; ACME-1 i OPS-1 powstały obok siebie
- 2026-08-31 in_progress — agent:claude — start implementacji
- 2026-08-31 done — agent:claude — `detectPrefixMismatch` wołane w `new-task.mjs` PRZED `nextId()` (nie ma powodu płacić za skan gałęzi, którego wynik przepadnie). `prefixMismatchMessage` dostał parametr `consequence`: `build` mówi o pustych widokach, `new` o dwóch przestrzeniach numerów — wspólna przyczyna i wspólne wyjście, różny skutek. Test `prefix-mismatch-on-write.test.mjs`, 5 asercji, z kontrolą pozytywną „na pustym drzewie zmiana prefiksu nadal działa" (bramka blokująca za dużo popsułaby najczęstszy krok onboardingu). Moc sprawdzona wyłączeniem warunku: oblewają 3 z 5, kontrola pozytywna i `build` zostają zielone. 278/278.
- 2026-08-31 done — agent:claude — przegląd pozostałych ścieżek piszących (krok 2): `history-record.mjs` bramki NIE dostaje świadomie — historia jest z założenia prefix-agnostyczna (`ANY_TASK_ID`), bo ID musi zostać czytelne właśnie po migracji; `migrate-prefix.mjs` z definicji pracuje na rozjeździe; `serve-backlog.mjs` edytuje ISTNIEJĄCE pliki, więc nie tworzy ID — przy rozjeździe liczy taski prefix-agnostycznie i wypisuje „build-backlog.mjs nie przeszedł — widoki mogą być nieaktualne". Zachowanie jest bezpieczne, ale komunikat nie mówi, że przyczyną jest prefiks. Osobny, drobny defekt — nie rozszerzałem tu zakresu.
