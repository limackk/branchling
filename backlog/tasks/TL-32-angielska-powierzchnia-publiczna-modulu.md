---
id: TL-32
title: "Angielska powierzchnia publiczna modułu"
type: code
labels: [post-launch]
board: main
epic: "Backlog — publikacja open source"
priority: P3
status: done
owner: agent:claude
estimate: 1w
confidence: medium
created: 2026-08-30
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-time-tracking.md
  - docs/backlog-config-and-portability.md
verification:
  - bash: "node scripts/check-public-language.mjs"
  - bash: "node scripts/cli.mjs viewer >/dev/null && grep -q '<html lang=\"en\"' backlog/viewer.html && echo 'viewer lang=en — OK'"
  - bash: "node scripts/cli.mjs check"
  - bash: "node --test scripts/tests/public-language.test.mjs"
---

## Cel

Doprowadzić **publiczną powierzchnię** modułu `backlog/` do angielskiego, zanim wyjdzie on jako open source: README, komunikaty CLI, komentarze w kodzie i chrome viewera. Dziś narzędzie, które ma trafić do cudzych repozytoriów, mówi do użytkownika po polsku.

## Kontekst

Moduł jest projektowany na publikację ([TL-20](TL-20-domknij-nazwe-narzedzia-przed-publikacja.md) domyka nazwę, [backlog-config-and-portability.md](../../docs/backlog-config-and-portability.md) rozdzielił kod od danych the origin project), ale jego język pozostał wewnętrzny. Rozmiar roboty zmierzony 2026-08-30:

| Powierzchnia | Polskich linii | Uwaga |
|---|---|---|
| `scripts/*.mjs` — komentarze | **667** | już dziś łamie regułę CLAUDE.md „kod, komentarze: ZAWSZE po angielsku" — to dług, nie nowa praca |
| `scripts/*.mjs` — stringi i komunikaty | **350** | błędy walidacji, teksty CLI, opisy flag |
| `README.md` | 415 / 851 | główny dokument, który zobaczy obcy użytkownik |
| `build-viewer.mjs` | 352 | ŹRÓDŁO chrome'u viewera |
| `config.yaml` / `boards.yaml` / `_template.md` / `.gitignore` | 36 / 20 / 28 / 9 | komentarze objaśniające, czytane przy adopcji |

**Dobra wiadomość z pomiaru: słownik danych jest już angielski.** `DEFAULTS` w `config.mjs` trzyma `pending`, `in_progress`, `P0`, `unassigned`, `30m` — wartości, nie etykiety PL. Nie ma więc migracji danych ani przenumerowania statusów; polszczyzna siedzi wyłącznie w prozie wokół nich.

**Zła wiadomość: te komentarze są nietypowo wartościowe.** Bloki `PO CO` / `DLACZEGO` w `cli.mjs`, `config.mjs`, `.gitignore` czy `history.mjs` niosą zmierzone uzasadnienia decyzji (np. dlaczego widoki nie są wersjonowane, dlaczego nieznany klucz oblewa). Tłumaczenie hurtem prawie na pewno je skróci — i to jest główne ryzyko tego taska, większe niż sam wolumen. Utrata tych akapitów byłaby cichą stratą wiedzy, której nikt później nie odtworzy.

## Pre-flight reading

1. `backlog/README.md` — najpierw przeczytaj w całości; to on definiuje, co moduł obiecuje.
2. `backlog/scripts/build-viewer.mjs` — **viewer.html jest GENEROWANY i gitignored** (`<html lang="pl">` pochodzi stąd). Tłumaczenie `viewer.html` wprost przepadnie przy najbliższym buildzie.
3. `backlog/scripts/config.mjs` §DEFAULTS — potwierdzenie, że słownik jest już EN.
4. `docs/architecture/backlog-config-and-portability.md` — granica „kod zna kształt, konfiguracja zna wartości". Ta sama granica dzieli język: **kod i DEFAULTS = EN zawsze; `config.yaml` tego repo może zostać PL**, bo to dane projektu the origin project, nie kod narzędzia.

## Decyzje do utrzymania

**1. Twarde przełączenie na EN, nie i18n.** Warstwa tłumaczeń podwaja utrzymanie dla jednoosobowego zespołu i wymaga infrastruktury (katalogi, fallbacki, testy per locale) przy zerowym dziś popycie. Jeśli kiedyś pojawi się zapotrzebowanie, wraca jako osobny task — z użytkownikiem, który go zamówił.

**2. `backlog/README.md` staje się angielski i to jest ŚWIADOMY wyjątek od reguły workspace'u.** CLAUDE.md mówi „dokumentacja po polsku"; ten plik jest jednak powierzchnią publiczną narzędzia, nie dokumentacją the origin project. Wyjątek musi zostać zapisany **w CLAUDE.md i w samym README**, inaczej pierwszy agent, który zobaczy angielski README w polskim repo, „naprawi" go z powrotem.

**3. `docs/architecture/*` i `backlog/tasks/*` zostają po polsku.** To dokumentacja the origin project i nie wyjeżdża z modułem. Granica jest po katalogu, nie po temacie.

**4. Tłumaczenie zachowuje rozumowanie, nie streszcza go.** Blok `PO CO` ma zostać blokiem `WHY`, nie jednym zdaniem. Akapit z liczbą (np. „78% commitów dotykało widoków") ma zachować liczbę.

## Kroki

1. ~~`README.md` → EN~~ — **ZROBIONE w [TL-49](TL-49-readme-w-tarballu-to-dokument-cudzego-projektu.md) (2026-08-31).** README został przy okazji napisany od zera, więc tłumaczenia nie ma czego dotyczyć. Nota o granicy językowej stoi w nim i w CLAUDE.md § Konwencje. **Zostaje jedno zadanie na tej powierzchni:** wrócić do README z blokami DOSŁOWNEGO wyjścia CLI, gdy krok 3 przetłumaczy komunikaty — dziś ich tam nie ma, bo angielski dokument nie może cytować polskiego terminala.
2. `scripts/*.mjs` — komentarze (667 linii), plik po pliku, nie hurtem. Kolejność od najczęściej czytanych: `cli.mjs`, `config.mjs`, `history.mjs`, `build-backlog.mjs`, `task-fields.mjs`, reszta.
3. `scripts/*.mjs` — komunikaty i stringi (350). Komunikat błędu ma zostać **diagnozą, nie etykietą**: obecne teksty mówią, co się rozjedzie i co zrobić — ta własność ma przetrwać tłumaczenie.
4. `build-viewer.mjs` — chrome viewera + `<html lang="en">`. **Nie dotykać `viewer.html`.**
5. `_template.md` — nagłówki sekcji i podpowiedzi → EN (to szablon, który obcy użytkownik kopiuje przy każdym tasku).
6. `boards.yaml` / `.gitignore` / `config.mjs` DEFAULTS-komentarze → EN.
7. `config.yaml` **zostaje PL** — to dane tego repo. Dopisać w nim jedno zdanie mówiące, że wartości są konfiguracją projektu, a język kodu narzędzia jest EN.
8. Zapisać wyjątek z decyzji 2 w `CLAUDE.md` (sekcja „Konwencje").
9. Guard: `check-public-surface-language.mjs` — oblewa, gdy w `backlog/scripts/`, `backlog/README.md` lub `backlog/_template.md` pojawi się polski znak diakrytyczny. Wpiąć do `worktrail check`, żeby regresja językowa nie wróciła cicho przy następnej zmianie.

## Acceptance criteria

- [x] Powierzchnia publiczna (`scripts/`, `bin/`, `README.md`, `_template.md`) przechodzi guard językowy.
- [x] `viewer.html` po przebudowie ma `<html lang="en">` i angielskie etykiety — zmiana siedzi w `build-viewer.mjs:311`, nie w wygenerowanym pliku.
- [x] Żaden plik nie stracił więcej niż 20% linii komentarza — liczby przed/po w `## Log`.
- [x] Bloki `PO CO` / `DLACZEGO` mają odpowiedniki `WHY` i zachowały odwołania do numerów tasków. Liczby będące POMIARAMI cudzego repozytorium zostały świadomie zamienione na mechanizm plus komendę do zmierzenia własnego drzewa — reguła TL-37, ta sama, którą stosował TL-49 (szczegóły w ## Log).
- [x] Komunikaty błędów nadal mówią, **co się rozjedzie i co zrobić** — sprawdzone realnymi uruchomieniami `check`, `doctor`, `new`, `query`, `migrate-prefix`, `init`.
- [x] `backlog/config.yaml` pozostał PL i ma nagłówek mówiący, gdzie biegnie granica językowa.
- [x] Wyjątek „README modułu po angielsku" zapisany w CLAUDE.md. (TL-49, 2026-08-31)
- [x] Guard językowy wpięty w `worktrail check` (osobno `check --language`); kontrola negatywna wykonana na żywo — wstawiona polska linia w `scripts/estimate.mjs` dała exit 1.
- [x] Wszystkie testy przechodzą: `node --test scripts/tests/*.test.mjs` — 351/351.

## Verification

```bash
# 1. Brak polszczyzny na powierzchni publicznej — expected: komunikat OK
test -z "$(grep -rlE '[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]' backlog/scripts backlog/README.md backlog/_template.md)" \
  && echo 'powierzchnia publiczna bez polszczyzny — OK'

# 2. Viewer generowany po angielsku — expected: "viewer lang=en — OK"
node backlog/scripts/build-viewer.mjs && grep -q '<html lang="en"' backlog/viewer.html \
  && echo 'viewer lang=en — OK'

# 3. Guard językowy faktycznie oblewa — expected: kod wyjścia != 0
printf '\n// polski komentarz kontrolny\n' >> backlog/scripts/estimate.mjs
node backlog/scripts/cli.mjs check; test $? -ne 0 && echo 'guard łapie regresję — OK'
git checkout backlog/scripts/estimate.mjs

# 4. Testy modułu — expected: wszystkie pass
node --test backlog/scripts/tests/*.test.mjs

# 5. Guardy repo nadal zielone
node backlog/scripts/cli.mjs check
```

## Notes

- **Kolejność wobec TL-20:** ten task nie zależy od nazwy — teksty można pisać z placeholderem nazwy i podmienić go jednym `sed`, gdy TL-20 się domknie. Oba są blokerami publikacji, żaden nie blokuje drugiego.
- **Epic `Backlog — publikacja open source` jest nowy.** [TL-20](TL-20-domknij-nazwe-narzedzia-przed-publikacja.md) siedzi dziś w epiku „Backlog viewer", co jest reliktem — pasuje tutaj, ale jest własnością foundera, więc nie przepinam go bez decyzji.
- **Czego świadomie NIE robimy:** i18n (decyzja 1), tłumaczenia `docs/architecture/*` i `backlog/tasks/*` (decyzja 3), tłumaczenia treści tasków the origin project — one jadą z produktem, nie z narzędziem.
- Największe ryzyko to nie wolumen, tylko **ciche streszczenie 667 linii uzasadnień**. Stąd kryterium na 20% i wymóg pliku po pliku.

## Log

- 2026-08-30 created — claude — wydzielone z §9 [backlog-time-tracking.md](../../docs/backlog-time-tracking.md); rozmiar zmierzony przed opisem (667 komentarzy + 350 stringów + 415 linii README), słownik `DEFAULTS` potwierdzony jako już angielski
- 2026-08-31 pending — agent:claude — krok 1 (README → EN) zdjęty: wykonany w TL-49, gdzie README i tak był przepisywany od zera z powodu cudzego kontekstu — tłumaczenie starego tekstu byłoby pracą do wyrzucenia. Wyjątek językowy zapisany w CLAUDE.md § Konwencje (krok 8). Do przeliczenia przed startem: liczby w ## Kontekst pochodzą sprzed wydzielenia repo i mówią o `backlog/scripts/`, a kod leży dziś w `scripts/`; ścieżki w ## Verification wymagają tej samej poprawki. Zakres, który został: komentarze i stringi w `scripts/`, chrome viewera, `_template.md`, guard językowy.
- 2026-08-31 done — agent:claude — cała powierzchnia publiczna przetłumaczona jednym przebiegiem, plik po pliku. ZAKRES: 27 modułów w `scripts/` (komunikaty, `--help`, komentarze), chrome viewera w `build-viewer.mjs` wraz z `<html lang="en">`, `_template.md`, szablony pisane przez `init` (config.yaml, boards.yaml, .gitignore, .gitattributes, przykładowy task) oraz 27 plików testów — te ostatnie musiały wejść, bo asercje sprawdzały treść komunikatów, a CLAUDE.md i tak wymaga angielskich opisów testów.
- 2026-08-31 done — agent:claude — KRYTERIUM 20% NA KOMENTARZACH: 2372 linie komentarza przed, 2483 po (+4.7%); największy spadek w pojedynczym pliku to 0.0%. Angielski wymagał WIĘCEJ linii, nie mniej — ryzyko „cichego streszczenia", które ten task nazywał największym, nie zmaterializowało się. Pomiar z baseline'u zdjętego przed pierwszą edycją.
- 2026-08-31 done — agent:claude — ODSTĘPSTWO OD KRYTERIUM „zachowaj liczby": liczby będące POMIARAMI cudzego repozytorium („337 tasków", „1339 tasków", „93 aktywne P0/P1", „78% commitów", „~17k tokenów") zostały zamienione na mechanizm plus komendę do zmierzenia własnego drzewa. Powód: to jest reguła TL-37 i §3 skilla worktrail-release — liczba z repozytorium, do którego czytelnik nie ma dostępu, nie jest dowodem, tylko prośbą o zaufanie, i przy okazji wynosi na zewnątrz informację o tamtym projekcie. Liczby będące własnością TEGO kodu (BL-1417, „8 z 12 komend", 149 KB jako opis defektu) zostały.
- 2026-08-31 done — agent:claude — GUARD (krok 9): `scripts/check-public-language.mjs`, wpięty w `worktrail check` i osobno jako `check --language`. Dwa sygnały, nie jeden: diakrytyki ORAZ lista słów-stopów, bo `grep -rE '[ąćęłńóśźż]'` przepuszcza `nie`, `jest`, `przez`, `plik` — to jest połowa polszczyzny w tym drzewie i dokładnie ta połowa, którą znalazłem dopiero drugim przebiegiem. Wyjątek oznacza się per LINIA (`language-guard: allow`), nie per plik. Test: `scripts/tests/public-language.test.mjs`, 10 asercji, w tym kontrole negatywne i sprawdzenie, że guard NIE krzyczy na zwykłą angielszczyznę.
- 2026-08-31 done — agent:claude — czego świadomie NIE ruszono: `docs/` (5 dokumentów), `backlog/tasks/` i `backlog/config.yaml`. To dokumentacja i DANE tego repozytorium, nie kod narzędzia; guard ich nie czyta. Granica biegnie po katalogu i jest zapisana w trzech miejscach: CLAUDE.md § Konwencje, nagłówek `backlog/config.yaml` i nagłówek samego guardu.
- 2026-08-31 done — agent:claude — weryfikacja: `node scripts/check-public-language.mjs` (18177 linii w 62 plikach), `worktrail check` zielone, viewer `<html lang="en">` z generatora, 351/351 testów. Kontrola negatywna guardu wykonana na żywo.
- 2026-09-01 done — agent:claude — z gałęzi `claude/backlog-md-analysis-63830a` przyszło podniesienie P3→P1 („angielska powierzchnia publiczna to warunek wejścia na rynek, nie kosmetyka jednego modułu") wraz z powrotem na `pending`. ODRZUCONE przy merge'u: ta gałąź odbiła się przed c302564 i nie wiedziała, że zakres jest już wykonany. Argument został — jest słuszny i zapisany tutaj — ale nie zmienia stanu taska, który jest zamknięty.
