---
id: TL-71
title: "Serwer nie wie, czyj backlog trzyma — ping bez katalogu"
type: task
labels: []
board: main
epic: "Backlog viewer"
priority: P1
status: done
owner: agent:claude
estimate: 2h
created: 2026-08-31
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - docs/worktrail-global-tool.md
verification:
  # Jeden wpis na CAŁY plik, nie po jednym na kryterium: wzorzec `--test-name-pattern`
  # nietrafiający w żaden test kończy się zielono i zerem testów, więc taki dowód
  # byłby zielony bez mocy dowodowej. Każdy test tu ma swoją kontrolę pozytywną.
  - id: identity
    bash: "node --test scripts/tests/serve-identity.test.mjs"
  - id: no-stale-name
    bash: "! grep -n 'origin' scripts/serve-backlog.mjs"
  - id: no-regression
    bash: "node --test scripts/tests/*.test.mjs"
---

## Cel

`worktrail serve` uruchomiony w projekcie A, gdy na porcie 4321 stoi już serwer
projektu B, ma **wystartować własny serwer** i powiedzieć, dlaczego wziął inny
port — zamiast po cichu otworzyć kartę z backlogiem projektu B.

Po tym tasku odpowiedź na pytanie „czyj backlog widzę w przeglądarce" jest
dostępna maszynowo (`/api/ping`), a nie tylko przez `ps aux | grep`.

## Kontekst

Zgłoszenie: „dlaczego w przeglądarce nie widzę tasków TL". Na 4321 działał
proces uruchomiony ze skryptu worktrail, ale z `cwd` w innym repozytorium, więc
`resolveBacklogDir()` wykrył w górę backlog tamtego projektu i serwował 1378
cudzych tasków.

Samo `cwd` nie jest tu całą przyczyną. Drugie uruchomienie — już z właściwego
katalogu — **też** pokazałoby cudze taski, bo start jest poprzedzony sondą:

```js
// serve-backlog.mjs:437-443
{ host: "127.0.0.1", port, path: "/api/ping", timeout: 500 }
resolve(JSON.parse(body).app === PING_ID);
```

`/api/ping` (`serve-backlog.mjs:342`) oddaje `{ app, pid }` — **bez katalogu
backlogu**. Sonda rozpoznaje więc „dowolny worktrail", nie „worktrail nad TYM
backlogiem", a `serve-backlog.mjs:506` na tej podstawie kończy się `exit 0`
z komunikatem „już działa — otwieram kartę". To cichy no-op z efektem
ubocznym: użytkownik dostaje otwartą kartę, czyli sygnał sukcesu, i cudze dane.
Ta sama klasa błędu, którą TL-22 zdjął z walidacji flag.

**Wielu serwerów naraz ten task nie wprowadza — one już działają** (`--port`,
plus zejście na `port + 1` przy EADDRINUSE w `listen()`). Brakuje wyłącznie
tożsamości: dopóki serwer nie publikuje swojego katalogu, ani sonda, ani viewer,
ani przyszły przełącznik projektów nie mają na czym się oprzeć.

Dlatego to jest **przesłanka dla kroku 6 w TL-36** („widok w viewerze —
przełącznik projekt / wszystkie"). Rozstrzygnięcie kształtu tamtego przełącznika
zostaje w TL-36 i tu go nie przesądzamy: jeden serwer obsługuje jeden backlog,
bo serwer PISZE (zapis `.md`, dopis do historii, regeneracja widoków), a jeden
proces piszący do N repozytoriów rozwodzi stan z gałęzią (Prawo 1).

Poza zakresem: stały port per projekt z rejestru (to TL-34) i klucze
`origin-backlog-*` w `localStorage`/IndexedDB viewera — te są utrwalone
u użytkownika i ich zmiana wymaga migracji, więc idą osobnym taskiem.
`PING_ID` jest tu jedynym wyjątkiem, bo to token handshake'u liczony w runtime,
nieutrwalony nigdzie — jego zmiana nic nie kosztuje, a zostawiony literał
z nazwą cudzego projektu łamie regułę „nazwa produktu pochodzi z
`scripts/product.mjs`".

## Pre-flight reading

1. `scripts/serve-backlog.mjs` — `PING_ID` (:76), handler `/api/ping` (:342),
   `probeExisting()` (:435), `listen()` z zejściem na kolejny port (:455),
   sonda przed startem (:506).
2. `scripts/paths.mjs` — `resolveBacklogDir()`: cztery źródła katalogu i to,
   dlaczego `cwd` jest jednym z nich.
3. `scripts/product.mjs` — skąd bierze się nazwa produktu.
4. `scripts/tests/_repo.mjs` — jak testy ustalają katalog backlogu w OBU
   układach; nowy test ma z tego korzystać, a nie liczyć ścieżek w górę.
5. `scripts/tests/flag-validation.test.mjs` — wzorzec testu, który startuje
   komendę i asertuje na jej wyjściu.

## Kroki

1. `/api/ping` oddaje `{ app, pid, backlogDir, projectName }`. `backlogDir`
   jako ścieżka **absolutna i zrezolwowana** (`realpath`) — inaczej worktree
   przez symlink porówna się nierówno z tym samym katalogiem.
2. `probeExisting()` przyjmuje oczekiwany katalog i zwraca trzy stany, nie dwa:
   `same` (ten sam backlog), `other` (worktrail, ale cudzy backlog), `none`.
   Zwracanie boolean-a jest tym, co dziś skleja dwa pierwsze przypadki.
3. `same` → zachowanie jak dziś: komunikat i otwarcie karty, `exit 0`.
4. `other` → **nie przejmuj portu**: `listen()` od `port + 1`, a komunikat mówi
   oba projekty po nazwie i oba porty. Bez nazw użytkownik nie wie, co na tym
   porcie siedzi, i wraca do `ps aux`.
5. `PING_ID` liczony z `product.mjs`, nie literał `"origin-backlog-viewer"`.
6. Test `scripts/tests/serve-identity.test.mjs` na dwóch fixture'ach backlogu
   startuje dwa serwery na tym samym porcie startowym i asertuje, że drugi
   serwuje SWÓJ backlog pod innym portem. Kontrola pozytywna obowiązkowa: test
   ma też pokryć przypadek `same` (drugie uruchomienie nad tym samym katalogiem
   NIE podnosi drugiego serwera) — bez niej przechodzi implementacja, która
   nigdy nie rozpoznaje serwera jako swojego.
7. Sprzątanie w teście: oba procesy ubite w `finally`, także gdy asercja padła.
   Wiszący serwer na 4321 psuje kolejne uruchomienie suity.

## Acceptance criteria

- [x] `GET /api/ping` zwraca `backlogDir` (absolutny, po `realpath`) i `projectName`. [proof: identity]
- [x] Drugi `worktrail serve` nad INNYM backlogiem podnosi własny serwer na kolejnym wolnym porcie; jego strona ma `project_name` swojego projektu. [proof: identity]
- [x] Komunikat tego przypadku wymienia oba projekty i oba porty. [proof: identity]
- [x] Drugi `worktrail serve` nad TYM SAMYM backlogiem nadal tylko otwiera kartę i kończy `exit 0` — bez drugiego procesu. [proof: identity]
- [x] `grep origin scripts/serve-backlog.mjs` nie zwraca nic. [proof: no-stale-name]
- [x] `node --test scripts/tests/*.test.mjs` zielone w całości. [proof: no-regression]
- [x] Test nie zostawia działającego procesu, także po nieudanej asercji. [proof: identity]

## Verification

```bash
# 1. Tożsamość serwera — expected: pass, w tym kontrola pozytywna `same`
node --test scripts/tests/serve-identity.test.mjs

# 2. Nazwa cudzego projektu nie została w kodzie — expected: exit 0 (brak trafień)
! grep -n 'origin' scripts/serve-backlog.mjs

# 3. Cała suita — expected: pass, bez regresji
node --test scripts/tests/*.test.mjs
```

## Notes

- Zmiana `PING_ID` sprawia, że nowy klient nie rozpozna **starego** działającego
  serwera i wejdzie na kolejny port. To jest poprawne: stary proces ma stary kod
  i tak czy inaczej nie umie powiedzieć, czyj backlog trzyma.
- Przesłanka dla kroku 6 w TL-36; nie wpisano tego w `blocked_by` TL-36,
  bo tamten task blokuje przede wszystkim rejestr z TL-34.

## Log

- 2026-08-31 pending — claude — z diagnozy „nie widzę tasków TL w przeglądarce":
  na 4321 stał serwer innego projektu, a sonda `/api/ping` nie odróżnia cudzego
  backlogu od własnego, więc drugie uruchomienie i tak trafiłoby w cudze dane
