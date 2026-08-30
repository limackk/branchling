---
id: TL-102
title: "Demo pierwszego kontaktu — odmowa worktrail done w 60 sekund"
type: task
labels: [pre-launch]
board: main
epic: "Backlog — publikacja open source"
priority: P1
status: in_progress
owner: agent:claude
estimate: 3h
confidence: medium
created: 2026-09-01
updated: 2026-09-01
blocked_by: [TL-82, TL-49]
blocks: [TL-103]
related_docs:
  - docs/funkcjonalnosci.md
verification:
  - bash: "test -f docs/demo/scenario.md && grep -q 'exit' docs/demo/scenario.md"
  - manual: "Nagranie (asciinema lub GIF) jest podlinkowane w nagłówku README, trwa do 60 sekund i kończy się CZERWONĄ odmową `worktrail done`, po której następuje naprawa i zielone zamknięcie"
---

## Cel

Nieznajomy w 60 sekund widzi jedyną rzecz, której nie ma nigdzie indziej:
`worktrail done` ODMAWIA zamknięcia taska, bo weryfikacja oblała — pokazuje
wyjście testu, task zostaje `pending`. Potem naprawa i zielone zamknięcie.
Nagranie wisi w nagłówku README jako pierwszy kontakt z narzędziem.

## Kontekst

W kategorii „markdown backlog CLI" pierwszym kontaktem lidera jest kanban w
terminalu — ładny, ale generyczny. Nasz wyróżnik jest fotogeniczny w inny
sposób: **odmowa jest ciekawsza niż sukces**. Scena „agent mówi zrobione,
narzędzie mówi nie" nazywa ból, który każdy pracujący z agentami zna z
codzienności — i nie da się jej pokazać żadnym innym narzędziem z tej kategorii.

Deweloperzy nie czytają dokumentów zakresu; patrzą na GIF w README i decydują
w kilkanaście sekund. Bez tego taska cała praca nad mechanizmem (TL-86,
TL-82) jest niewidzialna dla kogoś, kto nie przeczyta kodu.

Rozstrzygnięte z góry:

1. **Scenariusz jest skryptem w repo, nie improwizacją.** `docs/demo/scenario.md`
   z dokładnymi komendami — nagranie musi być odtwarzalne po każdej zmianie CLI,
   inaczej zgnije jak każdy screenshot.
2. **Dramaturgia: porażka najpierw.** init → task z `verification:` → praca
   „prawie skończona" → `worktrail done` → CZERWONA odmowa z wyjściem testu →
   naprawa → `worktrail done` → zielone. Nie pokazujemy tour po komendach.
3. **60 sekund to limit twardy.** Wszystko, co nie służy scenie odmowy, wypada.
4. Format: asciinema jako źródło (tekst, lekkie, kopiowowalne), GIF jako fallback
   do README na GitHubie, który asciinema nie osadza.

Blokady są realne, nie porządkowe: bez TL-82 nie ma czego nagrać (komenda
`done` nie istnieje), bez TL-49 nie ma README, w którym nagranie mogłoby wisieć.

## Pre-flight reading

1. `backlog/tasks/TL-82-*.md` — dokładne zachowanie `done` przy porażce;
   scenariusz ma pokazywać prawdziwe komunikaty, nie wymyślone.
2. `backlog/tasks/TL-49-*.md` — kształt nowego README; demo ma trafić w jego
   nagłówek.
3. README Backlog.md (github.com/MrLesk/Backlog.md) — jak wygląda ich GIF
   pierwszego kontaktu; nasz ma być rozpoznawalnie INNY, nie ładniejszy ich.

## Kroki

1. Napisz `docs/demo/scenario.md`: komendy krok po kroku, z oczekiwanym wyjściem.
2. Przejdź scenariusz ręcznie na świeżym katalogu; zmierz czas.
3. Nagraj asciinema; wygeneruj GIF.
4. Podlinkuj w nagłówku README; plik nagrania trzymaj poza npm-owym tarballem
   (rozmiar pakietu to część pierwszego wrażenia).
5. Dopisz do `worktrail-release` bramkę: scenariusz przechodzi na bieżącym CLI.

## Acceptance criteria

- [x] Scenariusz w `docs/demo/scenario.md` jest odtwarzalny komenda po komendzie.
- [ ] Nagranie trwa ≤60 s i zawiera scenę odmowy PRZED sceną sukcesu.
- [ ] Nagranie jest widoczne z nagłówka README bez klikania.
- [x] Tarball npm nie niesie plików nagrania.
- [x] Bramka release'owa sprawdza aktualność scenariusza.

## Log

2026-09-01 pending — agent:claude — założony z analizy konkurencyjności: mechanizm bez demo jest niewidzialny; odmowa jest bardziej fotogeniczna niż sukces.
- 2026-09-01 in_progress — agent:claude — podjety; TL-82 i TL-49 zamkniete, blokady odpadly.
- 2026-09-01 in_progress — agent:claude — **NIE ZAMKNIETY: brakuje samego nagrania, i tylko jego.** Scenariusz PRZESZEDLEM NA ZYWO na swiezym katalogu (`git init` → `init` → `new` → kontrakt w frontmatterze → odmowa → poprawka → zielone zamkniecie); wszystkie bloki „oczekiwane wyjscie" w `docs/demo/scenario.md` sa przepisane z prawdziwego przebiegu, nie wymyslone. Krokow 3 (asciinema/GIF) nie da sie tu wykonac: na maszynie nie ma `asciinema`, `agg`, `vhs` ani `ttyrec`, a nagranie wymaga TTY. Zostaje dla czlowieka i dokladnie to opisuje wpis `manual:`.
- 2026-09-01 in_progress — agent:claude — README **CELOWO NIETKNIETY**. Kryterium „nagranie widoczne z naglowka" wymaga pliku, ktorego nie ma; odnosnik-placeholder w naglowku README bylby martwym linkiem na pierwszym ekranie, czyli dokladnie odwrotnoscia celu tego taska. Zapisany warunek na pozniej: odnosnik musi byc URL-em ABSOLUTNYM — `files` w `package.json` jest lista dozwolen bez `docs/`, wiec README w tarballu nie ma czego pokazac pod sciezka wzgledna.
- 2026-09-01 in_progress — agent:claude — bramka z kroku 5 zrobiona JAKO TEST, nie jako punkt na ludzkiej liscie: `scripts/tests/demo-scenario.test.mjs` odtwarza scenariusz przy kazdym przebiegu testow i asertuje trzy takty, na ktorych stoi nagranie — niezerowy kod wyjscia odmowy, PRAWDZIWE wyjscie testu w komunikacie (a nie streszczenie), oraz plik taska bajt w bajt nietkniety po odmowie. Scena 4 ma kontrole pozytywna: najpierw asertuje, ze pierwszy przebieg OBLEWA, wiec test nie moze przejsc na scenariuszu, ktory nigdy nie byl czerwony. Skill `worktrail-release` dostal §6b, ktore ten test wywoluje i dokłada trzy rzeczy do sprawdzenia okiem.
- 2026-09-01 in_progress — agent:claude — ZNALEZIONA OSTRA KRAWEDZ, warta zapisania poza tym taskiem: zagniezdzony `node --test` DZIEDZICZY `NODE_TEST_CONTEXT` i raportuje wynik do zewnetrznego runnera, konczac sie kodem 0. Test bramki byl przez to ZIELONY mimo oblewajacej weryfikacji — czyli dokladnie ten rodzaj falszywej zieleni, przed ktorym stoi cale narzedzie. Naprawione czyszczeniem `NODE_TEST_CONTEXT` i `NODE_OPTIONS` w srodowisku procesu potomnego, z komentarzem w miejscu. Dotyczy KAZDEGO taska, ktorego `verification:` wola `node --test`, gdy `worktrail done` jest wywolywany z wnetrza testu; w zwyklej powloce uzytkownika problem nie wystepuje.
- 2026-09-01 in_progress — agent:claude — 419/419 zielone, `check --language` zielony (20845 linii, 72 pliki publiczne). Odmowilem `--confirm-manual`: nagrania nie ma, wiec reczne poswiadczenie byloby dokladnie tym „sprawdzilem", ktore ten mechanizm wymienia jako NIE-dowod.
