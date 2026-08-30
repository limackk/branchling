---
id: TL-75
title: "Pole modified_files i wyszukiwanie tasków po dotkniętym pliku"
type: code
labels: [post-launch]
board: main
epic: "Integralność danych"
priority: P2
status: pending
owner: unassigned
estimate: 4h
confidence: medium
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs: []
verification:
  - bash: "node --test scripts/tests/modified-files.test.mjs"
  - bash: "node scripts/cli.mjs query --modified-file scripts/cli.mjs --count"
---

## Cel

Task może zapisać listę plików, które zmienił, a `worktrail query --modified-file
<ścieżka>` odpowiada „w ramach czego ten plik był ruszany i dlaczego".

## Kontekst

`git log <plik>` mówi KTO i KIEDY zmienił plik. Nie mówi, W RAMACH CZEGO — a to
jest pytanie, które realnie pada przy czytaniu cudzego kodu („czemu ta funkcja
tak wygląda"). Odpowiedź istnieje w naszym backlogu: jest w sekcji `## Cel` i
`## Kontekst` taska. Brakuje tylko indeksu od pliku do taska.

To jest funkcja, której zewnętrzny tracker dać nie może — wymaga, żeby taski
mieszkały w tym samym drzewie co kod. Czyli dokładnie premia z I prawa,
niezrealizowana.

Rozstrzygnięcia do podjęcia:

1. **Kto wypełnia pole.** Ręcznie jest do niczego (nikt nie utrzyma). Sensowne
   źródło to nazwy plików z commitów wspominających ID taska — do policzenia z
   gita, a nie do wpisywania. Zdecyduj: pole w frontmatterze (wersjonowane,
   może skłamać) czy wyliczane przy odczycie (II prawo, zawsze prawdziwe, ale
   wymaga skanu historii). Domyślnie skłaniaj się ku wyliczaniu.
2. **Ścieżki są względem korzenia repozytorium**, nie katalogu backlogu — backlog
   bywa ko-lokowany i wtedy te dwie rzeczy to nie to samo (`resolveBacklogDir()`).

## Pre-flight reading

1. `scripts/task-fields.mjs` — jak dokładany jest nowy klucz frontmattera i
   gdzie oblewa nieznany.
2. `scripts/query.mjs` — tablica kryteriów; nowa flaga ma tam wejść jak reszta.
3. `scripts/paths.mjs` — `resolveBacklogDir()`; korzeń repo a korzeń backlogu.

## Kroki

1. Rozstrzygnij i zapisz w tasku: pole w frontmatterze czy wartość wyliczana.
2. Zaimplementuj wybrane źródło; ścieżki normalizuj do korzenia repozytorium.
3. `worktrail query --modified-file <ścieżka>` — dopasowanie dokładne i po
   prefiksie katalogu (`--modified-file scripts/` łapie cały katalog).
4. Pokaż listę w detalu taska w viewerze.
5. `scripts/tests/modified-files.test.mjs` — fixture z taskiem i plikiem; test
   oblewa, gdy zapytanie o niepowiązany plik zwraca trafienie.

## Acceptance criteria

- [ ] `query --modified-file` znajduje taski po pliku i po katalogu-prefiksie.
- [ ] Ścieżki są względem korzenia repozytorium także w układzie ko-lokowanym.
- [ ] Źródło danych jest jedno i udokumentowane w README.
- [ ] Test ma kontrolę negatywną (niepowiązany plik nie daje trafień).

## Log

2026-08-31 pending — agent:claude — założony z analizy Backlog.md (github.com/MrLesk/Backlog.md), punkt 3.
