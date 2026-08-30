---
id: TL-21
title: "Fundament logu zdarzeń worktrail — 5 decyzji nie do cofnięcia"
type: code
labels: [pre-launch]
board: main
epic: "worktrail — narzędzie"
priority: P1
status: done
owner: claude
estimate: 1d
confidence: medium
created: 2026-08-29
updated: 2026-08-29
blocked_by: []
blocks: []
related_docs:
  - docs/worktrail-state-and-sync.md
  - docs/backlog-field-editing-history.md
verification:
  - bash: "git merge-tree --write-tree <dwie gałęzie bez wspólnego taska> — BEZ konfliktu w INDEX.yaml"
  - bash: "node --test backlog/scripts/tests/history.test.mjs"
  - manual: "usuń backlog/history/.snapshot.json i widoki, odpal worktrail — wszystko odtwarza się bez utraty historii"
---

## Cel

Zdjąć zmierzoną dziś przyczynę konfliktów przy pracy równoległej (kroki 1–3) i **zamknąć trzy decyzje schematu, które po pierwszym obcym użytkowniku wymagałyby migracji jego danych** (kroki 4–5).

Kroki 1–3 opłacają się nawet gdyby hosting nigdy nie powstał. Kroki 4–5 kosztują dziś linijkę, a po wydaniu — migrację cudzych danych. Dlatego są w jednym tasku mimo różnej wagi.

## Kontekst

Analiza i pełne uzasadnienie: [worktrail-state-and-sync.md](../../docs/worktrail-state-and-sync.md). Najkrócej — co zmierzone 2026-08-29 na tym repozytorium:

- **7 żywych worktree'ów**, ale **0 tasków dotkniętych przez więcej niż jedną gałąź**.
- Mimo to `git merge-tree --write-tree` dwóch gałęzi **bez wspólnego taska** daje **KONFLIKT w `INDEX.yaml`** — bo widoki to posortowane agregaty wszystkich 1362 tasków.
- **896 z 1142** commitów (78%) dotykających `tasks/` dotyka też widoków generowanych.
- Mutacje istniejących tasków: `status` 639, `owner` 498, `updated` 272 — wobec `title` 43 i reszty poniżej 35. **Koordynacja ≈ 91%, treść ≈ 9%.**

Wniosek: konflikt nie bierze się z wersjonowania tasków, tylko z **wersjonowania stanu wyliczonego z tasków** — i z trzymania stanu koordynacyjnego w pliku gałęziowym.

Kierunek docelowy (log zdarzeń jako SSOT stanu, git jako SSOT treści, SQLite jako odtwarzalny indeks) opisuje dokument. Ten task NIE buduje ani serwera, ani SQLite, ani odwrócenia kierunku rekoncyliacji — kładzie tylko fundament, bez którego tamto będzie migracją zamiast dopisaniem.

Wpis historii z [TL-17](TL-17-historia-zmian-pol-taska-z-autorem.md) jest już z kształtu LWW-Registerem per pole. Brakuje mu identyfikatora i przestrzeni nazw aktora.

## Pre-flight reading

1. `docs/architecture/worktrail-state-and-sync.md` — §3 (czego brakuje), §5.1 (kto wygrywa), §7 (te pięć kroków)
2. `backlog/scripts/history.mjs` — `entry()`, `ACTOR_RE`, `reconcile()`
3. `backlog/scripts/task-fields.mjs` — `TRACKED_FIELDS`
4. `docs/architecture/backlog-field-editing-history.md` §4.6 — dlaczego rekoncyliacja pyta log, zanim zapisze

## Kroki

1. **`id` w każdym zdarzeniu.** ULID albo hash `(ts, task, field, actor, to)`. Czytanie starych wpisów **bez** `id` musi dalej działać (log jest append-only — nie przepisujemy historii). Test: dwa identyczne co do treści zdarzenia o różnych `id` to dwa zdarzenia; to samo `id` dwa razy = jedno.
2. **`.gitattributes`:** `backlog/history/*.jsonl merge=union`. Test na prawdziwym scaleniu dwóch gałęzi dopisujących do tego samego pliku — bez markerów konfliktu, oba wpisy obecne, dedup po `id`.
3. **Widoki generowane do `.gitignore`** (`INDEX.yaml`, `NOW.yaml`, `archive/done.yaml`, `boards/*/`). Warunek konieczny: generator musi ruszać SAM — przy starcie `worktrail` i z hooka. Bez tego pusty klon nie ma widoków i wygląda na zepsuty. `git rm --cached` na już wersjonowanych.
4. **`actor` z przestrzenią nazw** — `local:<nick>`, `agent:<nazwa>`, `user:<uuid>`. Stary format bez prefiksu czytany jako `local:` (zgodność wstecz), nowe zapisy zawsze z prefiksem. `ACTOR_RE` rozszerzone, `normalizeActor()` mapuje.
5. **Typ zdarzenia dopuszczający ciało i komentarze.** Nie implementujemy ich — schemat ma je przewidywać, żeby dołożenie nie było migracją. Dziś `TRACKED_FIELDS` obejmuje wyłącznie frontmatter; pseudo-pola `__body__` i `__comment__` mają mieć zarezerwowane miejsce obok `__created__` / `__deleted__`.

## Acceptance criteria

- [x] Każde NOWE zdarzenie ma `id` (ULID); wpisy bez `id` dalej czytane bez błędu.
- [x] Dedup po `id` — ten sam wpis wczytany dwa razy daje jedno zdarzenie; różne `id` o tej samej treści zostają dwoma.
- [x] `backlog/.gitattributes` z `merge=union`, potwierdzone **prawdziwym scaleniem** w repozytorium tymczasowym + kontrolą pozytywną (bez reguły scalenie konfliktuje).
- [x] `git merge-tree --write-tree` dwóch gałęzi bez wspólnego taska **NIE** zgłasza konfliktu w `INDEX.yaml` — z kontrolą pozytywną, że wersjonowany agregat konfliktuje.
- [x] Świeży klon bez widoków: `worktrail` regeneruje je **przed nasłuchem** (raz, poza `listen()`, które próbuje kolejnych portów); hook robi to samo.
- [x] KROK 4 — `actor` z prefiksem (`local:` / `agent:` / `user:`, plus `unknown`). **Kryterium ZMIENIONE w trakcie:** miało brzmieć „`local:kamil` i `kamil` to ten sam aktor", ale to wymuszałoby promowanie gołych nazw — a `claude` jest agentem i wylądowałby jako człowiek. Goła nazwa w nowym zapisie = brak deklaracji (`unknown`); stary wpis przy odczycie dostaje przestrzeń `legacy`. Uzasadnienie: [worktrail-state-and-sync.md §7 krok 4](../../docs/worktrail-state-and-sync.md).
- [x] KROK 5 — `__body__` i `__comment__` zarezerwowane w `PSEUDO_FIELDS` (w `task-fields.mjs`, więc viewer dostaje je źródłem); `diffMeta` ich nie produkuje.
- [x] `docs/architecture/worktrail-state-and-sync.md` — status CZĘŚCIOWO WDROŻONE, §7 z odhaczonymi krokami 1-3, nowe §7.1 (koszt przejścia) i §7.2 (jak to jest udowodnione).
- [x] `qa/worktrail-state-and-sync.yaml` założone (16 cases) + wpis w `qa/INDEX.yaml`.

## Verification

```bash
# 1. Test, który DZIŚ failuje — dwie rozłączne gałęzie nie mogą konfliktować na widoku
git merge-tree --write-tree <branch-a> <branch-b> | grep -i "KONFLIKT\|CONFLICT" && echo "NADAL ŹLE" || echo "OK"

# 2. Historia — pełna suita
node --test backlog/scripts/tests/history.test.mjs

# 3. Odtwarzalność: skasuj wszystko, co pochodne, i sprawdź, że nic nie zginęło
rm -f backlog/history/.snapshot.json backlog/INDEX.yaml backlog/NOW.yaml
./scripts/worktrail --no-open --port 4409
# oczekiwane: widoki odtworzone, ZERO nowych wpisów historii (snapshot to punkt odniesienia, nie prawda)
```

## Notes

**Świadomie POZA zakresem** (osobne taski, gdy przyjdzie czas):

- Odwrócenie kierunku rekoncyliacji dla pól koordynacyjnych (log wygrywa nad plikiem) — [worktrail-state-and-sync.md §5.1](../../docs/worktrail-state-and-sync.md).
- SQLite jako indeks (§5.4), locki (§6.1), serwer, konta, role, web UI.
- Historia ciała taska i komentarze — krok 5 rezerwuje im miejsce, nie buduje ich.

**Założenie do obalenia przed startem:** czy realny ból to konflikty scalania, czy kolizje agentów na tym samym tasku. Pomiar widzi tylko to, co doszło do commita — agent, który wszedł w zajęty task i się wycofał, nie zostawia śladu w gicie. Gdyby dominowały kolizje, priorytetem są locki, a nie kroki 1–3.

## Log

- 2026-08-29 created — claude — z analizy „stan tasków przy pracy równoległej + tryb hostowany", pomiar na 7 worktree'ach
- 2026-08-29 in_progress — claude — kroki 1-3 zrobione (ULID + dedup, merge=union, widoki poza gitem); 122/122 testów zielonych. Zostają kroki 4-5 (przestrzeń nazw aktora, rezerwacja typów zdarzeń) — do domknięcia przed pierwszym obcym użytkownikiem.
- 2026-08-29 done — claude — kroki 4-5 zrobione: przestrzeń nazw aktora (local/agent/user + legacy przy odczycie) i rezerwacja `__body__`/`__comment__`. Przy okazji: viewer stracił własną kopię listy pseudo-pól i zaszyte `.actor-claude` w CSS, a CLI przestało kłamać o autorze. 137/137 zielonych. Zakres kroków 1-5 zamknięty; ciąg dalszy (odwrócenie rekoncyliacji, SQLite, locki, serwer) to osobne taski, gdy przyjdzie czas.
