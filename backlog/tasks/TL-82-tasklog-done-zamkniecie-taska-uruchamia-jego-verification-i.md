---
id: TL-82
title: "worktrail done — zamknięcie taska uruchamia jego verification i odmawia przy porażce"
type: code
labels: [pre-launch]
board: main
epic: "Integralność danych"
priority: P0
status: done
owner: agent:claude
estimate: 1d
confidence: high
created: 2026-08-31
updated: 2026-09-01
blocked_by: [TL-86]
blocks: []
related_docs:
  - CLAUDE.md
  - .claude/skills/backlog-workflow/SKILL.md
verification:
  - id: gate-tests
    bash: "node --test scripts/tests/verification-gate.test.mjs"
  - id: readme-limit
    bash: 'grep -q "raises the \*cost\*" README.md && grep -q "there is no .--force. flag" README.md'
  - id: skill-refers
    bash: "grep -q 'worktrail done <ID>' .claude/skills/backlog-workflow/SKILL.md"
  - id: red-run-observed
    manual: "Na fixturze z wpisem `verification` który oblewa: `worktrail done <ID>` wychodzi z kodem !=0, wypisuje wyjście komendy, a plik taska DALEJ ma `status: pending`"
---

## Cel

`worktrail done <ID>` uruchamia każdy wpis z `verification:` tego taska, pokazuje
wyjście i USTAWIA `status: done` wyłącznie wtedy, gdy wszystkie przeszły. Po tym
tasku „zrobione" przestaje być deklaracją wykonawcy, a staje się kodem wyjścia
procesu.

## Kontekst

`verification:` jest jedyną cechą, która odróżnia to narzędzie od Backlog.md
i od każdego innego markdown-owego trackera. Tam kontraktem zamknięcia są
checkboxy (acceptance criteria + Definition of Done), które odhacza ten sam,
kto wykonywał pracę. Gdy pracę wykonuje agent, jest on zarazem jedynym
świadkiem i ma strukturalny interes w uznaniu roboty za skończoną: kontekst mu
się kończy, a „prawie działa" wygląda z jego strony identycznie jak „działa".
Odpowiedzią Backlog.md są trzy LUDZKIE punkty kontrolne, czyli skalowanie po
uwadze człowieka — po zasobie, który sami w README nazywają wąskim gardłem.

**Problem: u nas ta przewaga dziś nie istnieje jako mechanizm.** Sprawdzone w
kodzie: `verification` jest walidowane jako pole (`scripts/task-fields.mjs:146`),
wypełniane przy zakładaniu taska (`scripts/new-task.mjs:172`) i tłumaczone w
onboardingu (`scripts/init-backlog.mjs:157`) — ale ŻADEN skrypt go nie
uruchamia. Egzekucję pełni dziś skill `backlog-workflow`, czyli instrukcja dla
tego samego agenta, którego miała pilnować. To jest konwencja dyscypliny
udająca gwarancję, i dlatego P0: dopóki jej nie ma, wszystkie pozostałe taski
dokładają funkcje do narzędzia, którego jedyna wyróżniająca cecha nie działa.

Sześć rzeczy rozstrzygniętych przed startem — każda jest miejscem, w którym
naiwna implementacja zamienia bramkę w atrapę:

1. **Pusty `verification:` NIE zamyka taska.** Guard, który przechodzi na
   zerowej próbce, jest zielony bez mocy dowodowej (CLAUDE.md). Brak wpisów,
   pusta lista i literał z szablonu (`"komenda do uruchomienia"`) mają OBLEWAĆ
   z komunikatem, że task nie ma kontraktu zamknięcia.
2. **`manual:` to jedyna furtka i musi boleć.** Jeśli `manual:` przechodzi po
   cichu, wszyscy zaczną pisać `manual: "sprawdziłem"` i bramka umiera w
   tydzień. Wymaga jawnego potwierdzenia, a potwierdzenie ląduje w historii z
   aktorem w przestrzeni nazw — wiadomo, KTO zaręczył.
3. **`verification` nie uruchamia się nigdy samo.** Ani w `build`, ani w
   `check`, ani w `serve`, ani w `regen-hook`. Wyłącznie na jawne `worktrail
   done`. Task przychodzący w cudzym pull requeście niesie komendę powłoki;
   ma się ona wykonać dopiero, gdy człowiek świadomie zamyka ten task, i po
   wypisaniu jej treści przed uruchomieniem.
4. **To podnosi koszt kłamstwa, nie czyni go niemożliwym.** Plik taska zawsze
   da się edytować ręcznie. Bramka ma zatrzymać optymizm, nie złą wolę — i tak
   ma być opisana w README. Obiecywanie więcej byłoby tym samym rodzajem
   nieprawdy, przeciw któremu ten task powstał.
5. **Katalog roboczy komend to korzeń repozytorium**, nie katalog backlogu.
   W układzie ko-lokowanym to nie jest ta sama ścieżka — bierz ją z
   `resolveBacklogDir()`/gita, nigdy własnym liczeniem w górę.
6. **`manual:` musi powiedzieć, co JEST dowodem, nie tylko wymagać potwierdzenia.**
   Wyliczenie z Backlog.md jest tu lepsze niż nasza cisza i wchodzi wprost do
   komunikatu potwierdzenia: obecność kodu, wynik grepa i sama intencja
   implementacji NIE są dowodem. Przy pracy interaktywnej dowodem jest przejście
   przez przeglądarkę, skrypt na DOM-ie, runner testów albo opisany wynik ręcznej
   interakcji — nie „sprawdziłem". Ogólne „zweryfikuj porządnie" nie działa;
   działa konkretne wyliczenie tego, co nie przechodzi.
7. **`--force` istnieje albo nie istnieje, ale nie po cichu.** Jeśli tak: głośne
   ostrzeżenie plus wpis w historii z aktorem i powodem. Cicha flaga obejścia
   jest gorsza niż jej brak, bo daje pozór gwarancji.

## Pre-flight reading

1. `scripts/task-fields.mjs:146` — jak `verification` jest dziś walidowane i
   jaki ma kształt (`bash:` / `manual:`).
2. `scripts/new-task.mjs:172-178` — literał z szablonu, który musi oblewać.
3. `scripts/init-backlog.mjs:157-222` — dlaczego przykładowy task z `init` ma
   URUCHAMIALNE `verification`; ta decyzja jest już podjęta, nie podważaj jej.
4. `scripts/history-record.mjs` — jak dopisać zdarzenie z aktorem.
5. `scripts/paths.mjs` — `resolveBacklogDir()` i korzeń repozytorium.
6. `.claude/skills/backlog-workflow/SKILL.md`, sekcja „Close a task" — dziś
   opisuje ręczną procedurę; po tym tasku ma odsyłać do komendy.

## Kroki

1. `worktrail done <ID>`: wczytaj task, wypisz wpisy `verification` PRZED
   uruchomieniem, wykonaj po kolei w korzeniu repozytorium.
2. Strumieniuj wyjście każdej komendy. Pierwsza porażka kończy bieg, wychodzi
   z kodem !=0 i NIE dotyka pliku taska.
3. Pusta lista, brak pola i literał szablonu — oblewają z osobnym komunikatem
   (to inny błąd niż „weryfikacja nie przeszła").
4. `manual:` — jawne potwierdzenie, zapisane w historii z aktorem. Komunikat
   potwierdzenia wylicza, co dowodem NIE jest (punkt 6 kontekstu).
5. Odhacz kryteria akceptacji z powiązania wprowadzonego w TL-86 i odmów
   zamknięcia, gdy kryterium nie ma zielonego dowodu. Bez tego bramka przepuszcza
   task z martwymi checkboksami — zmierzone: 12 z 44 zamkniętych tasków.
6. Po komplecie zielonych: `status: done`, `updated:` na dziś, wpis w `## Log`,
   wpis w historii, `build`. Jedna komenda zamyka cały rytuał z SKILL.md.
7. `--json` (koperta z TL-72): wynik każdego wpisu, kod wyjścia, czas.
8. `--dry-run`: uruchom weryfikacje, nie zmieniaj statusu. To jest tryb, w
   którym agent sprawdza się PRZED zgłoszeniem gotowości.
9. README: opisz bramkę razem z jej granicą z punktu 4 kontekstu.
10. `scripts/tests/verification-gate.test.mjs`, fixture na każdy przypadek:
   wszystko zielone → status zmieniony; jedna porażka → status NIETKNIĘTY;
   pusty `verification` → oblewa; literał z szablonu → oblewa; `manual:` bez
   potwierdzenia → nie zamyka; potwierdzony `manual:` → wpis w historii z
   aktorem.

## Acceptance criteria

- [x] `worktrail done <ID>` zamyka task wyłącznie po zielonym komplecie `verification`. [proof: gate-tests]
- [x] Porażka zostawia plik taska bez zmian i wychodzi z kodem !=0. [proof: gate-tests, red-run-observed]
- [x] Brak, pusta lista i literał z szablonu OBLEWAJĄ, z komunikatem odróżnialnym od porażki weryfikacji. [proof: gate-tests]
- [x] `manual:` wymaga jawnego potwierdzenia zapisanego w historii z aktorem w przestrzeni nazw. [proof: gate-tests]
- [x] Komunikat potwierdzenia `manual:` wylicza, co dowodem NIE jest (obecność kodu, grep, intencja). [proof: gate-tests]
- [x] Kryteria akceptacji są odhaczane z dowodów; kryterium bez zielonego dowodu blokuje zamknięcie. [proof: gate-tests]
- [x] Żadna inna komenda (`build`, `check`, `serve`, `regen-hook`) nie uruchamia `verification`. [proof: gate-tests]
- [x] Komendy startują w korzeniu repozytorium także w układzie ko-lokowanym. [proof: gate-tests]
- [x] `--dry-run` sprawdza bez zmiany statusu; `--json` zwraca wynik każdego wpisu. [proof: gate-tests]
- [x] README nazywa granicę: bramka podnosi koszt kłamstwa, nie eliminuje go. [proof: readme-limit]
- [x] Skill `backlog-workflow` odsyła do komendy zamiast opisywać ręczną procedurę. [proof: skill-refers]
- [x] Test ma fixture na KAŻDY z sześciu przypadków, w tym kontrolę pozytywną na pustym `verification`. [proof: gate-tests]

## Log

2026-08-31 pending — agent:claude — założony po analizie Backlog.md. Powód P0: `verification:` jest dziś zapisywane i walidowane, ale nieuruchamiane przez żaden skrypt — jedyna wyróżniająca cecha narzędzia istnieje jako konwencja, nie mechanizm.
2026-08-31 pending — agent:claude — dopisane: zależność od TL-86 (bramka odhacza kryteria, nie tylko uruchamia komendy) i wyliczenie fałszywych dowodów w potwierdzeniu `manual:`.
2026-09-01 pending — agent:claude — PRZEKAZANIE Z TL-86 (krok 6). Mechanizm powiązania stoi; `worktrail done` ma go SKONSUMOWAĆ, nie zaprojektować drugi raz. Co dostajesz gotowe w `scripts/criteria.mjs`: (1) `parseVerification(frontmatter)` → wpisy `{id, bash, manual}` plus lista problemów — wpis może mieć stabilne `id:`, nieznany klucz OBLEWA, duplikat `id` OBLEWA; (2) `parseCriteria(body)` → pozycje `{text, checked, proofs}`, gdzie `proofs` pochodzą ze znacznika `[proof: a, b]` na końcu linii kryterium; (3) `auditTask({frontmatter, body, policy})` → `{errors, warnings}`; (4) `applyProofs(raw, passedIds)` → `{text, ticked}`, idempotentne, odhacza WYŁĄCZNIE kryteria, których WSZYSTKIE dowody przeszły, i nigdy nie cofa odhaczenia. CO BRAMKA MA ODHACZAĆ: kryteria, których każdy wskazany wpis `verification` wyszedł zielony — `applyProofs` liczy to za ciebie, zapisz zwrócony tekst. PRZY CZYM MA ODMÓWIĆ: (a) `auditTask(...).errors` niepuste — to znaczy powiązanie jest ZEPSUTE (kryterium wskazuje nieistniejący `id`), a nie tylko go brak; (b) kryterium, które po przebiegu DALEJ jest nieodhaczone — to jest AC „kryterium bez zielonego dowodu blokuje zamknięcie", i liczy się tak samo dla kryterium bez dowodu, jak dla kryterium, którego dowód oblał. UWAGA NA MIGRACJĘ: domyślna polityka `criteria_links: warn` (config.yaml) sprawia, że 69 obecnych tasków nie ma powiązań — gdyby `done` odmawiał przy braku powiązania, ŻADEN z nich nie dałby się zamknąć. Odmowa ma iść z polityki: przy `warn` brak powiązania nie blokuje, przy `require` blokuje. Zepsute powiązanie blokuje ZAWSZE. `manual:` jest już parsowane i może być wskazane przez kryterium — jego „zaliczenie" to twoja decyzja o potwierdzeniu, nie moja.
2026-09-01 pending — agent:claude — ODBLOKOWANY: TL-86 zamknięty. `blocked_by` zostaje jako zapis zależności, która była prawdziwa — guard referencji liczy `done` jako istniejące, więc nie ma powodu kasować historii, żeby dostać zielone.
2026-09-01 in_progress — agent:claude — wzięty; jedyny wykonalny P0 (TL-81 jest decyzyjny, TL-48 czeka na właściciela).
2026-09-01 in_progress — agent:claude — SIEDEM ROZSTRZYGNIĘĆ Z KONTEKSTU, każde zaimplementowane i otestowane.
  (1) PUSTY KONTRAKT — brak pola, pusta lista i literał `command to run` odmawiają z komunikatem „no closing contract", jawnie innym niż „verification failed"; test porównuje oba komunikaty, żeby nie zlały się w jeden. Kontrola pozytywna na pustym `verification` jest pierwszym testem w pliku, bo bramka zamykająca task bez kontraktu przeszłaby każdy inny test w tym pliku.
  (2) `manual:` — pytanie o człowieka z wyliczeniem, co dowodem NIE JEST (obecność kodu, grep, intencja implementacji, „sprawdziłem" — łącznie z prawdziwym). Potwierdzenie wymaga wpisania słowa `confirm`, nie `y`: zgoda, którą da się dać jednym palcem po drodze do czegoś innego, nie jest aktem świadomym. Ląduje w historii jako nowe pseudo-pole `__verified__` z aktorem i TREŚCIĄ wpisu — `diffMeta` tego nie zobaczy, bo frontmatter się nie zmienia, więc bez własnego zdarzenia jedyna rzecz, którą `manual:` ma do zaoferowania zamiast komendy — KTO zaręczył — nie zostawiałaby śladu.
  (3) NIC INNEGO NIE URUCHAMIA `verification` — test iteruje po `build`, `check`, `query`, `stats`, `viewer` i szuka markera, PLUS kontrola pozytywna, że ten sam marker odpala się pod `done`. Bez tej drugiej połowy test przechodziłby też wtedy, gdyby marker nie odpalał się nigdzie.
  (4) GRANICA W README — „podnosi koszt kłamstwa, nie eliminuje go", razem z powodem, dla którego nie ma `--force`.
  (5) KORZEŃ REPOZYTORIUM — `repoRootFor()` pyta gita (`rev-parse --show-toplevel`), a przy jego braku zwraca katalog backlogu i mówi to w komentarzu. Test zakłada PRAWDZIWE repozytorium i sprawdza oba układy: zagnieżdżony i ko-lokowany. `join(root, "..")` dałoby w ko-lokowanym katalog NAD repozytorium.
  (6) WYLICZENIE ZAMIAST PROŚBY — treść z Backlog.md wchodzi wprost do promptu; test asertuje obecność `grep` i „I checked" na liście, więc skrócenie jej oblewa.
  (7) `--force` NIE ISTNIEJE. Powód nie jest purystyczny: flaga nie dodałaby możliwości — ręczna edycja pliku i tak jest dostępna — dodałaby coś gorszego, czyli WSPIERANE, skryptowalne obejście długości jednego słowa, które wyląduje w jobie CI, gdzie nikt go już nie przeczyta. Obejście kosztujące widoczny diff w review jest właściwą ceną. Zapisane w `--help`, w README i w skillu, żeby brak flagi był decyzją, a nie przeoczeniem.
  DECYZJE POZA LISTĄ: (a) status zamknięcia bierze się z `archived_statuses`, NIGDY z literału „done" — backlog nazywający to `shipped` ma działać bez zmiany kodu; `--status` wybiera inny status archiwalny (np. `cancelled`), ale zawsze archiwalny, bo `done` zamyka, a przeniesienie do statusu otwartego to edycja, nie zamknięcie. (b) `--json` odmawia obsługi niepotwierdzonego `manual:` zamiast wstrzykiwać prompt w środek JSON-a — pytanie człowieka o zgodę, gdy wyjście parsuje program, jest niespójne samo w sobie. (c) Odmowy też są JSON-em (`reason`, `refusal`), bo skrypt potrzebuje maszynowej odpowiedzi na „dlaczego nie" bardziej niż na „tak". (d) Kryteria bez dowodu odmawiają PRZED uruchomieniem czegokolwiek (przy `criteria_links: require`) — palenie czasu na komendy, żeby potem odrzucić wynik, nic nie odpowiada. Po zielonym przebiegu został asercyjny bezpiecznik na niespójność między runnerem a `applyProofs`: kryterium, którego WSZYSTKIE dowody przeszły, a nie zostało odhaczone, to defekt narzędzia i odmawia zawsze.
  ZMIERZONE RĘCZNIE na fixturze (wpis `verification` oblewający z kodem 4): `done` wypisał wyjście komendy, wyszedł z kodem 1, a plik został z `status: pending` — to jest dokładnie wpis `manual:` tego taska i na TEJ obserwacji go zaręczam, nie na przeczytaniu kodu.
2026-09-01 in_progress — agent:claude — pierwsza próba zamknięcia OBLAŁA na własnym wpisie `readme-limit`: grep szukał frazy „raises the *cost* of a lie" w jednej linii, a zdanie łamie się w README między „*cost*" a „of a lie". Zapisane, bo to jest dokładnie ten rodzaj rzeczy, którą ręczne odhaczenie checkboksa by przepuściło — README było poprawne, dowód był zły, a bez uruchomienia nikt by się nie dowiedział, który z dwóch.
2026-09-01 done — agent:claude — closed by `worktrail done`: 3 command(s) + 1 vouched-for entry green.
