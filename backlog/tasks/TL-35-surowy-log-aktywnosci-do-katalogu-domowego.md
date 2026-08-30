---
id: TL-35
title: "Surowy log aktywności do katalogu domowego"
type: code
labels: [post-launch]
board: main
epic: "Backlog — pomiar czasu pracy"
priority: P2
status: pending
owner: unassigned
estimate: 4h
confidence: medium
created: 2026-08-30
updated: 2026-08-30
blocked_by: [TL-28, TL-34]
blocks: []
related_docs:
  - docs/worktrail-global-tool.md
  - docs/backlog-time-tracking.md
verification:
  - bash: "node --test backlog/scripts/tests/activity-location.test.mjs"
  - bash: "test -z \"$(git ls-files backlog/activity | grep -v '^backlog/activity/rollup/')\" && echo 'żaden surowy log nie jest śledzony — OK'"
---

## Cel

Przenieść **surowe heartbeaty** z `backlog/activity/` do katalogu domowego użytkownika. Agregat per task zostaje w repo bez zmian. Po tym tasku prywatne stemple czasu **fizycznie nie mogą** trafić do cudzej historii gita.

## Kontekst

[backlog-time-tracking.md §5](../../docs/backlog-time-tracking.md) kładzie surowy log w `backlog/activity/*.jsonl` i broni go gitignorem. To działa dokładnie do pierwszego `git add -A` w cudzym repozytorium — a wtedy zapis o tym, **o której godzinie konkretny człowiek pracował**, dzień po dniu, trafia do publicznej historii i **nie da się go stamtąd usunąć**. Wycofanie wymaga przepisania historii, czyli operacji, której w cudzym repo nikt nie zrobi.

Różnica jest jakościowa, nie stopniowa: w katalogu domowym ten wypadek jest **niemożliwy**, a nie tylko odradzany. Ochrona przestaje zależeć od poprawności `.gitignore` w każdym repozytorium, do którego narzędzie kiedykolwiek trafi.

Podział ról zostaje ten sam, co w projekcie pomiaru — surowe zostaje przy człowieku, agregat jedzie z projektem:

```
<data>/activity/<projekt>/BL-NNNN.jsonl        ← surowe heartbeaty, poza jakimkolwiek repo
<repo>/backlog/activity/rollup/BL-NNNN.json    ← agregat per task, wersjonowany (bez zmian)
```

To jest **rewizja świeżo zaprojektowanego mechanizmu**, nie nowy pomysł: [TL-31](TL-31-retencja-korekta-atrybucji-i-prawo-do-usuniecia.md) buduje na tej lokalizacji `prune` i `forget`, więc oba muszą wiedzieć o zmianie. Dopóki ten task nie jest zamknięty, wersja z TL-28 działa poprawnie na jednej maszynie — ale nie nadaje się do wypuszczenia.

## Pre-flight reading

1. `docs/architecture/worktrail-global-tool.md` — §6 (dlaczego przenosimy), §5 (rozdział config vs data).
2. `docs/architecture/backlog-time-tracking.md` — §5 (model danych), §9 (prywatność, retencja, korekta).
3. `backlog/scripts/home.mjs` (TL-34) — rozwiązanie katalogu data.
4. `backlog/scripts/activity.mjs` (TL-27) — jedyne miejsce, które zna ścieżki logu; po tej zmianie ma nim pozostać.

## Kroki

1. `activityPath()` czyta katalog **data** z `home.mjs`, nie z `backlogPaths()`. Jedno miejsce, jedna zmiana — jeśli trzeba dotknąć więcej niż jednego pliku, ścieżki wyciekły i to jest osobny problem do naprawienia najpierw.
2. Segregacja per projekt w katalogu domowym: `<data>/activity/<projekt>/`. Nazwa projektu z rejestru (TL-34); projekt niezarejestrowany dostaje **stabilny skrót ze ścieżki backlogu**, nie „default" — inaczej dwa projekty zlewają się w jeden i minuty się sumują po cichu.
3. Agregat `rollup/BL-NNNN.json` **zostaje w repo** i nadal jest wersjonowany. Ten task go nie dotyka.
4. `backlog/.gitignore`: reguła na `activity/*.jsonl` **zostaje** — jako pas bezpieczeństwa dla logów sprzed migracji i dla kogoś, kto ustawi tryb `full`.
5. Migracja istniejących logów: jednorazowe `worktrail activity migrate` przenoszące `backlog/activity/*.jsonl` do katalogu domowego, idempotentne, z `--dry-run`. Dla tego repo to najwyżej kilka plików, ale bez tego kroku dane po prostu znikają z widoku.
6. Zaktualizować `prune` i `forget` z [TL-31](TL-31-retencja-korekta-atrybucji-i-prawo-do-usuniecia.md), żeby działały na nowej lokalizacji — **jeśli TL-31 jest już zrobiony**; jeśli nie, dopisać tam notatkę o lokalizacji.
7. `worktrail where` (TL-34) drukuje też ścieżkę logu aktywności — użytkownik ma jedno miejsce, w którym sprawdza, co narzędzie o nim trzyma.
8. Zaktualizować `backlog-time-tracking.md` §5 i §9 na nową lokalizację.

## Acceptance criteria

- [ ] Surowe heartbeaty lądują w katalogu **data** użytkownika, nie w repo — jest na to test z `WORKTRAIL_HOME`.
- [ ] `git ls-files backlog/activity` nie zwraca **żadnego** pliku poza `rollup/` — bramka w Verification.
- [ ] Dwa różne projekty niezarejestrowane nie zlewają się do wspólnego katalogu — test na dwóch ścieżkach backlogu.
- [ ] `activity migrate --dry-run` niczego nie dotyka; `migrate` uruchomiony dwa razy daje ten sam stan.
- [ ] Agregat `rollup/` nadal wersjonowany i niezmieniony w kształcie.
- [ ] `worktrail where` pokazuje ścieżkę logu aktywności.
- [ ] `backlog-time-tracking.md` §5 i §9 opisują stan po zmianie; §6 dokumentu o narzędziu globalnym oznaczony jako wdrożony.
- [ ] `prune` i `forget` działają na nowej lokalizacji (albo TL-31 ma notatkę, jeśli jeszcze nie istnieje).

## Verification

```bash
# 1. Testy lokalizacji — expected: pass
node --test backlog/scripts/tests/activity-location.test.mjs

# 2. Nic surowego nie jest śledzone przez gita — expected: komunikat OK
test -z "$(git ls-files backlog/activity | grep -v '^backlog/activity/rollup/')" \
  && echo 'żaden surowy log nie jest śledzony — OK'

# 3. Zapis idzie do katalogu domowego — expected: plik POZA repo
WORKTRAIL_HOME=/tmp/worktrail-act node backlog/scripts/cli.mjs activity record --task TL-35 --kind tool
find /tmp/worktrail-act -name 'TL-35.jsonl' | head -1
test -z "$(find backlog/activity -name 'TL-35.jsonl' 2>/dev/null)" && echo 'nic nie wylądowało w repo — OK'
rm -rf /tmp/worktrail-act

# 4. Migracja idempotentna — expected: druga liczba identyczna
node backlog/scripts/cli.mjs activity migrate --dry-run | tail -1
```

## Notes

- **Dlaczego nie zostawić wszystkiego w repo z lepszym gitignorem:** bo `.gitignore` jest obietnicą utrzymywaną przez każdego przyszłego użytkownika w każdym przyszłym repozytorium, a katalog domowy jest własnością narzędzia. Jedno jest procedurą, drugie konstrukcją.
- **Dlaczego agregat zostaje w repo:** kalibracja estymat ma jeździć z projektem i przechodzić przez review — to ta sama granica, co surowe/agregat w §9 dokumentu pomiaru, i ona się nie zmienia.
- Poza zakresem: retencja i `forget` (TL-31), rejestr (TL-34), widok przekrojowy (TL-36).

## Log

- 2026-08-30 created — claude — rewizja lokalizacji z docs/architecture/backlog-time-tracking.md §5; w katalogu domowym przypadkowy `git add -A` w cudzym repo staje się niemożliwy, a nie tylko odradzany
