---
id: TL-43
title: "Log historii bywa nieśledzony w gicie — bramka na zapisie traci przesłankę"
type: bug
labels: []
board: main
epic: "Historia i atrybucja"
priority: P2
status: pending
owner: unassigned
estimate: 2h
confidence: medium
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-field-editing-history.md
verification:
  - bash: "node scripts/cli.mjs check --history"
---

## Cel

Plik `backlog/history/<ID>.jsonl` jest z założenia **wersjonowany** — to on niesie
atrybucję między drzewami. Dziś nic nie pilnuje, żeby faktycznie trafił do gita,
więc bywa nieśledzony i nie dojeżdża tam, gdzie jest potrzebny.

## Kontekst

Zmierzone 2026-08-31 w repozytorium konsumenta (`origin`): **28 z 71**
logów historii było nieśledzonych, przy jednocześnie zacommitowanych plikach
tasków.

Przyczyna jest proceduralna, nie techniczna: reguła „`git add` wyliczonymi
ścieżkami" (świadoma i słuszna — chroni przed zabraniem cudzej pracy) sprawia, że
`.md` się dodaje, bo o nim myślisz, a `.jsonl` nie, bo powstał obok, bez udziału
człowieka.

**Dlaczego to nie jest kosmetyka.** Bramka z TL-17 — rekoncyliacja pyta plik
historii, zanim dopisze `__created__` — działa tylko wtedy, gdy ma co czytać.
`.md` jedzie gitem, `.jsonl` tylko wtedy, gdy ktoś go dodał. Właśnie tak powstało
trzecie wystąpienie duplikatu z TL-39, już PO tamtej naprawie: drugie drzewo
zobaczyło task bez historii i uczciwie uznało go za nowy.

TL-39 dołożył drugą warstwę przy odczycie, więc **objaw jest zamknięty** — ale
kosztem: dopóki log nie dojedzie, atrybucja jest odtwarzana dopiero po fakcie,
a metryki liczone w drzewie bez logu są liczone z niepełnych danych.

## Kroki

1. Rozstrzygnąć, czy to zadanie narzędzia. `worktrail` z założenia nie zna gita
   (`--dir` może wskazywać katalog poza repozytorium), więc bramka musi być
   opcjonalna i **cicha, gdy gita nie ma** — a nie zielona, gdy jest.
2. `worktrail check --history`: dla każdego taska w `tasks/` sprawdzić, czy jego log
   (o ile istnieje) jest śledzony. Wyjście niezerowe przy nieśledzonych.
3. Rozważyć drugą stronę: log BEZ taska (osierocony po zmianie prefiksu albo po
   skasowaniu pliku) — to inny defekt, ale ta sama komenda go widzi.
4. Zdecydować, czy `check --history` wchodzi do pełnego `check` (wtedy oblewa
   drzewa, w których nikt jeszcze nie zacommitował logów) czy zostaje opt-in.
5. W repozytorium konsumenta: dodać 28 nieśledzonych logów do gita — osobnym
   commitem i po sprawdzeniu, że żaden nie jest cudzą pracą w locie.

## Acceptance criteria

- [ ] Nieśledzony log historii jest raportowany z nazwą pliku i wyjściem ≠ 0.
- [ ] Poza repozytorium gita komenda **nie udaje**, że sprawdziła — mówi, że nie
      ma czym sprawdzić, i to widać w wyjściu.
- [ ] Kontrola pozytywna: repozytorium z jednym nieśledzonym logiem oblewa,
      to samo repozytorium po `git add` przechodzi.
- [ ] Osierocony log (bez taska) rozpoznany osobno od nieśledzonego — to dwa
      różne defekty i mylenie ich zaciemnia oba.

## Notes

- Klasa ogólniejsza: dane wytwarzane przez narzędzie obok pliku, który człowiek
  dodaje ręcznie, są niewidoczne dla każdej siatki bezpieczeństwa gita.

## Log

- 2026-08-31 created — claude — wydzielone z TL-39 po zmierzeniu 28/71 nieśledzonych logów; TL-39 zamknął objaw (dedup przy odczycie), ten task zamyka drogę dostarczenia
