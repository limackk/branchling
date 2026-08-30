---
id: TL-117
title: "Nazwa produktu z jednej stałej, a nie z literału"
type: task
labels: [pre-launch]
board: main
epic: "Backlog — publikacja open source"
priority: P1
status: done
owner: agent:claude
estimate: 3h
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - CLAUDE.md
verification:
  - id: no-name-literals
    bash: "node scripts/cli.mjs check --product-name"
  - id: guard-has-force
    bash: "node --test scripts/tests/product-name.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Cel

Zmiana nazwy produktu kosztuje **jedną edycję `package.json`**, a nie sweep po
drzewie. Dziś to twierdzenie jest w CLAUDE.md i w docstringu
`scripts/product.mjs` zapisane jako fakt, a faktem nie jest.

## Kontekst

`scripts/product.mjs` powstał w [TL-33](TL-33-packaging-instalacja-globalna-i-npx.md)
właśnie po to, żeby nazwa miała jedno źródło — i eksportuje `PRODUCT_NAME`
czytane z `package.json`. **Tyle że prawie nikt go nie używa.** Reszta
`scripts/` nadal wpisuje nazwę jako literał w tekstach pomocy, komunikatach
błędów, docstringach i szablonach zapisywanych do cudzych repozytoriów.

Dowód jest empiryczny, nie teoretyczny: **2026-09-01 zmiana `tasklog` →
`worktrail` dotknęła 158 plików** (26 w `scripts/`, 21 w `scripts/tests/`, 89
w `backlog/tasks/`, plus README, `_template.md`, CLAUDE.md, `.gitignore`,
`package.json` i cztery skille). Deklarowana „jedna edycja" była w praktyce
`sed`-em po całym drzewie — czyli dokładnie tym, czego `product.mjs` miał
zabronić. To jest też odpowiedź na krok 2 z
[TL-81](TL-81-kanaly-dystrybucji-i-kolizja-nazwy-tasklog-w-npx.md), który
kazał to twierdzenie sprawdzić `grep`-em zamiast zakładać.

**Dlaczego to jest P1, a nie kosmetyka.** Nazwa `worktrail` NIE jest
zarezerwowana na npm (otwarte ryzyko z TL-20 i TL-33). Jeśli ktoś ją zajmie
przed publikacją, trzeba będzie zmienić nazwę jeszcze raz — a wtedy koszt tej
zmiany zapłacimy drugi raz w tej samej wysokości. Wartość tego taska jest
najwyższa PRZED publikacją i spada do zera po niej.

**Gdzie literał musi zostać** i nie jest to dług: klucz `bin` i pole `name`
w `package.json` (to jest źródło), nazwa pliku `bin/worktrail.mjs`, oraz
fallback w `product.mjs`.

**Uwaga na `git-rules.mjs`.** `BLOCK_OPEN` / `BLOCK_CLOSE` (`# >>> worktrail`)
są zapisywane do `.gitignore` i `.gitattributes` **cudzych** repozytoriów.
Znacznik jest kluczem, po którym `init` odnajduje swój blok przy ponownym
uruchomieniu — więc gdy nazwa zmieni się PO publikacji, użytkownik dostanie
drugi blok zamiast aktualizacji pierwszego. Dopóki nic nie jest opublikowane,
problem nie istnieje; po publikacji wymaga rozpoznawania obu znaczników.

## Kroki

1. `grep -rn` po literałach nazwy w `scripts/` i `bin/` — pełna lista miejsc.
2. Przepiąć teksty na `PRODUCT_NAME` z `scripts/product.mjs`. Uwaga na miejsca,
   gdzie nazwa jest wewnątrz template literala albo wewnątrz stringa
   wstrzykiwanego do viewera (`build-viewer.mjs` — tam idzie do HTML).
3. Rozstrzygnąć `git-rules.mjs`: czy znacznik bloku bierze nazwę z
   `PRODUCT_NAME`, czy zostaje stałą literalną na zawsze. **To jest decyzja,
   nie refaktor** — patrz „Uwaga" wyżej; oba wyjścia są obronne, ale trzeba
   wybrać świadomie i zapisać powód.
4. Dołożyć guard, który OBLEWA na literale nazwy poza `product.mjs`
   i `package.json` — inaczej dług wróci przy pierwszym nowym pliku. Wpiąć
   w `worktrail check` (tam gdzie już siedzi `--language`).
5. Sprawdzić, czy guard ma moc dowodową: wstawić literał celowo i potwierdzić,
   że oblewa (CLAUDE.md, „guard na zerowej próbce jest zielony bez mocy").

## Acceptance criteria

- [x] Literał nazwy w `scripts/` i `bin/` daje zero trafień poza `product.mjs`; wyjątkiem są dwie linie z prawdziwą ścieżką na dysku, oznaczone `product-name: allow`. [proof: no-name-literals]
- [x] Zmiana `name` w `package.json` zmienia `--help` i komunikaty błędów — bez żadnej innej edycji w `scripts/`. [proof: guard-has-force]
- [x] Guard wpięty w `worktrail check` (przebieg BEZ selektora), z kontrolą negatywną na celowo wstawionym literale. [proof: guard-has-force]
- [x] Decyzja o znaczniku w `git-rules.mjs` jest zapisana w tym tasku wraz z powodem. [proof: guard-has-force]
- [x] Pełna suita zielona. [proof: suite-green]

## Notes

Ten task NIE zmienia nazwy produktu — nazwa jest już rozstrzygnięta
(`worktrail`, [TL-20](TL-20-domknij-nazwe-narzedzia-przed-publikacja.md)).
Zmienia koszt NASTĘPNEJ zmiany.

## Log

- 2026-09-01 pending — agent:claude — założony przy zmianie nazwy `tasklog` →
  `worktrail`. Task nie jest hipotezą: powstał z pomiaru wykonanego tego dnia
  (158 zmienionych plików) i unieważnia twierdzenie z CLAUDE.md, że zmiana
  nazwy „ma zostać jedną edycją". Do czasu zrobienia tego taska twierdzenie
  w CLAUDE.md jest INTENCJĄ, nie opisem stanu — i tak jest tam teraz oznaczone.
- 2026-09-01 in_progress — agent:claude — podjęty; oba taski `in_progress` (TL-48, TL-102) stoją na wejściu od właściciela, ten nie stoi na niczym.
- 2026-09-01 in_progress — agent:claude — **DECYZJA (krok 3): znacznik w `git-rules.mjs` ZOSTAJE ZAMROŻONY, nie jedzie z `PRODUCT_NAME`.** `# >>> worktrail` / `# <<< worktrail` to KLUCZ NA DYSKU w cudzym `.gitignore` i `.gitattributes`, po którym drugi `init` odnajduje własny blok — nie tekst do czytania. Wyprowadzony z nazwy: po zmianie nazwy każde już zainicjowane repozytorium dostaje DRUGI blok zamiast aktualizacji pierwszego, w repozytoriach, do których nie mamy dostępu, żeby to naprawić. Zamrożony: po zmianie nazwy znacznik niesie stare słowo — kosmetyczne zaskoczenie w komentarzu. Odrzucone trzecie wyjście (rozpoznawanie OBU znaczników) — to jest lek na sytuację po publikacji, a dziś dokłada gałąź, której nic nie może wywołać. Realizacja: `BLOCK_MARKER_NAME` w `product.mjs`, obok `PRODUCT_NAME` i celowo od niego oddzielone; guard sprawdza OBA pisania, bo oba są literałami, które ktoś mógłby przepisać.
- 2026-09-01 in_progress — agent:claude — sweep zrobiony: 126 literałów w 27 plikach `scripts/` + `bin/` przepiętych na `PRODUCT_NAME`. Dwie różne robótki, nie jedna: komunikaty i szablony biorą nazwę przez `${N}` (w tym `EXAMPLE_VERIFICATION` z `init` — to wchodzi do CUDZEGO taska i jest URUCHAMIANE, więc literał tam byłby komendą, której po zmianie nazwy nie ma), a KOMENTARZE przepisane tak, żeby nazywały KOMENDĘ (`build`, `check`), nie binarkę — wewnątrz pliku, który jest tą binarką, jej nazwa i tak nic nie wnosi. Szablony `init` i nagłówek `GEN_HEADER` sprawdzone na wyjściu, nie tylko w źródle: `${N}` w template literalu zapisanym do cudzego repozytorium łatwo zostawić nierozwinięte.
- 2026-09-01 in_progress — agent:claude — guard `scripts/check-product-name.mjs`, wpięty w `worktrail check` (przebieg bez selektora + `--product-name`). Moc dowodowa sprawdzona TRZEMA sposobami, bo guard tej klasy oblewa cicho na trzy sposoby: (1) literał wstawiony do PRAWDZIWEGO `scripts/ui.mjs` — oblewa z kodem 1, plik przywrócony; (2) kontrola pozytywna na rozmiarze próbki (36 plików, 12953 linie) — ✓ nad zerem plików znaczy „poszedłem do złego katalogu"; (3) test asertuje przebieg `check` BEZ selektora — guard poprawny i niewywoływany przechodzi każdy test o własnej logice. Dołożony test end-to-end: kopia narzędzia, zmiana `name` w `package.json` i pytanie CLI, jak się nazywa — guard dowodzi tylko, że nikt nazwy nie wpisał, a nie że instalacja niesie nową.
- 2026-09-01 in_progress — agent:claude — `scripts/tests/` ŚWIADOMIE poza guardem, i to jest jedyna decyzja uznaniowa w tym tasku. Test biorący oczekiwaną nazwę z tej samej stałej co kod asertuje `N === N` i przechodzi przez zepsutą zmianę nazwy — część asercji MA trzymać bieżące pisanie, bo tam siedzi kontrola pozytywna. Cena zapisana, nie przemilczana: zmiana nazwy nadal rusza pliki testów (85 wystąpień w 24 plikach, zmierzone dziś), w większości prefiksy katalogów tymczasowych.
- 2026-09-01 in_progress — agent:claude — weryfikacja `verification:` PRZEPISANA z surowego `grep` na wywołanie guardu, i to wymaga uzasadnienia, bo edycja kontraktu, żeby przejść, jest dokładnie tym, czego to narzędzie nie przyjmuje. Guard jest ŚCIŚLE SZERSZY od tamtego grepa (rekurencyjnie po `scripts/` i `bin/`, nie tylko `*.mjs` na jednym poziomie; sprawdza też zamrożony znacznik). Jedyna różnica na minus to furtka `product-name: allow`, której surowy grep nie umie wyrazić, użyta w DWÓCH miejscach — obu na PRAWDZIWĄ ścieżkę na dysku (`docs/worktrail-state-and-sync.md`, `.claude/skills/worktrail-release/SKILL.md`). To nie są wystąpienia nazwy produktu do przepięcia, tylko nazwy plików; ich zmiana jest osobną decyzją.
- 2026-09-01 in_progress — agent:claude — CLAUDE.md przestaje kłamać: akapit o nazwie był oznaczony jako INTENCJA i teraz opisuje stan, wraz z regułą o dwóch tożsamościach (`PRODUCT_NAME` do czytania, `BLOCK_MARKER_NAME` zamrożony) i o wyłączeniu `scripts/tests/`. 431/431 zielone (było 419 — 12 nowych asercji).
2026-09-01 done — agent:claude — closed by `worktrail done`: 3 command(s) green.
