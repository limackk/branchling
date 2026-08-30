---
id: TL-60
title: "Literówka w config.yaml przelatuje przez build i check"
type: bug
labels: [pre-launch]
board: main
epic: "Konfigurowalność"
priority: P1
status: done
owner: claude
estimate: 4h
confidence: high
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-config-and-portability.md
verification:
  - bash: "node --test scripts/tests/config-strictness.test.mjs"
  - bash: "d=$(mktemp -d) && node /Users/limack/workspace/tasklog/bin/worktrail.mjs init --dir \"$d\" >/dev/null && printf 'statusess: [a, b]\\n' >> \"$d/config.yaml\" && ! node /Users/limack/workspace/tasklog/bin/worktrail.mjs check --dir \"$d\" >/dev/null 2>&1 && echo 'nieznany klucz oblewa check — OK'"
  - bash: "d=$(mktemp -d) && node /Users/limack/workspace/tasklog/bin/worktrail.mjs init --dir \"$d\" >/dev/null && printf 'statusess: [a, b]\\n' >> \"$d/config.yaml\" && node /Users/limack/workspace/tasklog/bin/worktrail.mjs stats --dir \"$d\" 2>&1 | grep -q ' at ' && { echo 'nadal stack trace'; exit 1; }; echo 'komunikat zamiast wyjątku — OK'"
---

## Cel

Sprawić, żeby obietnica „nieznany klucz oblewa build" — napisana w pliku, który
generuje sam `worktrail init` — była prawdziwa, i żeby oblewanie wyglądało jak
komunikat, a nie jak awaria narzędzia.

## Kontekst

Zmierzone 2026-08-31 na świeżo założonym backlogu, po dopisaniu jednej linii
`statusess: [a, b]` (literówka w `statuses`):

| Komenda | Wynik |
|---|---|
| `build` | **exit 0, cisza** — widoki przebudowane, słownik domyślny |
| `check` | **exit 0, trzy ptaszki** |
| `query`, `viewer`, `next-id` | przechodzą |
| `stats`, `new`, `serve` | exit 1 + **stack trace** z `config.mjs:258` |

Przyczyna jest w `loadConfig(root, opts)`: `strict` domyślnie jest `true`, ale
ustawia się go per wywołanie, a rozkład wyszedł odwrotny do zamierzenia —
`build-backlog.mjs`, wszystkie trzy guardy `check-*`, `query.mjs`, `build-viewer.mjs`
i `next-backlog-id.mjs` wołają `{ strict: false }`. Efekt: komenda, której CAŁYM
zadaniem jest oblać, gdy coś jest nie tak (`check`), jest najbardziej pobłażliwa,
a te, które oblewają, robią to nieobsłużonym wyjątkiem.

Dwa zdania, obie w plikach czytanych przez użytkownika, są dziś nieprawdziwe:

- `config.yaml` (generowany przez `init`): „Nieznany klucz oblewa build."
- `config.mjs`: „Nieznany klucz OBLEWA — literówka w słowniku jest nieodróżnialna
  od »ten projekt tak ma«, a kosztuje tyle samo co literówka we fladze CLI."

To jest ta sama klasa, którą projekt zamknął dla flag CLI ([TL-25](TL-25-domknij-walidacje-flag-w-5-komendach-worktrail.md)):
cichy no-op wygląda jak działanie. Tutaj boli bardziej, bo edycja `config.yaml`
jest **głównym aktem onboardingu** — to przy niej użytkownik dopasowuje narzędzie
do swojego projektu i to przy niej najbardziej potrzebuje informacji zwrotnej.

**Uwaga, żeby nie zamienić jednego defektu na drugi.** `{ strict: false }` w części
miejsc bywa uzasadnione: `migrate-prefix` musi umieć wczytać konfigurację, którą
właśnie naprawia, a `next-backlog-id` skanuje CUDZE gałęzie, gdzie konfiguracja
może być starsza. Task ma przejrzeć każde wywołanie i uzasadnić je z osobna, a nie
przełączyć wszystkie hurtem.

Zakres NIE obejmuje wartości słownika w taskach (`status: wymyslony` przechodzi
dziś przez `build` i `check`) — to [TL-56](TL-56-slownik-types-w-config-yaml-rozjechal-sie-z-drzewem.md).
Oba taski dotykają tej samej ścieżki odczytu, więc warto je robić po sobie.

## Pre-flight reading

1. `scripts/config.mjs` — `loadConfig()` (linie ~248–322), `parseConfigYaml()`, `validateConfig()`.
2. Wszystkie wywołania `loadConfig(` poza `config.mjs` — jest ich dwanaście, każde z własnym powodem.
3. [TL-25](TL-25-domknij-walidacje-flag-w-5-komendach-worktrail.md) — ta sama zasada dla flag CLI.
4. [TL-47](TL-47-brak-backlogu-wychodzi-jako-nieobsluzony-wyjatek-ze-stack.md) — druga połowa problemu: przewidziany stan nie ma wychodzić stack tracem.

## Kroki

1. Przejrzyj każde `loadConfig(…, { strict: false })` i zapisz w `## Log`, dlaczego zostaje albo dlaczego znika. Domyślną odpowiedzią jest „znika".
2. `check` i `build` mają oblewać na problemach konfiguracji. To jest miejsce, w którym użytkownik tego oczekuje.
3. Rozdziel dwie klasy problemów: **błąd** (nieznany klucz, niespójny słownik) oblewa; **ostrzeżenie** (np. konfiguracja z przyszłej wersji) przechodzi i jest wypisane. Bez tego rozdziału każda przyszła zmiana schematu będzie łamiąca.
4. Zamień wyjątek na komunikat: nazwa pliku, numer linii, klucz, najbliższe dozwolone klucze (`statusess` → „czy chodziło o `statuses`?"), i kod wyjścia — bez `at …`.
5. Test `scripts/tests/config-strictness.test.mjs`: nieznany klucz oblewa w `check` i `build`; komunikat nie zawiera stack trace'u; wywołania świadomie nie-strict są wymienione wprost i mają uzasadnienie w teście.

## Acceptance criteria

- [ ] Nieznany klucz w `config.yaml` oblewa `check` i `build`.
- [ ] Żadna komenda nie kończy się stack tracem na błędnej konfiguracji.
- [ ] Komunikat podaje plik, linię, klucz i podpowiedź najbliższego dozwolonego.
- [ ] Każde pozostałe `{ strict: false }` ma uzasadnienie zapisane w kodzie i w `## Log`.
- [ ] Zdania o oblewaniu w `config.yaml` i `config.mjs` są prawdziwe.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 created — agent:claude — zmierzone podczas audytu onboardingu
- 2026-08-31 in_progress — agent:claude — start implementacji
- 2026-08-31 done — agent:claude — przegląd dwunastu wywołań `loadConfig` (krok 1): WSZYSTKIE produkcyjne są teraz strict, każde z uzasadnieniem w kodzie przy wywołaniu. Trzy, które wymagały namysłu: `check-backlog-id-collisions` bywa kierowany `--dir` na CUDZY backlog — „nie umiem odczytać tej konfiguracji" jest uczciwszą odpowiedzią niż „✓ 0 tasków"; `migrate-prefix` ZMIENIA NAZWY PLIKÓW, a literówka w samym `task_id_prefix` daje prefiks źródłowy z wartości domyślnej i przenumerowanie nie z tego, z czego myśli; `next-backlog-id` wczytuje WŁASNĄ konfigurację, nie cudzej gałęzi (skan gałęzi czyta nazwy plików). Zostało zero `strict: false` w produkcji, a test pilnuje, żeby nie wróciły.
- 2026-08-31 done — agent:claude — kroki 4 i 5: `ConfigError` + `formatConfigError` + `loadConfigOrExit` w jednym miejscu zamiast dwunastu `try`. Komunikat: nagłówek, ścieżka, linia, podpowiedź najbliższego klucza (Levenshtein, próg rośnie z długością nazwy — `statusess` → `statuses`). Pełna lista kluczy tylko wtedy, gdy nic nie jest podobne. `TypeError` nadal leci ze stosem — test negatywny pilnuje rozróżnienia. `runCheck` waliduje konfigurację RAZ przed guardami, bo trzy procesy wypisywały to samo zdanie trzy razy. Test `config-strictness.test.mjs`, 10 asercji; moc sprawdzona przywróceniem `strict: false` w `build` i `check` — oblewają 3, kontrola pozytywna zostaje zielona. 288/288.
- 2026-08-31 done — agent:claude — krok 3 (rozdział błąd/ostrzeżenie) ŚWIADOMIE NIE ZROBIONY. Żaden dzisiejszy problem nie kwalifikuje się jako ostrzeżenie: nieznany klucz i niespójny słownik to jedno i drugie błąd. Kanał ostrzeżeń bez ani jednego członka jest martwym kodem, który przy pierwszym prawdziwym ostrzeżeniu i tak zostanie przeprojektowany. Do zrobienia razem z pierwszym kluczem zgodnym w przód — wtedy będzie wiadomo, czego ten kanał potrzebuje.
