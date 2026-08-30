---
id: TL-129
title: "check --language przepuszcza polski w scripts/serve-backlog.mjs"
type: task
labels: []
board: main
epic: "worktrail — narzędzie"
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
  - id: guard-catches-it
    bash: "node --test scripts/tests/public-language.test.mjs"
---

## Cel

`worktrail check --language` idzie na czerwono na polskim zdaniu, które dziś
przepuszcza, a `scripts/serve-backlog.mjs:241` jest po angielsku. Po zrobieniu
tego taska guard ma MOC DOWODOWĄ na tej próbce, a nie tylko na próbkach, które
akurat trafiły do jego listy słów.

## Kontekst

Znalezione przy TL-97. `scripts/serve-backlog.mjs:241` niesie:

```
// (`history-record.mjs --actor claude`) — dlatego czekamy RECONCILE_DELAY_MS,
```

`scripts/` jest w `PUBLIC_PATHS`, więc guard TĘ linię czyta — i mówi
„✓ language: 29563 lines across 96 public files read as English". Powód jest
w `scripts/check-public-language.mjs:83`: wykrywanie stoi na zamkniętej liście
polskich słów funkcyjnych, a nie ma na niej ani `dlatego`, ani `czekamy`.

**To jest gorsze niż brak guardu.** Guard, który mówi „przeczytałem 96 plików
i wszystkie są po angielsku", jest cytowany jako dowód; ten cytat był
nieprawdziwy przez cały czas, gdy ta linia tam stała.

Decyzja do podjęcia w tym tasku, bo nie jest oczywista: dopisanie kilku słów do
listy zamyka TĘ dziurę i nie zamyka klasy. Rozważyć wykrywanie po znakach
diakrytycznych (`ą ć ę ł ń ó ś ź ż`) jako drugi, niezależny sygnał — łapie
zdanie, którego żadnego słowa nie ma na liście. Uwaga: sama diakrytyka nie
wystarczy (`dlatego czekamy` jej nie ma), a fałszywe trafienia przyjdą
z nazwisk i z danych testowych — dlatego mechanizm wyjątków
`language-guard: allow` już istnieje i ma zostać jedyną drogą.

## Pre-flight reading

1. `scripts/check-public-language.mjs` — `PUBLIC_PATHS`, lista słów w linii 83
   i konwencja `language-guard: allow`.
2. `scripts/tests/public-language.test.mjs` — jak wygląda kontrola pozytywna
   tego guardu dzisiaj.

## Kroki

1. Test, który OBLEWA na dzisiejszym kodzie: próbka `dlatego czekamy` w pliku
   publicznym ma iść na czerwono.
2. Rozszerzyć wykrywanie tak, żeby ta próbka była łapana.
3. Naprawić `scripts/serve-backlog.mjs:241`.
4. Przejechać guard po całym drzewie i rozstrzygnąć każde nowe trafienie:
   albo tłumaczenie, albo `language-guard: allow` przy TEJ jednej linii.

## Acceptance criteria

- [ ] Kontrola pozytywna: próbka z `dlatego czekamy` w pliku publicznym oblewa guard. [proof: guard-catches-it]
- [ ] `scripts/serve-backlog.mjs` nie ma polskiego zdania. [proof: guard-catches-it]
- [ ] `worktrail check --language` zielony na całym drzewie, a każdy wyjątek ma komentarz `language-guard: allow` przy jednej linii. [proof: guard-catches-it]
