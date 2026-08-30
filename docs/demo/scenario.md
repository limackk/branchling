# Demo pierwszego kontaktu — 60 sekund

Skrypt nagrania, które wisi w nagłówku README. **To jest plik wykonywalny w
sensie dosłownym**: `scripts/tests/demo-scenario.test.mjs` odtwarza poniższe
komendy przy każdym uruchomieniu testów i oblewa, jeśli CLI przestało zachowywać
się tak, jak opisuje ten dokument. Screenshot gnije po cichu; ten scenariusz nie.

## Co ma zobaczyć widz

Jedną scenę, której nie da się nagrać żadnym innym narzędziem z tej kategorii:
**`worktrail done` ODMAWIA zamknięcia taska**, bo jego własna weryfikacja oblała.
Pokazuje wyjście testu, zostawia plik nietknięty i mówi to wprost. Dopiero po
naprawie kodu to samo wywołanie przechodzi i samo odhacza kryterium.

Kolejność jest odwrotna niż w typowym demo — **porażka najpierw**. Sukces bez
poprzedzającej odmowy wygląda jak każdy inny tracker.

Wszystko, co widać na ekranie — komendy, komentarze, treść taska — jest po
angielsku. Nagranie jedzie do cudzych repozytoriów, tak jak reszta powierzchni
publicznej.

## Warunki nagrania

- Świeży, pusty katalog z `git init` — widz ma zobaczyć start od zera.
- Binarka `worktrail` na `PATH` (`npm link` albo instalacja globalna). Na
  nagraniu nie może pojawić się `node …/scripts/cli.mjs` — to ścieżka
  developerska, nie sposób użycia narzędzia.
- Prompt skrócony do jednego znaku; szeroki terminal (min. 100 kolumn), żeby
  czerwony blok odmowy nie zawijał się w połowie zdania.

## Scenariusz

### Scena 0 — start od zera (ok. 8 s)

```bash
mkdir parser && cd parser && git init -q
worktrail init --dir ./backlog
```

Oczekiwane: lista utworzonych katalogów i jedna linia `next:`.

### Scena 1 — task, który obiecuje dowód (ok. 12 s)

```bash
worktrail new --title "Parser accepts an empty file"
```

W wygenerowanym pliku podmieniamy dwie rzeczy z szablonu — i to jest jedyna
edycja ręczna w całym nagraniu:

```yaml
verification:
  - id: empty-file
    bash: "node --test parse.test.mjs"
```

```markdown
- [ ] `parse("")` returns no rows. [proof: empty-file]
```

oraz `status: in_progress`.

To jest cały kontrakt: kryterium wskazuje wpis weryfikacji, który je udowadnia.

### Scena 2 — kod, który „prawie" działa (ok. 8 s)

`parse.mjs`:

```js
export function parse(text) {
  return text.split("\n").map((line) => line.trim());
}
```

`parse.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "./parse.mjs";

test("an empty file parses to no rows", () => {
  const rows = parse("");
  assert.equal(rows.length, 0, `expected 0 rows, got ${JSON.stringify(rows)}`);
});
```

Pusty tekst rozpada się na jedną pustą linię. Błąd jednoznaczny i mieszczący się
na ekranie — nie o niego tu chodzi.

### Scena 3 — ODMOWA (ok. 18 s, to jest cała pointa)

```bash
worktrail done TASK-2
```

Oczekiwane wyjście, w tej kolejności:

```
  TASK-2 — 1 verification entry, run in /…/parser

  1/1  empty-file  bash: node --test parse.test.mjs
✖ an empty file parses to no rows
  AssertionError [ERR_ASSERTION]: expected 0 rows, got [""]
  …

✗ worktrail done: TASK-2: verification failed (exit 1)
  `node --test parse.test.mjs`

  The task file was NOT touched — its status is still `in_progress`.
```

Kod wyjścia: **niezerowy**. Trzy rzeczy muszą być czytelne na stopklatce:
komenda, która oblała, wyjście prawdziwego testu, i zdanie o nietkniętym pliku.
Ta ostatnia linia jest tezą całego narzędzia — status nie jest deklaracją.

Jeśli nagranie ma mieć jedną klatkę w miniaturze GIF-a, to jest ta klatka.

### Scena 4 — naprawa i zielone zamknięcie (ok. 14 s)

```js
export function parse(text) {
  if (text.trim() === "") return [];
  return text.split("\n").map((line) => line.trim());
}
```

```bash
worktrail done TASK-2
```

Oczekiwane:

```
  1/1  empty-file  bash: node --test parse.test.mjs
  ✓ passed

  ✓ TASK-2 closed — status in_progress → done
    ticked 1 criterion from the run
```

### Scena 5 — kto to odhaczył (ok. 6 s)

```bash
git diff --stat
```

Kryterium jest odhaczone `[x]`, w `## Log` przybyła linia, a wpis w
`backlog/history/` mówi kto i czym. Nikt nie kliknął „done".

## Poza kadrem

- Żadnego tour po komendach. `query`, `stats`, viewer — nie w tym nagraniu.
- Żadnego przyspieszania w scenie 3; widz ma zdążyć przeczytać odmowę.
- Pliki nagrania (`.cast`, `.gif`) **nie jadą w paczce npm** — `files` w
  `package.json` jest listą dozwoleń i nie zawiera `docs/`. Z tego samego powodu
  odnośnik w README musi być URL-em absolutnym: README jedzie w tarballu, a
  ścieżka względna byłaby tam martwa.
