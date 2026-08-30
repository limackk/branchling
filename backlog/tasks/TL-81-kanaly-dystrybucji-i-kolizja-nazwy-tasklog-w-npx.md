---
id: TL-81
title: "Kanały dystrybucji i kolizja nazwy worktrail w npx"
type: task
labels: [pre-launch]
board: main
epic: "Backlog — publikacja open source"
priority: P0
status: done
owner: agent:claude
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - README.md
verification:
  - bash: "npm view worktrail name version 2>&1 | head -3"
  - bash: "node --test scripts/tests/packaging.test.mjs"
---

## Cel

Wiemy, czy nazwa `worktrail` jest wolna w npm, i mamy rozstrzygnięte, którymi
kanałami narzędzie jedzie do użytkownika. Ustalone ZANIM nazwa się utrwali w
dokumentacji, adresach i cudzych skryptach.

## Kontekst

`package.json` ma dziś `"name": "worktrail"`, `"private": true` i
`"license": "UNLICENSED"` — nic jeszcze nie zostało opublikowane, więc nazwa
jest jeszcze bezpłatnie wymienialna. Po publikacji przestaje być.

Konkretne ostrzeżenie z Backlog.md: ich pakiet nazywa się `backlog.md`, ale
`npx backlog` (bez instalacji) rozwiązuje się do NIEPOWIĄZANEGO pakietu innego
autora. Musieli to opisać w README jako pułapkę. To jest koszt, który ponosi się
raz i na zawsze, a wykrywa się jedną komendą przed publikacją.

Do rozstrzygnięcia w tym tasku (nie do wykonania — to jest task decyzyjny):

1. Czy `worktrail` jest wolne w npm; jeśli nie, jaka jest nazwa pakietu i czy
   `npx <nazwa>` nie trafia w cudzy kod.
2. Czy nazwa binarki (`bin.worktrail`) i nazwa pakietu mogą się różnić i co wtedy
   pokazujemy w README.
3. Które kanały poza npm: Homebrew i Nix (Backlog.md ma oba) — rozstrzygnij
   TERAZ, czy w ogóle, bo to wpływa na to, co README obiecuje na starcie.
4. Czy `scripts/product.mjs` naprawdę przykrywa wszystkie miejsca, w których
   nazwa występuje — CLAUDE.md mówi, że zmiana nazwy ma być JEDNĄ edycją. To
   jest twierdzenie do sprawdzenia, nie do założenia.

## Pre-flight reading

1. `package.json` — `name`, `bin`, `files`, `private`, `license`.
2. `scripts/product.mjs` — skąd bierze się nazwa produktu w wyjściu narzędzia.
3. `scripts/tests/packaging.test.mjs` — co dziś pilnujemy o zawartości tarballa.
4. `.claude/skills/worktrail-release/SKILL.md` — istniejąca bramka przedpublikacyjna;
   ustalenia z tego taska mają do niej wrócić.

## Kroki

1. Sprawdź dostępność nazwy w npm (`npm view worktrail`) i osobno, do czego
   rozwiązuje się `npx worktrail` dzisiaj.
2. Zweryfikuj twierdzenie „zmiana nazwy to jedna edycja": `grep` po literałach
   nazwy poza `product.mjs`. Znalezione literały to albo poprawka, albo nowy task.
3. Rozstrzygnij kanały dystrybucji i zapisz decyzję z uzasadnieniem.
4. Wnioski dopisz do bramki `worktrail-release`, żeby następna publikacja ich nie
   powtarzała od zera.

## Acceptance criteria

- [x] Wiadomo, czy nazwa pakietu jest wolna, i decyzja jest zapisana w tasku.
- [x] Sprawdzone i zapisane, do czego rozwiązuje się `npx <nazwa>` bez instalacji.
- [x] Twierdzenie o jednej edycji przy zmianie nazwy jest sprawdzone `grep`-em, nie założone.
- [x] Decyzja o kanałach (npm / brew / nix) jest zapisana wraz z uzasadnieniem.
- [x] Ustalenia trafiły do bramki przedpublikacyjnej.

## Log

2026-08-31 pending — agent:claude — założony z analizy Backlog.md (github.com/MrLesk/Backlog.md), punkt 10.
- 2026-09-01 pending — agent:claude — PODNIESIONE P1→P0 (dołącza do TL-82 i TL-86, które przyszły z merge'a gałęzi analitycznej). Powód jest nowy, nie kosmetyczny: właściciel rozważa usługę worktrail w chmurze (ustalone przy TL-48). Przy MIT — i tak samo przy Apache-2.0 — licencja NIE powstrzymuje konkurenta przed postawieniem usługi na tym kodzie; jedyne, co go powstrzymuje przed postawieniem jej POD TĄ NAZWĄ, to znak towarowy. Nazwa przestaje być kosmetyką i staje się aktywem biznesowym, a jest wciąż bezpłatnie wymienialna wyłącznie do pierwszej publikacji. Kolizja w npx (opisana w ## Kontekst jako cudzy przypadek) przy usłudze komercyjnej przestaje być niezręcznością w README, a staje się kierowaniem ruchu do cudzego pakietu.
- 2026-09-01 pending — agent:claude — **nazwa zmieniona `tasklog` → `worktrail`** (decyzja i uzasadnienie w logu [TL-20](TL-20-domknij-nazwe-narzedzia-przed-publikacja.md)). Co to zmienia w TYM tasku:
  **Krok 2 wykonany i dał wynik NEGATYWNY.** Twierdzenie „zmiana nazwy to jedna edycja" jest FAŁSZYWE — zmierzone, nie oszacowane: 158 plików, w tym 26 w `scripts/`. `scripts/product.mjs` eksportuje `PRODUCT_NAME`, ale reszta kodu go nie używa. Wynik wyjęty do [TL-117](TL-117-nazwa-produktu-z-jednej-stalej-a-nie-z-literalu.md), bo to robota, a nie decyzja — ten task pozostaje decyzyjny.
  **Punkt 1 częściowo rozstrzygnięty:** `registry.npmjs.org/worktrail` → 404 (2026-09-01), nazwa wolna. **NIEROZSTRZYGNIĘTE zostaje pytanie ostrzejsze**, to samo, które ubodło Backlog.md: do czego rozwiązuje się `npx worktrail` BEZ instalacji. Wolna nazwa w rejestrze tego nie gwarantuje i trzeba to sprawdzić osobno.
  **Podniesione ryzyko:** nazwa jest świeżo wybrana i wciąż niezarezerwowana, więc okno między wyborem a publikacją jest teraz jedynym zabezpieczeniem — i jest otwarte.
  `## Kontekst` powyżej mówi o `"private": true` i `"license": "UNLICENSED"` — **oba są nieaktualne** niezależnie od nazwy (licencja rozstrzygnięta w [TL-48](TL-48-license-i-metadane-pakietu-dzis-nikt-nie-moze-tego-uzyc.md), `private` usunięte).
- 2026-09-01 in_progress — agent:claude — **PUNKT 1 i 2 ROZSTRZYGNIĘTE POMIAREM** (2026-09-01, sieć). Rejestr: `registry.npmjs.org/worktrail` → 404, `npm view worktrail` → E404, wyszukiwarka npm dla `worktrail` → **0 wyników** (nie tylko brak dokładnej nazwy — brak czegokolwiek podobnego). Sąsiedztwo literówek wolne: `work-trail`, `worktrails`, `worktrail-cli` → 404. `which worktrail` → brak, więc żadna zainstalowana binarka nie przykrywa naszej. Brak formuły w Homebrew (`formulae.brew.sh/api/formula/worktrail.json` → 404).
  **Pytanie ostrzejsze — do czego rozwiązuje się `npx worktrail` — ma odpowiedź STRUKTURALNĄ, nie tylko empiryczną.** Empirycznie: `cd /tmp && npx --yes worktrail --version` → E404, nie ma czego przejąć. Strukturalnie, i to jest właściwe zabezpieczenie: **`npx` rozwiązuje NAZWĘ PAKIETU, nigdy nazwę binarki.** Pułapka Backlog.md nie bierze się z pecha, tylko z rozjazdu tych dwóch nazw — zweryfikowane u źródła: `npm view backlog.md bin` → `{ backlog: 'cli.js' }`, a `npm view backlog` → `backlog@1.4.56`, „Orchestrator for AI coding agents", INNEGO autora. Ich `npx backlog` musi trafiać w cudzy kod, bo pakiet nazywa się inaczej niż binarka. U nas `name` == jedyny klucz `bin` == `worktrail`, więc ta klasa błędu jest ZAMKNIĘTA KONSTRUKCYJNIE, a nie tylko „dziś wolna". Warunek do utrzymania: nazwa pakietu i nazwa binarki nie mogą się rozjechać — gdyby kiedyś pakiet musiał nazywać się np. `worktrail.md`, pułapka otwiera się natychmiast.
- 2026-09-01 in_progress — agent:claude — **PUNKT 4 (twierdzenie o jednej edycji) — potwierdzony NEGATYWNY wynik z poprzedniego wpisu.** `scripts/product.mjs` eksportuje `PRODUCT_NAME` czytany z `package.json` (jedno źródło dla nazwy pakietu i nazwy w `--help`), ale reszta `scripts/` nadal wpisuje nazwę literałem — 158 plików przy zmianie `tasklog` → `worktrail`. Twierdzenie z CLAUDE.md jest INTENCJĄ, nie opisem stanu; robota jest w [TL-117](TL-117-nazwa-produktu-z-jednej-stalej-a-nie-z-literalu.md) i tam zostaje. Ten task nic tu nie wykonuje.
- 2026-09-01 in_progress — agent:claude — **PUNKT 3 — DECYZJA WŁAŚCICIELA: kanał tylko npm.** README obiecuje `npm i -g worktrail` i `npx worktrail`, nic więcej. Uzasadnienie: Homebrew i Nix to dwa osobne rytuały wydawnicze i dwa miejsca, w których wersja może się zestarzeć; tap opóźniony względem npm jest GORSZY niż brak tapa, bo obiecuje kanał, którego nie dowozi. Backlog.md ma oba, ale ma też użytkowników, którzy o nie poprosili — my mamy zero. Wracają jako osobne taski, kiedy ktoś poprosi, nie wcześniej. Konsekwencja dla README: nie wolno w nim wspominać brew/nix nawet jako „wkrótce".
- 2026-09-01 in_progress — agent:claude — **REZERWACJA NAZWY — DECYZJA WŁAŚCICIELA: okno zostaje otwarte.** Przedstawiona alternatywa (opublikować działające `0.1.0` jako rezerwację, gdy tylko TL-48 dostanie adres repozytorium) ODRZUCONA; publikacja dopiero, gdy całość jest gotowa. **Ryzyko przyjęte świadomie i zapisane, żeby nie wróciło jako zaskoczenie:** dopóki nie ma publikacji, nazwa jest wolna dla każdego, a przy rozważanej usłudze w chmurze to nazwa — nie licencja — jest jedynym, co powstrzymuje konkurenta przed postawieniem usługi POD TĄ NAZWĄ (analiza w [TL-48](TL-48-license-i-metadane-pakietu-dzis-nikt-nie-moze-tego-uzyc.md)). Wariant scope'owany (`@…/worktrail`) rozważony i odrzucony jako pozorny: nie rezerwuje nazwy bezscope'owej, więc `npx worktrail` zostaje wolne mimo publikacji. Rezerwacja jest wciąż dostępna w każdej chwili — koszt rośnie tylko z czasem, nie z niczym innym.
- 2026-09-01 in_progress — agent:claude — ustalenia dopisane do bramki przedpublikacyjnej `.claude/skills/worktrail-release/SKILL.md` §7: trzy komendy sprawdzające (`npm view` / `npx` / `which`) z wyjaśnieniem, DLACZEGO pierwsza nie zastępuje drugiej, precedens `backlog.md` jako dowód, oraz decyzja o kanałach. Zapisane jako reguła do powtórzenia przy każdej przyszłej zmianie nazwy, nie jako protokół z tego jednego sprawdzenia.
2026-09-01 done — agent:claude — closed by `worktrail done`: 2 command(s) green.
