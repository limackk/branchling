---
id: TL-111
title: "migrate-prefix zostawia historię pod starym ID"
type: task
labels: []
board: main
epic: ""
priority: P1
status: done
owner: agent:claude
estimate: 2h
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs: []
verification:                      # JAK sprawdzić, że task naprawdę jest zrobiony
  - bash: "node --test scripts/tests/migrate-prefix-history.test.mjs"
  - bash: "node --test scripts/tests/history.test.mjs"
---

## Cel

Po `worktrail migrate-prefix` żaden task nie ma w historii rekordu mówiącego, że
został skasowany. Dziś ma je KAŻDY: migracja `BL-` → `TL-` w tym repozytorium
wyprodukowała 42 pliki `history/BL-*.jsonl`, każdy z jednym rekordem
`__deleted__`, oraz komplet rekordów `__created__` na nowych ID. Historia
mówiła, że cały backlog skasowano i założono od nowa tego samego dnia.

Gdy task jest zrobiony, migracja prefiksu jest dla historii RENAME, nie parą
skasowanie+utworzenie.

## Kontekst

Znalezione 2026-09-01 przy porządkowaniu working tree: 42 nieśledzone pliki
`backlog/history/BL-*.jsonl`, wszystkie z jednym rekordem, wszystkie
`{"field":"__deleted__","actor":"unknown","source":"boot"}`, wszystkie ze
znacznikiem czasu `2026-09-01T07:13:34.277Z` — jeden przebieg reconcile.
Pliki zostały skasowane (nie niosły żadnej historii poza nagrobkiem; prawdziwa
historia każdego taska jest w bliźniaku `TL-*`, który jest w repo). Ten task
usuwa PRZYCZYNĘ, żeby następna migracja ich nie odtworzyła.

**Przyczyna.** `scripts/migrate-prefix.mjs` przemianowuje starannie cztery
rzeczy (patrz komentarz na górze pliku): plik taska, `id:` we frontmatterze,
`blocked_by`/`blocks`, plik `history/<ID>.jsonl` wraz z polem `task` w środku
oraz `task_id_prefix` w config.yaml. Nie dotyka **piątej**:
`history/.snapshot.json` — `grep snapshot scripts/migrate-prefix.mjs` nie ma
ani jednego trafienia. Snapshot to „ostatnio widziany frontmatter każdego
taska", klucz = ID taska. Po migracji snapshot trzyma 74 klucze `BL-*`, a
drzewo ma 74 taski `TL-*`. Najbliższy reconcile (`source: "boot"`) porównuje
jedno z drugim i uczciwie melduje 74 zniknięcia i 74 nowe taski — robi dokładnie
to, do czego został napisany. Wada jest w migracji, która zostawiła mu
nieaktualny punkt odniesienia.

**Dlaczego to nie jest kosmetyka.** Historia pól jest wersjonowana i ma regułę
`merge=union` (`scripts/git-rules.mjs`); nagrobki wjeżdżają do repo i zostają.
TL-28–TL-31 budują na tej historii łańcuch atrybucji i kalibrację estymat
z danych rzeczywistych — dane, w których każdy task „powstał" w dniu migracji,
zafałszują każdy wyliczony z nich wiek i tempo.

**Druga wada, przy okazji.** Jeden z nagrobków miał ID
`BL-1417-domknij-walidacje-flag-w-5` — czyli klucz w snapshocie powstał
z NAZWY PLIKU (numer + slug ucięty na `-5`), a nie z pola `id:` we
frontmatterze. Task `TL-25` istnieje i ma własną, poprawną historię.
Sprawdzić, gdzie klucz snapshotu jest liczony z nazwy pliku, i czy nie jest to
osobna klasa błędu wymagająca własnego taska.

**Rozstrzygnięcie do podjęcia w trakcie.** Snapshot jest gitignorowany
(`IGNORE_RULES` w `git-rules.mjs`), więc przepisanie go w klonie, który
wykonuje migrację, nie pomaga KLONOWI OBOK: on pociągnie drzewo `TL-*`,
porówna z własnym snapshotem `BL-*` i wyprodukuje te same 74 nagrobki.
Do wyboru:

- **(a)** `migrate-prefix` przepisuje klucze lokalnego snapshotu — konieczne
  minimum, nie wystarcza dla innych klonów;
- **(b)** reconcile rozpoznaje HURTOWY rename (znikło ID `X-N`, pojawiło się
  `Y-N` o tym samym numerze i tej samej treści) i zapisuje rename zamiast
  pary skasowanie+utworzenie — działa w każdym klonie, ale to zgadywanie,
  a `history.mjs` deklaruje „uczciwość zamiast zgadywania";
- **(c)** migracja zostawia w repo jawny, wersjonowany zapis „prefiks zmienił
  się z X na Y w tym momencie", a reconcile go czyta — jawne, działa w każdym
  klonie, ale dokłada plik do formatu danych.

Rekomendacja: **(a) + (c)** — (a) naprawia klon migrujący natychmiast,
(c) daje pozostałym FAKT do odczytania zamiast heurystyki. Decyzję zapisać
w komentarzu przy implementacji, bo to wybór, nie oczywistość.

## Pre-flight reading

1. `scripts/migrate-prefix.mjs` — komentarz na górze wylicza, co migracja
   przemianowuje; to lista, do której dochodzi snapshot.
2. `scripts/history.mjs` — `snapshotPath`, `loadSnapshot`, `saveSnapshot`
   i `reconcile()`; szczególnie komentarze przy `__created__`/`__deleted__`
   (linie ~144 i ~390) — one tłumaczą, dlaczego reconcile zachował się
   poprawnie.
3. `scripts/git-rules.mjs` — `IGNORE_RULES` (snapshot ignorowany) i
   `ATTRIBUTE_RULES` (`history/*.jsonl merge=union`); to one przesądzają,
   że nagrobki są trwałe, a snapshot lokalny.
4. `scripts/tests/history.test.mjs` i `scripts/tests/id-prefix.test.mjs` —
   wzorce testów obu obszarów.
5. `scripts/tests/_repo.mjs` — katalog backlogu ZAWSZE stąd.

## Kroki

1. Odtwórz wadę w teście: fixture z taskami `BL-*`, historią i snapshotem →
   `migrate-prefix --to TL` → reconcile → asercja, że NIE powstał żaden
   rekord `__deleted__` ani `__created__`. Ten test ma dziś OBLEWAĆ.
2. Zaimplementuj (a): `migrate-prefix` przepisuje klucze `.snapshot.json`
   razem z resztą planu renames — w tej samej transakcji, żeby przerwana
   migracja nie zostawiła snapshotu rozjechanego z drzewem (plik już dba
   o kolejność: najpierw walidacja, potem zapisy).
3. Rozstrzygnij i zaimplementuj (c) albo świadomie odrzuć — decyzję zapisz
   w komentarzu w kodzie wraz z powodem.
4. Sprawdź, czy `--dry-run` mówi o snapshocie tak samo jak o pozostałych
   plikach (migracja ma być przewidywalna przed uruchomieniem).
5. Zbadaj drugą wadę: skąd klucz snapshotu
   `BL-1417-domknij-walidacje-flag-w-5`. Jeśli to osobna klasa błędu —
   załóż osobny task i zlinkuj tutaj w `blocks`.
6. Uzupełnij `doctor` albo `check` o wykrycie rozjazdu snapshot↔drzewo, jeśli
   okaże się tani — nagrobki powinny być zauważone przez narzędzie, nie przez
   człowieka czytającego `git status`.

## Acceptance criteria

- [x] `node --test scripts/tests/migrate-prefix-history.test.mjs` zielone,
      z kontrolą pozytywną (test oblewa na kodzie sprzed poprawki).
- [x] Po migracji na fixture reconcile nie produkuje ANI JEDNEGO rekordu
      `__deleted__` / `__created__`.
- [x] Po migracji w `history/` nie zostaje żaden plik pod starym prefiksem.
- [x] `.snapshot.json` po migracji ma klucze wyłącznie pod nowym prefiksem.
- [x] `--dry-run` wymienia snapshot wśród plików, które zostaną zmienione.
- [x] Wybór między (b) a (c) rozstrzygnięty i uzasadniony w komentarzu w kodzie.
- [x] `node --test scripts/tests/*.test.mjs` bez regresji;
      `worktrail check` zielone.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

2026-09-01 pending — agent:claude — założony po znalezieniu 42 nagrobków
`history/BL-*.jsonl` z migracji BL→TL. Pliki skasowane (same nagrobki, zero
historii); ten task usuwa przyczynę. Przyczyna ustalona: migracja nie
przepisuje `history/.snapshot.json`.
