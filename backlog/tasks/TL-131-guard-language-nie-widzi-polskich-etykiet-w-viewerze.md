---
id: TL-131
title: "Guard --language nie widzi polskich etykiet w viewerze"
type: task
labels: []
board: main
epic: "Backlog viewer"
priority: P2
status: pending
owner: unassigned
estimate: 2h
confidence: medium
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: labels-english
    bash: "node -e \"const s=require('fs').readFileSync('scripts/build-viewer.mjs','utf8');const m=s.match(/const HISTORY_FIELD_LABELS = \\{[^}]*\\}/);if(!m)process.exit(1);if(/utworzony|komentarz|zmieniony/i.test(m[0])){console.error(m[0]);process.exit(1)}console.log('labels are English')\""
  - id: guard-green
    bash: "node scripts/cli.mjs check --language"
---

## Cel

`worktrail check --language` przechodzi na zielono, a mimo to viewer pokazuje
polskie etykiety. W `scripts/build-viewer.mjs`, w mapie `HISTORY_FIELD_LABELS`,
stoją `__created__: "task utworzony"`, `created: "Utworzony"` — obok wpisów
angielskich (`__deleted__: "task deleted"`). Ta mapa jedzie do cudzych
repozytoriów w wygenerowanej stronie, więc jest POWIERZCHNIĄ PUBLICZNĄ
(TL-32), a guard jej nie łapie.

Po zrobieniu: etykiety są angielskie ORAZ guard ma kontrolę pozytywną, która
oblewa, gdy ktoś znów wpisze polskie słowo w tej mapie.

## Kontekst

Znalezione przy TL-99, kiedy `__comment__: "komentarz"` zamieniono na
`"comment"` przy okazji implementacji komentarzy. Dwa pozostałe wpisy zostały,
bo nie należały do tezy tamtego taska.

Ważniejsze od samej poprawki jest PYTANIE O GUARD: `check --language` czyta
30 tys. linii i orzeka „reads as English", a te dwie linie przepuścił. Trzeba
ustalić, dlaczego — heurystyka może pomijać krótkie stringi, wnętrza obiektów
albo linie bez czasownika. Poprawienie samych etykiet bez zamknięcia dziury
zostawia guard zielonym bez mocy dowodowej (reguła z CLAUDE.md).

## Kroki

1. Ustalić, na czym `scripts/check-public-language.mjs` gubi te dwie linie —
   zacząć od podania mu ich w izolacji jako kontroli pozytywnej.
2. Poprawić etykiety na angielskie w `scripts/build-viewer.mjs`.
3. Domknąć guard albo — jeśli okaże się to niewykonalne bez fałszywych
   alarmów — dołożyć węższy test na samą mapę i opisać w tasku, dlaczego
   ogólna reguła nie da rady.

## Acceptance criteria

- [ ] Żadna wartość w `HISTORY_FIELD_LABELS` nie jest po polsku. [proof: labels-english]
- [ ] Kontrola pozytywna: podstawienie polskiej etykiety OBLEWA. [proof: labels-english]
- [ ] `check --language` nadal zielony po zmianie. [proof: guard-green]
