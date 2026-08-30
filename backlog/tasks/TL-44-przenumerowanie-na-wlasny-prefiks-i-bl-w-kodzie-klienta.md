---
id: TL-44
title: "Przenumerowanie na własny prefiks — i BL, które przetrwało w kodzie"
type: code
labels: []
board: main
epic: "Backlog — publikacja open source"
priority: P2
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
  - bash: "node --test scripts/tests/*.test.mjs"
  - bash: "node scripts/cli.mjs check && node scripts/cli.mjs build"
---

## Cel

Ten backlog numeruje się własnym prefiksem (`TL-`), a nie prefiksem projektu, z
którego narzędzie wyszło. Kolizja `BL-1448` — jeden numer, dwa różne taski w
dwóch repozytoriach — przestaje istnieć, bo przestaje istnieć wspólna przestrzeń
numerów.

## Kontekst

TL-42 zrobił prefiks konfiguracją i dostarczył `migrate-prefix`, ale **krok
przenumerowania świadomie odłożył**: dry-run pokazywał 215 wzmianek w PROZIE,
których migracja nie tyka, bo `BL-1445` w treści może wskazywać na task drugiego
repozytorium. Ten task wykonuje przenumerowanie razem z przeglądem prozy.

**Numery zostają, zmienia się tylko prefiks** (`BL-1449` → `TL-39`). To nie
jest estetyka: komunikaty commitów są niezmienne i zawierają stare numery, więc
zachowanie numeru sprawia, że stara historia dalej daje się mechanicznie
rozwiązać. Przenumerowanie od 1 zerwałoby ten związek bez żadnego zysku.

## Kroki

1. `migrate-prefix --to TL` — nazwy plików, `id:`, `blocked_by`/`blocks`, logi
   historii i `task_id_prefix` w konfiguracji.
2. Proza: podzielić wzmianki na te, które JEDNOZNACZNIE wskazują ten backlog,
   te, które wskazują konsumenta, i te, które trzeba przeczytać.
3. Naprawić to, co przenumerowanie ODSŁONIŁO w kodzie.
4. Konsument: odwołania `worktrail#BL-NNNN` przepiąć na `worktrail#TL-NNNN`.

## Acceptance criteria

- [x] `check` i `build` zielone, pełna suita 263/263.
- [x] Wzmianki w prozie rozstrzygnięte co do jednej; wzmianki o taskach
      konsumenta ZOSTAJĄ jako `BL-`, i to sam prefiks je teraz odróżnia.
- [x] Odsłonięte defekty kodu naprawione, nie obejściem w teście.
- [x] Guardy sądzą backlog, KTÓRY DOSTAŁY, a nie ten z cwd.

## Notes

- Klasa, którą to potwierdza: **zmiana wartości jest jedynym sprawdzianem, czy
  wartość naprawdę wyszła z kodu.** TL-42 przeszedł zielono z czterema żywymi
  hardkodami `BL`, bo jedyny backlog, na którym cokolwiek biegało, miał prefiks
  `BL`. Test na konfiguracji ≠ test na innej wartości.

## Log

- 2026-08-31 done — claude — przenumerowane 43 taski / 85 plików; 287 wzmianek w prozie przepisanych automatycznie po podziale na kubełki (42 numery jednoznacznie własne), 5 zostawionych świadomie (wszystkie w TL-42, gdzie zdanie OPISUJE kolizję `BL-1448` i przepisanie uczyniłoby je fałszywym), 2 poprawione ręcznie. Wzmianki o taskach konsumenta (BL-1445, BL-1446, BL-1170…) zostają — po zmianie prefiksu sam zapis mówi, że są obce.

- 2026-08-31 PRZENUMEROWANIE ODSŁONIŁO CZTERY ŻYWE DEFEKTY — claude — których TL-42 nie mógł zobaczyć, bo do wczoraj każdy backlog pod ręką miał prefiks `BL`: (1) `query.mjs` sortował po `Number(id.replace(/^BL-/,""))`, więc `--sort id` dawał 0 dla każdego taska i układał listę porządkiem, o który nikt nie prosił; (2) viewer czytający katalog przez File System Access filtrował `^BL-\d+.*\.md$` — pod innym prefiksem wczytywał ZERO tasków; (3) i (4) dwa sortowania po numerze w viewerze i na dashboardzie, ta sama pomyłka. Wszystkie ciche: żadna nie rzuca błędu, każda zwraca „nic" albo „zero".

- 2026-08-31 druga klasa, poważniejsza — claude — guardy `check-backlog-id-collisions` i `check-backlog-boards` brały KATALOG z argumentu, a PREFIKS z konfiguracji znalezionej od cwd. Wskazane drzewo było więc sądzone słownikiem cudzego backlogu: zero dopasowanych plików i `✓ 0 tasków, każdy użyty raz`, exit 0. **Zielone przy zerowej mocy dowodowej.** W jednym repozytorium niewidoczne, bo cwd i cel to zawsze to samo drzewo. Korzeń idzie teraz z tego, co guard dostał (`backlogForTaskPath` przeniesione do `paths.mjs`), a gdy konfiguracja milczy — prefiks wnioskowany z OGLĄDANYCH nazw plików, nie z domyślnej wartości.

- 2026-08-31 ŚWIADOMIE NIETKNIĘTE — claude — 75 wzmianek GENERYCZNYCH (`BL-NNN` jako symbol zastępczy, „numer BL", „kolizje numerów BL") w README, `docs/` i treściach tasków. To nie są odwołania do żadnego taska, tylko słownictwo dokumentów — a czyszczenie dokumentów z kontekstu the origin project jest treścią TL-37. Rozdzielone celowo: ten task miał zmienić IDENTYFIKATORY, a nie przepisać prozę przy okazji. Liczba jest tu po to, żeby TL-37 zaczynał od miary, a nie od zera.

- 2026-08-31 in_progress — claude — 15 testów oblało zaraz po migracji. Cztery były testami pinującymi literał `BL` tam, gdzie chodziło o kontrakt (naprawione przez wzięcie prefiksu z konfiguracji), reszta była SYGNAŁEM z produkcyjnego kodu. Odróżnienie jednych od drugich, plik po pliku, było właściwą treścią tego taska.
