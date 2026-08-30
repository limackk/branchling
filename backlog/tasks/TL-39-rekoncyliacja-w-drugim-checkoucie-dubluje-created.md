---
id: TL-39
title: "Rekoncyliacja w drugim checkoucie dubluje __created__"
type: bug
labels: []
board: main
epic: "Historia i atrybucja"
priority: P2
status: done
owner: claude
estimate: 4h
confidence: medium
created: 2026-08-30
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-field-editing-history.md
  - docs/worktrail-state-and-sync.md
verification:
  - bash: "node --test scripts/tests/history-duplicate-created.test.mjs"
---

## Cel

Jedno założenie taska ma produkować **jeden** wpis `__created__`, niezależnie od
tego, ilu obserwatorów zobaczy plik. Dziś produkuje po jednym na obserwatora.

## Kontekst

Zaobserwowane dwukrotnie 2026-08-30 przy pracy w worktree'ach (TL-33, BL-1445).
Przebieg jest zawsze ten sam:

1. Task powstaje w worktree; hook zapisuje `__created__` z `actor: agent:claude`,
   `source: hook` i ULID-em **A**.
2. Ten sam task pojawia się w głównym checkoucie po merge'u albo po przebudowie
   widoków. Rekoncyliacja porównuje frontmatter ze swoim snapshotem, widzi task,
   którego wcześniej nie było, i zapisuje **drugie** `__created__` — z `actor:
   unknown`, `source: external` i ULID-em **B**.

Dedup w `readHistory()` idzie po `id`, a ULID-y są różne, więc oba zostają.
Historia twierdzi, że task założono dwa razy — raz przez agenta, raz przez nikogo.

**Dlaczego to nie jest kosmetyka.** `__created__` jest zdarzeniem taska, więc dwa
takie wpisy psują każdą metrykę liczącą założenia (lead time, throughput, przyszła
kalibracja z `backlog-time-tracking.md`). Przy dwóch obserwatorach to jeden
duplikat; przy siedmiu worktree'ach — sześć.

**To NIE jest to samo, co przypadek komplementarny.** Przy TL-33 dwie kopie logu
były różnymi zdarzeniami (`__created__` w jednej, `status`+`owner` w drugiej) i
unia była poprawna. Tutaj oba wiersze opisują JEDNO zdarzenie. Rozstrzygnięcie
musi umieć odróżnić te dwa przypadki, a nie scalać wszystkiego albo odrzucać
wszystko.

**Dlaczego dedup po ULID nie wystarcza.** ULID identyfikuje ZAPIS, nie ZDARZENIE.
Dwa zapisy o tym samym zdarzeniu mają różne ULID-y z definicji.

## Pre-flight reading

1. `docs/backlog-field-editing-history.md` §2 (kształt wpisu), §4 (czego mechanizm
   nie gwarantuje) — sprawdzić, czy ta klasa jest tam już nazwana.
2. `docs/worktrail-state-and-sync.md` §5.1 (kto wygrywa przy rozjeździe per klasa
   pola) — `__created__` jest pseudo-polem i może wymagać własnej reguły.
3. `scripts/history.mjs` — `reconcile()`, `readHistory()`, dedup po `id`.

## Kroki

1. Odtworzyć w teście: dwa checkouty tego samego repo, task założony w jednym,
   rekoncyliacja uruchomiona w drugim. Red-first.
2. Rozstrzygnąć regułę i **zapisać ją w dokumencie**, nie tylko w kodzie. Kandydaci:
   - `__created__` jest **idempotentne per task** — istnieje najwyżej jedno; drugie
     jest pomijane przy zapisie (rekoncyliacja pyta log, nie tylko snapshot);
   - albo dedup po kluczu **zdarzenia** (`task` + `field` + `to`) dla pseudo-pól,
     obok deduplikacji po `id` dla zwykłych zmian.
3. Rozstrzygnąć, **który wpis wygrywa**, gdy oba już istnieją: lepiej przypisany
   (`agent:`/`user:` bije `unknown`), a przy remisie wcześniejszy ULID. Cichy
   wybór „ostatni zapis" byłby tu najgorszy — zwykle to ten z `unknown`.
4. Napisać migrację dla logów, które już mają duplikaty (w tym repo: TL-33,
   BL-1445), albo świadomie ich nie ruszać i zapisać dlaczego.
5. Sprawdzić, czy ta sama ścieżka nie dubluje `__deleted__`.

## Acceptance criteria

- [x] Dwa checkouty, jedno założenie taska → **jeden** wpis `__created__`. Test.
- [x] Reguła (idempotencja albo klucz zdarzenia) zapisana w
      `docs/backlog-field-editing-history.md`, nie tylko w kodzie.
- [x] Przy istniejącym duplikacie wygrywa wpis lepiej przypisany — test na parze
      `agent:claude` vs `unknown`.
- [x] `__deleted__` sprawdzone pod tym samym kątem.
- [x] Zwykłe zmiany pól **nadal** deduplikują się po `id` i nie są scalane po
      wartości — dwa realne przejścia `pending → in_progress` w różnym czasie to
      dwa zdarzenia, nie jedno. Test negatywny.
- [x] Istniejące duplikaty w tym repo: naprawione albo świadomie zostawione z
      powodem w `## Log`.

## Verification

```bash
# expected: pass, w tym przypadek dwóch checkoutów
node --test scripts/tests/history-duplicate-created.test.mjs

# Ile duplikatów jest dziś w tym repo — expected: liczba do wpisania w ## Log
node -e 'import("./scripts/history.mjs").then(m=>{const h=m.readAllHistory("backlog");
  for(const [id,es] of Object.entries(h)){const c=es.filter(e=>e.field==="__created__");
  if(c.length>1)console.log(id, c.length, c.map(e=>e.actor).join(" + "));}})'
```

## Notes

- Znalezione ręcznie przy scalaniu gałęzi, nie przez test — czyli mechanizm nie ma
  dziś żadnej bramki na tę klasę.
- Powiązane z `docs/worktrail-state-and-sync.md`: kierunek rekoncyliacji jest tam
  jeszcze projektem, więc rozstrzygnięcie tutaj nie powinno zamykać tamtej drogi.

## Log

- 2026-08-31 done — claude — commit poniżej. **Reguła z kroku 2 wyszła inna, niż proponował task**, i to na dwóch punktach. (a) Klucz `task+field+to` NIE wystarcza: przy `__created__` wartością `to` jest tytuł, więc rename między jednym obserwatorem a drugim przepuściłby duplikat — kluczem jest samo zdarzenie. (b) „`__created__` idempotentne per task" jest ZA MOCNE: task skasowany i założony ponownie ma dwa prawdziwe założenia. Reguła końcowa: duplikatem jest powtórzenie, które nie zmienia stanu — sąsiadujące w czasie wpisy tego samego rodzaju, bez zdarzenia przeciwnego pomiędzy. Warstwa siedzi w `readHistory()`, więc obejmuje wszystkich czytelników (viewer, serwer, `readAllHistory`) jednym miejscem, i **nie przepisuje plików** — log zostaje append-only.

- 2026-08-31 pomiar — claude — duplikatów DZIŚ: **0** w obu repozytoriach (71 logów u konsumenta, 20 w narzędziu). To nie znaczy, że buga nie było: TL-33/1445/1446 rozstrzygnięto ręcznie tą samą regułą, którą teraz egzekwuje kod. Krok 4 (migracja) jest więc bezprzedmiotowy i świadomie NIE napisany — nie ma czego migrować, a martwy skrypt migracyjny to dług.

- 2026-08-31 przyczyna zawężona — claude — bramka z TL-17 (rekoncyliacja pyta historię przed zapisem) **istnieje i działa**; trzecie wystąpienie zdarzyło się po niej, bo zabrakło jej PRZESŁANKI: `.md` przyjechał gitem, `.jsonl` nie. Zmierzone u konsumenta: **28 z 71 logów historii nieśledzonych**. Stąd druga warstwa przy odczycie — bramka na zapisie nie może być jedyną obroną, skoro jej dane podróżują innym kanałem niż task. Droga dostarczenia logu wydzielona do TL-43.

- 2026-08-31 krok 5 — claude — `__deleted__` dublował się tą samą drogą i **nie miał nawet bramki z TL-17**: pętla kasowania pisała wprost, bez pytania historii. Dołożone symetrycznie. Przy okazji naprawiony przeciwny błąd, którego nikt nie zgłaszał: warunek „pusta historia = nowy task" sprawiał, że ponowne założenie po skasowaniu nie trafiało do historii NIGDY. Ma teraz test.

- 2026-08-31 kontrola pozytywna — claude — na prawdziwych danych konsumenta reguła nic nie zjada (140 wierszy → 140 wpisów), ale to wynik zerowy, więc osobno na KOPII logu `BL-1446` doklejone drugie `__created__`: 4 wiersze → 3 wpisy, ocalał ten z `agent:claude`/`hook`. Bez tego drugiego przebiegu „nic nie zniknęło" byłoby nieodróżnialne od martwej reguły.

- 2026-08-31 in_progress — claude — 11 testów, red-first: 8 czerwonych z właściwego powodu, 3 kontrole negatywne zielone od początku (mają takie zostać). Suita 263/263.`.

- 2026-08-30 trzecie wystąpienie — claude — przy BL-1446 w repo konsumenta, i tym razem **bez żadnego merge'a**: task założony w worktree (hook: `agent:claude`/`hook`, ULID …37N2X), zwykły `build` w głównym checkoucie dopisał drugie `__created__` (`unknown`/`external`, ULID …38WW8) 41 sekund później. To zawęża przyczynę — wystarczy DRUGI OBSERWATOR tego samego pliku, scalanie nie jest potrzebne. Rozstrzygnięte ręcznie regułą z kroku 3 (wygrywa lepiej przypisany), co potwierdza, że reguła jest wykonalna, ale też że dziś nikt jej nie egzekwuje poza człowiekiem.

- 2026-08-30 created — claude — zaobserwowane dwukrotnie tego dnia (TL-33, BL-1445) przy scalaniu worktree do głównego checkoutu; dedup po ULID tego nie łapie, bo ULID identyfikuje ZAPIS, nie ZDARZENIE
