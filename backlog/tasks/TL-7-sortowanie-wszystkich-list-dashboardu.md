---
id: TL-7
title: "Sortowanie wszystkich list i tabel dashboardu jednym mechanizmem"
type: code
labels: [pre-launch]
epic: ""
board: main
priority: P2
status: done
owner: claude
estimate: 2h
confidence: high
created: 2026-08-26
updated: 2026-08-26
blocked_by: []
blocks: []
related_docs:
  - backlog/README.md
verification:
  - bash: "node backlog/scripts/build-viewer.mjs"
  - manual: "Dashboard → 13 kontrolek sortowania: tabele (epiki, wiek) przez nagłówki, listy i słupki przez pasek „sortuj:"; opcja „kolejność" wraca do porządku naturalnego"
  - manual: "Listy uwagi: po zmianie sortowania widać inne 12 pozycji, a nota mówi „Pokazane 12 z N""
---

## Cel

Sortowanie miała tylko tabela epików (TL-6). Founder poprosił o to samo w
pozostałych zestawieniach.

## Kontekst

Kluczowa decyzja: **jeden mechanizm, nie osiem**. Zamiast kopiować logikę
epików do każdej karty, kolumna deklaruje etykietę, akcesor wartości i
kierunek, w którym się otwiera, a `dashSortItems` / `dashTableHead` /
`dashSortBar` obsługują wszystkie trzynaście list. Sortowanie epików zostało
przepięte na ten sam mechanizm — inaczej powstałaby druga definicja tego, co
znaczy „posortuj po Blok.".

Kolumna bez `get` to **porządek naturalny** karty: cykl życia dla statusów,
P0→P3 dla priorytetów, rosnące przedziały dla wieku i lead time'u, zadeklarowana
kolejność dla godzin. Bez tej opcji nie dałoby się wrócić do układu, w którym
karta ma sens — sortowanie „po wartości" niszczy oś, którą te karty niosą.

Przy okazji naprawiony cichy defekt: listy uwagi obcinały się do 12 pozycji
**przed** sortowaniem i nie mówiły o tym ani słowa. Po dodaniu sortowania
byłoby to już kłamstwo — przełącznik przestawiałby dwanaście wierszy wybranych
innym kluczem. Teraz sortowanie idzie pierwsze, cięcie drugie, a nota mówi
„Pokazane 12 z 41".

Tabela epików dostała kolumnę **Otwarte**. Domyślne sortowanie zawsze było „po
otwartych malejąco", ale kolumny nie było, więc po zmianie sortowania nie dało
się do tego układu wrócić.

## Acceptance criteria

- [x] Sortowanie w: epiki, wiek otwartych, 7 kart słupkowych, 3 listy uwagi,
      panel dnia, higiena.
- [x] Jedna implementacja; epiki przepięte na nią.
- [x] Opcja „kolejność" wraca do porządku naturalnego karty.
- [x] Listy uwagi sortują przed cięciem i deklarują, ile pozycji zostało poza.

## Verification

- W przeglądarce: 13 zarejestrowanych kontrolek; statusy natural → wartość →
  nazwa → z powrotem natural; wiek po P0 (16/7/4/2) i z powrotem do przedziałów;
  higiena po priorytecie; panel dnia po statusie (done, done, in_progress,
  pending); lista „w toku bez ruchu" po ID z notą „Pokazane 12 z 41".

## Log

- 2026-08-26: zaimplementowane i zweryfikowane w przeglądarce — claude.
