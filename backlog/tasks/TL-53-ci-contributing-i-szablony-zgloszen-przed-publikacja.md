---
id: TL-53
title: "CI, CONTRIBUTING i szablony zgłoszeń przed publikacją"
type: task
labels: [pre-launch]
board: main
epic: "Backlog — publikacja open source"
priority: P2
status: pending
owner: unassigned
estimate: 4h
confidence: medium
created: 2026-08-31
updated: 2026-09-01
blocked_by: [TL-112]
blocks: []
related_docs:
  - .claude/skills/worktrail-release/SKILL.md
verification:
  - bash: "ls .github/workflows/*.yml >/dev/null 2>&1 && echo 'workflow jest — OK'"
  - bash: "test -f CONTRIBUTING.md && echo 'CONTRIBUTING jest — OK'"
  - bash: "grep -q 'node --test' .github/workflows/*.yml && grep -q 'cli.mjs check' .github/workflows/*.yml && echo 'CI odpala testy i guardy — OK'"
  - manual: "Zielony przebieg widoczny publicznie przy pierwszym pushu; badge w README prowadzi do niego."
---

## Cel

Zamienić „263 testy przechodzą" z twierdzenia autora w zielony znacznik, który
widzi ktoś obcy — i powiedzieć wprost, jak wygląda dobra kontrybucja.

## Kontekst

Stan 2026-08-31: brak `.github/`, brak workflow, brak `CONTRIBUTING.md`, brak
`CHANGELOG.md`, brak zdalnego repozytorium. Zestaw testów jest mocny (263 testy,
zielony, ~2.4 s, bez zależności) — po prostu nikt poza autorem nie ma jak tego
zobaczyć.

Dla dewelopera oceniającego nieznane narzędzie kolejność wygląda tak: strona
repozytorium → czy jest zielone CI → README → kod. Zielony przebieg jest
najtańszym sygnałem zaufania, jaki ten projekt może kupić, bo praca, która za nim
stoi, **już jest zrobiona**.

Dwie rzeczy do rozstrzygnięcia przy okazji, bo obie są deklaracjami, których
potem trzeba dotrzymać:

- **Czy przyjmujemy pull requesty**, i jeśli tak, to na jakich zasadach. Brak
  odpowiedzi też jest odpowiedzią, tylko udzieloną przez ciszę.
- **Matryca wersji Node.** `engines` mówi `>=18`; jeśli CI testuje tylko jedną
  wersję, to `>=18` jest niesprawdzone. Albo mierzymy, albo zawężamy deklarację.

Wąska korzyść, o której łatwo zapomnieć: CI jest jedynym miejscem, gdzie testy
lecą **w układzie niekolokowanym** — na świeżym klonie, z pustym cachem, bez
wygenerowanych widoków. Dokładnie ta różnica złapała klasę błędów opisaną w
`scripts/tests/non-colocated-layout.test.mjs`.

## Pre-flight reading

1. `scripts/tests/_repo.mjs` — dlaczego testy nie mogą zakładać jednego układu katalogów.
2. `.gitignore` — widoki są generowane; świeży klon ich nie ma i CI to potwierdza.
3. `.claude/skills/worktrail-release/SKILL.md` §8 — czego szuka obcy deweloper.

## Kroki

1. `.github/workflows/test.yml`: `node --test scripts/tests/*.test.mjs` plus `node scripts/cli.mjs check` na świeżym klonie. Bez `npm install` — zależności nie ma i CI ma to udowadniać.
2. Matryca wersji Node zgodna z `engines` (18 / 20 / 22), na Linuksie i macOS.
3. Krok `npm pack --dry-run` z asercją, że w tarballu nie ma `tasks/`, `history/`, `archive/`, `boards/`, `config.yaml`, `viewer.html`. Lista dozwoleń, która nie jest sprawdzana, obowiązuje do pierwszej pomyłki.
4. `CONTRIBUTING.md`: jak uruchomić testy, czym jest backlog tego repozytorium, że narzędzie śledzi samo siebie, i co musi mieć zmiana (test, aktualizacja pomocy, `worktrail check`).
5. Badge w README.
6. Szablony zgłoszeń: błąd (z wersją, systemem, wyjściem `worktrail --version`) i propozycja funkcji.
7. Zdecyduj o `CHANGELOG.md` — ręczny czy generowany z tagów.

## Acceptance criteria

- [ ] CI odpala testy i `worktrail check` na każdym pushu.
- [ ] CI sprawdza zawartość tarballa.
- [ ] Matryca wersji Node pokrywa to, co deklaruje `engines`.
- [ ] `CONTRIBUTING.md` odpowiada, jak uruchomić testy i czy PR-y są przyjmowane.
- [ ] Badge w README prowadzi do przebiegu.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 created — agent:claude — z audytu gotowości do publikacji
- 2026-09-01 pending — agent:claude — ZABLOKOWANE przez TL-112. `CONTRIBUTING.md` ma powiedzieć kontrybutorowi, na jakich warunkach przyjmujemy jego kod — a te warunki nie są jeszcze rozstrzygnięte (DCO czy CLA, i gdzie biegnie granica open/chmura). Napisany wcześniej byłby deklaracją, którą trzeba potem wycofać wobec ludzi, którzy już na niej polegli.
