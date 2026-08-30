---
id: TL-38
title: "Suita testów odpięta od repozytorium źródłowego"
type: code
labels: []
board: main
epic: "Portability"
priority: P2
status: done
owner: claude
estimate: 1d
confidence: medium
created: 2026-08-30
updated: 2026-08-30
blocked_by: []
blocks: []
related_docs:
  - docs/worktrail-global-tool.md
verification:
  - bash: "node --test scripts/tests/*.test.mjs"
---

## Cel

Suita ma przechodzić **w tym repozytorium**, a nie tylko w tym, z którego moduł
został wydzielony. Dziś 14 testów z 226 oblewa, bo opisują cudze drzewo.

## Kontekst

Znalezione przy pierwszym uruchomieniu suity po wydzieleniu (BL-1445). Rozkład
oblanych, zmierzony 2026-08-30:

| Plik | Oblanych |
|---|---|
| `boards.test.mjs` | 7 |
| `history-merge.test.mjs` | 2 |
| `config.test.mjs` | 2 |
| `views-not-versioned.test.mjs` | 1 |
| `task-fields.test.mjs` | 1 |
| `backlog-id-collisions.test.mjs` | 1 |

To NIE są dwie różne sprawy, tylko dwie klasy jednej:

**Klasa A — ko-lokacja w testach.** Pięć plików liczy katalog backlogu jako
`join(HERE, "..", "..")`. To jest dokładnie ten błąd, który BL-1445 naprawił w
`build-backlog.mjs` i `cli.mjs`: skrót, który działa wyłącznie wtedy, gdy kod
leży NAD danymi, i milczy o tym, że jest założeniem. W tym repozytorium
`scripts/tests/../..` to korzeń repo, nie backlog — więc `git check-ignore
INDEX.yaml` pyta o nieistniejący plik w niewłaściwym katalogu.

**Klasa B — asercje o cudzym projekcie.** Część testów sprawdza WARTOŚCI, które
były faktem o tamtym repozytorium: jego słowniki w `config.yaml`, jego manifest
`pre-commit`, jego etykiety. Te testy nie mają czego pilnować tutaj i nie da się
ich „przenieść" — trzeba je przepisać na fixture albo usunąć wraz z uzasadnieniem.

**Czego NIE robić:** rozluźniać asercji, żeby przeszły. Kilka z nich (na przykład
ratchet rozmiaru `INDEX.yaml` i kontrola pozytywna konfliktu widoków) ma realną
moc dowodową i przechodzenie na pustym drzewie byłoby zielenią bez wartości.

## Pre-flight reading

1. `CLAUDE.md` §„Zanim zmienisz kod" — reguła o `resolveBacklogDir()`.
2. `scripts/tests/non-colocated-layout.test.mjs` — regresja z BL-1445; pokazuje,
   jak zbudować drzewo w kształcie tego repozytorium.
3. `scripts/paths.mjs` — cztery źródła katalogu danych.

## Kroki

1. **Klasa A:** zastąpić `join(HERE, "..", "..")` wywołaniem `resolveBacklogDir()`
   albo — lepiej — fixture'em zakładanym przez test. Test, który pyta o REALNE
   drzewo, jest zależny od tego, w jakim repo go uruchomiono; test na własnym
   fixture nie jest.
2. **Klasa B:** dla każdego testu rozstrzygnąć, czy pilnuje właściwości
   NARZĘDZIA (→ fixture) czy właściwości tamtego projektu (→ usunąć, z powodem
   w commicie).
3. Testy, które muszą widzieć realne drzewo (ratchety, kontrole pozytywne),
   zostawić — ale mają czytać drzewo TEGO repozytorium.
4. Nie zostawić żadnego testu, który przechodzi na zerowej próbce.

## Acceptance criteria

- [x] `node --test scripts/tests/*.test.mjs` — 0 oblanych w tym repozytorium.
- [x] Żaden test nie liczy katalogu backlogu jako `join(HERE, "..", "..")`.
- [x] Każdy usunięty test ma powód w commicie — nie znika po cichu.
- [x] Żadna asercja nie została rozluźniona po to, żeby przeszła; testy z mocą
      dowodową (ratchety, kontrole pozytywne) nadal ją mają.
- [x] Test przechodzący na pustym drzewie nie istnieje — każdy ma kontrolę
      pozytywną albo własny fixture.

## Verification

```bash
# expected: 0 fail
node --test scripts/tests/*.test.mjs

# Żaden test nie zgaduje katalogu przez ko-lokację — expected: brak trafień
grep -rn '"\.\.", "\.\."' scripts/tests/ && echo "UWAGA: ko-lokacja w testach" || echo "czysto"
```

## Notes

- To jest dług przywieziony z wydzielenia, nie nowa wada — narzędzie działa
  (`build`, `check`, 212 testów zielonych). Ale suita jest tym, co przekonuje
  obcego użytkownika, że działa, więc czerwień w niej kosztuje wiarygodność.

## Log

- 2026-08-30 test mutacyjny po commicie — claude — `_repo.mjs` wskazany na `scripts/` zamiast `backlog/`: suita **CZERWONA** (7 oblanych) i licznik testów spada z 232 do 138, bo rzucenie przy imporcie zabija całe pliki. Zły resolver nie ma jak dać zielonego przebiegu — o to chodziło. Uwaga na przyszłość: przy tej mutacji trzeba czytać LICZNIK, nie samo „fail 7"; 94 testy w ogóle nie ruszyły.
- 2026-08-30 done — claude — 232/232. Rozwiązanie: JEDEN moduł `scripts/tests/_repo.mjs` odpowiada na pytanie „gdzie jest backlog TEGO repozytorium", wszystkie testy pytają jego. Rozstrzyga OBA układy (`<repo>/backlog` i ko-lokowany `<repo>`), bo narzędzie wspiera oba — więc jego własne testy nie mogą wpisywać na sztywno żadnego.
- 2026-08-30 dlaczego nie `resolveBacklogDir()` — claude — jego trzecim źródłem jest wykrywanie w górę od **cwd**, więc suita odpalona z innego katalogu sądziłaby cudzy backlog i nadal świeciła na zielono. Szukanie startuje od położenia pliku testu, nie od cwd.
- 2026-08-30 dwa testy USUNIĘTE z powodem w kodzie — claude — (1) „guard jest zadeklarowany w manifeście pre-commit": trwale nieaktualny, nie tylko nieprzenośny — konsument świadomie usunął oba guardy z `GUARD_MANIFEST` (BL-1446), bo kontrakt manifestu to „guard jest ŚLEDZONYM plikiem w tym repo". (2) „config.yaml the origin project odtwarza słowniki": jednorazowy dowód parytetu przy TL-19, dostarczony tam, gdzie miał sens. Oba zostawiły komentarz mówiący, czego przez to NIE mamy.
- 2026-08-30 ratchet PRZEBAZOWANY, nie usunięty — claude — próg `INDEX.yaml < 75 000 B` był policzony z 337 tasków tamtego projektu; przy 42 taskach przechodziłby, choćby każdy wiersz był pełnym mirrorem frontmattera — czyli był ZIELONY PRZY ZEROWEJ MOCY DOWODOWEJ, dokładnie to, czego ten task zabrania. Zastąpiony kosztem NA WIERSZ (próg 250 B), bo to jest niezmiennik, o który chodziło. Zmierzone: 155 B/wiersz tutaj, 168 B/wiersz u konsumenta (nagłówek liczony osobno — rozłożony na 14 wierszy podnosi średnią o ~90 B, na 353 o ~4 B). Defekt, dla którego ratchet powstał, to 442 B/task; kontrola pozytywna na syntetycznym „grubym" indeksie daje 451 B i ratchet ją ŁAPIE.
- 2026-08-30 świadome rozluźnienie, jedno — claude — „boards.yaml zna co najmniej 2 boardy" → „co najmniej 1". To była właściwość rejestru tamtego projektu; projekt z jednym boardem jest poprawny. W zamian test dostał kontrolę pozytywną, której wcześniej NIE miał: „przeczytałem co najmniej jeden task" — bez niej pusty katalog dawał zielone „zero złych boardów".
- 2026-08-30 dodane kontrole pozytywne — claude — cztery, w miejscach gdzie zielone przejście nie odróżniało „sprawdziłem i było dobrze" od „nie było czego sprawdzać": realne drzewo boardów, guard kolizji na realnym drzewie, `project_name` (brak pliku → default), `labels_closed` (druga strona przełącznika).
- 2026-08-30 bramka poprawiona, nie obchodzona — claude — `grep '"..", ".."'` zapalał się też na `packaging.test.mjs`, gdzie ta ścieżka była POPRAWNA (korzeń repo, nie backlog). Zamiast obchodzić regex, `packaging` też idzie przez `_repo.mjs` — korzeń repozytorium liczy się teraz w jednym miejscu, tak samo jak katalog backlogu.
- 2026-08-30 taken — claude
- 2026-08-30 dopisane — claude — dwa uzupełnienia po BL-1446 w repo konsumenta:
  1. Test „guard: jest zadeklarowany w manifeście pre-commit" jest teraz
     **trwale nieaktualny**, nie tylko nieprzenośny. Konsument świadomie usunął
     oba guardy z `GUARD_MANIFEST`, bo kontrakt manifestu brzmi „guard jest
     ŚLEDZONYM plikiem w tym repo", a zainstalowana zależność tego nie spełnia.
     Ten test nie ma czego pilnować NIGDZIE — należy do klasy B (usunąć z
     powodem), a nie do klasy A.
  2. Ta sama klasa siedzi w ~20 liniach KOMENTARZY (`node backlog/scripts/…` w
     nagłówkach `scripts/*.mjs`). Nie oblewa niczego, więc nie blokuje tego
     taska, ale jest tą samą zaszytą wiedzą o cudzym drzewie. Jedno wystąpienie
     było **user-facing** — komunikat guardu boardów kazał uruchomić ścieżkę,
     która u konsumenta nie istnieje; poprawione od ręki, reszta zostaje.

- 2026-08-30 created — claude — znalezione przy pierwszym uruchomieniu suity po wydzieleniu repo (BL-1445); 14/226 oblanych, dwie klasy: ko-lokacja w testach i asercje o cudzym projekcie
