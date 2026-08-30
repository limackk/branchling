---
id: TL-52
title: "Kolor i spójne komunikaty CLI w jednym module ui.mjs"
type: task
labels: [pre-launch]
board: main
epic: "Powierzchnia CLI"
priority: P1
status: done
owner: claude
estimate: 1d
confidence: medium
created: 2026-08-31
updated: 2026-08-31
blocked_by: [TL-51]
blocks: []
related_docs:
  - .claude/skills/worktrail-cli/SKILL.md
  - .claude/skills/worktrail-cli/references/output-style.md
verification:
  - bash: "node --test scripts/tests/ui.test.mjs"
  - bash: "grep -q $'\\033' scripts/ui.mjs || { echo 'kontrola pozytywna: ui.mjs nie ma ani jednej sekwencji, więc test poniżej byłby zielony na pustej próbce'; exit 1; }; test -z \"$(grep -rl $'\\033' scripts --include='*.mjs' | grep -v 'scripts/ui.mjs' | grep -v 'scripts/tests/')\" && echo 'sekwencje sterujące tylko w ui.mjs — OK'"
  - bash: "node scripts/cli.mjs stats 2>&1 >/dev/null | wc -c | grep -q '^ *0$' && echo 'stats: diagnostyka nie miesza się z odpowiedzią — OK'"
  - manual: "Wyjście `stats`, `check`, `query` obejrzane w terminalu i przez `| cat` — ta sama treść, w potoku bez kolorów."
---

## Cel

Dać CLI **jeden moduł stylu**: kolor, symbole, wyrównanie i jednolity kształt
komunikatu błędu — tak, żeby wyjście dało się czytać, a `NO_COLOR` był
właściwością programu, a nie obietnicą każdego pliku z osobna.

## Kontekst

Zmierzone 2026-08-31 na całym drzewie `scripts/` i `bin/`: **zero sekwencji
sterujących**, zero odwołań do `isTTY`, zero obsługi `NO_COLOR` i `FORCE_COLOR`.
Wyjście jest poprawne i całkowicie płaskie.

Do tego prefiksy komunikatów pochodzą z nazw plików, a nie z komendy, którą
wpisał użytkownik:

| Prefiks w kodzie | Co wpisał użytkownik |
|---|---|
| `[build-backlog]` | `worktrail build` |
| `[backlog-viewer]` | `worktrail viewer` |
| `next-backlog-id:` | `worktrail next-id` |
| `suggest-board:` | `worktrail board` |
| `[backlog-history]` | `worktrail history` |
| `[worktrail new]`, `[worktrail stats]` | zgodne |

Nazwa `build-backlog` nie występuje w żadnej pomocy ani dokumentacji użytkownika.
Komunikat, który się nią przedstawia, każe szukać czegoś, czego nie ma.

**Dlaczego to jest task, a nie kosmetyka.** Ten projekt stawia na to, że
deweloper polubi narzędzie na tyle, by naciskać na wdrożenie w firmie. CLI jest
tym, co widzi najpierw. Jednocześnie wyjście musi zostać uczciwe: jest czytane
przez potok, w logu CI i przez ludzi, którzy nie rozróżniają odcieni.

**Reguła, która to spina:** kolor jest podkreśleniem, nigdy informacją. Cokolwiek
mówi kolor, musi też mówić słowo albo znak. Pełny kontrakt — kiedy wolno
kolorować, sześć ról palety na 16 kolorach ANSI, symbole, anatomia błędu, układ
pomocy — jest w `.claude/skills/worktrail-cli/references/output-style.md` i ten task
go realizuje, a nie wymyśla od nowa.

**Kolejność względem [TL-51](TL-51-worktrail-komenda-help-oblewa-w-8-z-12-komend.md):**
najpierw pomoc ma istnieć, potem ma wyglądać. Odwrotna kolejność znaczy
projektowanie układu tekstu, którego w ośmiu komendach nie ma.

## Pre-flight reading

1. `.claude/skills/worktrail-cli/references/output-style.md` — CAŁOŚĆ; ten task jest jego wdrożeniem.
2. `scripts/stats-report.mjs` — dzisiejsze formatowanie (`pad`, `line`) do przeniesienia.
3. `scripts/check-backlog-*.mjs` — komunikaty `✓`/`✗`, czyli jedyne miejsce, gdzie symbole już są.
4. `scripts/query.mjs` — jak wygląda dziś błąd walidacji flagi.

## Kroki

1. `scripts/ui.mjs`: `color` (włączony/wyłączony liczony RAZ przy imporcie), `line`, `heading`, `ok`, `warn`, `fail`, `fatal`, `table`. Nic poza tym modułem nie pisze sekwencji sterujących.
2. Warunek koloru: `NO_COLOR` nieustawione, `TERM` różny od `dumb`, strumień jest TTY, brak `--no-color`. `FORCE_COLOR` i `--color` wymuszają włączenie. Liczone osobno dla stdout i stderr — jeden bywa przekierowany, drugi nie.
3. Paleta: 16 podstawowych kolorów ANSI plus `bold`/`dim`. Bez wartości heksadecymalnych — one ignorują motyw terminala użytkownika.
4. Kolory statusów i priorytetów wyprowadź z `config.yaml` (rola, indeks), nie z nazw wpisanych w kod. Viewer robi to tak od dawna i dzięki temu nowy status dostaje kolor bez zmiany kodu.
5. Przepnij komendy na `ui.mjs`; prefiks komunikatu to nazwa komendy Z TABELI `COMMANDS`, nie nazwa pliku.
6. Ujednolić anatomię błędu: co się stało → czego oczekiwano (konkretna lista) → co zrobić dalej (komenda do wklejenia).
7. `--json` nie dostaje ani koloru, ani nagłówka — coś to parsuje.
8. `--no-color` do walidacji flag każdej komendy (dziś nieznana flaga oblewa, więc bez tego kroku flaga byłaby błędem).
9. Testy `scripts/tests/ui.test.mjs`: `NO_COLOR=1` wyłącza, `FORCE_COLOR=1` włącza mimo braku TTY, wyjście bez koloru jest identyczne co do treści, `--json` nigdy nie zawiera sekwencji.

## Acceptance criteria

- [ ] `scripts/ui.mjs` istnieje i jest jedynym plikiem produkcyjnym z sekwencjami sterującymi.
- [ ] `NO_COLOR=1` daje czysty tekst w każdej komendzie; potok też.
- [ ] `FORCE_COLOR=1` włącza kolor bez TTY.
- [ ] Prefiks każdego komunikatu to nazwa komendy, którą wpisuje użytkownik.
- [ ] Każdy komunikat błędu mówi, co zrobić dalej.
- [ ] Kolory statusów/priorytetów pochodzą z konfiguracji, nie z literałów.
- [ ] `--json` bez koloru i bez ozdobników.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 created — agent:claude — z audytu powierzchni CLI
- 2026-08-31 done — agent:claude — `scripts/ui.mjs`: `colorAllowed` liczone RAZ przy imporcie i OSOBNO dla stdout i stderr (jeden bywa przekierowany, gdy drugi nie), sześć ról palety na 16 podstawowych kolorach ANSI, `MARK`, `line`, `table`, `heading`, `failure`/`fail`, `statusPaint`/`priorityPaint`. Zero wartości heksadecymalnych: szesnastka jest odwzorowywana przez MOTYW terminala, więc zachowuje cudzy kontrast i cudze tło — ręcznie dobrany odcień wygląda dobrze tylko na tle, na którym go dobierano.
- 2026-08-31 done — agent:claude — `--no-color`/`--color` obsłużone RAZ, w dispatcherze: zdejmowane z argumentów i przekazywane dziecku ŚRODOWISKIEM, którego `ui.mjs` i tak słucha. Alternatywą było dopisanie obu flag do listy dozwolonych w dwunastu komendach, czyli dwanaście okazji, żeby o którejś zapomnieć. Walidacja flag w komendach nietknięta.
- 2026-08-31 done — agent:claude — 42 wystąpienia prefiksów z nazwami plików zamienione na nazwę KOMENDY: `[build-backlog]` → `worktrail build:`, `next-backlog-id:` → `worktrail next-id:`, `[backlog-serve]` → `worktrail serve:` i osiem innych. Żadna z tamtych nazw nie występuje w pomocy ani w dokumentacji, więc komunikat kazał szukać czegoś, czego nie ma. Test skanuje drzewo, żeby nie wróciły.
- 2026-08-31 done — agent:claude — przy okazji: błąd `check` przestał przepisywać całe `usage`. Odkąd `check --help` działa (TL-51), komunikat ma nazwać flagę i wskazać drogę — komunikat dłuższy od pomocy przestaje być komunikatem.
- 2026-08-31 done — agent:claude — test `ui.test.mjs`, 13 asercji. Najważniejsza porównuje `check` uruchomiony z `NO_COLOR=1` i z `FORCE_COLOR=1` po zdjęciu sekwencji: treść MUSI być identyczna, bo kolor jest podkreśleniem, nigdy informacją. Moc obu asercji policyjnych sprawdzona przez sabotaż — dopisany escape poza `ui.mjs` oblewa skan, a malarz doklejający tekst tylko w kolorze oblewa porównanie treści. Skan zna oba zapisy sekwencji (znak i escape JS), bo inaczej wystarczyłaby zmiana zapisu, żeby przemycić własne kolorowanie. 341/341.
- 2026-08-31 done — agent:claude — KOREKTA STANU. Praca była skończona i zacommitowana (39771a4), ale frontmatter został na `pending`: wywołanie, które miało przestawić status na `in_progress`, zostało odrzucone w całości razem z zapisem `ui.mjs`, a przy zamykaniu podmiana `in_progress` → `done` nie znalazła wzorca i przeszła po cichu. Log mówił `done`, pole mówiło `pending` — i żadna bramka tego nie widziała. Guard na ten rozjazd: [TL-68](TL-68-log-mowi-done-frontmatter-mowi-pending-nikt-tego-nie-lapie.md).
