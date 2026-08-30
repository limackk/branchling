---
id: TL-122
title: "Push viewera nie widzi zmiany stanu w innym worktree"
type: task
labels: []
board: main
epic: "Backlog viewer"
priority: P3
status: pending
owner: unassigned
estimate: 2h
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - docs/worktrail-state-and-sync.md
verification:
  - id: suite
    bash: "node --test scripts/tests/serve-cross-branch-push.test.mjs"
  - id: no-regression
    bash: "node --test scripts/tests/*.test.mjs"
  - id: manual-two-trees
    manual: "Przy otwartej stronie z `worktrail serve` w głównym checkoucie: `worktrail take <ID>` w DRUGIM worktree sprawia, że badge `<worktree>: in_progress` pojawia się na karcie bez przeładowania strony"
---

## Cel

Otwarta strona viewera pokazuje wzięcie taska w innym worktree bez przeładowania.
Dziś sygnał stanu z wielu gałęzi (TL-73) działa w ODCZYCIE, ale nie w pushu:
strona zostaje stara, a czytelnik nie ma powodu nacisnąć F5.

## Kontekst

`GET /` renderuje HTML per request (`scripts/serve-backlog.mjs:377-386`), więc po
przeładowaniu badge `elsewhere` jest aktualny — dane są dobre, problem jest
wyłącznie w powiadamianiu.

Push do przeglądarki wisi na jednym `fs.watch` nad WŁASNYM `backlog/tasks`
(`scripts/serve-backlog.mjs:267-273`). `worktrail take <ID>` wykonany w innym
worktree zapisuje plik w KATALOGU TAMTEGO DRZEWA — lokalnie nie zmienia się nic,
więc watcher nie strzela i SSE milczy. To samo dotyczy commita na cudzej gałęzi.

Dlaczego to jest wada, a nie kosmetyka: `crossBranchState()` istnieje po to, żeby
widok z jednego checkoutu nie KŁAMAŁ o reszcie repozytorium. Strona, która trzyma
nieaktualny skan i wygląda na żywą (bo dostaje pushe przy lokalnych edycjach),
jest tym samym trybem awarii, tylko trudniejszym do zauważenia niż statyczny plik.

Pułapki, które trzeba rozstrzygnąć w trakcie:

1. **Nie zakładaj watchera na cudze worktree.** Ich lista zmienia się w czasie
   życia serwera (worktree powstają i są usuwane), a każdy nowy watcher to
   deskryptor, którego nikt nie zamyka. Odpytywanie `crossBranchState()` w
   interwale jest tańsze i nie zależy od tego, czy plik był brudny czy
   zacommitowany.
2. **Push tylko przy RÓŻNICY.** SSE ma lecieć, gdy zmieni się wynik skanu, a nie
   co tick — inaczej strona przerysowuje się w kółko i pushe przestają cokolwiek
   znaczyć.
3. **Interwał jest wartością konfiguracji, nie literałem** (III prawo). Skan
   uruchamia `git`, więc częstotliwość to koszt, o którym decyduje projekt.
   Wyłącznik skanu (`crossBranchState: false`) MUSI wyłączać także tę pętlę.
4. **Serwer bywa poza repozytorium git** — wtedy skan nie rusza (`reason`) i
   pętla nie ma czego pilnować; nie wolno logować ostrzeżenia co tick.

## Pre-flight reading

1. `scripts/serve-backlog.mjs:245-273` — reconcile + `fs.watch` + `notifyClients()`.
2. `scripts/branch-scan.mjs:400-430` — `crossBranchState()` i jego `reason`.
3. `scripts/build-viewer.mjs:200-222` — gdzie `elsewhere` wchodzi do taska.

## Kroki

1. Wyliczaj skrót wyniku `crossBranchState()` (para `id → obserwacje`) w interwale
   z konfiguracji; przy zmianie skrótu wyślij zdarzenie SSE.
2. Klucz konfiguracji na interwał w warstwie projektu; nieznany klucz oblewa.
   Wyłączony skan = brak pętli.
3. Test: fixture z dwoma worktree, take w drugim, oczekiwane zdarzenie na SSE
   BEZ przeładowania. Kontrola pozytywna: przy braku zmiany nie leci nic.

## Acceptance criteria

- [ ] Zmiana stanu taska w innym worktree wywołuje pushe do otwartej strony. [proof: suite]
- [ ] Brak zmiany nie wywołuje pusha — test ma kontrolę negatywną i pozytywną. [proof: suite]
- [ ] Interwał jest kluczem konfiguracji projektu, a wyłączony skan wyłącza pętlę. [proof: suite]
- [ ] Serwer poza repozytorium git działa jak dziś i nie loguje ostrzeżenia w pętli. [proof: suite]
- [ ] Pozostałe testy zielone. [proof: no-regression]
