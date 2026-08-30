---
id: TL-89
title: "Komentarz PR z dowodami pracy: GitHub Action"
type: task
labels: []
board: main
epic: "Wyróżniki agentowe"
priority: P2
status: pending
owner: unassigned
estimate: 1d
confidence: medium
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/worktrail-state-and-sync.md
  - docs/backlog-time-tracking.md
verification:
  - bash: "node --test scripts/tests/pr-summary.test.mjs"
---

## Cel

`worktrail pr-summary --base main` wypisuje (markdown na stdout) podsumowanie
tasków, których dotyka bieżąca gałąź: przejścia statusów, autora zmian per pole
(człowiek vs `agent:`), a gdy dane pomiaru istnieją — estymatę kontra czas i
tokeny. Cienki workflow GitHub Actions publikuje to jako komentarz PR.

Efekt: recenzent widzi w PR nie tylko diff kodu, ale diff backlogu i rachunek
pracy agenta — a każdy PR konsumenta jest reklamą narzędzia w cudzym repo.
Task jedzie z gałęzią (Prawo 1), więc tylko narzędzie o tej architekturze może
to zrobić bez integracji z zewnętrznym trackerem.

## Kontekst

Powstało z przeglądu wyróżników wobec Backlog.md (2026-08-31).

Podział odpowiedzialności jest tu decyzją, nie szczegółem:
- **Cała inteligencja w komendzie CLI** — `git diff --name-only <base>...HEAD
  -- <backlog>/tasks/` daje listę tasków, `history/` daje przejścia i aktorów,
  `activity/rollup/` (gdy istnieje po TL-27/25) daje czas i tokeny.
- **Action jest głupi** — checkout, `npx worktrail pr-summary`, komentarz.
  Zgodnie z Prawem 4 (rozszerzalność przez kompozycję): Action to skrypt nad
  stabilnym wyjściem, nie wtyczka. Ta sama komenda działa w GitLab CI czy
  hooku bez ani jednej zmiany.

Sekcje czasu/tokenów są WARUNKOWE: brak danych pomiaru = sekcji nie ma. Nie
blokować tego taska na fazach pomiaru — przejścia statusów i atrybucja per pole
są wartościowe same i istnieją już dziś w `history/`.

**Koszt w komentarzu PR jest opt-in.** Komentarz trafia do miejsca publicznego
(albo firmowego z szeroką widocznością), a kwoty, liczby tokenów i nazwy modeli
to informacja o wydatkach i stacku autora. Domyślnie sekcja pomiaru pokazuje
czas; tokeny, model i kwotę włącza dopiero `--cost`. Kwota podlega przy tym
trybom rozliczenia z TL-30 (krok 4): dane z abonamentu (Claude Code, Codex)
dają tokeny bez kwoty, model lokalny — zadeklarowane zero; komentarz nie
zmyśla dolarów tam, gdzie ich nie ma.

## Pre-flight reading

- [docs/backlog-field-editing-history.md](../../docs/backlog-field-editing-history.md)
  — format wpisu historii, przestrzenie aktorów, czego atrybucja nie
  gwarantuje (§4) — komentarz nie może obiecywać więcej niż dane.
- [docs/worktrail-state-and-sync.md](../../docs/worktrail-state-and-sync.md) §2 —
  dlaczego widoki nie są wersjonowane; pr-summary czyta taski i historię,
  nigdy `INDEX.yaml`.
- `scripts/history.mjs` — odczyt i dedup wpisów.

## Kroki

1. Komenda `pr-summary`: taski dotknięte względem `--base` (git diff po
   ścieżkach `tasks/`), per task: przejścia statusów z zakresu gałęzi, udział
   aktorów w zmianach pól, wynik `verification:` jeśli zapisany.
2. Sekcja pomiaru (warunkowa): estymata vs engaged time z rollupu; tokeny,
   model i kwota dopiero pod `--cost`, z zachowaniem trybów rozliczenia.
3. Wyjścia: markdown (domyślne) i `--json`.
4. Szablon workflow w repo (`.github/workflows/` przykład w README lub
   `examples/`), publikujący komentarz z aktualizacją w miejscu (nie nowy
   komentarz na każdy push).
5. Testy na repozytorium tymczasowym z gałęzią: dotknięte taski wykryte,
   nietknięte pominięte; kontrola pozytywna — gałąź bez zmian w `tasks/` daje
   jawne „brak tasków", nie pusty komentarz.

## Acceptance criteria

- [ ] Wykrywanie tasków po diffie gita, nie po żadnym widoku wyliczonym.
- [ ] Sekcje czasu/tokenów znikają w całości przy braku danych — żadnych zer.
- [ ] Bez `--cost` wyjście nie zawiera tokenów, kwot ani nazw modeli.
- [ ] Wyjście markdown renderuje się poprawnie jako komentarz GitHuba
      (sprawdzone na realnym PR przed zamknięciem).
- [ ] Komenda działa bez GitHuba (stdout) — Action jest tylko transportem.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 pending — agent:claude — task założony z przeglądu wyróżników
  agentowych; sekcja pomiarowa celowo warunkowa zamiast blokady na TL-27/25.
- 2026-08-31 revised — agent:claude — sekcja kosztów opt-in (`--cost`):
  komentarz jest publiczny, a tokeny/model/kwota to informacja o wydatkach
  i stacku; kwoty wg trybów rozliczenia z TL-30.
