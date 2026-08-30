---
id: TL-70
title: "Komentarz przy polu szablonu wchodzi do wartości pola"
type: task
labels: [pre-launch]
board: main
epic: "Backlog — publikacja open source"
priority: P1
status: done
owner: agent:claude
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs: []
verification:
  - bash: "d=$(mktemp -d); node scripts/cli.mjs init --dir \"$d\" >/dev/null && node scripts/cli.mjs new --dir \"$d\" --title 'Sprawdzenie parsera' >/dev/null && node scripts/cli.mjs query --dir \"$d\" --json | grep -q '\"epic\": \"\"' && { echo 'epic pusty — OK'; rm -rf \"$d\"; } || { echo 'komentarz wszedł do wartości pola'; rm -rf \"$d\"; exit 1; }"
---

## Cel

`worktrail new` na świeżym backlogu ma dawać task, którego pola mają wartości
wpisane w szablonie — a nie treść komentarza stojącego za wartością.

## Kontekst

Zmierzone 2026-08-31 na czystym drzewie z `worktrail init`:

```console
$ worktrail new --title "Napisz README"
$ worktrail query
- {id: TASK-2, …, epic: "\"                           # wolny tekst — grupa, w której ten task się liczy", title: "…"}
```

Parser frontmattera nie ucina komentarza `#` stojącego **za wartością w
cudzysłowie**. Linia `epic: ""   # wolny tekst — …` daje wartość, która jest
sklejeniem drugiego cudzysłowu i całego komentarza.

To jest widoczne w PIERWSZEJ minucie pracy z narzędziem: `_template.md` pisany
przez `worktrail init` komentuje w ten sposób osiem pól, a `epic` jest jedynym
z nich, którego wartością domyślną jest pusty string w cudzysłowie — reszta
(`labels: []`, `board: main`, `priority: P1`) nie jest cudzysłowowana, więc
przechodzi. Skutek widać w `query`, w `--json`, w INDEX-ie i w viewerze:
narzędzie pokazuje sam siebie jako zepsute, zanim użytkownik cokolwiek zrobił.

Wybór, który trzeba świadomie podjąć: naprawić parser (komentarz po
zamkniętym cudzysłowie jest komentarzem) czy usunąć komentarz z tej jednej
linii szablonu. **Naprawa parsera jest właściwa** — komentarz przy polu to
konwencja całego `config.yaml` i `_template.md`, a obejście przez usunięcie
komentarza zostawia pułapkę dla każdego, kto skomentuje własne pole
tekstowe. Usunięcie komentarza nie jest naprawą, tylko ominięciem próbki.

Znalezione przy TL-49 (przepisanie README) — flow „pierwsze pięć minut"
z README przechodzi przez dokładnie tę ścieżkę.

## Pre-flight reading

1. `scripts/task-fields.mjs` — parser frontmattera i walidacja pól.
2. `_template.md` w korzeniu repozytorium — szablon, który `init` kopiuje.
3. `docs/backlog-config-and-portability.md` — granica kształt/wartości.

## Kroki

1. Odtwórz błąd: `worktrail init --dir <tmp>` → `worktrail new --dir <tmp> --title x` → `worktrail query --dir <tmp> --json`.
2. Napraw ucinanie komentarza po zamkniętym cudzysłowie w parserze frontmattera; komentarz WEWNĄTRZ cudzysłowu ma zostać częścią wartości.
3. Dołóż test jednostkowy na obie strony: `a: "x" # c` → `x`, oraz `a: "x # c"` → `x # c`.
4. Sprawdź, czy ta sama ścieżka nie dotyczy `config.yaml` i `boards.yaml`.

## Acceptance criteria

- [x] `worktrail new` na świeżym `init` daje `epic: ""`.
- [x] Test pokrywa komentarz za wartością ORAZ `#` wewnątrz cudzysłowu.
- [x] Kontrola pozytywna: test oblewa na kodzie sprzed naprawy.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 created — agent:claude — znalezione przy TL-49, na flow z README
- 2026-09-01 in_progress — agent:claude — pięć kopii parsera frontmattera, jedna poprawna; naprawa przez konsolidację na task-fields.mjs
- 2026-09-01 done — agent:claude — parser skonsolidowany na `task-fields.mjs` (`stripComment`/`unquote` wyeksportowane); poprawione: query.mjs, build-backlog.mjs, parseBoardsYaml, check-backlog-{boards,refs,id-collisions}.mjs, migrate-prefix.mjs. Nowy `scripts/tests/frontmatter-comments.test.mjs` — każda z siedmiu poprawek ma osobną kontrolę pozytywną (oblewa po cofnięciu tylko tego pliku). 367/367 zielone.
