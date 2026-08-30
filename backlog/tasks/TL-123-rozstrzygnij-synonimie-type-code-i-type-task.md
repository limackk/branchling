---
id: TL-123
title: "Rozstrzygnij synonimię type: code i type: task"
type: task
labels: [pre-launch]
board: main
epic: "Integralność danych"
priority: P3
status: pending
owner: unassigned
estimate: 2h
confidence: high
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-config-and-portability.md
verification:
  - bash: "test $(grep -c '^type: code' backlog/tasks/*.md 2>/dev/null | grep -vc ':0') -eq 0 || grep -q 'code' backlog/config.yaml   # albo migracja, albo zapisana decyzja o zostawieniu"
  - bash: "node scripts/cli.mjs check --vocabulary"
  - manual: "Decyzja zapisana w config.yaml przy `types:` — którym słowem opisuje się zwykłą pracę i dlaczego drugie zostaje albo znika"
---

## Cel

Sprawić, żeby na zwykłą pracę było JEDNO słowo — albo żeby dwa słowa miały
zapisaną, sprawdzalną różnicę.

## Kontekst

Wypadek uboczny TL-56, świadomie z niego wyłączony. Uzgadniając `types:`
z drzewem zmierzono rozkład:

| wartość | plików | pierwszy | ostatni |
|---|---|---|---|
| `code` | 59 | 2026-08-26 | 2026-09-01 |
| `task` | 48 | 2026-08-31 | 2026-09-01 |
| `bug`  | 13 | 2026-08-30 | 2026-08-31 |

`code` i `task` nie dzielą backlogu na dwie klasy pracy — oba są aktywnie pisane
TEGO SAMEGO DNIA i oba stoją na taskach nie do odróżnienia po treści. Próbka
z 2026-09-01: pod `code` leżą „Koperta JSON w komendach piszących" i „Pętla
autonomiczna", pod `task` — „Komenda worktrail plan z --json" i „Nazwa produktu
z jednej stałej". To ta sama robota opisana dwoma słowami.

Skąd się wzięły oba: `code` to wartość z pierwszego commita, `task` weszło
2026-08-31 razem z `_template.md`, który niesie `type: task` na sztywno. Od tej
pory `worktrail new` pisze `task`, a `code` dopisuje się ręczną edycją pliku —
bo `--type code` był do TL-56 ODRZUCANY przez ścieżkę piszącą.

**Dlaczego to nie pojechało w TL-56.** Tamten task zamykał rozjazd słownika
z drzewem i jego naprawa to jedna linia w `config.yaml`. Zwinięcie synonimii to
migracja 59 plików i decyzja o SŁOWNICTWIE projektu, a nie skutek uboczny
naprawy guarda. Właściciel wybrał 2026-09-01 wariant „drzewo jest prawdą, bez
masowego przepisywania" — z tego wyboru ten task został jako reszta.

**Do rozstrzygnięcia jest, czy różnica ma powstać, czy zniknąć.** Trzecia droga
jest realna i tańsza od obu: `type` może w ogóle nie być osią, którą ten projekt
mierzy — wtedy odpowiedzią jest `types: [task, bug]` i migracja, a nie
wymyślanie znaczenia dla `code`.

## Pre-flight reading

1. `backlog/config.yaml` — komentarz przy `types:` opisuje stan i tę odłożoną decyzję.
2. `scripts/check-backlog-vocabulary.mjs` — guard, który od TL-56 pilnuje, że drzewo i słownik się zgadzają.
3. `backlog/_template.md` — źródło `type: task` przy każdym `worktrail new`.

## Kroki

1. Rozstrzygnij z właścicielem: jedno słowo czy dwa z zapisaną różnicą.
2. Jeśli jedno — przepisz drzewo i ZWĘŹ `types:` w tym samym commicie; słownik
   szerszy niż drzewo to ten sam rozjazd, tylko z drugiej strony.
3. Jeśli dwa — zapisz różnicę przy `types:` w `config.yaml` tak, żeby dała się
   zastosować bez pytania autora, i sprawdź ją na dziesięciu istniejących taskach.
4. Uzgodnij `_template.md` z wynikiem — dziś przemyca `task` niezależnie od
   decyzji (to jest osobno TL-69).

## Acceptance criteria

- [ ] `types:` w `config.yaml` zawiera tylko wartości, które ktoś umie rozróżnić.
- [ ] Jeśli została jedna wartość na zwykłą pracę — żaden task nie niesie drugiej.
- [ ] Jeśli zostały dwie — kryterium rozróżnienia stoi w `config.yaml`, nie w cudzej głowie.
- [ ] `worktrail check --vocabulary` zielony po zmianie.
