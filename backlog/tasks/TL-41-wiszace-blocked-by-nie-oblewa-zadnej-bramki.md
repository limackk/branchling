---
id: TL-41
title: "Wiszące blocked_by nie oblewa żadnej bramki"
type: code
labels: []
board: main
epic: "Integralność danych"
priority: P1
status: done
owner: claude
estimate: 4h
confidence: high
created: 2026-08-30
updated: 2026-08-30
blocked_by: []
blocks: []
related_docs: []
verification:
  - bash: "node --test scripts/tests/dangling-refs.test.mjs"
---

## Cel

`blocked_by`/`blocks` wskazujące na task, którego nie ma, mają **oblewać**.
Dziś przechodzą przez `build` i `check` bez słowa.

## Kontekst

Zmierzone 2026-08-30, na żywym przypadku. Po usunięciu z tego repozytorium
tasków należących do konsumenta, `TL-37` został z `blocked_by: [BL-1445]`
wskazującym na plik, który już nie istnieje. `worktrail build` i `worktrail check`
były **zielone**:

```
✓ backlog wygenerowany: 40 tasków → 11 aktywnych
✓ backlog: 40 tasków, każdy BL-NNN użyty raz
✓ backlog: 40 task(ów) sprawdzonych, każdy z boardem z rejestru
```

**Dlaczego to boli bardziej niż literówka.** `blocked_by` steruje kolejnością
pracy — to pole, po którym narzędzie odpowiada „czy mogę to wziąć". Wiszące
odwołanie daje task, który **na zawsze wygląda na zablokowany przez nic**. Nie
ma sygnału, że coś jest nie tak; jest sygnał, że trzeba czekać.

**To ta sama klasa, którą zamykały guardy kolizji ID i boardów:** detektor,
który nie ma jak oblać, jest ostrzeżeniem, nie zabezpieczeniem. Tyle że tutaj
nie ma nawet ostrzeżenia.

**Skąd wzięło się wiszące odwołanie** — nie z literówki, tylko z **usunięcia
taska**. To będzie się powtarzać: każdy podział backlogu, archiwizacja z
kasowaniem albo przeniesienie taska do innego repozytorium produkuje tę samą
sytuację.

## Pre-flight reading

1. `scripts/build-backlog.mjs` — czyta całe drzewo, więc zna zbiór istniejących
   ID; to jest naturalne miejsce na sprawdzenie.
2. `scripts/check-backlog-id-collisions.mjs` — wzór guardu, który sądzi ZBIÓR, i
   jego komunikat (mówi, co zrobić, nie tylko że źle).
3. `scripts/cli.mjs` — `parseCheckArgs`; nowy selektor idzie tą samą konwencją
   co `--id-collisions` i `--boards`.

## Kroki

1. Red-first: fixture z taskiem, którego `blocked_by` wskazuje na nieistniejący
   numer. Ma oblać.
2. Rozstrzygnąć zakres: `blocked_by` i `blocks` — oba. Sprawdzić, czy istnieją
   inne pola nawiązujące do ID (`related_docs` bywa ścieżką, nie ID).
3. Rozstrzygnąć **taski zarchiwizowane**: odwołanie do taska `done` jest
   POPRAWNE (blocker spełniony), odwołanie do NIEISTNIEJĄCEGO nie. Nie zlewać
   tych dwóch przypadków — to różnica między „zrobione" a „zgubione".
4. Rozstrzygnąć **odwołania cross-repo**: po podziale backlogu istnieje forma
   `<repo>#BL-NNNN` (użyta w `LINEAGE.md`). Guard ma ją przepuszczać jako
   świadomie zewnętrzną, a nie oblewać — inaczej wymusi kłamstwo w danych.
5. Wystawić jako `check --refs`, dołożyć do domyślnego `check`.

## Acceptance criteria

- [x] `blocked_by` na nieistniejący numer **oblewa** — test red-first.
- [x] `blocks` sprawdzane tym samym przebiegiem.
- [x] Odwołanie do taska `done`/`cancelled` **przechodzi** — test negatywny,
      inaczej guard zmusza do kasowania prawdziwej historii zależności.
- [x] ~~Odwołanie w formie `<repo>#BL-NNNN` przechodzi i jest rozpoznane jako
      zewnętrzne~~ → **rozstrzygnięte ODWROTNIE: takie odwołanie OBLEWA**, z
      komunikatem mówiącym, gdzie je zapisać. Powód w `## Log`.
- [x] Komunikat mówi, KTÓRY task wskazuje na CO i co z tym zrobić.
- [x] `check --refs` działa osobno i jest częścią domyślnego `check`.
- [x] Realne drzewo tego repozytorium przechodzi — z kontrolą pozytywną, że
      guard w ogóle coś sprawdził (liczba zweryfikowanych odwołań > 0).

## Verification

```bash
# expected: pass
node --test scripts/tests/dangling-refs.test.mjs

# Realne drzewo — expected: ✓ i NIEZEROWA liczba sprawdzonych odwołań
node scripts/cli.mjs check --refs

# Kontrola pozytywna na żywym drzewie — expected: exit != 0
cp backlog/tasks/TL-41-wiszace-blocked-by-nie-oblewa-zadnej-bramki.md /tmp/bl1451.bak
sed -i '' 's/^blocked_by: \[\]/blocked_by: [BL-999999]/' backlog/tasks/TL-41-wiszace-blocked-by-nie-oblewa-zadnej-bramki.md
node scripts/cli.mjs check --refs; echo "exit=$?"
cp /tmp/bl1451.bak backlog/tasks/TL-41-wiszace-blocked-by-nie-oblewa-zadnej-bramki.md
```

## Notes

- Znalezione ręcznie, nie przez test — czyli dziś nic tej klasy nie pilnuje.
- Krok 3 jest tu najważniejszy merytorycznie: najprostsza implementacja („każdy
  numer z `blocked_by` musi być plikiem w `tasks/`") jest POPRAWNA tylko dopóki
  archiwum zostaje w `tasks/`. Gdyby taski `done` wyprowadziły się kiedyś do
  osobnego katalogu, ten guard zacząłby oblewać na poprawnych danych.

## Log

- 2026-08-30 done — claude — `scripts/check-backlog-refs.mjs` + `check --refs`, dołożony do domyślnego `check`. 8 testów, wszystkie red-first. Pełna suita 240/240.
- 2026-08-30 KROK 4 ROZSTRZYGNIĘTY ODWROTNIE NIŻ W PLANIE — claude — task zakładał, że guard ma PRZEPUSZCZAĆ `<repo>#BL-NNNN` jako „świadomie zewnętrzne". Pomiar to obalił dwa razy. **Po pierwsze, taka wartość nie ma jak dziś powstać:** `task-fields.mjs` ma `itemPattern: "^BL-[0-9]+$"` na obu polach, więc viewer ją odrzuca — pisałbym obsługę wejścia, którego nie da się wprowadzić. **Po drugie, i ważniejsze: przepuszczenie zepsułoby znaczenie pola.** Narzędzie nie wie, czy `inne-repo#BL-1` jest zrobione, więc `blocked_by` przestałoby być pełną odpowiedzią na „czy mogę to wziąć" — cicho, bo wpis wyglądałby na sprawdzony. Guard taki wpis ODRZUCA i mówi, gdzie zależność zapisać: prozą w `## Log`/`## Notes`. Dokładnie tak zrobiłem ręcznie w `origin#BL-1445`, zanim ten guard powstał.
- 2026-08-30 zakres guardu — claude — sądzi ZBIÓR (jak guard kolizji), nie pojedynczy plik (jak guard boardów). Odwołanie jest złe wyłącznie WZGLĘDEM całego drzewa; żaden pojedynczy plik nie niesie dość informacji, żeby to stwierdzić.
- 2026-08-30 `done` to nie „zgubione" — claude — odwołanie do zamkniętego blockera PRZECHODZI, z testem negatywnym pilnującym tej różnicy. Tańsza reguła („musi wskazywać na task aktywny") wyglądałaby na poprawną i zmuszała do kasowania prawdziwej historii zależności dla zielonego wyniku — czyli uczyła kłamać guardowi. Znany limit zapisany w nagłówku pliku: rozstrzyganie idzie po plikach w `tasks/`, więc gdyby archiwum kiedyś wyprowadziło się do osobnego katalogu, guard zacząłby oblewać na poprawnych danych i musi się o tym katalogu dowiedzieć W TEJ SAMEJ zmianie.
- 2026-08-30 kontrola pozytywna w komunikacie — claude — czysty przebieg drukuje LICZBĘ sprawdzonych odwołań, bo „✓" nad zerem znaczy „nie było czego sprawdzać". Test na pustym drzewie pilnuje, że guard nie zmyśla niezerowej liczby.
- 2026-08-30 sprawdzone na KONSUMENCIE przed wypuszczeniem — claude — guard wchodzi do domyślnego `check`, czyli od razu do hooka `pre-commit` origin. Zmierzone tam PRZED commitem: **562 odwołania, 0 wiszących** — hook nie zaświeci się founderowi na czerwono.
- 2026-08-30 dwie pomyłki własne — claude — (1) polski cudzysłów zamykający `"` wewnątrz literału `"…"` urwał string i plik nie parsował się; (2) `takeDirFlag` zwraca `{dir, argv}`, nie `{dir, rest}`. Obie złapane pierwszym uruchomieniem, obie przez to, że guard był wołany, a nie tylko czytany.
- 2026-08-30 created — claude — znalezione przy rozdzielaniu backlogu konsumenta: po usunięciu tasków `origin#BL-1445`/`#BL-1446` z tego repo `TL-37` został z wiszącym `blocked_by`, a `build` i `check` były zielone
