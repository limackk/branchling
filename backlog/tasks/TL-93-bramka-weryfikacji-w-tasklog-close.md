---
id: TL-93
title: "Bramka weryfikacji w worktrail close"
type: task
labels: []
board: main
epic: "Wyróżniki agentowe"
priority: P1
status: done
owner: agent:claude
estimate: 1d
confidence: medium
created: 2026-08-31
updated: 2026-09-01
blocked_by: []
blocks: [TL-96, TL-101]
related_docs:
  - docs/backlog-field-editing-history.md
verification:
  - id: gate
    bash: "node --test scripts/tests/verification-gate.test.mjs"
  - id: one-door
    bash: 'grep -q "setFrontmatterField(text, .status." scripts/done-task.mjs && ! grep -qF "text.replace(/^status:" scripts/done-task.mjs'
  - id: no-force
    bash: "grep -q 'there is no .--force. flag' README.md"
---

## Cel

`worktrail close TL-NNNN` uruchamia komendy z bloku `verification:` taska
i przechodzi na `status: done` TYLKO gdy wszystkie skończą się kodem 0.
Wynik (które komendy, kody wyjścia, kiedy) trafia do `history/` jako zdarzenie
— „done" przestaje być deklaracją i staje się dowodem, którego agent nie może
ominąć przez wpisanie statusu do pliku.

To bezpośrednia odpowiedź na główny lęk użytkowników puszczających agentów bez
nadzoru i spójna z filozofią głośnego oblewania (cichy no-op wygląda jak
działanie).

## Kontekst

Powstało z przeglądu wyróżników wobec Backlog.md (2026-08-31). Protokół „close
= uruchom verification" istnieje już jako konwencja (skill backlog-workflow);
ten task zamienia konwencję w komendę. Klasa błędu jest realna: commit 27776f0
(„TL-52 was done and said pending") i TL-68 jako guard, który by to złapał.

Decyzje zakresu:
- **Edycja pliku wprost pozostaje możliwa** — agent może dalej wpisać
  `status: done` Editem; architektura (state-and-sync §5.1) świadomie na to
  pozwala. Bramka jest drogą preferowaną, a rozjazd „done bez zdarzenia
  weryfikacji" wykrywa `worktrail audit` (TL-90). Nie budować policji zapisu.
- **Wykonywanie cudzych komend jest jawne**: `close` pokazuje, co uruchomi,
  i wykonuje z katalogu głównego repo; `--dry-run` tylko wypisuje. Blok
  `verification` przychodzi z repozytorium, któremu użytkownik i tak ufa
  (to jego własny kod), ale wyjście ma nazywać każdą uruchamianą komendę.
- **Brak bloku albo placeholder** („komenda do uruchomienia" z szablonu) =
  odmowa zamknięcia z komunikatem, nie ciche done. Flaga `--no-verify`
  istnieje, jest głośna w wyjściu i zapisuje w zdarzeniu, że weryfikację
  pominięto.
- Po przejściu: `status: done`, `updated:`, zdarzenie w `history/`
  (aktor z `--actor`), `build` — jedną istniejącą drogą zapisu
  (`task-fields.mjs`), bez nowego kodu piszącego frontmatter.

## Rozstrzygnięcie (2026-09-01)

Bramkę dostarczył **TL-82** — pod nazwą `worktrail done`, nie `close`; ten task
opisywał ją drugi raz i został założony tego samego dnia z tego samego przeglądu.
Kryteria 1–3 były spełnione i pokryte testami, zanim ktokolwiek wziął TL-93.

Zostało kryterium 5 i nie było kosmetyczne. `done` pisał frontmatter regexem po
CAŁYM pliku (`text.replace(/^status: .*$/m, …)`), podczas gdy `take` pisał to samo
pole przez `setFrontmatterField`. Dwa mierzalne skutki:

- komentarz obok wartości (`status: pending  # …`) był kasowany przy zamknięciu,
  a przy `take` przeżywał — dwie komendy nie zgadzały się, czym jest plik taska
  (TL-70: komentarz jest komentarzem w KAŻDYM czytniku);
- na tasku bez pola `updated:` regex nie trafiał w nic i nie pisał nic **po
  cichu**: task zamykał się z kodem 0 i bez pola mówiącego kiedy.

Drugi punkt to dokładnie ta klasa błędu, dla której to narzędzie istnieje —
no-op, który melduje sukces.

## Pre-flight reading

- `_template.md` — kształt bloku `verification:` (lista wpisów `bash:`).
- `scripts/task-fields.mjs` — jedyna droga zapisu frontmattera.
- `scripts/history.mjs` — zapis zdarzenia; ustalić reprezentację wyniku
  weryfikacji (pseudo-pole vs zwykłe zdarzenie) spójną z `PSEUDO_FIELDS`
  w `task-fields.mjs`.
- [docs/backlog-field-editing-history.md](../../docs/backlog-field-editing-history.md)
  §2–§3 — trzy drogi zapisu i format wpisu.

## Kroki

1. Parser bloku `verification:` z frontmattera (wpisy `bash:`); placeholder
   z szablonu rozpoznawany i odrzucany.
2. Wykonanie sekwencyjne z wypisaniem komendy i jej wyjścia; pierwszy błąd
   zatrzymuje bramkę, task zostaje w dotychczasowym statusie.
3. Zapis sukcesu: zmiana statusu przez `task-fields.mjs`, zdarzenie
   weryfikacji do `history/`, regeneracja widoków.
4. `--dry-run`, `--no-verify` (głośne, odnotowane w zdarzeniu), `--json`.
5. Testy: verification przechodzące, oblewające, brakujące, placeholder;
   kontrola pozytywna — oblewająca komenda MUSI zostawić status nietknięty.

## Acceptance criteria

- [x] Oblana weryfikacja nie zmienia żadnego pola taska. [proof: gate]
- [x] Brak bloku `verification:` lub placeholder = odmowa z komunikatem. [proof: gate]
- [x] Zdarzenie w `history/` niesie wynik weryfikacji i aktora. [proof: gate]
- [x] ~~`--no-verify` jest widoczny i w wyjściu, i w zapisanym zdarzeniu.~~
  ODRZUCONE w TL-82, nie niezrobione. Obejście bramki jest ręczną edycją
  pliku, którą widać w diffie; flaga zostawiłaby jedno słowo w jobie CI,
  którego nikt nie czyta. README stwierdza to wprost. [proof: no-force]
- [x] Zapis frontmattera idzie wyłącznie przez `task-fields.mjs`. [proof: one-door]

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 pending — agent:claude — task założony z przeglądu wyróżników
  agentowych; zamienia konwencję ze skilla backlog-workflow w egzekwowaną
  komendę.
