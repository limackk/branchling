---
id: TL-51
title: "worktrail <komenda> --help oblewa w 8 z 12 komend"
type: bug
labels: [pre-launch]
board: main
epic: "Powierzchnia CLI"
priority: P1
status: done
owner: claude
estimate: 4h
confidence: high
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: [TL-52]
related_docs:
  - .claude/skills/worktrail-cli/SKILL.md
  - .claude/skills/worktrail-cli/references/output-style.md
verification:
  - bash: "node --test scripts/tests/cli-help.test.mjs"
  - bash: "node scripts/cli.mjs stats --help >/dev/null 2>&1 && echo 'stats --help — OK' || { echo 'nadal oblewa'; exit 1; }"
  - bash: "node scripts/cli.mjs query --help | head -1 | grep -q '#!' && { echo 'help nadal drukuje źródło'; exit 1; }; echo 'query --help bez shebanga — OK'"
---

## Cel

Obietnica z pomocy głównej — „`worktrail <komenda> --help` pokazuje flagi komendy" —
ma być prawdziwa w każdej komendzie.

## Kontekst

Zmierzone 2026-08-31, `node scripts/cli.mjs <komenda> --help` dla wszystkich
dwunastu komend z tabeli `COMMANDS`:

| Zachowanie | Komendy |
|---|---|
| oblewa: „nieznana flaga: --help", kod 2 | `build`, `viewer`, `next-id`, `board`, `history`, `new`, `init`, `stats` |
| działa | `check`, `migrate-prefix` |
| działa, ale drukuje komentarz źródłowy modułu — razem z linią `#!/usr/bin/env node` | `query` |
| nie sprawdzone (uruchomiłoby serwer) | `serve` |

**Skąd się to wzięło.** [TL-25](TL-25-domknij-walidacje-flag-w-5-komendach-worktrail.md)
domknął walidację flag w pięciu komendach — słusznie, bo cichy no-op wygląda jak
działanie. Ale lista dozwolonych flag nie zawierała `--help`, więc dobra zmiana
zamieniła flagę pomocniczą w błąd użycia. To jest regresja tamtego taska, a nie
osobna dziura: dokładnie ten sam mechanizm, który chroni przed literówką, blokuje
też jedyną flagę, którą użytkownik wpisuje, gdy NIE WIE, jakie flagi istnieją.

**Dlaczego to boli bardziej, niż wygląda.** `--help` jest wpisywane w momencie
niepewności. Odpowiedź „nieznana flaga" z kodem 2 uczy, że narzędzie nie ma
pomocy — a pomoc główna właśnie obiecała, że ma. Program, który łamie własną
obietnicę, kosztuje więcej zaufania niż program, który nic nie obiecał.

`query --help` jest osobnym przypadkiem: drukuje własny nagłówek modułu przez
`readFileSync(import.meta.url).split("*/")`. Treść jest wartościowa, ale to
notatka dla współautora, nie pomoc dla użytkownika — zaczyna się od shebanga i
mówi o kosztach tokenów.

`serve --help` wymaga uwagi przy testowaniu: jeśli nie jest obsłużone, komenda
wystartuje serwer i test zawiśnie. Dlatego weryfikacja idzie przez `node --test`
ze `spawnSync` i limitem czasu, a nie przez pętlę w powłoce.

## Pre-flight reading

1. `scripts/cli.mjs` — `COMMANDS` (pole `usage` jest już w tabeli), `HELP_FLAGS`, `runScript`.
2. `scripts/query.mjs` — wzorzec walidacji flag i dzisiejsza obsługa `--help`.
3. [TL-25](TL-25-domknij-walidacje-flag-w-5-komendach-worktrail.md) — dlaczego nieznana flaga oblewa; ta reguła zostaje.
4. `.claude/skills/worktrail-cli/references/output-style.md` §7 — układ pomocy.

## Kroki

1. Rozstrzygnij, gdzie mieszka pomoc komendy. Tabela `COMMANDS` już trzyma `usage` — najtaniej, żeby `cli.mjs` przechwytywał `--help`/`-h` PRZED spawnem i drukował `usage` komendy. Wtedy żadna komenda nie musi pamiętać o tej fladze, a obietnica z pomocy głównej jest spełniona z jednego miejsca.
2. Jeśli komenda ma coś więcej do powiedzenia niż jedna linia `usage` (`check` już ma), niech tabela pozwala na tekst wielolinijkowy — tak jak dziś `CHECK_USAGE`.
3. `--help` w każdej ścieżce: wyjście na stdout, kod 0. To nie jest błąd użycia.
4. `query.mjs` — przestań drukować własny nagłówek modułu; drukuj to samo, co tabela, ewentualnie z listą flag.
5. `serve` — obsłuż `--help` bez startowania serwera.
6. Test `scripts/tests/cli-help.test.mjs`: dla KAŻDEJ komendy z `COMMANDS` (iteracja po tabeli, nie po ręcznej liście — inaczej nowa komenda ucieknie testowi) `--help` kończy się kodem 0, pisze na stdout, nie pisze na stderr i nie zawiera shebanga. `spawnSync` z `timeout`, żeby `serve` nie zawiesił zestawu.

## Acceptance criteria

- [ ] `worktrail <komenda> --help` kończy się kodem 0 dla każdej komendy z `COMMANDS`.
- [ ] Wyjście `--help` idzie na stdout, nie na stderr.
- [ ] `query --help` nie drukuje shebanga ani komentarza źródłowego.
- [ ] `serve --help` nie uruchamia serwera.
- [ ] Test iteruje po tabeli `COMMANDS`, więc nowa komenda bez pomocy oblewa.
- [ ] Nieznana flaga NADAL oblewa kodem 2 — reguła z TL-25 nietknięta.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 created — agent:claude — z audytu powierzchni CLI
- 2026-08-31 in_progress — agent:claude — start implementacji
- 2026-08-31 done — agent:claude — rozstrzygnięcie z kroku 1: `--help` przechwytuje `cli.mjs` PRZED spawnem i składa pomoc z tabeli (`summary` mówi PO CO, `usage` mówi JAK — oba pola już były, brakowało drogi, którą użytkownik może je zobaczyć). Żadna komenda nie musi o tej fladze pamiętać, a nowa dostaje pomoc przez samo wpisanie się do `COMMANDS`. Martwy handler `--help` w `runCheck` usunięty. 13/13 komend, kod 0, stdout.
- 2026-08-31 done — agent:claude — dwie ścieżki bezpośredniego wywołania też poprawione, bo `node scripts/<x>.mjs` omija dispatcher: `query.mjs` przestał drukować nagłówek własnego pliku (razem z shebangiem i akapitem o kosztach tokenów) — lista flag jest teraz WYPROWADZANA z tych samych zbiorów, którymi waliduje wejście, więc nie może się z nimi rozjechać; `serve-backlog.mjs` obsługuje `--help` przed zbindowaniem portu.
- 2026-08-31 done — agent:claude — REGRESJA ZŁAPANA NA SOBIE, warta zapisania. Pierwsza wersja skanowała argumenty przeciw `HELP_FLAGS`, w którym jest też gołe słowo `help` — przez co `worktrail query --text help --count` drukowało pomoc zamiast liczyć trafienia. Czyli poprawka na cichy no-op sama wprowadziła cichy no-op, w tej samej komendzie. Wewnątrz argumentów komendy pomocą są wyłącznie `--help` i `-h`; `worktrail help` zostaje, bo tam to słowo stoi na miejscu komendy. Osobny test.
- 2026-08-31 done — agent:claude — test `cli-help.test.mjs`, 10 asercji, iteruje po `COMMANDS`, nie po ręcznej liście: ręczna lista sprawia, że nowa komenda wypada z pokrycia po cichu, czyli że ta sama dziura wraca przy pierwszej okazji. `spawnSync` z limitem czasu, bo `serve` bez obsługi `--help` nie oblewa, tylko zaczyna nasłuchiwać. Kontrola pozytywna na niepustości tabeli i asercja, że nieznana flaga NADAL oblewa — poprawka przepuszczająca wszystko też dałaby zielone `--help`. 328/328.
