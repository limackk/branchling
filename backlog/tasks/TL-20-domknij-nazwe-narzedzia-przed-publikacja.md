---
id: TL-20
title: Domknij nazwę narzędzia przed publikacją open source
type: code
labels: [post-launch]
board: main
epic: "Backlog — publikacja open source"
priority: P3
status: done
owner: founder
estimate: 30m
confidence: medium
created: 2026-08-29
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-config-and-portability.md
  - backlog/README.md
verification:
  - bash: "curl -s -o /dev/null -w '%{http_code}' https://registry.npmjs.org/tasklog   # 404 = nazwa nadal wolna"
  - manual: "Nazwa potwierdzona ALBO zmieniona wszędzie: scripts/tasklog, package.json, README §2.1, alias w ~/.zshrc"
---

## Cel

`tasklog` jest nazwą **wstępną**, przyjętą 2026-08-29 na czas dalszej pracy. Przed publikacją trzeba ją albo potwierdzić, albo zmienić — a im dłużej żyje, tym drożej się ją zmienia (README, aliasy, skille, ewentualne linki z zewnątrz).

## Kontekst

Nazwa `backlog` odpadła nie z powodu gustu, tylko dwóch faktów zmierzonych 2026-08-29 na `registry.npmjs.org`:

- `backlog` — zajęte (v1.4.56, publikacja 2026-05-10), binarka **`backlog`**,
- `backlog.md` — zajęte (v1.50.1, publikacja 2026-08-10), binarka **`backlog`**,
- `backlog-cli` — zajęte (v0.2.0, martwe od 2014), binarka `backlog`.

Czyli: kto zainstaluje [Backlog.md](https://github.com/MrLesk/Backlog.md), temu komenda `backlog` przestaje znaczyć to, co dziś.

Sprawdzone alternatywy (npm / kolizja w PATH / organizacja na GitHubie):

| Kandydat | npm | PATH | github.com/&lt;nazwa&gt; |
|---|---|---|---|
| **tasklog** (wybrany wstępnie) | wolne | wolne | zajęte (konto) |
| taskledger | wolne | wolne | wolne |
| git-backlog | wolne | wolne | — (daje `git backlog …`) |
| backlogit | wolne | wolne | wolne |
| worktrail / tasktrail | wolne | wolne | zajęte / — |
| ~~kanri~~ | wolne | wolne | zajęte | ODPADA: kanriapp/kanri to kanban z ~2000 ★, ta sama półka |

Półka jest tłoczna i rośnie: poza Backlog.md na npm siedzą `mdtask` (2026-06) i `taskmd` (2026-03) — obie „markdown tasks w gicie".

## Kroki

1. Zdecyduj: zostaje `tasklog`, czy wchodzi `taskledger` / `git-backlog` / inna.
2. Sprawdź ponownie dostępność (nazwy bywają zajmowane w międzyczasie) — komenda w `verification`.
3. Jeśli zostaje: rozważ rezerwację nazwy na npm (publikacja pustego pakietu 0.0.1 albo scope `@<nick>/tasklog`). To działanie NA ZEWNĄTRZ — decyduje founder.
4. Jeśli się zmienia: `scripts/tasklog`, `package.json`, README §2.1, alias w `~/.zshrc`, ten task.
5. ~~Po domknięciu: skasuj `scripts/backlog`.~~ Zrobione 2026-08-29 na decyzję foundera („chcę wymusić nawyk") — razem z `npm run backlog` i aliasem `backlog` w `~/.zshrc`. Jeśli nazwa się jeszcze zmieni, nie ma alias-warstwy do posprzątania.

## Acceptance criteria

- [x] Nazwa **POTWIERDZONA** — zostaje `tasklog` (decyzja foundera 2026-08-30). Cztery miejsca z kroku 4 już ją niosą, więc potwierdzenie nie wymagało zmian.
- [x] Dostępność sprawdzona PONOWNIE w dniu decyzji: `npm view tasklog` → **E404, nazwa wolna** (2026-08-30).
- [x] Rozstrzygnięte, czy `scripts/backlog` zostaje — **usunięty** (2026-08-29), jedna nazwa, jedno wejście.

## Notes

Nazwa binarki jest ważniejsza niż nazwa pakietu: pakiet da się wydać jako scoped (`@nick/cokolwiek`) i problem znika, ale komenda w `PATH` musi być wolna u KAŻDEGO użytkownika.

## Log

- 2026-08-29 created — claude — przyjęto `tasklog` jako nazwę wstępną, założono task na domknięcie
- 2026-08-29 — claude — na decyzję foundera usunięto alias zgodności: `scripts/backlog`, `npm run backlog` i alias `backlog` w `~/.zshrc`. `tasklog` jest jedynym wejściem.
- 2026-08-30 — claude — na polecenie foundera przepięty z epiku „Backlog viewer" (relikt — nazwa narzędzia nie jest sprawą viewera) do „Backlog — publikacja open source", razem z [TL-32](TL-32-angielska-powierzchnia-publiczna-modulu.md). Oba są blokerami publikacji i żaden nie blokuje drugiego.
- 2026-08-30 — claude — **decyzja foundera: zostaje `tasklog`.** Dostępność zweryfikowana ponownie tego dnia (`npm view tasklog` → E404). Nazwa wchodzi do `package.json` i `bin/` w [TL-33](TL-33-packaging-instalacja-globalna-i-npx.md) oraz do katalogu domowego w [TL-34](TL-34-katalog-domowy-preferencje-i-rejestr-projektow.md). **Zostaje otwarte działanie zewnętrzne:** rezerwacja nazwy na npm (krok 3) — nie jest warunkiem tego taska, ale dopóki nie nastąpi, nazwę może zająć ktoś inny. Decyzja i wykonanie należą do foundera.
- 2026-09-01 — agent:claude — **DECYZJA ODWRÓCONA: `tasklog` → `worktrail`.** Powód nie jest gustowny, tylko ten sam co przy odpadnięciu `backlog`: półka jest tłoczna, a `tasklog` nie odróżnia się od `mdtask` / `taskmd` / Backlog.md ani brzmieniem, ani obietnicą. `worktrail` był już na liście z 2026-08-29 (wiersz „worktrail / tasktrail") i przegrał wtedy tylko zajętym kontem na GitHubie — a Notes tego taska same mówią, że **nazwa binarki waży więcej niż konto czy nazwa pakietu**. Dostępność sprawdzona ponownie 2026-09-01: `registry.npmjs.org/worktrail` → **404, wolne**; GitHub: 17 luźnych trafień, żadnego aktywnego narzędzia na tej półce. Odrzucone tego dnia: `taskvault` (240 trafień, w tym pluginy Obsidiana), `gitask` (51, generyczne), `donefile` (najczystsze — 2 trafienia — ale sugeruje POJEDYNCZY plik, a backlog to katalog).
  **Ten task NIE wraca do `todo`.** Zamknął pytanie „czy `tasklog` jest domknięty przed publikacją" i odpowiedź brzmiała „tak" — to się nie cofnęło. Odwrócenie jest nową decyzją, nie niedokończoną starą, więc jedzie w [TL-117](TL-117-nazwa-produktu-z-jednej-stalej-a-nie-z-literalu.md) razem z długiem, który ta zmiana ujawniła.
  **Treść powyżej celowo mówi `tasklog`** — jest zapisem decyzji z 2026-08-30 i przepisanie jej byłoby fałszowaniem rekordu. Poza tym plikiem obowiązuje `worktrail`.
  **Nadal otwarte to samo działanie zewnętrzne:** rezerwacja nazwy na npm. Ryzyko wzrosło, nie spadło — nazwa jest świeżo wybrana i niezarezerwowana.
