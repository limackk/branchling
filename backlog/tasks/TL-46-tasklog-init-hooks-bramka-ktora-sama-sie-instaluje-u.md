---
id: TL-46
title: "worktrail init --hooks — bramka, która sama się instaluje u użytkownika"
type: code
labels: [post-launch]
board: main
epic: "Backlog — publikacja open source"
priority: P3
status: pending
owner: unassigned
estimate: 4h
confidence: medium
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/worktrail-global-tool.md
verification:
  - bash: "node --test scripts/tests/hooks-install.test.mjs"
---

## Cel

Rozstrzygnąć, czy narzędzie ma umieć **zainstalować hooka gitowego u swojego
użytkownika**, i jeśli tak — zrobić to tak, żeby nigdy nie nadpisało cudzego
hooka i dało się cofnąć jedną komendą.

## Kontekst

Bramki (`check-backlog-id-collisions`, `check-backlog-boards`,
`check-backlog-refs`) **już jadą do każdej instalacji** — leżą w `scripts/`,
objętym `files` w `package.json`, i są wystawione jako `worktrail check`. Czego
nie ma, to momentu, w którym ktoś je odpala. Dziś odpala je ten, kto pamięta.

Rozróżnienie, przez które ten task w ogóle powstał
([worktrail-global-tool.md §10.1](../../docs/worktrail-global-tool.md)): hook w repo
konsumenta jest jego plikiem, hook dogfoodingowy tutaj nie wchodzi do paczki, a
więc **żadne z tych dwóch nie rozwiązuje problemu użytkownika.** Brakującym
elementem jest komenda, nie plik konfiguracyjny u nas.

**Dlaczego to jest decyzja, a nie oczywistość.** Narzędzie, które pisze do
`.git/` cudzego repozytorium, robi rzecz nieoczekiwaną. Trzy pułapki, z których
każda zdarzyła się już komuś innemu:

1. **Nadpisanie istniejącego hooka.** Repozytoria mają własne `pre-commit`
   (husky, lefthook, pre-commit.com). Wpisanie się na siłę kasuje cudzą bramkę.
2. **`core.hooksPath` już ustawiony.** Wtedy `.git/hooks/` jest martwe i cichy
   zapis tam **nie zadziała, nie mówiąc o tym** — czyli najgorszy wariant:
   użytkownik myśli, że ma bramkę.
3. **Brak drogi powrotnej.** Instalacja bez `--uninstall` to instalacja, której
   ktoś będzie się pozbywał ręcznie, ucząc się przy okazji nieufności.

## Kroki

1. Rozstrzygnąć formę: własny plik hooka vs **dopisanie linii** do istniejącego
   vs samo wypisanie linii do skopiowania (najmniej inwazyjne, zero magii).
2. Wykryć `core.hooksPath` i istniejący `pre-commit` PRZED zapisem; przy
   konflikcie **nie pisać** i powiedzieć dlaczego.
3. `--uninstall` zdejmujący dokładnie to, co komenda założyła — i nic więcej.
4. Rozstrzygnąć, czy to podkomenda `init`, czy osobna (`worktrail hooks install`).
   `init` zakłada backlog w PUSTYM katalogu; hook dotyczy repozytorium, które
   już istnieje — to mogą być dwa różne momenty w życiu użytkownika.

## Acceptance criteria

- [ ] Istniejący `pre-commit` NIE jest nadpisany — komenda odmawia i nazywa plik.
- [ ] Ustawiony `core.hooksPath` rozpoznany; komenda pisze we właściwe miejsce
      albo odmawia, ale **nigdy nie zapisuje w miejsce, którego git nie czyta**.
- [ ] `--uninstall` przywraca stan sprzed instalacji — test na bajtach.
- [ ] Repozytorium bez `.git` → czytelny błąd, nie stack trace.
- [ ] Kontrola pozytywna: po instalacji commit z kolizją ID **oblewa**. Bez tego
      kroku test dowodzi tylko, że plik powstał.

## Notes

- Warto rozważyć wariant najskromniejszy: `worktrail hooks --print`, który wypisuje
  gotową linię, a instalację zostawia człowiekowi. Rozwiązuje 90% problemu za 10%
  ryzyka i nie dotyka cudzego `.git/`.

## Log

- 2026-08-31 created — claude — wydzielone z rozmowy o bramkach, w której moja pierwsza propozycja (hook dogfoodingowy w tym repo) została **odrzucona jako nieuzasadniona**: nie łapałaby żadnego z czterech błędów tej sesji. Pytanie foundera „te bramki wejdą w projekt open source czy to bramki w the origin project?" pokazało, że mylę trzy różne rzeczy — i że jedyna, która dotyczy użytkownika, to właśnie ta, której nie ma.
