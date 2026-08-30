---
id: TL-37
title: "Rozdziel dokumenty — mechanizm jedzie, pomiary zostają"
type: code
labels: [post-launch]
board: main
epic: "Backlog — publikacja open source"
priority: P3
status: pending
owner: unassigned
estimate: 4h
confidence: medium
created: 2026-08-30
updated: 2026-08-30
blocked_by: []
blocks: []
related_docs:
  - origin#docs/architecture/worktrail-extraction.md
verification:
  - bash: "test -z \"$(grep -rlniE 'origin|client-app|sync-layer|kamil|founder@' /Users/limack/workspace/tasklog/docs /Users/limack/workspace/tasklog/README.md 2>/dev/null)\" && echo 'zero kontekstu the origin project — OK'"
  - bash: "test -z \"$(grep -rnE '\\b(1[0-9]{3}|[0-9]{2})% commitów|1[0-9]{3} tasków|45 tasków' /Users/limack/workspace/tasklog/docs 2>/dev/null)\" && echo 'zero pomiarów z cudzego repo — OK'"
---

## Cel

Rozdzielić pięć dokumentów architektury na **dwie wersje dla dwóch czytelników**: w the origin project zostaje zapis „dlaczego MY tak zdecydowaliśmy" z pomiarami, do narzędzia jedzie „jak to działa i jak sprawdzisz to u siebie". Bez ani jednej danej o the origin project w nowym repozytorium.

## Kontekst

**Decyzja foundera 2026-08-30: żadnych informacji o the origin project w repo narzędzia.** Ten task realizował wcześniej wariant „zanonimizuj liczby i zabierz je" — został przepisany, bo tamten wariant był po prostu słabszy.

Powód warto zapisać, bo to samo pytanie wróci przy każdym kolejnym dokumencie:

> **Niesprawdzalny pomiar nie jest dowodem dla obcego czytelnika.** „78% commitów dotykało widoków" w repozytorium, do którego nikt nie ma dostępu, wymaga wiary w autora. Wewnątrz the origin project ta liczba BYŁA dowodem, bo każdy mógł ją przeliczyć. Na zewnątrz przestaje nim być — a nadal niesie informację o firmie. Najgorszy możliwy stosunek: zero zysku, niezerowy koszt.

Czytelnika open source przekonuje **mechanizm**, a jeszcze bardziej **komenda, którą sam odtworzy pomiar u siebie**. Dokument mówiący „`INDEX.yaml` jest agregatem wszystkich tasków, więc każda gałąź przepisuje ten sam plik — sprawdź: `git merge-tree` na dwóch gałęziach o rozłącznych taskach" jest mocniejszy niż ten podający wynik z cudzego drzewa.

To jest ta sama granica, którą moduł już zna z TL-19 — **kod zna kształt, konfiguracja zna wartości** — zastosowana do dokumentacji:

| | Trzyma | Gdzie |
|---|---|---|
| dokument narzędzia | mechanizm, decyzję, uzasadnienie, komendę do odtworzenia | `worktrail/docs/` |
| dokument the origin project | pomiary z datami, komendami i kontekstem | `origin/docs/architecture/` |

**Dokumenty w origin zostają NIETKNIĘTE.** To nasz zapis rozumowania i nie ma powodu go kaleczyć — ten task nie edytuje ani jednego pliku w origin.

Zakres NIE obejmuje tłumaczenia — to [TL-32](TL-32-angielska-powierzchnia-publiczna-modulu.md). Oba taski przepisują te same pliki, więc **sekwencyjnie, nie równolegle**.

## Pre-flight reading

1. `docs/architecture/worktrail-extraction.md` §6 — podział i trzy przykłady przepisania.
2. Pięć dokumentów w `docs/` nowego repo, w całości. Wycięcie liczby bez zrozumienia, czego dowodziła, kaleczy argument — a celem jest argument mocniejszy, nie krótszy.
3. `TL-32` — zakres językowy, żeby nie robić tej samej pracy dwa razy.

## Kroki

1. **Inwentarz przed edycją**: każde wystąpienie „the origin project", ścieżek `client-app/`, `origin-*`, the sync layer, nazwisk, adresów **oraz każdy pomiar** w `docs/` i `README.md` nowego repo. Lista jest kryterium kompletności na końcu.
2. Dla każdego pomiaru rozstrzygnąć, **czego dowodził**, i zastąpić go jedną z trzech form:
   - **mechanizm** — gdy liczba tylko ilustrowała regułę („agregat = każda gałąź przepisuje ten sam plik");
   - **komenda odtwarzająca** — gdy pomiar jest sprawdzalny u czytelnika (`git merge-tree`, `git log --name-only`, zliczenie własnych `in_progress`);
   - **ostrzeżenie warunkowe** — gdy liczba opisywała nasz przypadek, nie regułę („`in_progress` bywa stanem parkingowym — policz swoje, zanim zaufasz cycle time").
3. Ścieżki przykładowe → neutralne (`/path/to/repo`, `myproject/backlog`).
4. Odwołania do dokumentów, które **nie jadą** (`legal-and-compliance.md`, `repositories.md`, `worktrail-extraction.md`) — usunąć albo zastąpić opisem. Martwy link w publicznym repo to gorsza wizytówka niż jego brak.
5. Odwołania `BL-NNNN` **zostają** — to numery tasków narzędzia, które jadą razem z nim; `LINEAGE.md` wyjaśnia pochodzenie.
6. Guard `check-no-foreign-context.mjs` w nowym repo: oblewa na nazwach (`origin`, `client-app`, `sync-layer`, nazwiska) **i na wzorcach pomiarowych** („N% commitów", „N tasków"). Wpiąć w `worktrail check`.
7. Przejrzeć `LINEAGE.md`, README i commit inicjalny tym samym kryterium.
8. Przeczytać każdy przepisany dokument od nowa i sprawdzić, czy **argument nadal stoi**. Jeśli po wyjęciu liczby akapit nie ma czego bronić, akapit był o the origin project, a nie o narzędziu — wyciąć go w całości.

## Acceptance criteria

- [ ] `grep -rlniE 'origin|client-app|sync-layer|kamil|founder@'` po `docs/` i `README.md` nowego repo nie zwraca nic.
- [ ] Żaden pomiar z naszego repozytorium nie przetrwał — bramka wzorcowa w Verification plus przegląd inwentarza z kroku 1.
- [ ] Każdy usunięty pomiar zastąpiony mechanizmem, komendą albo ostrzeżeniem warunkowym — **żaden nie zniknął bez zamiennika**.
- [ ] Co najmniej trzy dokumenty zyskały komendę, którą czytelnik odtworzy pomiar u siebie.
- [ ] Żaden dokument nie linkuje do pliku, którego w nowym repo nie ma.
- [ ] **Dokumenty w origin nietknięte** — `git -C origin status docs/` czysty.
- [ ] Guard wpięty w `worktrail check`, z testem negatywnym na celowo wstawionej nazwie i na wzorcu pomiaru.
- [ ] `LINEAGE.md`, README i commit inicjalny przeszły ten sam przegląd.
- [ ] Nie kolidowało z TL-32 — jeden task skończony przed startem drugiego (zapisane w `## Log`).

## Verification

```bash
# 1. Zero kontekstu the origin project — expected: komunikat OK
test -z "$(grep -rlniE 'origin|client-app|sync-layer|kamil|founder@' \
  /Users/limack/workspace/tasklog/docs /Users/limack/workspace/tasklog/README.md 2>/dev/null)" \
  && echo 'zero kontekstu the origin project — OK'

# 2. Zero pomiarów z cudzego repo — expected: komunikat OK
test -z "$(grep -rnE '[0-9]+% commitów|1[0-9]{3} tasków|45 tasków' /Users/limack/workspace/tasklog/docs 2>/dev/null)" \
  && echo 'zero pomiarów z cudzego repo — OK'

# 3. Źródło nietknięte — expected: brak zmian
git -C /Users/limack/workspace/origin status --porcelain docs/

# 4. Brak martwych linków — expected: brak trafień
cd /Users/limack/workspace/tasklog && grep -rhoE '\]\(([^)]+\.md)\)' docs README.md \
  | sed -E 's/.*\((.*)\)/\1/' | sort -u | while read f; do
    [ -e "docs/$f" ] || [ -e "$f" ] || echo "martwy link: $f"; done

# 5. Guard łapie regresję — expected: kod wyjścia != 0
cd /Users/limack/workspace/tasklog && printf '\nthe origin project ma 1394 taski.\n' >> docs/worktrail-global-tool.md
node scripts/cli.mjs check; test $? -ne 0 && echo 'guard łapie — OK'
git checkout docs/worktrail-global-tool.md
```

## Notes

- **To jest bramka publikacji, nie warunek działania.** Repo może istnieć lokalnie z pełnym kontekstem; nie może z nim wyjechać na publiczny hosting.
- Krok 8 jest tam, gdzie leży realna wartość: akapit, który po wyjęciu naszej liczby nie ma czego bronić, **nie był o narzędziu**. Znalezienie takich akapitów jest zyskiem, nie stratą.
- Świadomie poza zakresem: tłumaczenie (TL-32), historia gita (spłaszczona w BL-1445, nie ma czego audytować), push (osobna decyzja foundera).

## Log

- 2026-08-30 blocker zdjęty — claude — `blocked_by: [BL-1445]` wskazywał na task, który mieszka w backlogu KONSUMENTA (`origin#BL-1445`), nie tutaj, i jest tam `done`. Wiszące odwołanie było niewidoczne dla `build` i `check` — brak tej bramki zgłoszony osobno.

- 2026-08-30 created — claude — z docs/architecture/worktrail-extraction.md §6; trzy warianty obsługi liczb, rekomendacja „zanonimizowane"
- 2026-08-30 revised — claude — **decyzja foundera: zero danych o the origin project w repo narzędzia.** Task przepisany z „czyszczenia" na ROZDZIAŁ dokumentów: pomiary zostają w the origin project, do narzędzia idzie mechanizm + komenda odtwarzająca. Powód, dla którego poprzedni wariant był słabszy: niesprawdzalny pomiar z cudzego repozytorium nie jest dowodem dla obcego czytelnika, a nadal niesie informację o firmie
