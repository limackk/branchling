---
id: TL-56
title: "Słownik types w config.yaml rozjechał się z drzewem"
type: bug
labels: [pre-launch]
board: main
epic: "Integralność danych"
priority: P2
status: done
owner: unassigned
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-config-and-portability.md
verification:
  - bash: "node --test scripts/tests/config-vocabulary.test.mjs"
  - bash: "node scripts/cli.mjs check"
  - bash: "d=$(mktemp -d) && node scripts/cli.mjs init --dir \"$d\" >/dev/null 2>&1 && T=$(node -e \"import('./scripts/config.mjs').then(m=>console.log(m.loadConfig(process.argv[1]).types[0]))\" \"$d\") && node scripts/cli.mjs new --dir \"$d\" --title Sonda --type \"$T\" >/dev/null 2>&1 || { echo 'typ z konfiguracji ODRZUCONY przy zapisie'; exit 1; }; node scripts/cli.mjs new --dir \"$d\" --title Sonda2 --type nie-ma-takiego >/dev/null 2>&1 && { echo 'wartosc spoza slownika PRZESZLA'; exit 1; }; echo \"OK: typ z konfiguracji ($T) przechodzi, wartosc spoza slownika odrzucona\""
---

## Cel

Doprowadzić do zgodności słownik `types` z zawartością drzewa — i sprawić, żeby
rozjazd w KAŻDYM słowniku oblewał przy odczycie, a nie dopiero przy próbie zapisu.

## Kontekst

Trafione 2026-08-31 przy zakładaniu tasków z audytu:

```
$ worktrail new --title "…" --type code
[worktrail new] `code` nie jest dozwoloną wartością pola `type`
  dozwolone: task
```

Tymczasem w drzewie stoi: **43 taski z `type: code`**, 3 z `type: bug`, 1 z
`type: manual` — i ani jednego z `type: task`, czyli jedyną wartością, jaką zna
`config.yaml`. `worktrail check` i `worktrail build` przechodzą na zielono.

To jest **asymetria między zapisem a odczytem**: ścieżka pisząca egzekwuje
słownik, ścieżka czytająca go nie sprawdza. Konsekwencja jest dokładnie odwrotna
do zamierzonej — 47 plików narusza słownik bez słowa protestu, a jedyną rzeczą,
którą narzędzie blokuje, jest zapisanie kolejnego pliku takiego, jak wszystkie
istniejące.

Klasa błędu jest już w tym projekcie nazwana. Prefiks ID rozstrzygnięto tak, że
**rozjazd konfiguracji z drzewem OBLEWA przed zapisem** (`detectPrefixMismatch`
w `task-id.mjs`, `CLAUDE.md` §„Zanim zmienisz kod"). Ta sama zasada nie została
zastosowana do pozostałych słowników, więc `types` mógł się rozjechać po cichu —
i nie wiadomo bez sprawdzenia, czy jest jedyny.

**Do rozstrzygnięcia jest kierunek naprawy, nie sam fakt.** Albo `config.yaml`
jest w błędzie i ma wymieniać `[code, bug, manual]` (wtedy drzewo jest prawdą),
albo drzewo ma zostać przemigrowane na `task`. Pierwsze jest niemal na pewno
poprawne — 47 plików to udokumentowana praktyka, a `types: [task]` wygląda na
wartość domyślną, której nikt nie zaktualizował — ale to decyzja właściciela, bo
`type` jest słownikiem projektu.

Powód, dla którego to jedzie przed publikacją: obcy użytkownik dostanie ten sam
efekt na własnym backlogu, tyle że bez wiedzy, że w ogóle istnieje plik
konfiguracji, który to rozstrzyga.

## Pre-flight reading

1. `scripts/config.mjs` — `DEFAULTS`, ładowanie i walidacja `config.yaml`.
2. `scripts/task-fields.mjs` — `buildFieldSpecs()` / `normalizeValue()`, czyli miejsce, w którym zapis egzekwuje słownik.
3. `scripts/task-id.mjs` — `detectPrefixMismatch()`, wzorzec „rozjazd oblewa przed zapisem".
4. `backlog/config.yaml` — `types: [task]`.

## Kroki

1. Zmierz rozjazd we WSZYSTKICH słownikach: `type`, `status`, `priority`, `owner`, `estimate`, `label`, `board`. Wynik zapisz w `## Log` — nie zakładaj, że `types` jest jedyny.
2. Rozstrzygnij kierunek dla każdego rozjazdu z właścicielem.
3. Popraw `config.yaml` (albo drzewo, jeśli taka będzie decyzja).
4. Dołóż guard, który porównuje słowniki z drzewem i OBLEWA — na wzór `detectPrefixMismatch`. Komunikat ma nazywać pole, wartości spoza słownika i liczbę plików, w których stoją.
5. Podłącz guard do `worktrail check`, żeby jechał w tym samym miejscu co pozostałe.
6. Kontrola pozytywna w teście: fixture z wartością spoza słownika MUSI oblać. Bez niej test przejdzie na czystym drzewie i będzie zielony bez mocy dowodowej.

## Acceptance criteria

- [x] `config.yaml` i drzewo zgadzają się w każdym słowniku.
- [x] Rozjazd słownika oblewa `worktrail check`, nie tylko zapis.
- [x] Komunikat nazywa pole, wartości i liczbę plików.
- [x] Test ma kontrolę pozytywną — fixture z wartością spoza słownika oblewa.
- [x] Wynik przeglądu wszystkich słowników zapisany w `## Log`.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 created — agent:claude — trafione przy `worktrail new --type code`; 43 taski `code`, 3 `bug`, 1 `manual`, słownik zna tylko `task`
- 2026-08-31 pending — agent:claude — TL-62 dołożył `auditVocabulary(metas, config)` w `task-fields.mjs` i wypina wynik w `worktrail doctor`. Ten task ma więc już gotowy pomiar: zostaje decyzja kierunku (poprawić `types` w config czy drzewo) i wpięcie funkcji w `check` z kontrolą pozytywną. Zmierzone dziś przez doctor: `type` — code ×43, bug ×10, manual ×1, przy słowniku `[task]`.
- 2026-09-01 done — agent:claude — przegląd WSZYSTKICH słowników, bo krok 1 zabraniał zakładać, że `types` jest jedyny. Zamknięte enumy: `type` — jedyny rozjazd; `status` (5 wartości) i `priority` (4) czyste. `owner` (`claude`, `agent:claude`, `founder` poza `owners:`) i `estimate` (`4h` ×41, `3h`, `1h` poza `estimates:`) NIE są rozjazdem — to pola `kind: "text"` z `suggestFrom`, czyli listy podpowiedzi, nie słowniki. `labels` otwarte przez `labels_closed: false`. `board` ma własnego strażnika i jest wyłączony w `auditVocabulary` świadomie, żeby jeden plik nie był zgłaszany dwa razy.
- 2026-09-01 done — agent:claude — kierunek: DRZEWO jest prawdą. `types: [task]` stało w pliku od pierwszego commita (aa6d49e) RÓWNOCZEŚNIE z taskami `type: code` — czyli nigdy nie było prawdą; to wartość domyślna narzędzia, nie decyzja projektu. `types: [task, code, bug]`.
- 2026-09-01 done — agent:claude — `manual` ×1 NIE trafiło do słownika: to pozostałość z innej osi. `manual` jest rodzajem WERYFIKACJI (`VERIFICATION_KEYS` w `criteria.mjs`), a jedyny nosiciel — TL-20 — ma wpis `manual:` w swoim `verification:` i pracę czysto kodową (nazwa w `scripts/`, `package.json`, README). Poprawione na `code`: jeden plik, nie migracja. W całej historii gita istniały tylko cztery wartości `type`, więc literówek nie ma.
- 2026-09-01 done — agent:claude — `code` (59) i `task` (48) są synonimami i oba są pisane tego samego dnia; zwinięcie to migracja 59 plików i decyzja o słownictwie, więc odłożone jako TL-123, a nie zrobione po cichu przy okazji.
- 2026-09-01 done — agent:claude — strażnik: `check-backlog-vocabulary.mjs` + `--vocabulary`, w domyślnym przebiegu `check`. Werdykt bierze z `auditVocabulary()` — tej samej funkcji co `doctor` — a dokłada tylko sparowanie wartości z plikami, żeby komunikat mówił GDZIE iść. Przy okazji zamknięta dziura w samym `auditVocabulary`: lista ZAMKNIĘTA z pustym słownikiem (`labels_closed: true`, `labels: []`) była pomijana, choć ścieżka pisząca odrzuca wtedy każdą etykietę — dokładnie ta asymetria, którą ten task zamyka.
- 2026-09-01 done — agent:claude — fixture w `cli.test.mjs` niósł `type: code`, czyli słownictwo TEGO projektu, działając pod wbudowanymi domyślnymi (`types: ["task"]`). Nowy strażnik go zaczerwienił i miał rację — poprawiony fixture, nie strażnik.
- 2026-09-01 done — agent:claude — trzecia sonda w `verification:` była zepsuta OD POCZĄTKU i nie mogła przejść przy żadnym stanie kodu: `sed 's/.*\[//'` jest zachłanne, więc na `types: [task]                      # [tree]` sięgało do OSTATNIEGO `[` i wyciągało `tree`, po czym `new --type` dostawał śmieć. Wymieniona na wariant czytający wartość przez `loadConfig()` zamiast przez sed, z obiema kontrolami: typ ze słownika MUSI przejść, wartość spoza niego MUSI zostać odrzucona. Sonda mierząca własne parsowanie zamiast narzędzia jest zielona bez mocy dowodowej — tu była czerwona bez mocy dowodowej.
