---
id: TL-34
title: "Katalog domowy — preferencje i rejestr projektów"
type: code
labels: [post-launch]
board: main
epic: "Backlog — publikacja open source"
priority: P2
status: pending
owner: unassigned
estimate: 1d
confidence: medium
created: 2026-08-30
updated: 2026-08-30
blocked_by: [TL-33]
blocks: [TL-35, TL-36]
related_docs:
  - docs/worktrail-global-tool.md
  - docs/backlog-config-and-portability.md
verification:
  - bash: "node --test backlog/scripts/tests/home.test.mjs backlog/scripts/tests/registry.test.mjs"
  - bash: "WORKTRAIL_HOME=/tmp/worktrail-probe node backlog/scripts/cli.mjs where --json | python3 -c \"import json,sys; d=json.load(sys.stdin); assert d['home'].startswith('/tmp/worktrail-probe'), d; print('WORKTRAIL_HOME respektowane — OK')\""
---

## Cel

Dać narzędziu **katalog domowy użytkownika**: preferencje (fakty o człowieku, nie o projekcie) i rejestr projektów jako **indeks wskaźników**. To warstwa, dzięki której `worktrail` przestaje być modułem jednego repozytorium, nie przenosząc z niego danych.

## Kontekst

Dziś w module nie ma ani jednego `homedir()` ani `XDG_` — cała konfiguracja jest w repo. To było słuszne (TL-19: kod zna kształt, konfiguracja zna wartości), ale zostawia trzy rzeczy bez miejsca: tożsamość aktora, preferencje maszyny i wiedzę, że projektów bywa więcej niż jeden.

**Największe ryzyko tego taska nie jest techniczne — jest to Prawo 3** ([worktrail-global-tool.md §3](../../docs/worktrail-global-tool.md)). Dwie warstwy konfiguracji rozjadą się na pewno, o ile obie mogą mówić o tym samym. Granica ma więc być **rozłączna, nie priorytetowa**:

| Warstwa | Trzyma | Nie ma prawa dotknąć |
|---|---|---|
| użytkownik | aktor, edytor, motyw, port, format daty | statusów, priorytetów, labels, boardów, kolorów, `title_max_length` |
| projekt | słownictwo projektu | tożsamości człowieka |

Klucz w złej warstwie **OBLEWA**, tak jak dziś oblewa nieznany klucz w `config.yaml`. Precedencja typu „użytkownik nadpisuje projekt" jest tu **wykluczona**, bo dawałaby dwóm osobom różne boardy dla tego samego repozytorium.

Drugie ryzyko: rejestr, który po cichu stanie się prawdą. Wykrywanie w górę od cwd już rozwiązuje „gdzie jest mój backlog" i **rejestr nie ma tego dublować** — jest indeksem, a jego skasowanie musi być nieszkodliwe (Prawo 2).

## Pre-flight reading

1. `docs/architecture/worktrail-global-tool.md` — §3 (cztery prawa), §5 (gdzie leży katalog), §7 (rejestr jako indeks), §8 (workspace wielorepozytoryjny).
2. `backlog/scripts/config.mjs` — `DEFAULTS`, `KNOWN_KEYS`, sposób oblewania nieznanego klucza. Warstwa użytkownika ma powtórzyć ten rygor, nie wymyślić własny.
3. `backlog/scripts/paths.mjs` — `looksLikeBacklogDir()`; rejestr rewaliduje przez tę funkcję, nie przez `existsSync`.
4. `docs/architecture/backlog-config-and-portability.md` — dlaczego wartości wyjechały do konfiguracji.

## Kroki

1. `backlog/scripts/home.mjs` — rozwiązanie katalogu domowego wg §5: `WORKTRAIL_HOME` → `XDG_CONFIG_HOME`/`XDG_DATA_HOME` → `~/.config` + `~/.local/share` → `%APPDATA%`. Rozdział **config vs data** jest częścią kontraktu, nie szczegółem.
2. Nazwa katalogu z **jednej stałej** — `worktrail` jest nazwą wstępną ([TL-20](TL-20-domknij-nazwe-narzedzia-przed-publikacja.md)), zmiana nie może być greppem.
3. `USER_KEYS` — **zamknięta** lista kluczy warstwy użytkownika. Klucz z `KNOWN_KEYS` projektu użyty w warstwie użytkownika OBLEWA z komunikatem mówiącym, gdzie jego miejsce (diagnoza, nie etykieta).
4. Scalanie warstw: **suma rozłączna**, nigdy nadpisanie. Test negatywny na próbę nadpisania `statuses` z warstwy użytkownika.
5. `<config>/projects.yaml` — rejestr: `name` (etykieta lokalna dla użytkownika) + `path` (katalog **backlogu**, nie repozytorium git — §8).
6. `worktrail project add|list|remove` + rejestracja z `worktrail init`. Rejestracja **nie jest warunkiem działania** żadnej innej komendy.
7. Rewalidacja przy użyciu przez `looksLikeBacklogDir()`; **brakująca ścieżka jest RAPORTOWANA**, nigdy pomijana po cichu.
8. `worktrail where` — drukuje katalog config, katalog data, znaleziony backlog i **którym źródłem** został znaleziony (`explicit`/`env`/`discovery`/`colocated`/`registry`). To jest odpowiedź na pierwsze pytanie każdego nowego użytkownika i na §11 pkt 3.
9. Testy: `home.test.mjs` (kolejność źródeł, Windows, XDG), `registry.test.mjs` (rewalidacja, brakująca ścieżka, kasowalność, workspace wielorepozytoryjny).

## Acceptance criteria

- [ ] `WORKTRAIL_HOME` wygrywa ze wszystkim — jest na to test (i to jest hak testowy dla reszty).
- [ ] `XDG_CONFIG_HOME`/`XDG_DATA_HOME` respektowane, gdy ustawione; domyślnie `~/.config` + `~/.local/share`.
- [ ] Config i data to **osobne** katalogi — jest na to asercja, nie tylko intencja.
- [ ] Klucz słownictwa projektu (`statuses`, `labels`, `boards`…) w warstwie użytkownika **OBLEWA** z komunikatem wskazującym właściwą warstwę — test negatywny.
- [ ] Warstwa użytkownika nie potrafi nadpisać ŻADNEJ wartości z `config.yaml` projektu — test, nie deklaracja.
- [ ] Skasowanie `projects.yaml` nie psuje żadnej komendy działającej w repo — test (Prawo 2).
- [ ] Wpis z nieistniejącą ścieżką jest raportowany, a nie pomijany — test.
- [ ] Rejestr trzyma katalog **backlogu**; układ „repo root + 9 sub-repo" (ten workspace) daje JEDEN projekt, nie dziesięć — test na fixturze o tym kształcie.
- [ ] `worktrail where` podaje źródło rozwiązania backlogu.
- [ ] Żadna komenda nie zaczyna WYMAGAĆ `--project` — jeśli zaczyna, rejestr został prawdą i to jest regresja (§11 pkt 2).

## Verification

```bash
# 1. Testy katalogu domowego i rejestru — expected: pass
node --test backlog/scripts/tests/home.test.mjs backlog/scripts/tests/registry.test.mjs

# 2. WORKTRAIL_HOME wygrywa — expected: komunikat OK
WORKTRAIL_HOME=/tmp/worktrail-probe node backlog/scripts/cli.mjs where --json | python3 -c \
  "import json,sys; d=json.load(sys.stdin); assert d['home'].startswith('/tmp/worktrail-probe'); print('WORKTRAIL_HOME respektowane — OK')"

# 3. Rejestr jest kasowalny — expected: komendy dalej działają
WORKTRAIL_HOME=/tmp/worktrail-probe rm -f /tmp/worktrail-probe/config/projects.yaml
node backlog/scripts/cli.mjs query --count && echo 'brak rejestru nieszkodliwy — OK'

# 4. Warstwa użytkownika nie nadpisze słownictwa — expected: kod wyjścia != 0
mkdir -p /tmp/worktrail-probe/config && printf 'statuses: [foo]\n' > /tmp/worktrail-probe/config/config.yaml
WORKTRAIL_HOME=/tmp/worktrail-probe node backlog/scripts/cli.mjs query --count; test $? -ne 0 && echo 'zła warstwa oblewa — OK'
rm -rf /tmp/worktrail-probe

# 5. Guardy modułu
node backlog/scripts/cli.mjs check
```

## Notes

- **Bez demona.** Rejestr to plik YAML czytany przy starcie; proces rezydentny dokładałby cykl życia, logi i restarty, żeby oszczędzić jeden odczyt.
- **Bez synchronizacji katalogu domowego** między maszynami — to jest problem wersji hostowanej ([worktrail-state-and-sync.md §6](../../docs/worktrail-state-and-sync.md)).
- Założenie do obalenia: rejestr może nigdy nie mieć drugiego wpisu (§11 pkt 1). Wtedy [TL-36](TL-36-widok-przekrojowy-nad-wieloma-projektami.md) nie ma odbiorcy, ale ten task broni się sam — warstwa preferencji i `where` są potrzebne przy JEDNYM projekcie.

## Log

- 2026-08-30 created — claude — z projektu narzędzia globalnego (docs/architecture/worktrail-global-tool.md); granica warstw konfiguracji rozłączna, nie priorytetowa — dwie warstwy mówiące o tym samym to gwarantowany rozjazd
