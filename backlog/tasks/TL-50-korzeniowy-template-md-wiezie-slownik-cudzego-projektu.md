---
id: TL-50
title: "Korzeniowy _template.md wiezie słownik cudzego projektu"
type: bug
labels: [pre-launch]
board: main
epic: "Backlog — publikacja open source"
priority: P1
status: done
owner: claude
estimate: 30m
confidence: high
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-config-and-portability.md
  - .claude/skills/worktrail-release/SKILL.md
verification:
  - bash: "printf 'wyslij DPA\\nboard: backlog-project\\n' > /tmp/tl1460-probe && grep -qwiE 'origin|DPA|backlog-project|pre-launch|Legal compliance|Mobile redesign' /tmp/tl1460-probe || { echo 'kontrola pozytywna: wzorzec nie łapie nawet jawnego trafienia'; exit 1; }; grep -qwiE 'origin|DPA|backlog-project|pre-launch|Legal compliance|Mobile redesign' _template.md && { echo 'szablon nadal niesie cudzy słownik'; exit 1; }; echo 'szablon generyczny — OK'"
  - bash: "grep -q 'node backlog/scripts/' _template.md && { echo 'ścieżki sprzed pakietu'; exit 1; }; echo 'bez ścieżek do skryptów — OK'"
  - bash: "npm pack --dry-run 2>&1 | grep -q '_template.md' && echo 'szablon nadal w tarballu (znacznik ko-lokacji) — OK'"
---

## Cel

Szablon, który jedzie w pakiecie, ma pokazywać **kształt pliku taska**, a nie
wartości cudzego projektu.

## Kontekst

W repozytorium są dwa `_template.md` i różnią się treścią:

| Plik | Rola | Stan |
|---|---|---|
| `backlog/_template.md` | czyta go `worktrail new` (`join(root, "_template.md")`) | generyczny, krótki, w porządku |
| `_template.md` (korzeń) | **jedzie w tarballu** (`files` w `package.json`) | stary szablon cudzego projektu |

Korzeniowy szablon zawiera (zmierzone 2026-08-31): `id: BL-NNN`, przykład tytułu
„Wyślij DPA do Anthropic", `board: main | backlog-project`, `labels: [pre-launch]`
z komentarzem o cudzych środowiskach, `related_docs: docs/architecture/<feature>.md`
oraz `node backlog/scripts/suggest-board.mjs` jako sposób wyboru boardu.

**Zastrzeżenie, żeby task nie został zrobiony w złym miejscu:** ten plik nie jest
dziś czytany jako treść. `init-backlog.mjs` trzyma własny `TEMPLATE_MD` w kodzie,
a korzeniowy `_template.md` pełni rolę **znacznika ko-lokacji** — po nim
`looksLikeBacklogDir()` poznaje katalog backlogu, co jest sprawdzane w
`scripts/tests/packaging.test.mjs`. Nie kasuj go, podmień treść.

Mimo że nikt go nie czyta, **jest publikowany**, a opublikowana treść jest
publiczna niezależnie od tego, czy program po nią sięga. Do tego mówi `BL-NNN`,
podczas gdy `config.yaml` tego repozytorium mówi `task_id_prefix: TL` — więc jako
dokumentacja jest w dodatku nieprawdziwy.

Przy okazji: prefiks w szablonie ma być **neutralny**, a nie zamieniony z `BL` na
`TL`. Prefiks jest konfiguracją ([TL-42](TL-42-prefiks-id-taska-to-konfiguracja-nie-kod.md)),
więc szablon, który wpisuje konkretny, uczy złego nawyku w pierwszym pliku,
jaki widzi nowy użytkownik.

## Pre-flight reading

1. `_template.md` i `backlog/_template.md` — porównaj oba (`diff`).
2. `scripts/tests/packaging.test.mjs` — dlaczego korzeniowy plik musi istnieć.
3. `scripts/init-backlog.mjs` — `TEMPLATE_MD`, czyli szablon, który dostaje nowy backlog.

## Kroki

1. Zastąp treść korzeniowego `_template.md` wersją generyczną (bazą jest `backlog/_template.md`).
2. Prefiks ID w szablonie zapisz neutralnie (np. `<PREFIX>-NNN`) z komentarzem, że wartość bierze się z `config.yaml`.
3. Sprawdź, czy `TEMPLATE_MD` w `init-backlog.mjs` nie ma tego samego problemu — to on trafia do backlogu obcego użytkownika.
4. Rozstrzygnij, czy dwie kopie szablonu mają sens: jeśli nie, jedna z nich powinna powstawać z drugiej, a nie żyć równolegle.
5. `npm pack --dry-run` — szablon nadal w tarballu.

## Acceptance criteria

- [ ] Korzeniowy `_template.md` nie zawiera nazw, boardów ani etykiet cudzego projektu.
- [ ] Prefiks ID w szablonie jest neutralny, nie `BL` i nie `TL`.
- [ ] `scripts/tests/packaging.test.mjs` przechodzi (znacznik ko-lokacji zachowany).
- [ ] `TEMPLATE_MD` w `init-backlog.mjs` sprawdzony pod tym samym kątem.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 created — agent:claude — z audytu gotowości do publikacji
- 2026-08-31 in_progress — agent:claude — start implementacji
- 2026-08-31 done — agent:claude — korzeniowy `_template.md` przepisany: zero słownictwa cudzego projektu, prefiks NEUTRALNY (`<PREFIX>-NNN` z odesłaniem do `task_id_prefix`), nagłówek mówiący, że wartości to tylko domyślne z `init`, a słowniki pochodzą z `config.yaml` TWOJEGO backlogu. Rozmiar w tarballu spadł z 4.2 kB do 2.3 kB.
- 2026-08-31 done — agent:claude — krok 4 rozstrzygnięty: dwie kopie NIE mają sensu. `TEMPLATE_MD` wpisany w `init-backlog.mjs` zniknął — `init` CZYTA teraz `_template.md` z pakietu. Ten plik i tak tam jedzie, bo jest znacznikiem ko-lokacji, więc druga kopia tej samej treści w kodzie mogła się z nim rozjechać, a rozjazd byłby niewidoczny: jedna wersja trafiałaby do nowych backlogów, druga do czytania przez człowieka, który otworzy plik w `node_modules`. Brak pliku znaczy uszkodzoną instalację i mówi to wprost — cichy szablon awaryjny dawałby backlogi różniące się od tych z normalnej instalacji.
- 2026-08-31 done — agent:claude — WERYFIKACJA TEGO TASKA BYŁA WADLIWA i poprawiłem POMIAR, nie tekst. Wzorzec `DPA` bez granicy słowa trafiał w „odpadły" w prozie szablonu, więc guard oblewał na poprawnym pliku. Teraz `grep -w` plus kontrola pozytywna na sondzie z jawnym trafieniem — bez niej wzorzec, który nie łapie niczego, byłby zielony i bezużyteczny naraz.
- 2026-08-31 done — agent:claude — dwa defekty trafione po drodze, oba starsze niż ta zmiana: podpowiedź `doctor` doklejała „s" do nazwy pola i odsyłała do `statuss:` zamiast `statuses:` (naprawione tutaj — klucz słownika idzie teraz z `FIELD_SHAPES`, nie ze zgadywania); oraz `worktrail new` po zmianie słowników zapisuje wartość z szablonu bez sprawdzenia, choć tę samą wartość podaną flagą by odrzucił — [TL-69](TL-69-szablon-po-zmianie-slownikow-przemyca-wartosc-spoza-nich.md).
