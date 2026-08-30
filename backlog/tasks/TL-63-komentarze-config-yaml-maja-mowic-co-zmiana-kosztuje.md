---
id: TL-63
title: "Komentarze config.yaml mają mówić, co zmiana kosztuje"
type: task
labels: [pre-launch]
board: main
epic: "Onboarding"
priority: P2
status: done
owner: claude
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-config-and-portability.md
verification:
  - bash: "d=$(mktemp -d); node /Users/limack/workspace/tasklog/bin/worktrail.mjs init --dir \"$d\" >/dev/null; for k in statuses priorities labels task_id_prefix owners estimates; do grep -q \"^$k:\" \"$d/config.yaml\" || { echo \"brak klucza $k w szablonie\"; exit 1; }; done; echo 'wszystkie klucze obecne — OK'"
  - bash: "node --test scripts/tests/init-config-comments.test.mjs"
  - manual: "Ktoś, kto nie zna narzędzia, po samym przeczytaniu wygenerowanego config.yaml potrafi powiedzieć, które zmiany są darmowe, a która wymaga migracji."
---

## Cel

Dopisać do generowanego `config.yaml` informację, której dziś nie ma nigdzie:
**ile kosztuje zmiana każdego klucza** i co trzeba zrobić, gdy backlog nie jest
już pusty.

## Kontekst

Wygenerowany `config.yaml` jest głównym — realnie jedynym — dokumentem, który
otwiera osoba dostosowująca narzędzie do swojego projektu. Komentarze już tam są
i są dobre, ale odpowiadają na pytanie „co to jest", a nie na to, które użytkownik
zadaje faktycznie: **„czy mogę to teraz zmienić".**

Odpowiedź nie jest jednakowa i to jest sedno. Zmierzone 2026-08-31:

| Klucz | Koszt zmiany |
|---|---|
| `priorities`, `owners`, `estimates`, `labels`, kolory, `title_max_length` | darmowa |
| `statuses`, `types`, `labels_closed`, boardy | wymaga przejrzenia drzewa — istniejące taski mogą mieć wartości spoza nowego słownika |
| `task_id_prefix` | **wymaga migracji**: `worktrail migrate-prefix --to <NOWY>`, najpierw `--dry-run` |

Przy `task_id_prefix` ostrzeżenie już jest i jest dobre. Przy `statuses` nie ma
nic — a zmiana `statuses` na własne (`todo`/`doing`/`shipped`) jest jedną z
pierwszych rzeczy, które robi zespół, i pociąga za sobą `archived_statuses` oraz
`dashboard_open_statuses`. Zmierzone: taka zmiana bez poprawienia tych dwóch
kluczy daje pięciolinijkowy komunikat o niespójności — poprawny i czytelny, tylko
że wychodzi PO fakcie, zamiast być napisany obok pola.

Ten task jest tani i wysoko punktowany właśnie dlatego, że nie dokłada mechanizmu.
Zmienia tekst w jednym szablonie — a tekst jest tu interfejsem.

Zależność, którą warto znać: `worktrail doctor` ([TL-62](TL-62-worktrail-doctor-jedna-odpowiedz-czy-backlog-jest-ustawiony.md))
odpowie na to samo pytanie po fakcie. Ten task odpowiada na nie **przed** — i
dlatego oba mają sens, a żaden nie zastępuje drugiego.

## Pre-flight reading

1. `scripts/init-backlog.mjs` — `CONFIG_YAML`; to jest cały zakres edycji.
2. `scripts/config.mjs` — `DEFAULTS` i `validateConfig()`; klasyfikacja musi się zgadzać z tym, co kod naprawdę egzekwuje.
3. `backlog/config.yaml` tego repozytorium — przykład konfiguracji, która odjechała od domyślnej.

## Kroki

1. Dopisz do nagłówka `CONFIG_YAML` krótką legendę trzech klas zmiany. Trzy linie, nie akapit.
2. Przy każdym kluczu oznacz klasę i — gdy klasa jest inna niż „darmowa" — jedno zdanie o tym, co zrobić, gdy backlog nie jest pusty.
3. Przy `statuses` wymień wprost dwa klucze, które trzeba poprawić razem (`archived_statuses`, `dashboard_open_statuses`). Ten związek jest niewidoczny, dopóki się nie oberwie komunikatem.
4. Przy `labels_closed` powiedz, co się zmienia po przestawieniu na `true` i że dotyczy to również tasków już istniejących.
5. Nie duplikuj dokumentacji — to ma być pięć–dziesięć linii razem, nie druga instrukcja obsługi. Komentarz, który rośnie, przestaje być czytany.
6. Test `scripts/tests/init-config-comments.test.mjs`: wygenerowany `config.yaml` po `init` nadal parsuje się bez problemów (komentarz nie może zepsuć wąskiego parsera) i zawiera legendę klas.

## Acceptance criteria

- [ ] Generowany `config.yaml` ma legendę trzech klas zmiany.
- [ ] Każdy klucz ma przypisaną klasę.
- [ ] `statuses` wskazuje dwa klucze zależne.
- [ ] Klasyfikacja zgadza się z tym, co egzekwuje `validateConfig()`.
- [ ] Wygenerowany plik nadal parsuje się bez problemów.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 created — agent:claude — z audytu onboardingu
- 2026-08-31 in_progress — agent:claude — start implementacji
- 2026-08-31 done — agent:claude — legenda trzech klas w nagłówku generowanego `config.yaml`, klasa przy każdym kluczu. Przy `statuses` wymienione WPROST oba klucze do poprawienia razem z nim (`archived_statuses`, `dashboard_open_statuses`) — a przy okazji `dashboard_open_statuses` w ogóle wjechał do szablonu, bo dotąd go tam nie było, mimo że jego niespójność oblewa build. Przy `task_id_prefix` dopisane zdanie, że na PUSTYM backlogu zmiana jest darmowa: to jest najczęstszy przypadek zaraz po `init`, a samo odesłanie do `migrate-prefix` wyglądało na armatę na wróbla.
- 2026-08-31 done — agent:claude — klasyfikacja musiała zostać SKORYGOWANA w trakcie, i to jest wynik warty zapisania. `owners` chciałem oznaczyć „[wolna] podpowiedzi, nie słownik zamknięty" — nieprawda: `new-task.mjs` sprawdza `--owner` przeciw tej liście, choć drzewo może trzymać dowolnego ownera (pole jest `dynamic`, więc `auditVocabulary` je pomija). To ta sama asymetria zapis/odczyt co w TL-56, tylko w drugą stronę. Komentarz mówi teraz obie połowy.
- 2026-08-31 done — agent:claude — test `init-config-comments.test.mjs`, 7 asercji. Dwie pilnują, że komentarz nie wywraca wąskiego parsera; trzy są kontrolami POZYTYWNYMI dla samej klasyfikacji — sprawdzają, że klucz oznaczony [migracja] naprawdę oblewa build po zmianie, a oznaczony [wolna] naprawdę nie. Komentarz mówiący „wolna" przy kluczu wymagającym migracji jest gorszy od braku komentarza, więc asercja na obecność tekstu bez asercji na jego prawdziwość niczego by nie broniła. 309/309.
