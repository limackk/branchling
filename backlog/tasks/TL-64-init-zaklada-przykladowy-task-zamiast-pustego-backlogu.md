---
id: TL-64
title: "init zakłada przykładowy task zamiast pustego backlogu"
type: task
labels: [post-launch]
board: main
epic: "Onboarding"
priority: P3
status: done
owner: claude
estimate: 2h
confidence: medium
created: 2026-08-31
updated: 2026-08-31
blocked_by: [TL-66]
blocks: []
related_docs:
  - .claude/skills/backlog-workflow/SKILL.md
verification:
  - bash: "d=$(mktemp -d); T=/Users/limack/workspace/tasklog/bin/worktrail.mjs; node $T init --dir \"$d\" >/dev/null && test \"$(ls \"$d/tasks\" | wc -l | tr -d ' ')\" = 1 && echo 'init zakłada jeden task — OK'"
  - bash: "d=$(mktemp -d); T=/Users/limack/workspace/tasklog/bin/worktrail.mjs; node $T init --dir \"$d\" >/dev/null && node $T check --dir \"$d\" && node $T stats --dir \"$d\" | head -3"
  - bash: "d=$(mktemp -d); T=/Users/limack/workspace/tasklog/bin/worktrail.mjs; node $T init --dir \"$d\" --no-example >/dev/null && test \"$(ls \"$d/tasks\" | wc -l | tr -d ' ')\" = 0 && echo 'da się wyłączyć — OK'"
---

## Cel

Skrócić drogę od instalacji do pierwszej widocznej wartości: po `init` ma być co
oglądać, a przykład ma pokazywać kształt dobrze napisanego taska.

## Kontekst

Dziś po `worktrail init` backlog jest pusty: `stats` pokazuje same zera, viewer
otwiera się bez ani jednej karty, a jedynym śladem po kształcie pliku jest
`_template.md`, którego nikt nie musi otworzyć. Użytkownik ocenia narzędzie na
pustym ekranie.

Pusty stan jest też straconą okazją dydaktyczną. Najtrudniejsza do przekazania
konwencja tego narzędzia to **`verification:` — task nie jest zrobiony, dopóki nie
ma komendy, która to udowadnia.** Nie da się tego wyjaśnić akapitem tak dobrze,
jak jednym plikiem, w którym to widać.

**Ograniczenia, których nie wolno złamać:**

- Przykład musi być **generyczny**. Zero słownictwa jakiegokolwiek istniejącego
  projektu — ten sam wymóg, który obowiązuje szablony i którego pilnuje test.
- Musi być **kasowalny bez konsekwencji** i musi to mówić o sobie wprost.
- Musi **przechodzić `worktrail check`** i mieć `verification`, które naprawdę da
  się uruchomić. Przykład z atrapą komendy uczyłby dokładnie odwrotnie, niż trzeba.
- Musi dać się **wyłączyć** — `init` bywa wołany przez skrypt i przez agenta, a
  wtedy nieoczekiwany plik w `tasks/` jest zaskoczeniem.

Do rozstrzygnięcia w tasku: czy przykładem ma być task „o narzędziu" (np.
„Dostosuj słowniki w config.yaml do swojego projektu" — realne pierwsze zadanie,
z `verification` wołającym `worktrail check`), czy neutralna atrapa. Pierwsze jest
mocniejsze, bo przykład jest jednocześnie prawdziwym pierwszym krokiem i po
wykonaniu zamyka się naturalnie. Drugie jest bezpieczniejsze, bo nie zakłada, co
użytkownik chce zrobić.

Wariant do rozważenia zamiast flagi: `init` buduje widoki od razu, więc po jednej
komendzie działa i `stats`, i viewer. Dziś `init` kończy podpowiedzią
`dalej: worktrail build` — dobrą, ale wciąż to jest drugi krok do zrobienia ręcznie.

## Pre-flight reading

1. `scripts/init-backlog.mjs` — `FILES`, `TEMPLATE_MD`, zasada „istniejący plik pomijam".
2. `scripts/new-task.mjs` — jak powstaje task; przykład powinien powstawać tą samą drogą, nie drugim generatorem.
3. `.claude/skills/backlog-workflow/SKILL.md` §„Write a task" — standard, który przykład ma ilustrować.
4. `scripts/tests/init-stats.test.mjs` — dzisiejsze asercje o świeżym backlogu; zmienią się.

## Kroki

1. Rozstrzygnij treść przykładu (task o dostosowaniu konfiguracji kontra neutralna atrapa) i zapisz powód w `## Log`.
2. Przykład powstaje przez tę samą ścieżkę co `worktrail new` — jeden generator, nie dwa.
3. `--no-example` (albo `--bare`) wyłącza; dopisz flagę do walidacji flag `init`.
4. Rozważ zbudowanie widoków na koniec `init`, żeby `stats` i viewer działały po jednej komendzie.
5. Zaktualizuj podpowiedź „dalej:" tak, żeby odpowiadała temu, co faktycznie zostało zrobione.
6. Popraw `scripts/tests/init-stats.test.mjs` i dopisz asercje: przykład przechodzi `check`, jego `verification` jest wykonywalne, `--no-example` daje pusty katalog.

## Acceptance criteria

- [ ] `worktrail init` zakłada dokładnie jeden przykładowy task.
- [ ] Przykład przechodzi `worktrail check` i ma uruchamialne `verification`.
- [ ] Przykład mówi o sobie, że można go skasować.
- [ ] Zero słownictwa jakiegokolwiek istniejącego projektu.
- [ ] `--no-example` daje dzisiejsze, puste zachowanie.
- [ ] Po `init` `worktrail stats` pokazuje niezerową liczbę bez dodatkowych komend.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 created — agent:claude — z audytu onboardingu
- 2026-08-31 in_progress — agent:claude — start implementacji
- 2026-08-31 pending — agent:claude — odblokowane: TL-66 zdjął fałszywe ostrzeżenie `next-id`, które padało przy pierwszym tasku i psuło ścieżkę, którą ten task ma skrócić.
- 2026-08-31 done — agent:claude — wybrany wariant: task O KONFIGURACJI, nie neutralna atrapa (krok 1). Powód: przykład, który JEST prawdziwym pierwszym krokiem, uczy dwóch rzeczy naraz — kształtu pliku i tego, że `verification:` ma być uruchamialne — a po wykonaniu zamyka się sam. Jego `verification` to `worktrail doctor`, czyli komenda, która naprawdę odpowie na pytanie z tego taska. Atrapa uczyłaby, że to pole jest ozdobne.
- 2026-08-31 done — agent:claude — „jeden generator" zrealizowany przez wydzielenie `createTask()` z `main()` w `new-task.mjs` (bez drukowania; `main` drukuje). `init` woła tę samą funkcję, więc numer nadal bierze skan wszystkich gałęzi, a zapis jest wyłączny (`wx`). `createTask` przyjmuje `body` (treść poniżej frontmattera) i `fields.verification` (blok, nie linia — szablon niesie tam atrapę). Przykład wchodzi TYLKO do pustego drzewa: backlog z taskami nie jest nowy, a dokładanie mu pliku byłoby tym samym zaskoczeniem, co nadpisanie.
- 2026-08-31 done — agent:claude — `init` buduje na koniec widoki, więc `stats` i viewer działają po JEDNEJ komendzie; podpowiedź zmieniona z `dalej: worktrail build` na `dalej: worktrail`. `--no-example` przywraca dzisiejsze zachowanie i wszedł do walidacji flag.
- 2026-08-31 done — agent:claude — siedem fixture'ów testowych dostało `--no-example`, każdy z uzasadnieniem w komentarzu. To nie jest obejście: te testy mówią o numeracji, o „nic nie zapisał" albo o PUSTYM drzewie, więc przykład zmieniałby ich przedmiot, a nie ich wynik. Pięć nowych asercji na sam przykład, z dowodem mocy przez wyłączenie zachowania. 318/318.
- 2026-08-31 done — agent:claude — znane, świadomie zostawione: `init` do katalogu POZA repozytorium gita wypisuje przy przykładzie ostrzeżenie `next-id` o węższym źródle numeru. Jest prawdziwe (backlog naprawdę nie leży w repo), choć w świeżym katalogu ryzyko kolizji jest zerowe. Wyciszanie prawdziwego ostrzeżenia dla ładniejszego wyjścia byłoby odwrotnością reguły, którą właśnie naprawił TL-66.
