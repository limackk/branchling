---
id: TL-58
title: "Wartość zaczynająca się od myślnika oblewa w worktrail new"
type: bug
labels: [post-launch]
board: main
epic: "Powierzchnia CLI"
priority: P3
status: pending
owner: unassigned
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - .claude/skills/worktrail-cli/SKILL.md
verification:
  - bash: "node --test scripts/tests/new-task.test.mjs"
  - bash: "d=$(mktemp -d) && node scripts/cli.mjs init --dir \"$d\" >/dev/null && node scripts/cli.mjs new --dir \"$d\" --title -- '--json na komendach czytających' >/dev/null && ls \"$d\"/tasks | grep -q json && echo 'tytuł z myślnikiem — OK'"
---

## Cel

Pozwolić na wartość flagi zaczynającą się od `-`, bo dziś tytuł taska o fladze
CLI jest nie do zapisania.

## Kontekst

Zmierzone 2026-08-31 przy zakładaniu tasków z tego samego audytu:

```
$ worktrail new --title "--json na komendach czytających: check, next-id, board" …
[worktrail new] --title wymaga wartości
```

Przyczyna jest w `parseArgs()` w `scripts/new-task.mjs`: warunek
`argv[i + 1].startsWith("-")` traktuje każdą wartość zaczynającą się od myślnika
jako brak wartości. Ta heurystyka istnieje po to, żeby `--title --board main`
oblało zamiast założyć task o tytule „--board" — i to jest słuszny cel. Cena jest
taka, że wartość, która LEGALNIE zaczyna się od myślnika, staje się niezapisywalna.

Standardowe rozstrzygnięcie tej dwuznaczności to separator `--`: wszystko po nim
jest wartością, nigdy flagą. Jest to konwencja, którą użytkownik CLI już zna z
`git`, `rm` i `xargs`, więc nie wymaga tłumaczenia w pomocy — wymaga tylko
obsłużenia.

**Zasięg jest szerszy niż `new`.** Ten sam wzorzec siedzi w innych komendach
(`query --text -foo`, `migrate-prefix`). Task ma sprawdzić wszystkie parsery flag,
a nie tylko ten, na którym problem wyszedł.

Niski priorytet, bo obejście jest natychmiastowe (przeformułowanie tytułu), a
bezpośrednia strata to jedna zablokowana forma zapisu. Nie znaczy to, że defekt
jest nieszkodliwy: to parser, który myli wartość z flagą, czyli ta sama klasa co
cichy no-op — tyle że oblewa głośno, więc kosztuje minutę zamiast dnia.

## Pre-flight reading

1. `scripts/new-task.mjs` — `FLAGS`, `parseArgs()`.
2. `scripts/query.mjs` — drugi parser flag, ten sam warunek do sprawdzenia.
3. [TL-25](TL-25-domknij-walidacje-flag-w-5-komendach-worktrail.md) — dlaczego nieznana flaga oblewa; ta reguła zostaje nietknięta.

## Kroki

1. Obsłuż `--` we wspólny sposób: wszystko po separatorze jest wartością pozycyjną albo wartością poprzedzającej flagi.
2. Zachowaj dzisiejszą ochronę: `--title --board` BEZ separatora nadal oblewa, bo to prawie na pewno pomyłka.
3. Przejrzyj pozostałe parsery flag pod tym samym kątem; jeśli wzorzec się powtarza, to argument za wspólnym parserem, ale wydzielenie go jest osobnym taskiem, nie tym.
4. Testy: tytuł zaczynający się od `-` przechodzi po separatorze; `--title --board` bez separatora nadal oblewa kodem 2.

## Acceptance criteria

- [ ] `worktrail new --title -- "--json …"` zakłada task z tym tytułem.
- [ ] `worktrail new --title --board main` nadal oblewa kodem 2.
- [ ] Pozostałe parsery flag sprawdzone; wynik przeglądu zapisany w `## Log`.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 created — agent:claude — defekt trafiony przy zakładaniu TL-57
