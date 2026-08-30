---
id: TL-62
title: "worktrail doctor — jedna odpowiedź czy backlog jest ustawiony"
type: task
labels: [pre-launch]
board: main
epic: "Onboarding"
priority: P2
status: done
owner: claude
estimate: 1d
confidence: medium
created: 2026-08-31
updated: 2026-08-31
blocked_by: [TL-60]
blocks: []
related_docs:
  - .claude/skills/worktrail-cli/SKILL.md
  - .claude/skills/worktrail-cli/references/output-style.md
verification:
  - bash: "node --test scripts/tests/doctor.test.mjs"
  - bash: "d=$(mktemp -d); T=/Users/limack/workspace/tasklog/bin/worktrail.mjs; node $T init --dir \"$d\" >/dev/null && node $T doctor --dir \"$d\" >/dev/null && echo 'świeży backlog przechodzi doctor — OK'"
  - bash: "d=$(mktemp -d); T=/Users/limack/workspace/tasklog/bin/worktrail.mjs; node $T init --dir \"$d\" >/dev/null; printf 'statusess: [a]\\n' >> \"$d/config.yaml\"; node $T doctor --dir \"$d\" >/dev/null 2>&1 && { echo 'doctor nie widzi zepsutej konfiguracji'; exit 1; }; echo 'doctor łapie literówkę — OK'"
  - bash: "node scripts/cli.mjs doctor --json | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{JSON.parse(s);console.log('doctor --json parsuje — OK')})\""
---

## Cel

Dać jedną komendę odpowiadającą na pytanie, którego dziś nie da się zadać:
**„czy mój backlog jest dobrze ustawiony i co dalej".**

## Kontekst

Po `worktrail init` użytkownik dostosowuje `config.yaml` do swojego projektu i nie
ma jak sprawdzić, czy mu się udało. Musi wywołać losową komendę i liczyć na to,
że akurat ta zauważy problem — a zmierzone 2026-08-31 zachowanie jest niespójne:
literówka w kluczu przechodzi przez `build` i `check`, ale wywraca `stats`.

Rozproszenie diagnostyki jest w tym projekcie naturalne (guardy mają różny zakres
z rozmysłem), ale brakuje **jednego wejścia, które je zbiera i mówi ludzkim
językiem**. To jest standard w narzędziach deweloperskich z dobrego powodu:
komenda diagnostyczna jest tania w utrzymaniu, gdy sprawdzenia i tak istnieją, a
zamienia „nie wiem, czy to działa" w listę zdań.

Ten projekt ma nietypowo dobrą pozycję startową — sprawdzenia już są. `doctor`
ma je **wołać, a nie powtarzać**; drugi zestaw reguł rozjechałby się z pierwszym.

Co ma sprawdzać, i skąd to wiadomo — każda pozycja odpowiada realnej, zmierzonej
pułapce:

| Sprawdzenie | Skąd |
|---|---|
| `config.yaml` parsuje się, klucze są znane | [TL-60](TL-60-literowka-w-config-yaml-przelatuje-przez-build-i-check.md) |
| słowniki są spójne (`archived_statuses` ⊆ `statuses` itd.) | działa dziś, zebrać |
| wartości w taskach mieszczą się w słownikach | [TL-56](TL-56-slownik-types-w-config-yaml-rozjechal-sie-z-drzewem.md) |
| prefiks z konfiguracji zgadza się z drzewem | [TL-61](TL-61-rozjazd-prefiksu-nie-zatrzymuje-worktrail-new.md) |
| widoki są ignorowane przez gita | [TL-59](TL-59-ko-lokacja-widoki-nie-sa-ignorowane-w-istniejacym-repo.md) |
| `history/*.jsonl` ma `merge=union` | TL-59 |
| guardy backlogu (`check`) | jest |
| hooki zainstalowane albo nie | [TL-46](TL-46-worktrail-init-hooks-bramka-ktora-sama-sie-instaluje-u.md) |
| ile tasków, w jakich statusach, co dalej | jest w `stats` |

**Granica, której nie wolno przekroczyć: `doctor` niczego nie naprawia.** Komenda,
która „przy okazji" poprawia cudzą konfigurację, przestaje być diagnozą i staje
się zmianą bez decyzji. Może za to podać dokładną komendę naprawczą przy każdej
pozycji — to jest różnica między `doctor` a `fix`, i ta druga jest osobną decyzją,
nie krokiem tutaj.

Kod wyjścia niesie znaczenie: 0 = wszystko w porządku, 1 = jest błąd. Ostrzeżenia
nie oblewają — inaczej `doctor` w CI stanie się szumem, który wszyscy wyłączą.

## Pre-flight reading

1. `scripts/cli.mjs` — `COMMANDS`, obsługa `check` jako komendy złożonej (kod wyjścia = najgorszy z guardów); `doctor` ma podobny kształt.
2. `scripts/config.mjs` — `validateConfig()`; źródło większości sprawdzeń.
3. `scripts/stats-report.mjs` — rozdział „arytmetyka osobno, formatowanie osobno"; `doctor` ma go zachować.
4. `.claude/skills/worktrail-cli/references/output-style.md` §5–§6 — układ i anatomia komunikatu.

## Kroki

1. `scripts/doctor.mjs` + wpis w `COMMANDS`. Sprawdzenia są WOŁANE z istniejących modułów, nie przepisane.
2. Każda pozycja: symbol (`✓` / `!` / `✗`), zdanie po ludzku, a przy problemie — komenda naprawcza do wklejenia.
3. Sekcja końcowa „co dalej", zależna od stanu: pusty backlog → `worktrail new`; są taski, brak widoków → `worktrail build`; wszystko gotowe → `worktrail` (viewer).
4. `--json` dla CI: lista sprawdzeń ze statusem i identyfikatorem, żeby dało się na nie reagować programowo.
5. Kod wyjścia: 0 gdy brak błędów (ostrzeżenia dozwolone), 1 gdy jest błąd.
6. `doctor` działa też BEZ backlogu — wtedy jego odpowiedzią jest „nie ma tu backlogu, załóż: `worktrail init --dir …`". To jest naturalne miejsce na tę podpowiedź.
7. Test `scripts/tests/doctor.test.mjs`: świeży `init` przechodzi; każde zepsucie z tabeli powyżej jest wykrywane (kontrola pozytywna dla każdego wiersza — bez tego test byłby zielony na zdrowym drzewie i nic by nie dowodził).

## Acceptance criteria

- [ ] `worktrail doctor` istnieje i jest w `COMMANDS` oraz w pomocy.
- [ ] Sprawdza każdą pozycję z tabeli, wołając istniejące moduły.
- [ ] Każdy problem ma komendę naprawczą w treści.
- [ ] Niczego nie naprawia sam.
- [ ] Kod wyjścia: 0 bez błędów, 1 z błędem; ostrzeżenia nie oblewają.
- [ ] `--json` parsuje się i niesie identyfikatory sprawdzeń.
- [ ] Działa bez backlogu i kieruje do `init`.
- [ ] Test ma kontrolę pozytywną dla każdego sprawdzenia.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 created — agent:claude — z audytu onboardingu; zbiera pułapki z TL-56, TL-59, TL-60, TL-61
- 2026-08-31 in_progress — agent:claude — start implementacji
- 2026-08-31 done — agent:claude — `scripts/doctor.mjs` + wpis w `COMMANDS`. Sprawdzenia WOŁANE, nie przepisane: konfiguracja przez `loadConfig`, prefiks przez `detectPrefixMismatch`, guardy przez spawn `cli.mjs check`, liczby przez `summarize`. Wiersze: config, vocabulary, prefix, git-ignore, git-tracked, git-merge, guards, volume. Kody wyjścia 0/1, ostrzeżenia nie oblewają. `--json` z identyfikatorami wierszy. Bez backlogu odpowiada `init --dir`, a nie wyjątkiem. Test `doctor.test.mjs`, 14 asercji, kontrola pozytywna dla KAŻDEGO wiersza; moc sprawdzona wyłączeniem dwóch wierszy — oblewają dokładnie ich dwa testy. 302/302.
- 2026-08-31 done — agent:claude — dwa wydzielenia, żeby „sprawdzenia są wołane" było prawdą, a nie deklaracją: `git-rules.mjs` (same ODCZYTY o gicie; `doctor` nie ma z czego przypadkiem dopisać, bo pisanie zostało w `init-backlog.mjs`) i `task-io.mjs` (`readTaskMetas` wspólne dla `stats` i `doctor` — dwa filtry dałyby „65 tasków" i „64 taski", obie prawdziwe). `task-io.mjs` jest osobnym plikiem, bo oba sąsiedztwa są zamknięte świadomie: `stats.mjs` jest jawnie bez dysku, a ŹRÓDŁO `task-fields.mjs` jest wstrzykiwane do strony viewera, więc `import "node:fs"` wywaliłby przeglądarkę.
- 2026-08-31 done — agent:claude — wiersz „słowniki a drzewo" realizuje `auditVocabulary()` w `task-fields.mjs` (board pominięty świadomie — ma własny guard i własny komunikat, a dwa głosy o tym samym pliku czyta się jak dwa problemy). Funkcja jest gotowa do wpięcia w `check` przez TL-56; ten task jej NIE wpina, bo kierunek naprawy (`types` w config kontra drzewo) jest decyzją właściciela. Skutek uboczny, zamierzony: `worktrail doctor` w TYM repozytorium świeci na czerwono i wskazuje dokładnie TL-56.
- 2026-08-31 done — agent:claude — wiersz „hooki zainstalowane albo nie" ŚWIADOMIE POMINIĘTY: instalatora hooków jeszcze nie ma (TL-46), a zgadywanie formatu instalacji dałoby wiersz, który myli się w obie strony. Do dołożenia razem z TL-46.
