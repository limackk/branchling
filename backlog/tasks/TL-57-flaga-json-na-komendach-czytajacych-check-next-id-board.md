---
id: TL-57
title: "Flaga --json na komendach czytających: check, next-id, board"
type: task
labels: [pre-launch]
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
  - .claude/skills/worktrail-cli/SKILL.md
verification:
  - bash: "node --test scripts/tests/json-output.test.mjs"
  - bash: "node scripts/cli.mjs check --json | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);console.log('check --json parsuje, guardów:',Array.isArray(r)?r.length:Object.keys(r).length)})\""
  - bash: "node scripts/cli.mjs next-id --json | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{JSON.parse(s);console.log('next-id --json parsuje — OK')})\""
---

## Cel

Domknąć Prawo 4 — „`--json` na każdej komendzie czytającej" — bo dziś jest to
opis dwóch komend, a nie reguła.

## Kontekst

Zmierzone 2026-08-31, `grep '--json' scripts/*.mjs`:

| Komenda | czyta? | `--json` |
|---|---|---|
| `query` | tak | jest |
| `stats` | tak | jest |
| `check` | tak | **brak** |
| `next-id` | tak | **brak** |
| `board` | tak | **brak** |

`docs/worktrail-global-tool.md` §3 stawia to jako jedno z czterech praw i wyprowadza
z niego całą rozszerzalność: „bez API wtyczek, bo `--json` na każdej komendzie
czytającej i wywoływalne wejście na każdej piszącej". Prawo, które obowiązuje w
dwóch komendach na pięć, nie jest podstawą rozszerzalności — jest opisem stanu.

Praktyczna cena jest dziś widoczna w `new-task.mjs`: numer z `next-backlog-id.mjs`
czytany jest **ze stdout, jako ostatnia linia**, po czym walidowany regeksem, żeby
awaria skanera nie dała pliku `BL-NaN-*.md`. To jest obejście po dokładnie tę
brakującą flagę. `--json` zamienia „ostatnia linia stdout, oby była liczbą" w pole.

Największą wartość ma tu `check --json`: to jest komenda, którą ktoś podepnie do
CI albo do hooka i będzie chciał wiedzieć, KTÓRY guard oblał i na czym — a nie
tylko, że kod wyjścia jest różny od zera.

**Ograniczenie, które łatwo złamać:** przy `--json` na stdout nie ma prawa pojawić
się nic poza JSON-em. Nagłówek, `✓` albo ostrzeżenie dopisane „tylko na chwilę"
psują parsowanie u każdego konsumenta naraz. Diagnostyka idzie na stderr.

Kod wyjścia zostaje bez zmian: `check --json`, który znalazł naruszenie, nadal
oblewa. JSON opisuje wynik, nie zastępuje kodu wyjścia.

## Pre-flight reading

1. `docs/worktrail-global-tool.md` §3, Prawo 4.
2. `scripts/query.mjs` i `scripts/stats-report.mjs` — dwa istniejące wzorce `--json`.
3. `scripts/new-task.mjs` — funkcja `nextId()`, czyli obejście, które ten task usuwa.
4. `scripts/cli.mjs` — `check` jest komendą złożoną (trzy guardy, kod wyjścia = najgorszy z nich); JSON musi to zachować.

## Kroki

1. `check --json`: jeden dokument dla całego uruchomienia — lista guardów, dla każdego nazwa, wynik, liczba sprawdzonych rzeczy i lista naruszeń. Kod wyjścia nadal najgorszy z guardów.
2. `next-id --json`: numer, pełne ID i **źródło** (`repo` / `local`) — dziś ostrzeżenie o węższym źródle idzie tylko na stderr prozą, a to jest informacja, na którą program powinien móc zareagować.
3. `board --json`: sugerowany board plus reguła, z której wyszedł.
4. Uporządkuj `new-task.mjs`, żeby czytał `next-id --json` zamiast ostatniej linii stdout.
5. `scripts/tests/json-output.test.mjs`: dla każdej komendy czytającej wyjście `--json` parsuje się, także przy zerowej liczbie wyników, i stdout nie zawiera nic poza JSON-em.
6. Dopisz `--json` do listy dozwolonych flag każdej z tych komend (dziś nieznana flaga oblewa).

## Acceptance criteria

- [ ] `check`, `next-id`, `board` przyjmują `--json`.
- [ ] Przy `--json` stdout zawiera wyłącznie JSON — sprawdzone testem, także dla pustego wyniku.
- [ ] `check --json` nazywa guard, który oblał, i zachowuje kod wyjścia.
- [ ] `next-id --json` niesie źródło numeru (`repo` / `local`).
- [ ] `new-task.mjs` nie parsuje już stdout linia-po-linii.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 created — agent:claude — z audytu powierzchni CLI
