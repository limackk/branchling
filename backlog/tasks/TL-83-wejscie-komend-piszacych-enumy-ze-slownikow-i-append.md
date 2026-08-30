---
id: TL-83
title: "Wejście komend piszących: enumy ze słowników i --append- zamiast wieloliniowych stringów"
type: code
labels: [post-launch]
board: main
epic: "Powierzchnia CLI"
priority: P2
status: pending
owner: unassigned
estimate: 4h
confidence: high
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/worktrail-global-tool.md
verification:
  - bash: "node --test scripts/tests/write-input-surface.test.mjs"
  - bash: "node scripts/cli.mjs new --help --json | node -e \"const d=JSON.parse(require('fs').readFileSync(0,'utf8')); const p=JSON.stringify(d); if(!p.includes('pending')||!p.includes('P1')) process.exit(1)\""
---

## Cel

Każda komenda pisząca opisuje swoje wejście maszynowo: dopuszczalne wartości
pochodzą ze słowników `config.yaml`, a tekst wieloliniowy da się podać bez
składni, której sandboksy agentowe nie przepuszczają.

## Kontekst

IV prawo obiecuje „wywoływalne wejście na każdej piszącej". Dziś to jest połowa
obietnicy: komendy przyjmują flagi, ale nie mówią, jakie wartości są legalne.
Agent zgaduje, oblewa, próbuje ponownie — i ta pętla jest jedynym powodem, dla
którego oblewanie na nieznanej wartości bywa odbierane jako uciążliwe. Problemem
nie jest surowość, tylko to, że lista dopuszczalnych wartości jest niedostępna
w chwili, gdy jest potrzebna.

Backlog.md rozwiązał to na poziomie MCP: schematy narzędzi generują `status`
jako enum ze słowników projektu, więc agent **strukturalnie nie może** wysłać
nieistniejącej wartości. To nie jest walidacja po fakcie, tylko zawężenie
przestrzeni wejścia. Nie potrzebujemy do tego MCP — potrzebujemy, żeby
`--help --json` niosło słowniki.

**Drugi problem jest bardziej praktyczny, niż wygląda.** Sandboksy agentowe
oparte na tree-sitter ODRZUCAJĄ składnię `$'linia1\nlinia2'` (Backlog.md,
issue #595). Agent w takim sandboksie nie ma jak wpisać wieloliniowej notatki
jednym wywołaniem. Ich odpowiedzią są powtarzalne `--append-*`, uznane wprost
za formę rekomendowaną dla agentów. Nas to uderzy dokładnie w chwili, gdy
TL-80 i TL-82 dołożą komendy zapisujące tekst — czyli lepiej wiedzieć teraz
niż projektować wejście dwa razy.

Rozstrzygnięcia:

1. **Słowniki w `--help --json`, nie druga kopia w kodzie.** Źródłem jest
   `config.yaml` czytanego backlogu. Lista wpisana w definicję flagi rozjedzie
   się z projektem przy pierwszej zmianie configu.
2. **Zachowanie przy oblewaniu się nie zmienia.** Nieznana wartość dalej oblewa
   (III prawo). Ten task dokłada listę, nie miękkość.
3. **`--append-<pole>` dopisuje, `--<pole>` zastępuje.** Gdy podane oba, najpierw
   zastąpienie, potem dopisania w kolejności z linii poleceń. Kolejność musi być
   zdefiniowana, bo inaczej ten sam zestaw flag daje różne wyniki.

## Pre-flight reading

1. `scripts/cli.mjs` — tablica komend i walidacja flag; tam mieszka definicja
   wejścia i tam ma dojść jego opis.
2. `scripts/config.mjs` — odczyt słowników projektu.
3. `scripts/new-task.mjs` — jedyna dziś komenda pisząca; wzorzec dla reszty.
4. `docs/worktrail-global-tool.md` §3 — brzmienie IV prawa.

## Kroki

1. `--help --json` na każdej komendzie: flagi, typy, wymagalność oraz — dla flag
   słownikowych — pełna lista dopuszczalnych wartości z `config.yaml`.
2. Komunikat oblania nieznanej wartości wypisuje dopuszczalne wartości (nie
   samo „nieznana wartość").
3. Wprowadź `--append-<pole>` dla pól tekstowych na komendach piszących; ustal
   i udokumentuj kolejność zastąpienie-przed-dopisaniem.
4. Udokumentuj w README trzy formy podawania tekstu wieloliniowego, z
   `--append-` jako rekomendowaną dla agentów i adnotacją dlaczego.
5. `scripts/tests/write-input-surface.test.mjs`: `--help --json` każdej komendy
   parsuje się i podaje wartości z FIXTURE'OWEGO, niedomyślnego configu
   (kontrola pozytywna — inaczej test przejdzie na literałach w kodzie);
   powtórzone `--append-` zachowuje kolejność; `--pole` + `--append-pole`
   daje udokumentowany wynik.

## Acceptance criteria

- [ ] `--help --json` na każdej komendzie opisuje flagi i dopuszczalne wartości.
- [ ] Wartości słownikowe pochodzą z `config.yaml`, nigdy z literałów w definicji flagi.
- [ ] Oblanie na nieznanej wartości wypisuje listę dopuszczalnych.
- [ ] `--append-<pole>` działa na komendach piszących, z udokumentowaną kolejnością względem `--<pole>`.
- [ ] README opisuje formy wieloliniowe i mówi, która działa w sandboksie agentowym.
- [ ] Test używa niedomyślnego configu, więc literały w kodzie go oblewają.

## Log

2026-08-31 pending — agent:claude — z analizy powierzchni agentowej Backlog.md (src/mcp/utils/schema-generators.ts, issue #595).
