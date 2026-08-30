---
id: TL-66
title: "Ostrzeżenie next-id kłamie o gicie na pustym backlogu"
type: bug
labels: [pre-launch]
board: main
epic: "Powierzchnia CLI"
priority: P2
status: done
owner: claude
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: [TL-64]
related_docs:
  - .claude/skills/worktrail-cli/references/output-style.md
verification:
  - bash: "node --test scripts/tests/next-id-empty-backlog.test.mjs"
  - bash: "d=$(mktemp -d)/p; mkdir -p \"$d\"; cd \"$d\"; git init -q .; echo x > a; git add -A; git -c user.email=t@t -c user.name=t commit -qm i >/dev/null; T=/Users/limack/workspace/tasklog/bin/worktrail.mjs; node $T init --dir ./backlog >/dev/null; node $T new --dir ./backlog --title Proba 2>&1 | grep -q 'poza repozytorium git' && { echo 'nadal kłamie'; exit 1; }; echo 'pierwszy task bez fałszywego ostrzeżenia — OK'"
---

## Cel

Ostrzeżenie o węższym źródle numeru ma padać wtedy, gdy źródło NAPRAWDĘ jest
węższe — a nie za każdym razem, gdy skan po gałęziach nic nie znalazł.

## Kontekst

Zmierzone 2026-08-31 w normalnym repozytorium gita, z commitem, zaraz po
`worktrail init`:

```
$ worktrail new --dir ./backlog --title "Proba"
next-backlog-id: numer z LOKALNEGO katalogu — poza repozytorium git
  nie widzę innych gałęzi ani worktree, więc ten numer może być gdzieś zajęty.
[worktrail new] …/backlog/tasks/TASK-1-proba.md
```

Zdanie „poza repozytorium git" jest nieprawdziwe: jesteśmy w repozytorium, skan
po gałęziach i worktree **wykonał się w całości** i po prostu nic nie znalazł, bo
backlog powstał sekundę wcześniej.

Przyczyna jest w warunku: `if (sources.size === 0)`. Zbiór źródeł jest pusty w
dwóch różnych sytuacjach, których ten warunek nie rozróżnia:

| Sytuacja | Czy odpowiedź jest węższa |
|---|---|
| katalog poza repozytorium gita | **tak** — nie widzieliśmy cudzych gałęzi |
| repozytorium jest, backlog pusty | **nie** — widzieliśmy wszystkie i nie ma nic |

Intencja ostrzeżenia jest słuszna i zapisana w kodzie: węższe źródło MUSI się
odezwać, bo numer z jednego katalogu wygląda tak samo wiarygodnie jak numer ze
skanu wszystkich gałęzi. Zła jest tylko przesłanka.

**Dlaczego to jest P2, a nie kosmetyka.** To zdanie pada przy PIERWSZYM tasku
każdego nowego użytkownika — czyli w jedynym momencie, gdy nie ma jeszcze
podstaw, żeby ocenić, które komunikaty narzędzia są wiarygodne. Ostrzeżenie,
które kłamie za pierwszym razem, uczy ignorować wszystkie następne; a to
akurat ostrzeżenie ma kiedyś uratować przed dwoma taskami o tym samym numerze.

## Pre-flight reading

1. `scripts/next-backlog-id.mjs` — warunek `sources.size === 0` i komentarz nad nim.
2. `scripts/git-rules.mjs` — `insideGitRepo()`; pytanie jest już zadane gdzie indziej.
3. `scripts/new-task.mjs` — `nextId()` przekazuje to ostrzeżenie dalej na stderr.

## Kroki

1. Rozdziel przesłanki: ostrzegaj, gdy katalog backlogu NIE leży w repozytorium
   gita, a nie gdy skan wrócił pusty.
2. Użyj `insideGitRepo()` z `git-rules.mjs` zamiast wnioskować z liczby źródeł.
3. Zachowaj ostrzeżenie tam, gdzie jest prawdziwe — jego intencja nie jest błędem.
4. Test: pusty backlog W repozytorium nie ostrzega; backlog poza repozytorium
   ostrzega. Obie strony, bo poprawka usuwająca ostrzeżenie w ogóle byłaby
   „zielona" przy jednostronnym teście.

## Acceptance criteria

- [ ] Pusty backlog wewnątrz repozytorium gita: brak ostrzeżenia.
- [ ] Backlog poza repozytorium gita: ostrzeżenie nadal jest.
- [ ] Treść ostrzeżenia nie mówi o gicie rzeczy nieprawdziwych.
- [ ] Test pokrywa obie strony.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 created — agent:claude — trafione przy TL-64; blokuje czystą ścieżkę pierwszego uruchomienia
- 2026-08-31 in_progress — agent:claude — start implementacji
- 2026-08-31 done — agent:claude — przesłanką jest teraz `insideGitRepo(OWN_ROOT)` z `git-rules.mjs`, a nie liczba znalezionych źródeł. Treść poprawiona: „backlog nie leży w repozytorium git" zamiast „poza repozytorium git" — bo pierwsze jest sprawdzalne, a drugie było zdaniem o kontekście wywołania. Test `next-id-empty-backlog.test.mjs` sprawdza OBIE strony: pusty backlog w repo milczy, backlog poza repo nadal ostrzega. Sam test na ciszę byłby zielony także dla poprawki kasującej ostrzeżenie w całości. 313/313.
