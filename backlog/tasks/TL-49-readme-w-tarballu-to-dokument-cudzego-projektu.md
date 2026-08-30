---
id: TL-49
title: "README w tarballu to dokument cudzego projektu"
type: task
labels: [pre-launch]
board: main
epic: "Backlog — publikacja open source"
priority: P1
status: done
owner: agent:claude
estimate: 1d
confidence: medium
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-config-and-portability.md
  - .claude/skills/worktrail-release/SKILL.md
verification:
  - bash: "grep -qiE 'origin|sync-layer|supabase|railway|DPA' README.md && { echo 'README nadal niesie cudzy projekt'; exit 1; }; echo 'README bez cudzego kontekstu — OK'"
  - bash: "grep -q 'node backlog/scripts/' README.md && { echo 'ścieżki sprzed pakietu'; exit 1; }; echo 'komendy przez worktrail, nie przez ścieżki — OK'"
  - bash: "grep -qE '\\bBL-[0-9]' README.md && { echo 'prefiks BL w dokumencie narzędzia'; exit 1; }; echo 'brak twardego prefiksu — OK'"
  - manual: "README przeczytany przez kogoś, kto nie zna projektu: potrafi zainstalować narzędzie i wykonać pierwsze zapytanie bez pytania autora."
---

## Cel

Napisać README **tego narzędzia** — dokument, który obcy deweloper czyta przed
decyzją „spróbuję". Dziś w tarballu jedzie 58.9 kB README innego projektu.

## Kontekst

Zmierzone 2026-08-31, `npm pack --dry-run`:

```
npm notice 58.9kB README.md
npm notice  4.2kB _template.md
```

To są dwa pierwsze pliki, które otwiera obcy człowiek — i oba mówią o czymś
innym niż o tym narzędziu. `README.md` zaczyna się od nagłówka „Backlog the origin project",
ma 904 linie, a w §3.2 rozwija słownik etykiet o cudzej infrastrukturze
(Railway, Supabase, the sync layer, „Submit do App Store", „DPA outreach"). Komendy
w §7 są podawane jako `node backlog/scripts/*.mjs`, czyli ścieżkami do cudzego
drzewa — a od [TL-33](TL-33-packaging-instalacja-globalna-i-npx.md) wejściem
jest `worktrail`. Numery tasków są pisane jako `BL-NNN`, mimo że prefiks jest
konfiguracją ([TL-42](TL-42-prefiks-id-taska-to-konfiguracja-nie-kod.md)).

**To nie jest dług kosmetyczny.** Publikacja jest nieodwracalna, a ten dokument
mówi nowemu użytkownikowi, że boardy nazywają się `backlog-project` i że etykiety
opisują cudze środowiska produkcyjne. Kod od dawna zna KSZTAŁT pola, a nie jego
wartości; README nadal pokazuje wartości i podaje je za kształt.

Ten task **nie jest tłumaczeniem** — to [TL-32](TL-32-angielska-powierzchnia-publiczna-modulu.md),
i oba przepisują ten sam plik, więc idą sekwencyjnie, nie równolegle. Nie jest też
rozdzieleniem dokumentów w `docs/` — to [TL-37](TL-37-split-the-documents-the-mechanism-travels.md),
którego zasada („mechanizm i komenda do odtworzenia, nie cudzy pomiar") obowiązuje
tu tak samo.

## Pre-flight reading

1. `README.md` — w całości; trzeba wiedzieć, co się wyrzuca, zanim się wyrzuci.
2. `docs/backlog-config-and-portability.md` §3 — granica „kod zna kształt, konfiguracja zna wartości".
3. [TL-37](TL-37-split-the-documents-the-mechanism-travels.md) — ta sama zasada dla `docs/`.
4. `.claude/skills/worktrail-release/SKILL.md` §2–§3 — co wolno wypuścić w tarballu.

## Kroki

1. Wyciągnij z obecnego README to, co jest o narzędziu: filozofia (§1), schema pliku taska (§3), statusy (§4), co NIE jest backlogiem (§8). To zostaje, po przepisaniu bez cudzego słownictwa.
2. Napisz nowy README wokół pierwszych pięciu minut: co to jest, instalacja, `worktrail init`, pierwszy task, `worktrail query`, viewer w przeglądarce. Screenshot viewera jest tu wart więcej niż akapit.
3. Wszystkie komendy przez `worktrail <komenda>`, nigdy `node backlog/scripts/…`.
4. Numery tasków w przykładach z prefiksem generycznym albo wprost oznaczone jako konfigurowalne.
5. Słownik etykiet, boardów i epików: pokaż, że to `config.yaml` projektu, i daj przykład NIE związany z żadnym istniejącym repozytorium.
6. Przykłady wyjścia CLI wklej dopiero na końcu — po [TL-51](TL-51-worktrail-komenda-help-oblewa-w-8-z-12-komend.md) i [TL-52](TL-52-kolor-i-spojne-komunikaty-cli-w-jednym-module-ui-mjs.md), inaczej trafią do przepisania drugi raz.
7. Materiał wewnętrzny (protokół dla agenta, protokół foundera) przenieś tam, gdzie ma czytelnika — do `CLAUDE.md` albo do skilla, nie do README.

## Acceptance criteria

- [x] `README.md` nie zawiera nazw ani słownictwa innego projektu.
- [x] Każda komenda w README jest wywołaniem `worktrail`, nie ścieżką do skryptu.
- [x] Instalacja i pierwsze zapytanie dają się wykonać z samego README.
- [x] Prefiks ID w przykładach jest pokazany jako konfiguracja, nie jako stała.
- [x] `npm pack --dry-run` — README nadal w tarballu, w nowej wersji.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 created — agent:claude — z audytu gotowości do publikacji
- 2026-08-31 in_progress — agent:claude — przepisanie README wokół pierwszych pięciu minut
- 2026-08-31 done — agent:claude — README przepisany (904 linie → 574); z tarballa znikło 58.9 kB cudzego dokumentu, weszło 23.7 kB o tym narzędziu. Przykładowy config.yaml sprawdzony realnym `build` + `doctor`. Kryterium manualne (obcy czytelnik) zostaje do potwierdzenia przez człowieka.
- 2026-08-31 done — agent:claude — na polecenie foundera README napisany po ANGIELSKU, nie po polsku: to krok 1 [TL-32](TL-32-angielska-powierzchnia-publiczna-modulu.md) i jego decyzja 2, wykonana tutaj zamiast dwa razy. Wyjątek zapisany w CLAUDE.md § Konwencje. Konsekwencja: bloki z DOSŁOWNYM wyjściem CLI wypadły z README poza tymi, które są angielskie już dziś (`query`, `--json`) — reszta CLI mówi po polsku do czasu TL-32, a angielski dokument cytujący polskie wyjście byłby albo niespójny, albo kłamał. Wracają jako krok 6 tego taska, gdy TL-32 przetłumaczy komunikaty.
