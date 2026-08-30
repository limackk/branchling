---
id: TL-67
title: "Import z GitHub Issues — jednorazowy, ze stdin, z dry-run"
type: task
labels: [post-launch]
board: main
epic: "Onboarding"
priority: P2
status: pending
owner: unassigned
estimate: 1w
confidence: medium
created: 2026-08-31
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - docs/worktrail-state-and-sync.md
  - docs/worktrail-global-tool.md
  - .claude/skills/worktrail-cli/SKILL.md
verification:
  - bash: "node --test scripts/tests/import-github.test.mjs"
  - bash: "cat scripts/tests/fixtures/gh-issues.json | node scripts/cli.mjs import --from github --dir $(mktemp -d) --dry-run | grep -q 'nic nie zapisano' && echo 'dry-run nie pisze — OK'"
  - bash: "d=$(mktemp -d); node scripts/cli.mjs init --dir \"$d\" --no-example >/dev/null; cat scripts/tests/fixtures/gh-issues.json | node scripts/cli.mjs import --from github --dir \"$d\" >/dev/null; cat scripts/tests/fixtures/gh-issues.json | node scripts/cli.mjs import --from github --dir \"$d\" >/dev/null; test $(ls \"$d/tasks\" | wc -l | tr -d ' ') -eq 3 && echo 'drugi import nie duplikuje — OK'"
  - bash: "node scripts/cli.mjs check --dir <katalog-po-imporcie>"
---

## Cel

Dać zespołowi, który ma zadania w GitHub Issues, **jednorazową drogę do
przeniesienia ich tutaj** — bez zamieniania narzędzia w klienta cudzego API i
bez rozbrajania reguł, na których stoi.

## Kontekst

Decyzja właściciela 2026-08-31 ([TL-65](TL-65-rozstrzygnij-import-z-istniejacego-trackera-zadan.md)):
importer ma powstać, ale zrobiony solidnie i nie teraz. Ten task jest zapisem
tego, co przy „solidnie" trzeba rozstrzygnąć — żeby ktoś, kto weźmie go za pół
roku, nie wyprowadzał tych samych wniosków od nowa.

**Odbiorca.** Zespół, który już gdzieś jest. Cała dotychczasowa praca nad
onboardingiem obniża tarcie ZAKŁADANIA nowego backlogu; to jest jedyna pozycja,
która odpowiada na „mam dwieście zadań, jak je tu przeniosę". To jest różnica
między „fajne, wrócę do tego" a wdrożeniem.

**Dlaczego GitHub Issues jako pierwsze i jedyne źródło tego taska.** `gh issue
list --json` daje czysty JSON bez konfiguracji uwierzytelniania po naszej
stronie, a to tracker, w którym siedzą deweloperzy mający polubić narzędzie
pierwsi. Jira wymaga tokenów, adresu instancji i mapowania własnych typów — to
osobny task, gdy pojawi się zespół, który jej używa. **Nie rób „importera" w
liczbie mnogiej**: adapter do dwóch systemów naraz zacznie od abstrakcji, której
nikt jeszcze nie potrzebuje.

### Sześć rozstrzygnięć, które ten task ma wykonać

**1. Narzędzie NIE CHODZI DO SIECI. Nigdy.** Import czyta JSON ze STDIN:

```bash
gh issue list --state all --limit 500 --json number,title,body,state,labels,assignees,url \
  | worktrail import --from github --dry-run
```

To nie jest wygoda, tylko trzy rzeczy naraz: zero zależności zostaje zerem,
uwierzytelnianie zostaje w `gh` (my nie dotykamy cudzych tokenów), a test może
podać fixture zamiast udawać sieć. Importer, który sam woła API, jest
nietestowalny bez atrapy serwera i psuje się przy każdej zmianie cudzego API.

**2. JEDNORAZOWO, nie synchronicznie.** Synchronizacja to drugie źródło prawdy,
czyli stan rozwiedziony z gałęzią — wada, dla której w ogóle odrzucono
zewnętrzne trackery (Prawo 1). Import kopiuje i zapomina. Jeśli kiedykolwiek
pojawi się potrzeba synchronizacji, to jest inny dokument i inna decyzja:
[`docs/worktrail-state-and-sync.md`](../../docs/worktrail-state-and-sync.md) §6.

**3. `verification` zostaje PUSTE — i import mówi o tym głośno.** Żaden tracker
tego pola nie ma. Kuszące jest wstawienie atrapy, żeby taski „wyglądały
kompletnie" — i to jest dokładnie ta decyzja, która rozbraja jedyną linię obrony
przed „zrobione", które nie jest zrobione. Import ma na końcu powiedzieć wprost:

```
✓ zaimportowano 214 tasków
! 214 z nich nie ma `verification` — nie da się ich domknąć, dopóki go nie dopiszesz
  → worktrail query --status pending --json | …
```

Liczba niekompletnych tasków jest wynikiem importu, nie jego skutkiem ubocznym.

**4. Pola bez odpowiednika: import przenosi TASK, nie archiwum.** Treść issue
idzie do ciała pliku. Komentarze, załączniki i historia statusów NIE — to jest
rozmowa wokół zadania, a nie zadanie; przeniesienie ich zamienia task w zrzut
cudzego formatu. Dostęp do nich zachowuje link do źródła, więc nic nie ginie
bezpowrotnie.

**5. Tożsamość i powtórny import.** Numer jest LOKALNY i bierze go ta sama droga
co `worktrail new` — `createTask()` z `new-task.mjs` (skan wszystkich gałęzi,
zapis wyłączny `wx`). `GH-412` nie staje się `ACME-412`: numery są unikalne w
obrębie projektu, a udawanie, że cudzy numer jest nasz, kłamie przy pierwszej
kolizji.

Zostaje pytanie, gdzie zapisać wskaźnik na źródło, bo od niego zależy
idempotencja (drugi import tego samego zbioru NIE MOŻE duplikować):

| Wariant | Za | Przeciw |
|---|---|---|
| link w `## Notes` | zero zmian schematu | wyszukiwanie po treści zamiast po polu |
| nowe pole `source:` | pole pierwszej klasy, widoczne w viewerze i w `query` | zmiana `FIELD_SHAPES`, viewera i historii — schemat jest tani DZIŚ, nieodwracalny po pierwszym obcym użytkowniku |

Rozstrzygnij to świadomie i zapisz powód w `## Log`. Jeśli wariant z polem —
zrób go osobnym taskiem PRZED tym, bo zmiana schematu nie jest szczegółem
implementacyjnym importu.

**6. Mapowanie słowników jest ARGUMENTEM IMPORTU, nie kluczem w `config.yaml`.**
Etykiety i statusy GitHuba nie muszą mieć odpowiedników. Kuszące jest dopisanie
`import_label_map:` do konfiguracji — i to złamałoby Prawo 3: warstwy są
ROZŁĄCZNE, a `config.yaml` zna słownictwo PROJEKTU, nie instrukcje jednorazowej
operacji. Mapowanie jedzie flagą albo plikiem podanym flagą, żyje tyle, co
import, i nie zostaje w repozytorium jako martwy klucz.

Wartość spoza słownika ma OBLAĆ przed zapisem, nie wjechać po cichu — inaczej
import wprowadzi dokładnie ten rozjazd konfiguracji z drzewem, który
[TL-56](TL-56-slownik-types-w-config-yaml-rozjechal-sie-z-drzewem.md) ma
domknąć.

## Pre-flight reading

1. `docs/worktrail-state-and-sync.md` §6 — granica trybów; dlaczego import to nie synchronizacja.
2. `docs/worktrail-global-tool.md` §3 — Prawo 1, 3 i 4; wszystkie trzy są tu naruszalne.
3. `scripts/new-task.mjs` — `createTask()`; import MUSI iść tą drogą, nie własną.
4. `scripts/migrate-prefix.mjs` — wzorzec `--dry-run` dla komendy, która zmienia wiele plików naraz.
5. `scripts/task-fields.mjs` — `FIELD_SHAPES`, jeśli wariant z polem `source:`.
6. `.claude/skills/worktrail-cli/SKILL.md` — kontrakt komendy: walidacja flag, `--dir`, kody wyjścia.

## Kroki

1. `scripts/import-github.mjs` + wpis w `COMMANDS`. Wejście: JSON na stdin. Bez sieci.
2. `--dry-run` OBOWIĄZKOWY w pierwszej wersji i domyślny w dokumentacji: komenda zapisująca setki plików ma najpierw pokazać, co zrobi. Wypisuje plan (ile tasków, jakie mapowania, ile bez `verification`) i kończy słowami „nic nie zapisano".
3. Mapowanie stanu: `open` → pierwszy status z konfiguracji, `closed` → pierwszy z `archived_statuses`. Bez zaszytych `pending`/`done` — to są wartości projektu.
4. Etykiety: mapowanie z flagi; nieznana etykieta oblewa, gdy `labels_closed`, a poza tym wchodzi tylko jeśli jest w słowniku.
5. Zapis przez `createTask()`, z `body` złożonym z treści issue i sekcji `## Notes` z linkiem do źródła.
6. Idempotencja: drugi przebieg na tym samym wejściu nie zakłada ani jednego pliku. Rozstrzygnięcie z punktu 5 kontekstu decyduje, po czym to rozpoznać.
7. Raport końcowy: ile zaimportowano, ile pominięto jako już istniejące, ile bez `verification`.
8. Fixture `scripts/tests/fixtures/gh-issues.json` — trzy issue: otwarte, zamknięte, z etykietą spoza słownika. Test bez sieci.
9. README: sekcja „przeniesienie zespołu", z jedną komendą i uczciwym zdaniem o tym, czego import NIE przenosi.

## Acceptance criteria

- [ ] `worktrail import --from github` czyta JSON ze stdin i nie wykonuje ani jednego żądania sieciowego.
- [ ] `--dry-run` niczego nie zapisuje i mówi to wprost.
- [ ] Statusy i etykiety mapowane z KONFIGURACJI i flag, nigdy z literałów w kodzie.
- [ ] Wartość spoza zamkniętego słownika oblewa PRZED zapisem czegokolwiek.
- [ ] `verification` zostaje puste, a liczba takich tasków jest w raporcie.
- [ ] Numery lokalne, z `createTask()`; żadnego przepisywania numerów GitHuba.
- [ ] Powtórny import tego samego wejścia nie duplikuje ani jednego taska.
- [ ] `worktrail check` przechodzi na katalogu po imporcie.
- [ ] Test działa bez sieci, na fixture.
- [ ] Rozstrzygnięcie o wskaźniku na źródło zapisane w `## Log` z powodem.

## Notes

Świadomie POZA zakresem, żeby nie wróciło jako „przy okazji": synchronizacja w
obie strony, import z Jiry, import komentarzy i załączników, mapowanie
użytkowników GitHuba na `owners` (przestrzenie nazw aktorów to osobna sprawa,
patrz `docs/backlog-field-editing-history.md`).

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 created — agent:claude — z decyzji w TL-65: importer ma powstać, solidnie, nie teraz. Task niesie sześć rozstrzygnięć, żeby „solidnie" nie znaczyło „wymyśl to jeszcze raz".
2026-09-01 pending — agent:claude — podniesiony P3→P2 z analizy konkurencyjności — import z Issues to ścieżka spróbowania bez kosztu migracji; nikt nie porzuca dotychczasowego trackera pierwszego dnia.
