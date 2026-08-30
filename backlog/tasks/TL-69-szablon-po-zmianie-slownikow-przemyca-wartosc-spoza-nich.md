---
id: TL-69
title: "Szablon po zmianie słowników przemyca wartość spoza nich"
type: bug
labels: [pre-launch]
board: main
epic: "Integralność danych"
priority: P2
status: pending
owner: unassigned
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-config-and-portability.md
verification:
  - bash: "node --test scripts/tests/template-vocabulary.test.mjs"
  - bash: "d=$(mktemp -d); T=/Users/limack/workspace/tasklog/bin/worktrail.mjs; node $T init --dir \"$d\" --no-example >/dev/null; sed -i '' 's/^statuses: .*/statuses: [todo, doing, shipped]/; s/^archived_statuses: .*/archived_statuses: [shipped]/; s/^dashboard_open_statuses: .*/dashboard_open_statuses: [todo, doing]/' \"$d/config.yaml\"; node $T new --dir \"$d\" --title Proba >/dev/null 2>&1 && { echo 'zapisał task ze statusem spoza słownika'; exit 1; }; echo 'zapis zatrzymany albo poprawiony — OK'"
---

## Cel

Nie pozwolić, żeby `worktrail new` zapisał task z wartością spoza słownika tylko
dlatego, że stoi ona w szablonie.

## Kontekst

Zmierzone 2026-08-31 na świeżym backlogu, po dopasowaniu statusów do własnego
procesu — czyli po najczęstszym kroku onboardingu:

```
$ sed -i 's/^statuses: .*/statuses: [todo, doing, shipped]/' config.yaml
$ worktrail new --title "Proba"
worktrail new: …/tasks/TASK-1-proba.md      # bez słowa protestu
$ grep '^status:' tasks/TASK-1-proba.md
status: pending                            # wartości `pending` nie ma w słowniku
```

`new-task.mjs` sprawdza wartości, które dostał WE FLAGACH (`--status`,
`--priority`, `--type`, `--owner`) — i robi to dobrze. Nie sprawdza natomiast
wartości, które wchodzą do pliku Z SZABLONU, a szablon jest kopią domyślnych
słowników z chwili `worktrail init` i po zmianie konfiguracji się z nią rozjeżdża.

Efekt jest przewrotny: komenda odmówi zapisu, gdy jawnie podasz `--status
pending`, ale zapisze dokładnie to samo, gdy nie podasz nic.

`worktrail doctor` łapie to PO fakcie (wiersz „słowniki a drzewo"), więc stan nie
jest niewidoczny — jest tylko wykrywany o jeden krok za późno, u kogoś, kto
tymczasem założył kilkanaście tasków.

Warianty naprawy, do rozstrzygnięcia w tasku:

| | Za | Przeciw |
|---|---|---|
| walidować frontmatter PO złożeniu z szablonu | łapie każdą wartość, nie tylko flagi | odmowa dotyczy pliku, którego użytkownik nie pisał — komunikat musi kierować do szablonu, nie do polecenia |
| podstawiać PIERWSZĄ wartość ze słownika, gdy ta z szablonu jest spoza | zawsze da się założyć task | zmienia cudzą treść po cichu; a „pierwszy status" nie zawsze znaczy „nowy" |
| ostrzegać i zapisywać | nic nie blokuje | ostrzeżenie przy każdym `new` przestaje być czytane |

Moja rekomendacja to pierwszy wariant, z komunikatem mówiącym wprost, że to
`_template.md` rozjechał się z `config.yaml` — bo to jest prawdziwa przyczyna i
naprawa jest jednorazowa, a nie przy każdym tasku.

## Pre-flight reading

1. `scripts/new-task.mjs` — tablica `checks` (walidacja flag) i `createTask()`.
2. `scripts/task-fields.mjs` — `buildFieldSpecs`, `auditVocabulary`; ta druga już umie ocenić gotowy frontmatter.
3. `scripts/doctor.mjs` — wiersz „słowniki a drzewo"; ten sam pomiar, tylko po fakcie.

## Kroki

1. Rozstrzygnij wariant i zapisz powód w `## Log`.
2. Po złożeniu treści z szablonu, a PRZED zapisem, oceń frontmatter tym samym
   pomiarem, którego używa `doctor` — jeden pomiar, nie drugi zestaw reguł.
3. Komunikat ma nazywać pole, wartość, słownik i **plik szablonu** jako miejsce
   naprawy; inaczej użytkownik będzie szukał błędu w swoim poleceniu.
4. `worktrail init` mógłby przy okazji ostrzegać, gdy szablon w katalogu rozjeżdża
   się z konfiguracją — ale to jest wniosek do rozważenia, nie wymóg.
5. Test: po zmianie słowników `new` bez flag nie zapisuje wartości spoza nich;
   kontrola pozytywna — na niezmienionej konfiguracji `new` nadal działa.

## Acceptance criteria

- [ ] `worktrail new` bez flag nie zapisuje wartości spoza słowników.
- [ ] Komunikat wskazuje `_template.md` jako miejsce naprawy.
- [ ] Na niezmienionej konfiguracji `new` działa bez zmian.
- [ ] Ocena frontmattera używa tego samego pomiaru co `doctor`.
- [ ] Wybrany wariant uzasadniony w `## Log`.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 created — agent:claude — trafione przy TL-50, gdy sprawdzałem, czy nowy szablon niczego nie przemyca. Defekt jest starszy niż tamta zmiana: szablon zawsze niósł stałe wartości, tylko nikt nie sprawdzał, co się dzieje po zmianie słowników.
