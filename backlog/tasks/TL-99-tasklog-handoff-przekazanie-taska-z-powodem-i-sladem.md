---
id: TL-99
title: "worktrail handoff — przekazanie taska z powodem i sladem"
type: task
labels: []
board: main
epic: "Wyróżniki agentowe"
priority: P1
status: done
owner: agent:claude
estimate: 4h
confidence: medium
created: 2026-08-31
updated: 2026-09-01
blocked_by: [TL-87, TL-97]
blocks: [TL-114]
related_docs:
  - docs/backlog-field-editing-history.md
  - docs/worktrail-state-and-sync.md
verification:
  - id: handoff
    bash: "node --test scripts/tests/handoff.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Cel

`worktrail handoff TL-NNNN --to-role analyst --reason "…" --actor agent:claude`
przekazuje task innej roli: zmienia `role:` (i zeruje `owner` na
`unassigned`), zdejmuje lock bieżącej sesji, zapisuje powód jako zdarzenie
komentarza oraz linię w `## Log` taska. Task wraca do kolejki i czeka na
wykonawcę docelowej roli.

Scenariusz docelowy: agent-developer trafia na decyzję poza swoim mandatem,
oddaje task analitykowi z pytaniem; analityk (agent albo człowiek) zapisuje
decyzję i oddaje z powrotem. Cała wymiana — kto pytał, kto zdecydował, kiedy
— jest w tasku i w historii, nie w scrollbacku sesji.

## Kontekst

Powstało z decyzji o rolach subagentów (2026-08-31). Handoff jest komendą
złożoną z istniejących prymitywów: zmiana pól przez `task-fields.mjs`,
zdarzenia przez `history.mjs`, lock z TL-87. Nowe jest tylko jedno:
**pierwsze użycie zarezerwowanego typu zdarzenia `__comment__`**
([worktrail-state-and-sync.md](../../docs/worktrail-state-and-sync.md) §7 pkt 5,
`PSEUDO_FIELDS` w `task-fields.mjs`) — powód przekazania jest komentarzem,
nie zmianą pola, i jak komentarze jest append-only i bezkonfliktowy (§5.1
tamtego dokumentu). Implementacja `__comment__` ma być na tyle ogólna, żeby
przyszłe komentarze (viewer, osoby nietechniczne) użyły jej bez zmian —
ale UI komentarzy jest POZA zakresem tego taska.

Decyzje:
- **`--reason` jest obowiązkowy.** Przekazanie bez powodu to dla odbiorcy
  task bez kontekstu — dokładnie ta klasa, co `blocked` z pustym
  `blocked_by`.
- **Handoff nie zmienia statusu.** Task wraca do `pending` tylko jeśli był
  `in_progress` u przekazującego (bo przestaje być w toku); `blocked`
  zostaje `blocked`. Żadnych nowych statusów — role nie są workflow.
- **`--to-role` waliduje słownik** (TL-97); `--to-owner` jako wariant
  przekazania konkretnej osobie w ramach tej samej roli.
- Viewer pokazuje zdarzenia `__comment__` w osi historii taska (rendering
  listy zdarzeń już istnieje; komentarz to nowy rodzaj wiersza, nie nowy
  mechanizm).

## Pre-flight reading

- [docs/backlog-field-editing-history.md](../../docs/backlog-field-editing-history.md)
  §2 — pseudo-pola, reguły dedupu; komentarz musi się w nie wpisać.
- [docs/worktrail-state-and-sync.md](../../docs/worktrail-state-and-sync.md)
  §5.1–§5.2 — komentarze jako klasa append-only, bezkonfliktowa.
- `scripts/task-fields.mjs` — `PSEUDO_FIELDS`; `scripts/history.mjs` —
  zapis i odczyt zdarzeń.
- `backlog/tasks/TL-87-worktrail-next-atomowy-przydzial-taska-dla-agenta.md`
  — kontrakt locka, który handoff zdejmuje.

## Kroki

1. Zdarzenie `__comment__`: zapis przez `history.mjs` (task, treść, aktor,
   ULID), odczyt i render w viewerze przy osi historii; dedup po `id` jak
   zwykłe zdarzenia (komentarz nie podlega regule dedupu `__created__`,
   bo dwa identyczne komentarze w różnym czasie to dwa zdarzenia).
2. Komenda `handoff`: walidacja roli/ownera, zmiana pól jedną istniejącą
   drogą zapisu, zdjęcie locka sesji, komentarz z powodem, linia w `## Log`
   pliku taska, `build`.
3. Kody wyjścia i komunikaty: brak `--reason` = błąd wywołania; task
   nieistniejący / rola spoza słownika = jak wszędzie.
4. Testy: pełny handoff (pola + lock + komentarz + log), handoff taska bez
   locka (działa — przekazać można też task wzięty ręcznie), brak reason
   oblewa, `blocked` zostaje `blocked`.

## Acceptance criteria

Każde kryterium w JEDNEJ linii: zawinięte do drugiej gubi tekst i `[proof:]`
u dzisiejszego parsera (TL-118).

- [x] Handoff zmienia `role`, czyści `owner`, zdejmuje lock. [proof: handoff]
- [x] W historii zostaje `__comment__` z powodem, aktorem i własnym id. [proof: handoff]
- [x] `handoff` bez `--reason` kończy się kodem 2 i NIC nie zapisuje. [proof: handoff]
- [x] Rola spoza słownika oblewa przed jakimkolwiek zapisem. [proof: handoff]
- [x] Backlog bez `roles:` mówi, gdzie je zadeklarować. [proof: handoff]
- [x] Dwa identyczne komentarze w różnym czasie zostają dwoma zdarzeniami. [proof: handoff]
- [x] Wiersz wstawiony dwa razy przez union-merge zostaje jednym. [proof: handoff]
- [x] Viewer niesie treść komentarza i renderuje ją regułą `historyEntryKind()`. [proof: handoff]
- [x] Przekazany task wraca do kolejki — `next` wydaje go ponownie. [proof: handoff]
- [x] `blocked` zostaje `blocked`; status wraca tam, skąd task został wzięty. [proof: handoff]
- [x] Suite zielona po zmianie kontraktu `owner`. [proof: suite-green]

Trzy rzeczy z pierwotnego brzmienia NIE są zrobione i to są decyzje, nie
przeoczenia:

- **Linia w sekcji `Log`.** Sekcja została zniesiona w TL-105 przy zerowej
  adopcji, a powód jedzie odtąd z ZAPISEM (pole `reason` rekordu). Dopisanie
  prozy byłoby drugą kopią tego, co historia już trzyma.
- **`next --role <docelowa>`.** Selekcja po roli należy WYŁĄCZNIE do TL-98
  („Zakres egzekwowania ról to wyłącznie ten task"), który czeka jeszcze na
  TL-96. Zrobiona jest połowa dająca się dziś zweryfikować: task wraca do
  kolejki i `next` wydaje go ponownie. Filtr po roli dojdzie tam.
- **`owner: unassigned`.** `unassigned` jest wartością CUDZEGO projektu
  (`owners:` w `config.yaml`), a nic w tym słowniku nie mówi, który wpis
  znaczy „nikt". Zamiast wpisywać to słowo z kodu, `owner` dostał
  `allowEmpty`: nieposiadany task to BRAK roszczenia — dashboard i tak już
  grupował go przez `!t.owner`.

Do czego status wraca, nie rozstrzyga słownik, tylko HISTORIA tego taska:
`take` zapisał przejście, którego handoff jest cofnięciem. Domyślna
konfiguracja zostawia DWA statusy znaczące „czeka na kogoś" (`pending`
i `blocked`), więc reguła czytająca sam `config.yaml` byłaby niejednoznaczna
w przypadku zwyczajnym, a nie brzegowym.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 blocked — agent:claude — task założony z decyzji o rolach;
  czeka na pole role (TL-97) i lock z next (TL-87). Pierwsze użycie
  zarezerwowanego `__comment__`.
- 2026-09-01 blocked — agent:claude — dopisany dependent TL-114 (zdarzenie
  `__decision__` buduje na implementacji `__comment__` z tego taska).
