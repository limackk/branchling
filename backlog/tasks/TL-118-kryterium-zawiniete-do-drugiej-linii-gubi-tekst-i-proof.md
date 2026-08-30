---
id: TL-118
title: "Kryterium zawinięte do drugiej linii gubi tekst i [proof:]"
type: task
labels: []
board: main
epic: "Integralność danych"
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
estimate: 2h
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: wrapped
    bash: "node --test scripts/tests/criteria-mapping.test.mjs"
  - id: tree
    bash: "node scripts/cli.mjs check --criteria"
---

## Cel

Kryterium akceptacyjne zawinięte do kolejnej linii ma być czytane w CAŁOŚCI —
razem z `[proof: <id>]`, który stoi na jej końcu. Dziś parser widzi wyłącznie
pierwszą linię, więc reszta zdania i link do dowodu znikają bez słowa.

## Kontekst

Zmierzone przy TL-87. Task miał osiem kryteriów, wszystkie z `[proof: suite]`;
`worktrail done --dry-run` odhaczył PIĘĆ i zgłosił „3 criteria name no proof".
Trzy niedohaczone to dokładnie te, które zawijały się do drugiej linii —
markerów na tych liniach nikt nie przeczytał. Obejście w TL-87 było jedno:
zwinąć te trzy kryteria do jednej długiej linii.

Dlaczego to nie jest kosmetyka:

1. **`check --criteria` mówi nieprawdę o cudzym drzewie.** Zgłasza „criterion
   with no proof" dla kryterium, które dowód nazywa — i pod `criteria_links:
   require` OBLAŁBY task poprawnie napisany. Guard, który oblewa na poprawnych
   danych, uczy wyłączania guardu.
2. **Tekst kryterium jest obcinany w raportach.** `parseCriteria` zwraca tylko
   pierwszą linię, więc komunikat cytuje pół zdania (widać to w wyjściu
   `check` dla kilkunastu tasków w tym repozytorium).
3. **Zawijanie jest tu NORMĄ, nie wyjątkiem.** Prawie każdy starszy task w
   `backlog/tasks/` łamie kryteria na 80 kolumn — czyli defekt dotyczy
   większości drzewa, a nie jednego pliku.

Rozstrzygnięcia do podjęcia w tasku, nie z góry:

- **Co kończy kryterium.** Naturalna reguła: linie wcięte, które NIE zaczynają
  nowego elementu listy (`- [ ]`) ani nowej sekcji, należą do poprzedniego
  kryterium. To ta sama zasada, którą `setFrontmatterField` stosuje do
  wieloliniowych pól frontmattera — warto sprawdzić, czy da się ją opisać raz.
- **Gdzie może stać `[proof:]`** — na końcu OSTATNIEJ linii kryterium (tak
  pisze człowiek) czy na dowolnej? Jedno miejsce jest łatwiejsze do
  wytłumaczenia i do napisania; dwa nie dają nic poza dwuznacznością.
- **`applyProofs` odhacza po numerze linii** (`c.line`). Po zmianie linia
  kryterium przestaje być jego jedyną linią — trzeba sprawdzić, czy odhaczanie
  trafia w linię z `- [ ]`, a nie w kontynuację.

## Pre-flight reading

1. `scripts/criteria.mjs` — `parseCriteria()` i `applyProofs()`; obie funkcje
   zakładają „jedno kryterium = jedna linia".
2. `scripts/tests/criteria-mapping.test.mjs` — istniejące testy mapowania; tam
   dokłada się przypadek zawinięty.
3. `backlog/tasks/TL-87-*.md` — trzy kryteria zwinięte do jednej linii jako
   obejście; po naprawie można je rozwinąć z powrotem.

## Kroki

1. Test NAJPIERW: kryterium zawinięte do dwóch i do trzech linii, z `[proof:]`
   na końcu ostatniej. Ma oblewać na dzisiejszym kodzie.
2. `parseCriteria`: sklej kontynuacje w jeden tekst, zapamiętaj linię
   NAGŁÓWKOWĄ elementu do odhaczania.
3. `applyProofs`: odhacz w linii z `- [ ]`, nie w kontynuacji.
4. Sprawdź `check --criteria` na tym drzewie — liczba tasków „not linked yet"
   ma się zmienić tylko tam, gdzie link faktycznie był napisany.
5. Rozwiń z powrotem trzy kryteria w TL-87 (obejście przestaje być potrzebne).

## Acceptance criteria

- [ ] Kryterium zawinięte do dwóch linii z `[proof: x]` na końcu jest odhaczane przez `done`. [proof: wrapped]
- [ ] Tekst kryterium w raporcie `check --criteria` obejmuje wszystkie jego linie, nie pierwszą. [proof: wrapped]
- [ ] Kontrola pozytywna: kryterium zawinięte BEZ `[proof:]` nadal jest zgłaszane jako niepowiązane. [proof: wrapped]
- [ ] Odhaczenie ląduje w linii z `- [ ]`, a plik poza tym znakiem nie zmienia się bajtowo. [proof: wrapped]
- [ ] `check --criteria` na tym repozytorium przechodzi. [proof: tree]

