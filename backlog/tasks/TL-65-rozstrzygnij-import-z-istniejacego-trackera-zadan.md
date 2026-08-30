---
id: TL-65
title: "Rozstrzygnij import z istniejącego trackera zadań"
type: task
labels: [post-launch]
board: main
epic: "Onboarding"
priority: P3
status: done
owner: founder
estimate: 4h
confidence: low
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: [TL-67]
related_docs:
  - docs/worktrail-global-tool.md
  - docs/worktrail-state-and-sync.md
verification:
  - manual: "Decyzja zapisana: import wchodzi w takim zakresie / nie wchodzi, z powodem. Jeśli wchodzi — powstał task na wykonanie z konkretnym źródłem i konkretnym zakresem pól."
---

## Cel

Rozstrzygnąć — a nie zbudować — czy narzędzie ma umieć przyjąć zadania z
istniejącego trackera, i w jakim zakresie. To jest decyzja o kierunku produktu,
która blokuje sensowne zaplanowanie czegokolwiek w tym obszarze.

## Kontekst

Cała dotychczasowa praca nad onboardingiem obniża tarcie **zakładania nowego
backlogu**. Nie odpowiada natomiast na sytuację, która decyduje o wejściu
narzędzia do firmy: zespół ma dwieście zadań w GitHub Issues albo w Jirze i
pytanie brzmi „jak je tu przenieść", a nie „jak zacząć od zera".

Bez odpowiedzi narzędzie nadaje się do nowego projektu i do jednej osoby. Z
odpowiedzią — również do zespołu, który już gdzieś jest. To jest różnica między
„fajne, wrócę do tego" a wdrożeniem.

**Dlaczego to jest rozstrzygnięcie, a nie task wykonawczy.** Import wygląda na
prostą transformację, a niesie decyzje, których nie da się cofnąć po pierwszym
obcym użytkowniku:

- **Import jednorazowy czy synchronizacja.** Jednorazowy jest tani i uczciwy.
  Synchronizacja oznacza drugie źródło prawdy, a `docs/worktrail-state-and-sync.md`
  jest w całości o tym, dlaczego to jest kosztowne. Prawo 1 mówi, że stan
  rozwiedziony z gałęzią jest wadą, dla której odrzucono zewnętrzne trackery —
  synchronizacja wprowadziłaby go z powrotem tylnymi drzwiami.
- **Co zrobić z polami, których tam nie ma.** `verification` jest tu warunkiem
  zamknięcia taska, a żaden tracker go nie ma. Import bez tego pola wyprodukuje
  dwieście tasków, których z definicji nie da się domknąć — czyli nauczy, że to
  pole jest opcjonalne, i rozbroi jedyną linię obrony przed „zrobione", które nie
  jest zrobione.
- **Co zrobić z polami, których TU nie ma.** Komentarze, załączniki, historia
  statusów, powiązania. Milczące zgubienie ich jest utratą danych; przeniesienie
  wszystkiego zamienia task w zrzut cudzego formatu.
- **Numeracja i tożsamość.** Prefiks jest konfiguracją, numery mają być unikalne
  w obrębie projektu, a importowane zadania mają własne identyfikatory. Czy
  `GH-412` staje się `ACME-412`, czy dostaje nowy numer i odsyłacz do źródła?
- **Zakres słownika.** Etykiety i statusy z tamtego systemu nie muszą mieć
  odpowiedników. Mapowanie jest konfiguracją projektu, nie kodem — czyli kolejny
  plik do zaprojektowania.

**Tania odpowiedź, którą warto rozważyć na starcie:** nie budować importera, tylko
udokumentować, że taski są zwykłymi plikami markdown z frontmatterem, i pokazać
dwudziestolinijkowy skrypt, który generuje je z `gh issue list --json`. To
przenosi koszt utrzymania na użytkownika i nie zobowiązuje do niczego, a
jednocześnie odpowiada „da się" zamiast „nie". Kompozycja zamiast API wtyczek
(Prawo 4) mówi dokładnie to samo.

Zapisane jako task, bo pytanie wróci — i lepiej, żeby wróciło z zapisaną
odpowiedzią niż od nowa.

## Pre-flight reading

1. `docs/worktrail-state-and-sync.md` §6 — granica trybów; import a synchronizacja.
2. `docs/worktrail-global-tool.md` §3 — Prawo 1 i Prawo 4.
3. `scripts/task-fields.mjs` — jakie pola w ogóle istnieją i jak są normalizowane.
4. `scripts/new-task.mjs` — jedyna droga zapisu taska; importer musiałby nią iść albo mieć powód, żeby nie iść.

## Kroki

1. Wypisz odbiorcę: kto konkretnie ma dwieście zadań i chce je tu przenieść. Jeśli nie umiesz go nazwać, odpowiedź brzmi „nie teraz" i to jest wynik tego taska.
2. Rozstrzygnij trzy pytania: jednorazowo czy synchronicznie; co z `verification`; co z polami bez odpowiednika.
3. Zdecyduj między trzema wariantami: (a) nic, (b) dokumentacja plus przykładowy skrypt, (c) komenda `worktrail import`.
4. Zapisz decyzję i powód w `## Log` — również wtedy, gdy brzmi „nie robimy". Powód jest tu wartościowszy niż decyzja, bo to on przetrwa do następnego razu.
5. Jeśli wariant (b) albo (c): załóż osobny task wykonawczy z jednym konkretnym źródłem. Nie „importer" w liczbie mnogiej.

## Acceptance criteria

- [ ] Odbiorca nazwany albo jawnie uznany za nieznanego.
- [ ] Trzy pytania z kroku 2 mają zapisane odpowiedzi.
- [ ] Wybrany wariant z uzasadnieniem w `## Log`.
- [ ] Jeśli wariant zakłada pracę — powstał task wykonawczy z jednym źródłem.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 created — agent:claude — z audytu onboardingu; pytanie o adopcję zespołową, nie o defekt
- 2026-08-31 done — founder — DECYZJA: importer ma powstać, zrobiony solidnie, nie teraz. Odrzucony wariant (b) „dokumentacja plus przykładowy skrypt", który rekomendował agent — argumentem za nim była taniość utrzymania, argumentem przeciw to, że zostawia najtrudniejszą część (mapowanie, idempotencja, `verification`) każdemu użytkownikowi z osobna, za każdym razem od nowa.
- 2026-08-31 done — agent:claude — trzy pytania z kroku 2 rozstrzygnięte i zapisane w [TL-67](TL-67-import-z-github-issues-jednorazowy-ze-stdin-z-dry-run.md): (1) JEDNORAZOWO — synchronizacja to drugie źródło prawdy, czyli Prawo 1; (2) `verification` zostaje PUSTE, a liczba takich tasków jest WYNIKIEM importu — atrapa rozbroiłaby jedyną linię obrony przed „zrobione", które nie jest zrobione; (3) pola bez odpowiednika NIE jadą — import przenosi task, nie archiwum, a dostęp do komentarzy zachowuje link do źródła.
- 2026-08-31 done — agent:claude — odbiorca i źródło: GitHub Issues, jedno i konkretne. `gh issue list --json` daje czysty JSON bez konfiguracji uwierzytelniania po naszej stronie. Jira jest osobnym taskiem, gdy pojawi się zespół, który jej używa — adapter do dwóch systemów naraz zacząłby od abstrakcji, której nikt jeszcze nie potrzebuje. Rozstrzygnięcie architektoniczne, które trzyma resztę: NARZĘDZIE NIE CHODZI DO SIECI, JSON wchodzi przez stdin. Zero zależności zostaje zerem, cudze tokeny zostają w `gh`, a test dostaje fixture zamiast atrapy serwera.
