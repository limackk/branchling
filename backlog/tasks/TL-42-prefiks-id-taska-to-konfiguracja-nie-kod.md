---
id: TL-42
title: "Prefiks ID taska to konfiguracja, nie kod"
type: code
labels: []
board: main
epic: "Konfigurowalność"
priority: P2
status: done
owner: claude
estimate: 1d
confidence: medium
created: 2026-08-30
updated: 2026-08-30
blocked_by: []
blocks: []
related_docs:
  - LINEAGE.md
verification:
  - bash: "node --test scripts/tests/id-prefix.test.mjs"
---

## Cel

Projekt zakładający backlog tym narzędziem ma móc powiedzieć, jak nazywają się
jego taski. Dziś nie może — `BL-` jest wpisane w kod w 13 plikach.

## Kontekst

Zmierzone 2026-08-30: wzorzec `BL-\d`, `BL-[0`, `BL-N` albo literał `"BL-"`
występuje **31 razy w 13 plikach** (poza komentarzami odsyłającymi do tasków):

| Plik | Wystąpień |
|---|---|
| `build-backlog.mjs` | 8 |
| `history.mjs` | 5 |
| `check-backlog-id-collisions.mjs` | 4 |
| `build-viewer.mjs` | 3 |
| `new-task.mjs`, `task-fields.mjs` | po 2 |
| 7 pozostałych | po 1 |

**Dlaczego to jest ta sama sprawa, co TL-19.** Wtedy słownictwo projektu
(statusy, etykiety, boardy) wyprowadziło się z kodu do `config.yaml` pod hasłem
„kod zna KSZTAŁT, konfiguracja zna WARTOŚCI". Prefiks ID to ostatnia wartość
jednego projektu, jaka została w kodzie. Kształtem jest „prefiks + numer"; „BL"
jest wartością — i to cudzą.

**Skutek uboczny, który to wywołał.** Po podziale backlogu (`origin`
i to repo) oba drzewa wydają numery niezależnie z tej samej przestrzeni.
`next-id` zwrócił `1448` w OBU, i `BL-1448` znaczy dziś dwie różne rzeczy: tutaj
„Suita testów odpięta od repozytorium źródłowego", u konsumenta „Wygaś board
backlog-project". **Ta kolizja jest realna, nie hipotetyczna** — istnieje w
chwili pisania tego taska i jest świadomie zostawiona do rozstrzygnięcia tutaj,
bo przenumerowanie po tej zmianie robi się raz, a nie dwa razy.

Osobno, mniej pilne, ale prawdziwe: projekt open source zaczynający swój backlog
od `TL-1` wygląda jak fragment cudzego repozytorium. Bo nim jest.

## Pre-flight reading

1. `scripts/config.mjs` — jak wygląda dokładanie klucza; nieznany klucz OBLEWA,
   więc default musi istnieć zanim ktokolwiek go użyje.
2. `scripts/paths.mjs` — `looksLikeBacklogDir`; rozpoznanie katalogu nie może
   zależeć od prefiksu, inaczej zmiana prefiksu psuje wykrywanie backlogu.
3. `scripts/next-backlog-id.mjs` — skan po WSZYSTKICH gałęziach; wzorzec siedzi
   też w argumentach do gita.
4. `LINEAGE.md` — tam odwołania cross-repo mają już formę `<repo>#BL-NNNN`.

## Kroki

1. Dodać `task_id_prefix` do konfiguracji z generycznym defaultem. **Default nie
   może brzmieć `BL`** — to jest wartość projektu, od którego się odklejamy;
   `TASK` albo `T` są neutralne. Zmiana defaultu jest zmianą łamiącą dla
   każdego, kto już ma backlog, więc migracja idzie w kroku 4.
2. Zastąpić 31 wystąpień odwołaniem do konfiguracji. Wzorce budować z prefiksu,
   nie sklejać stringów w miejscu użycia — jedna funkcja `taskIdPattern(cfg)`.
3. Nazwa pliku taska też niesie prefiks (`BL-NNN-slug.md`) — objąć tym samym.
4. Napisać migrację: przenumerowanie istniejącego backlogu na nowy prefiks,
   razem z `history/<ID>.jsonl`, `blocked_by`, `blocks` i odwołaniami w treści.
   **Bez tego krok 1 jest pułapką**, nie zmianą.
5. Rozstrzygnąć, czy TEN backlog przechodzi na własny prefiks. Rekomendacja:
   tak — kolizja `BL-1448` znika sama, a numeracja przestaje zaczynać się od
   1303. Decyzję i powód zapisać w `LINEAGE.md`.

## Acceptance criteria

- [x] `task_id_prefix` w konfiguracji, z generycznym (NIE `BL`) defaultem.
- [x] `grep -rE '"BL-|BL-\\d' scripts/*.mjs` nie zwraca nic poza komentarzami
      odsyłającymi do tasków — bramka w Verification.
- [x] Backlog z prefiksem innym niż `BL` przechodzi pełny cykl: `init`, `new`,
      `build`, `check`, `next-id`, `query`, viewer. Test end-to-end na fixture.
- [x] `next-id` liczy z właściwego wzorca — test na drzewie z DWOMA prefiksami
      pilnujący, że obcy nie jest liczony.
- [x] Migracja przenosi też `history/<ID>.jsonl` i przepina `blocked_by`/`blocks`
      — test na taskach, które się wzajemnie blokują.
- [x] Odwołania `<repo>#PREFIX-NNNN` nadal działają (patrz TL-41).
- [x] Kolizja `BL-1448` **rozstrzygnięta świadomie: ZOSTAJE na razie**, powód
      niżej. Mechanizm, który ją rozpuszcza, jest dowieziony i sprawdzony.

## Verification

```bash
# expected: pass
node --test scripts/tests/id-prefix.test.mjs

# Prefiks nie mieszka już w kodzie — expected: brak trafień poza komentarzami
grep -rnE '"BL-|BL-\\\\d|BL-\[0' scripts/*.mjs | grep -v '^\s*\*' || echo "czysto"

# Obcy prefiks przechodzi pełny cykl — expected: same ✓
node scripts/cli.mjs init --dir /tmp/prefix-probe
# (ustaw task_id_prefix: TASK w /tmp/prefix-probe/config.yaml)
node scripts/cli.mjs new --dir /tmp/prefix-probe --title "Proba"
node scripts/cli.mjs build --dir /tmp/prefix-probe && node scripts/cli.mjs check --dir /tmp/prefix-probe
```

## Notes

- Kolejność z krokiem 4 nie jest kosmetyczna: wypuszczenie konfigurowalnego
  prefiksu bez migracji daje narzędzie, w którym zmiana ustawienia po cichu
  odcina użytkownika od jego własnych tasków (`next-id` przestaje je widzieć,
  `build` przestaje je zbierać). To byłaby utrata danych z widokiem sukcesu.
- Świadomie poza zakresem: format numeru (zera wiodące, długość). Dziś jest
  `\d+` i nic nie zgłasza problemu.

## Log

- 2026-08-31 done — claude — `task_id_prefix` w konfiguracji, wzorce z `scripts/task-id.mjs`, komenda `migrate-prefix`, guard rozjazdu. 12 nowych testów, pełna suita 251/251. Konsument (origin) sprawdzony po każdej zmianie: 1363 taski, wszystkie trzy guardy zielone.
- 2026-08-31 KROK 5 ROZSTRZYGNIĘTY ODWROTNIE — claude — rekomendowałem przenumerować TEN backlog na własny prefiks. **Nie robię tego**, bo `--dry-run` to zmierzył: 78 plików do zmiany i **215 wzmianek `BL-NNN` w TREŚCI tasków**, których migracja świadomie NIE tyka (nie da się odróżnić odwołania lokalnego od `<repo>#BL-NNNN`). Migracja zostawiłaby 215 zdań wskazujących na numery, których już nie ma — czyli zamieniłaby jedną znaną kolizję na dwieście cichych. Mechanizm jest dowieziony i sprawdzony; przenumerowanie tego repo to osobna decyzja z krokiem przeglądu prozy. Kolizja `BL-1448` jest opisana po obu stronach i kosztuje dziś mało.
- 2026-08-31 zmiana projektu w trakcie: INFERENCJA — claude — samo „default = TASK" złamałoby **każdy istniejący backlog**: jego `config.yaml` nie ma tego klucza, więc po aktualizacji byłby czytany pod `TASK` i nie znalazłby ani jednego swojego taska. Zmierzone na własnej suicie — 13 testów naraz. Dołożona reguła: **ustawienie jawne wygrywa zawsze; dopiero jego BRAK oddaje głos drzewu.** Konfiguracja zostaje źródłem prawdy, a nietknięty backlog działa bez żadnej edycji.
- 2026-08-31 guard rozjazdu jest sednem, nie dodatkiem — claude — bez niego pliki `BL-*.md` pod konfiguracją `TASK` czytają się jako ZERO tasków, a `build` przebudowuje widoki jako puste NA REALNYCH DANYCH i wypisuje ✓. To utrata danych z komunikatem o sukcesie. Guard oblewa PRZED zapisem; test sprawdza, że `INDEX.yaml` w ogóle nie powstał. Kontrola negatywna osobno: pusty backlog to legalny stan, nie rozjazd.
- 2026-08-31 defekt złapany kontrolą pozytywną na realnym drzewie — claude — wykrywanie obcego prefiksu było ZACHŁANNE i z `TL-25-domknij-walidacje-flag-w-5-komendach.md` czytało prefiks `TL-25-domknij-walidacje-flag-w` (bo dalej też stoi `-5-`). Komunikat o rozjeździe podawał śmieci zamiast nazwy. Naprawione kwantyfikatorem leniwym, przypięte testem. Zobaczyłbym to tylko na prawdziwych nazwach plików — fixture z `BL-1-x.md` przechodził.
- 2026-08-31 DRUGI egzemplarz tej samej zachłanności, znaleziony po ARTEFAKCIE — claude — `git status` pokazał plik `backlog/history/TL-25-domknij-walidacje-flag-w-5.jsonl`, którego nikt nie zakładał. Wyciąganie ID z nazwy pliku (`ANY_TASK_FILE_ID`) miało ten sam zachłanny wzorzec, więc hook zapisał historię pod zmyślonym identyfikatorem. To nie było znalezione testem ani przeglądem kodu, tylko przez niepasujący plik na dysku. Naprawione, plik usunięty, klasa przypięta testem na PRAWDZIWEJ nazwie pliku — fixture `BL-1-x.md` przechodził oba defekty.
- 2026-08-31 przy okazji: `next-id` przestał wymagać gita — claude — poza repozytorium git kończył się błędem, a `--dir` może wskazywać dowolny katalog. Teraz spada na skan własnego katalogu i **głośno mówi**, że to węższe źródło (numer może być zajęty na cudzej gałęzi); `new` przekazuje to ostrzeżenie dalej zamiast je połknąć. Pusty backlog daje `1` zamiast błędu.
- 2026-08-31 trzy własne pomyłki — claude — (1) pythonowa zamiana zjadła backslashe i `"^TASK-\\d+"` stało się `^TASK-d+` (ta sama klasa co template literal zjadający regexy); naprawione przez budowanie wzorców w testach z FUNKCJI narzędzia, nie z przepisanego stringa; (2) backtick w komentarzu wewnątrz template literala urwał `init-backlog.mjs`; (3) import wstrzyknięty po ostatniej linii `import` wylądował W ŚRODKU wieloliniowego importu w `serve-backlog.mjs`.
- 2026-08-31 świadomie NIE zrobione — claude — `history.mjs`, `regen-hook.mjs` i walidator ścieżek w `serve-backlog.mjs` dostały wzorce BEZ prefiksu (`ANY_TASK_*`). Log historii jest kluczowany tym ID, które task ma; nadanie mu opinii o słownictwie sprawiłoby, że po migracji przestałby czytać własną historię — dokładnie wtedy, gdy jest najbardziej potrzebna.
- 2026-08-30 created — claude — 31 wystąpień w 13 plikach zmierzone; wywołane realną kolizją `BL-1448` między tym repo a `origin` po podziale backlogu
