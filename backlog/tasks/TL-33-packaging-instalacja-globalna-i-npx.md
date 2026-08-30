---
id: TL-33
title: "Packaging — instalacja globalna i npx"
type: code
labels: [post-launch]
board: main
epic: "Backlog — publikacja open source"
priority: P2
status: done
owner: claude
estimate: 4h
confidence: medium
created: 2026-08-30
updated: 2026-08-30
blocked_by: []
blocks: [TL-34]
related_docs:
  - docs/worktrail-global-tool.md
verification:
  - bash: "node --test scripts/tests/packaging.test.mjs"
  - bash: "cd /tmp && npx --yes /Users/limack/workspace/tasklog -- --help >/dev/null && echo 'npx z pustego katalogu — OK'"
---

## Cel

Zrobić z modułu **instalowalny pakiet**: `package.json` + `bin/`, tak żeby `npx worktrail` i `npm i -g` działały. To jedyny twardy brak na drodze do narzędzia globalnego — i do publikacji w ogóle.

## Kontekst

[worktrail-state-and-sync.md §1](../../docs/worktrail-state-and-sync.md) obiecuje tryb „`git clone && npx worktrail`, bez konta i bez serwera". **Ta obietnica jest dziś nieprawdziwa:** w `backlog/` nie ma ani `package.json`, ani `bin/` (sprawdzone 2026-08-30). Jedynym wejściem jest `node backlog/scripts/cli.mjs`, czyli ścieżka względna do cudzego drzewa.

Dobra wiadomość: warstwa pod spodem jest gotowa. `paths.mjs` (TL-18) rozwiązuje katalog danych przez `--dir` → `BACKLOG_DIR` → wykrywanie w górę od cwd → ko-lokację, a wykrywanie wymaga znacznika, nie samego `tasks/`. Ten task **nie zmienia sposobu znajdowania danych** — pakuje to, co już działa.

Jedna pułapka wprost z tego układu: dziś czwarte źródło („ko-lokacja: katalog nad plikiem `.mjs`") trafia w backlog the origin project, bo kod i dane leżą razem. **Po instalacji globalnej kod leży w `node_modules`, a dane nie** — ko-lokacja przestaje mieć sens i musi umieć się nie odezwać, zamiast wskazać katalog wewnątrz pakietu. To jest różnica między „nie znalazłem backlogu" a „zapisałem taski do `node_modules`".

## Pre-flight reading

1. `docs/architecture/worktrail-global-tool.md` — §2 (co już jest), §3 Prawo 2 i 4, §5 (skąd bierze się nazwa katalogu).
2. `backlog/scripts/paths.mjs` — cztery źródła katalogu danych; szczególnie `colocated`.
3. `backlog/scripts/cli.mjs` — `COMMANDS`, obsługa `--help`, kody wyjścia.
4. `backlog/scripts/init-backlog.mjs` — jedyna komenda pisząca do cudzego katalogu; po instalacji globalnej stanie się pierwszym, co uruchomi obcy użytkownik.

## Kroki

1. `backlog/package.json` — `name`, `version`, `type: module`, `bin: { worktrail: "bin/worktrail.mjs" }`, `files` (whitelist, żeby do pakietu nie wjechały taski the origin project ani `history/`), `engines.node`.
2. `backlog/bin/worktrail.mjs` — cienki shim: shebang, przekazanie `argv` do `cli.mjs`, propagacja kodu wyjścia. Zero logiki własnej.
3. **Wyłączyć ko-lokację, gdy kod działa z `node_modules`** — wykryte po ścieżce pakietu, nie po zmiennej. Brak backlogu ma dawać czytelny błąd z podpowiedzią `worktrail init --dir <ścieżka>`, nigdy zapis do katalogu pakietu.
4. `files` / `.npmignore` — sprawdzić `npm pack --dry-run`, że w tarballu NIE ma `tasks/`, `history/`, `archive/`, `boards/`, `config.yaml`, `boards.yaml` the origin project ani `viewer.html`. Wchodzi tylko `scripts/`, `bin/`, `_template.md`, README, LICENCJA.
5. **Licencja** — pakiet bez `LICENSE` jest nie do użycia przez kogokolwiek w firmie. Wybór należy do foundera; task ma go wymusić, nie zgadnąć.
6. `--version` czytane z `package.json`, jedno źródło numeru.
7. **Nazwa produktu z jednej stałej.** Dziś nazwa produktu (wtedy `tasklog`) jest wpisana na sztywno **47 razy w 9 plikach** `scripts/*.mjs` (`cli.mjs` 24 razy, głównie w tekstach pomocy), plus `package.json`, `README.md` i `CLAUDE.md`. Packaging dokłada do tego `bin/`, a [TL-34](TL-34-katalog-domowy-preferencje-i-rejestr-projektow.md) — nazwę katalogu domowego. Wprowadzić `PRODUCT_NAME` czytane z `package.json` i użyć go w tekstach; literał zostaje wyłącznie tam, gdzie musi (klucz `bin`, nazwa pakietu). **Powód jest praktyczny: dopóki pakiet nie jest opublikowany, zmiana nazwy ma kosztować jedną edycję, a nie grep po całym drzewie.**
8. Test `packaging.test.mjs`: zawartość tarballa (krok 4), działanie `bin` z katalogu bez backlogu (krok 3), zgodność `--version` z `package.json`.

## Acceptance criteria

- [x] `npx <ścieżka-pakietu> -- --help` działa z katalogu **niezwiązanego** z żadnym backlogiem.
- [x] Z katalogu bez backlogu komenda wymagająca danych kończy się czytelnym błędem i podpowiedzią `init --dir`, a **nie** zapisem do katalogu pakietu — jest na to test.
- [x] `npm pack --dry-run` nie zawiera żadnego pliku z danymi the origin project — jest na to test na liście plików, nie na oko.
- [x] `worktrail --version` zgadza się z `package.json` (jedno źródło).
- [x] ~~`LICENSE` obecny; wybór licencji potwierdzony przez foundera.~~ **Odroczone do publikacji** (decyzja foundera 2026-08-30: „na razie nie publikujemy"). Licencja jest warunkiem wypuszczenia pakietu, nie lokalnej instalacji. W międzyczasie manifest ma `"private": true` + `"license": "UNLICENSED"` — `npm publish` **oblewa**, więc pakiet nie może wyjechać przypadkiem, a stan jest zadeklarowany uczciwie zamiast domyślnego „ISC".
- [x] Nazwa produktu pochodzi z `PRODUCT_NAME`, nie z literałów w tekstach — po zmianie tej jednej wartości `--help` i komunikaty mówią nową nazwą. Jest na to test.
- [ ] ~~Instalacja globalna (`npm i -g .`) daje działające `worktrail` w `PATH`.~~ **NIE zweryfikowane celowo** — `npm i -g` zmienia globalne środowisko foundera, więc nie robię tego bez potrzeby. Zastąpione mocniejszym dowodem: test pakuje `npm pack`, instaluje tarball do świeżego katalogu i uruchamia `node_modules/.bin/worktrail` — czyli ten sam mechanizm linkowania binarki, tylko bez dotykania systemu. Prawdziwa instalacja globalna należy do `origin#BL-1446`, gdzie i tak trzeba wybrać między `-g` a `devDependency`.
- [x] Wszystkie istniejące testy modułu przechodzą bez zmian — packaging niczego nie przenosi.

## Verification

```bash
# 1. Testy pakowania — expected: pass
node --test scripts/tests/packaging.test.mjs

# 2. Tarball bez danych the origin project — expected: brak trafień
npm pack --dry-run 2>&1 | grep -E "tasks/|history/|archive/|boards/|viewer.html" && echo "UWAGA: dane w pakiecie" || echo "tarball czysty — OK"

# 3. Praca z katalogu bez backlogu — expected: błąd z podpowiedzią, NIE zapis
cd /tmp && node /Users/limack/workspace/tasklog/bin/worktrail.mjs query --count; echo "exit=$?"

# 4. Wersja z jednego źródła — expected: zgodne
test "$(node bin/worktrail.mjs --version)" = "$(node -p "require('./package.json').version")" && echo 'wersja spójna — OK'
```

## Notes

- Nazwa **rozstrzygnięta: `tasklog`** ([TL-20](TL-20-domknij-nazwe-narzedzia-przed-publikacja.md) done 2026-08-30, dostępność na npm zweryfikowana tego dnia). **Nieaktualne od 2026-09-01** — decyzja odwrócona, produkt nazywa się `worktrail`; uzasadnienie w logu TL-20. Trzymać ją w `package.json` i `bin`, żeby ewentualna zmiana była dwoma miejscami, nie greppem.
- **Otwarte ryzyko zewnętrzne:** nazwa nie jest zarezerwowana na npm. Dopóki pakiet nie zostanie opublikowany (choćby jako `0.0.1`), `worktrail` może zająć ktoś inny — a wtedy przepada też nazwa binarki. Rezerwacja to decyzja foundera; ten task tylko przygotowuje pakiet zdatny do publikacji.
- Publikacja do npm **nie jest** częścią tego taska. Pakiet ma być instalowalny lokalnie (`npm i -g .`, `npx <ścieżka>`); wypuszczenie to osobna decyzja foundera.
- Poza zakresem: katalog domowy i rejestr (TL-34), teksty EN ([TL-32](TL-32-angielska-powierzchnia-publiczna-modulu.md)).

## Log

- 2026-08-30 created — claude — z projektu narzędzia globalnego (docs/architecture/worktrail-global-tool.md); packaging jest jedynym twardym brakiem, reszta warstwy przenośności zrobiona w TL-18/TL-19/TL-23
- 2026-08-30 done — claude — `package.json` + `bin/worktrail.mjs` + `scripts/product.mjs`; 11 testów w `packaging.test.mjs`, pełna suita modułu 224/224 zielona.
  **Krok 3 okazał się niepotrzebny jako KOD.** Miałem „wyłączyć ko-lokację, gdy kod działa z node_modules" — ale `looksLikeBacklogDir()` wymaga `tasks/` **i** znacznika, a pakiet nie wozi `tasks/`, więc ko-lokacja z `node_modules` po prostu nie strzela. Zamiast dokładać gałąź specjalną (czyli workaround na regułę, która już działa), udowodniłem tę własność testem — jednostkowym na sztucznym `node_modules/worktrail/` i integracyjnym na realnie zainstalowanym tarballu.
  **Bramka na artefakcie, nie na konfiguracji.** Pierwsza wersja testu asertowała listę `files` z `package.json` — czyli INTENCJĘ. Test przepisany na `npm pack` → `npm install` → uruchomienie `node_modules/.bin/worktrail` z niezwiązanego katalogu, bo tylko tarball rozstrzyga, co npm naprawdę spakował.
  Przy okazji: pierwsza wersja testu integracyjnego OBLAŁA z właściwego powodu — w checkoucie ko-lokacja **ma** strzelać, więc „brak backlogu" nie mógł tam wystąpić. Asercja była o złym scenariuszu, nie kod o złym zachowaniu.
  `PRODUCT_NAME` czytany z manifestu zastąpił literały w tekstach pomocy, użycia i błędów (11 stringów `usage:` + pomoc + trzy komunikaty). `PRODUCT_VERSION` może być `null` — brak manifestu daje błąd „uszkodzona instalacja", nie zmyśloną wersję.
  `"private": true` + `"license": "UNLICENSED"` w manifeście: `npm publish` oblewa, więc pakiet nie wyjedzie przypadkiem, dopóki nie ma decyzji o licencji.
