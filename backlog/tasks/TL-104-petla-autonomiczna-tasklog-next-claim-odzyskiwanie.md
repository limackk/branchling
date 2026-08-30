---
id: TL-104
title: "Pętla autonomiczna: worktrail next --claim, odzyskiwanie porzuconych tasków, wzorzec świeżej sesji"
type: code
labels: [post-launch]
board: main
epic: "Powierzchnia CLI"
priority: P1
status: done
owner: agent:claude-opus-5
estimate: 1d
confidence: medium
created: 2026-09-01
updated: 2026-09-01
blocked_by: [TL-82]
blocks: []
related_docs:
  - docs/funkcjonalnosci.md
  - docs/worktrail-state-and-sync.md
verification:
  - bash: "node --test scripts/tests/next-claim.test.mjs"
  - manual: "Dwie równoległe pętle `while worktrail next --claim` na tym samym backlogu nie biorą nigdy tego samego taska; task porzucony (in_progress, stary `updated`) wraca do puli z wpisem w logu, nie po cichu"
---

## Cel

Backlog może napędzać pętlę autonomiczną — `claude -p` albo `codex exec` w
świeżej sesji na każdy task — bez żadnej logiki wyboru po stronie pętli.
`worktrail next` mówi, co teraz; `--claim` bierze to atomowo; task porzucony
przez martwą sesję wraca do puli sam. Kryterium wyjścia sesji jest
`worktrail done` (TL-82), nie opinia agenta.

## Kontekst

Kompaktacja kontekstu u obu vendorów jest stratna z konstrukcji: degradacja od
~70% zapełnienia, kontekst decyzyjny jako pierwsza ofiara streszczenia (Claude),
zawieszenia przy progu i cykle wracające od razu na ~80% (Codex, issues #19116,
#35032). Oficjalna rada Anthropic: co ma przeżyć granicę kompaktacji, musi
mieszkać POZA rozmową. Właściwa architektura trybu autonomicznego to więc
świeża sesja na task — a nasz plik taska (Cel / Kontekst / Pre-flight / Kroki /
verification) jest już zaprojektowany jako pakiet rehydracji dla kogoś bez
pamięci rozmowy. Ten task domyka trzy dziury, przez które ta pętla dziś nie
może istnieć:

1. **Polityka wyboru mieszka w pętli, nie w narzędziu.** `query` filtruje, ale
   „pending, nieblokowany, najwyższy priorytet, najstarszy" każda pętla
   pisałaby sama — i każda inaczej. Polityka ma być JEDNA i testowalna.
2. **Brak atomowego wzięcia.** Dwie pętle w dwóch worktree (nasz własny model
   pracy równoległej) wezmą ten sam task. Uwaga na granicę trudności: dwa
   PROCESY na jednym drzewie rozstrzyga zapis pliku; dwa WORKTREE widzą się
   dopiero po commicie — `--claim` gwarantuje atomowość w obrębie jednego
   drzewa, a dla wielu worktree dokumentuje wzorzec (skan gałęzi jak w
   `next-id` / TL-73), zamiast obiecywać atomowość, której git nie daje.
3. **Martwa sesja zostawia `in_progress` na zawsze** i pętla staje. Staleness:
   `in_progress` + `updated` starsze niż okno → task wraca do puli z wpisem w
   logu i historii (aktor `agent:`), nigdy po cichu. Okno jest kluczem
   konfiguracji projektu. To sąsiaduje z heartbeatami (TL-28), ale ich nie
   wymaga — `updated` wystarcza na start.

Rozstrzygnięte: `next` NIE wykonuje pracy i NIE uruchamia agenta. Wybór i
wzięcie to komendy worktrail; pętla zewnętrzna (shell, cron, hook) jest poza
narzędziem i dostaje przykładowy skrypt w dokumentacji. Uzasadnienie: IV prawo —
kompozycja zamiast wbudowanego orkiestratora, który musiałby znać vendorów.

Zależność od TL-82 jest realna: bez bramki `done` pętla nie ma mechanicznego
kryterium wyjścia i „autonomia" znaczy „agent sam sobie wierzy".

## Pre-flight reading

1. `scripts/query.mjs` — istniejące filtry i sortowanie; `next` ma z tego
   korzystać, nie liczyć drugi raz.
2. `scripts/check-backlog-refs.mjs` — rozstrzyganie `blocked_by`; „nieblokowany"
   znaczy: każdy bloker w statusie archiwalnym wg `config.yaml`, nie literału.
3. `scripts/history-record.mjs` — wpis historii dla claim i dla odzyskania.
4. `backlog/tasks/TL-82-*.md` — kontrakt `done`, który zamyka pętlę.
5. `backlog/tasks/TL-28-*.md` — heartbeaty; nie dubluj, zostaw punkt zaczepienia.

## Kroki

1. `worktrail next [--json]`: jeden task albo jawne „pusta kolejka" (exit 0 z
   komunikatem, odróżnialne od błędu) — pending, nieblokowany, najwyższy
   priorytet, najstarszy `created`, remis rozstrzyga ID.
2. `worktrail next --claim --owner <aktor>`: atomowo `in_progress` + `owner` +
   `updated` + wpis historii. Aktor obowiązkowo z przestrzenią nazw.
3. Odzyskiwanie: `next` traktuje przeterminowany `in_progress` jako dostępny;
   przejęcie zapisuje w `## Log` i historii, od kogo i dlaczego. Okno w
   konfiguracji projektu; nieznany klucz oblewa (III prawo).
4. `--json` w kopercie z TL-72.
5. Dokumentacja wzorca: przykładowa pętla dla `claude -p` i `codex exec`,
   hook SessionStart → `worktrail instructions overview`, hook PreCompact →
   checkpoint do `## Log`. Jako temat `autonomous-loop` w `instructions`
   (TL-74), nie osobny plik.
6. `scripts/tests/next-claim.test.mjs`: kolejność wyboru na fixture z remisami;
   task zablokowany niewybieralny, dopóki bloker nie jest archiwalny; dwa
   `--claim` pod rząd nie dają tego samego taska; przeterminowany `in_progress`
   wraca z wpisem; pusta kolejka to nie błąd. Kontrola pozytywna: fixture z
   NIEDOMYŚLNYMI statusami w configu.

## Acceptance criteria

- [ ] `next` zwraca dokładnie jeden task wg jednej, udokumentowanej polityki, albo jawną pustą kolejkę.
- [ ] Wzięcie jest atomowe w obrębie drzewa; granica gwarancji dla wielu worktree jest zapisana w dokumentacji, nie przemilczana.
- [ ] Porzucony task wraca do puli po skonfigurowanym oknie, z wpisem w historii i ostrzeżeniem na stdout — nigdy po cichu.
- [ ] Wybór respektuje `blocked_by` przez statusy archiwalne z configu, nie literały.
- [ ] Wzorzec pętli (Claude i Codex, z hookami) jest tematem w `instructions`.
- [ ] Testy pokrywają remisy, blokady, podwójny claim, staleness i pustą kolejkę, na niedomyślnym configu.

## Log

2026-09-01 pending — agent:claude — założony z analizy trybu autonomicznego: kompaktacja u obu vendorów jest stratna, więc architektura to świeża sesja na task; plik taska jest pakietem rehydracji, brakowało wyboru, atomowego wzięcia i odzyskiwania porzuconych.
