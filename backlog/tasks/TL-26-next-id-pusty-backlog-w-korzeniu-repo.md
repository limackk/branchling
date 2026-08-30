---
id: TL-26
title: "next-backlog-id.mjs nie znajduje niczego, gdy backlog jest korzeniem repozytorium git"
type: code
labels: [pre-launch]
board: main
epic: "worktrail — narzędzie"
priority: P2
status: done
owner: claude
estimate: 1h
confidence: high
created: 2026-08-30
updated: 2026-08-30
blocked_by: []
blocks: []
related_docs:
  - backlog/README.md
verification:
  - bash: "mkdir /tmp/x && cd /tmp/x && git init -q && node <ścieżka>/init-backlog.mjs --dir . && echo 'id: BL-1' > tasks/BL-1-x.md && git add -A && git commit -qm x && node <ścieżka>/next-backlog-id.mjs --dir . --explain  # ma pokazać BL-1, dziś: „nie znaleziono ŻADNEGO BL-*”"
---

## Cel

`next-backlog-id.mjs` ma jeden zawsze prawdziwy warunek: gdy backlog jest KORZENIEM repozytorium git (nie podkatalogiem), skrypt nic nie znajduje i kończy błędem — mimo że taski istnieją i są zacommitowane.

## Kontekst

Znalezione przy pisaniu testów do [TL-25](TL-25-domknij-walidacje-flag-w-5-komendach-worktrail.md) (walidacja flag) — osobny, niepowiązany defekt w tym samym pliku.

Przyczyna — `BACKLOG_REL`:

```js
const rel = relative(root, dir);
return rel && !rel.startsWith('..') ? rel : 'backlog';
```

`relative(root, dir)` zwraca **pusty string**, gdy `dir` (backlog) i `root` (korzeń repo od `git rev-parse --show-toplevel`) to ten sam katalog. Pusty string jest falsy, więc ternary cicho podstawia `'backlog'` — myśląc, że ścieżka względna jest „nieprawidłowa" (tak jak dla `../gdzieś`), a nie że backlog leży W korzeniu.

Skutek: `fromWorkingTree()` i `fromRef()` szukają `<root>/backlog/tasks`, którego nie ma (taski są bezpośrednio w `<root>/tasks`). Zero numerów w unii → `exit 2`, „nie znaleziono ŻADNEGO BL-*".

**Dlaczego to nie jest teoretyczne:** to jest dokładnie układ, do którego prowadzi [TL-23](TL-23-worktrail-init-i-stats.md) — `worktrail init --dir .` w świeżo założonym repozytorium open source, gdzie backlog JEST całym repo, nie podkatalogiem workspace'u (jak w the origin project). Pierwszy `worktrail new` w takim repo dostanie `BL-1` z awaryjnej ścieżki lokalnej zamiast z prawdziwego skanu gałęzi — nieszkodliwe przy jednej gałęzi, ale ostrzeżenie „UWAGA: numer z LOKALNEGO skanu" pojawi się przy KAŻDYM wywołaniu, myląc kogoś, kto nie ma pojęcia, dlaczego.

## Kroki

1. Naprawić warunek: pusty string ma być traktowany jako poprawna ścieżka względna (backlog = korzeń), różna od `undefined`/`null` (backlog poza repo, gdzie `resolveBacklogDir` by rzucił i trafiłby w `catch`).
2. `fromWorkingTree`/`fromRef` — `join(root, BACKLOG_REL, 'tasks')` z pustym `BACKLOG_REL` ma dać `join(root, 'tasks')`, nie `join(root, '', 'tasks')` z literałem `''` traktowanym jak segment (sprawdzić, czy `node:path.join` obsługuje to poprawnie — powinien, ale dopisać test).
3. Test regresji: backlog jako korzeń repo git, jeden zacommitowany task, `next-backlog-id.mjs --explain` ma zwrócić poprawny numer.

## Acceptance criteria

- [x] Backlog w korzeniu repozytorium git: `next-backlog-id.mjs` znajduje taski i liczy `max+1` poprawnie.
- [x] Backlog w podkatalogu (dzisiejszy przypadek the origin project) nietknięty — kontrola pozytywna w tym samym pliku testów.
- [x] `worktrail new` w takim repo NIE pokazuje ostrzeżenia o skanie lokalnym.

## Notes

Nie naprawione w TL-25 świadomie — inny defekt niż walidacja flag, znaleziony przy pisaniu testu, nie w zakresie tamtego taska. Test dla TL-25 obchodzi ten przypadek, zagnieżdżając backlog w podkatalogu repo (`repo/backlog/`) — żeby mierzyć walidację flag, a nie tę osobną usterkę.

## Log

- 2026-08-30 created — claude — znalezione przy pisaniu testów regresji do TL-25
- 2026-08-30 done — claude — naprawione DWA błędy w tej samej funkcji, nie jeden. (1) pusty string mylony z nieprawidłową ścieżką (opisane w tasku). (2) `fromRef()` budował pathspec przez konkatenację stringów (`BACKLOG_REL + '/tasks'`), co dla pustego BACKLOG_REL dawało `/tasks` — git odczytuje wiodący `/` jako ścieżkę BEZWZGLĘDNĄ i kończy błędem „jest poza repozytorium", nie jako „od korzenia repo". `fromWorkingTree()` używa `path.join()` i tej wady nie miał — stąd naprawa (1) sama w sobie nie wystarczała: test „numer widzi taski z INNYCH gałęzi" dalej czerwony, bo ta ścieżka idzie przez `fromRef`, nie `fromWorkingTree`. Przy okazji: testy w tym pliku uderzyły też na artefakt środowiska (macOS symlinkuje /tmp→/private/tmp, /var→/private/var), przez co `relative()` między ścieżką z gita (rozwiązaną) a ścieżką z `resolveBacklogDir` (nierozwiązaną) dawała fałszywe „..” nawet dla poprawnego układu — naprawione przez `realpathSync` przed `relative()`, żeby test mierzył logikę BACKLOG_REL, a nie przypadek systemu plików.
