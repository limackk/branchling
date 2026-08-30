---
id: TL-45
title: "Bramka na martwe linki i related_docs w dokumentach narzędzia"
type: code
labels: []
board: main
epic: "Backlog — publikacja open source"
priority: P2
status: pending
owner: unassigned
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs: []
verification:
  - bash: "node scripts/cli.mjs check --docs"
---

## Cel

Link w dokumencie albo `related_docs`, który wskazuje na nieistniejący plik,
**oblewa**. Dziś nic tego nie pilnuje, a to jest nawigacja, po której porusza się
agent — martwy link nie daje błędu, tylko cichą ślepą uliczkę.

## Kontekst

Zmierzone 2026-08-31, po przeniesieniu narzędzia do własnego repozytorium:
**61 ze 101 linków `.md` było martwych** (60%), plus **27 wpisów `related_docs`**
wskazujących na układ katalogów, którego w tym repo nie ma
(`docs/architecture/…`, `qa/…` — kształt projektu, z którego moduł wyszedł).

Naprawione ręcznie w tej samej sesji, ale **naprawa bez bramki zgnije tak samo**:
każde przeniesienie pliku dokumentacji odtwarza ten stan i nikt się nie dowie.

**Klasa jest ogólniejsza niż linki.** Ścieżka w `related_docs` to jedyne miejsce,
w którym task mówi „przeczytaj to, zanim zaczniesz". Gdy wskazuje w pustkę,
agent nie dostaje błędu — dostaje mniej kontekstu i nie wie, że go dostał.

Konsument (`origin`) ma swój `check-docs-links` i on właśnie tę klasę
łapie u siebie; narzędzie wyszło spod tamtej bramki i nie zabrało jej ze sobą.

## Kroki

1. `check --docs`: linki markdown w `README.md`, `CLAUDE.md`, `docs/**`,
   `backlog/tasks/**` + wszystkie `related_docs` z frontmatterów.
2. Rozstrzygnąć formę odwołania do INNEGO repozytorium. Dziś zapisane jako
   `origin#docs/architecture/…` — bramka ma je **rozpoznawać i pomijać**,
   a nie próbować rozwiązać jako ścieżkę lokalną.
3. Zdecydować, czy `check --docs` wchodzi do bezargumentowego `check`.
4. Kontrola pozytywna: repo z jednym martwym linkiem oblewa, po naprawie
   przechodzi. Bez tego kroku bramka może nie mieć mocy dowodowej.

## Acceptance criteria

- [ ] Martwy link i martwe `related_docs` raportowane z plikiem i celem, exit ≠ 0.
- [ ] Odwołanie `<repo>#<ścieżka>` pomijane świadomie, nie przez przypadek.
- [ ] Kotwice (`#sekcja`) nie wywracają walidacji ścieżki.
- [ ] Kontrola pozytywna w teście, nie tylko opis.

## Notes

- Powiązane z TL-37 (rozdział dokumentów), ale to NIE to samo: tam chodzi
  o treść i kontekst the origin project, tu o to, czy ścieżka w ogóle prowadzi do pliku.

## Log

- 2026-08-31 created — claude — wydzielone po zmierzeniu 61/101 martwych linków przy odpowiadaniu na pytanie „czy mamy pełne rozdzielenie"; linki naprawione od razu, bramka została jako dług
