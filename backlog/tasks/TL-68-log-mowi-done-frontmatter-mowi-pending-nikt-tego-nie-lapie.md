---
id: TL-68
title: "Log mówi done, frontmatter mówi pending — nikt tego nie łapie"
type: bug
labels: [pre-launch]
board: main
epic: "Integralność danych"
priority: P2
status: pending
owner: unassigned
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-field-editing-history.md
verification:
  - bash: "node --test scripts/tests/log-status-agreement.test.mjs"
  - bash: "node scripts/cli.mjs check"
  - bash: "node scripts/cli.mjs doctor --json | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);const row=r.checks.find(c=>c.id==='log-status');if(!row){console.error('brak wiersza log-status w doctorze');process.exit(1)}console.log('doctor zna ten rozjazd — OK')})\""
---

## Cel

Złapać task, którego `## Log` mówi jedno, a pole `status:` drugie — bo dziś ten
rozjazd nie jest widziany przez żadną bramkę.

## Kontekst

Trafione 2026-08-31 na własnej pracy. [TL-52](TL-52-kolor-i-spojne-komunikaty-cli-w-jednym-module-ui-mjs.md)
miał w logu pięć wpisów `done`, zacommitowany kod i zielone testy — a w polu
`status: pending`. Przez to siedział w `INDEX.yaml` jako otwarty i wypadł z
archiwum, czyli **widoki kłamały o stanie projektu**.

Mechanizm pomyłki jest banalny i powtarzalny: wpis do logu i zmiana pola to dwie
osobne edycje tego samego pliku. Kiedy jedna się nie wykona — bo wywołanie
padło, bo podmiana nie znalazła wzorca, bo ktoś dopisał notatkę i zapomniał
przestawić status — plik zostaje w stanie wewnętrznie sprzecznym i **nic tego
nie zgłasza**. `check` sądzi kolizje numerów, boardy i odwołania; żaden z tych
trzech nie zagląda do środka pliku po to, żeby porównać go z nim samym.

**Dlaczego to jest warte guardu, a nie uważności.** Ten backlog jest po to, żeby
odpowiadać na pytanie „co jest zrobione". Task ze statusem sprzecznym z własnym
logiem odpowiada na nie źle, wygląda przy tym normalnie i nie ma powodu, żeby
ktokolwiek go otworzył. To jest dokładnie ta klasa, dla której powstały
pozostałe bramki tego projektu — cichy stan, który wygląda jak działanie.

Format logu jest zadeklarowany w szablonie: `YYYY-MM-DD status — kto — notatka`.
Ostatni wpis pasujący do tego kształtu niesie stan, do którego task doszedł.

**Czego ten guard NIE MOŻE robić.** Nie wolno mu poprawiać pliku. Sprzeczność
rozstrzyga człowiek, bo obie strony bywają prawdziwe: log może wyprzedzać pole
(praca skończona, status niezmieniony) albo pole może wyprzedzać log (status
przestawiony w viewerze, notatka niedopisana). Automat wybierający jedną ze stron
zamieniłby wykrytą sprzeczność w cichą decyzję.

## Pre-flight reading

1. `backlog/_template.md` — deklarowany format wpisu logu.
2. `scripts/check-backlog-refs.mjs` — najbliższy kształtem guard (czyta drzewo, wypisuje listę naruszeń, oblewa).
3. `scripts/doctor.mjs` — jak dokłada się wiersz do diagnozy; `doctor` woła guardy, nie przepisuje ich.
4. `scripts/task-fields.mjs` — `splitFrontmatter`, `extractMeta`.

## Kroki

1. Funkcja czytająca OSTATNI wpis logu pasujący do zadeklarowanego kształtu i zwracająca jego status; brak wpisów to nie naruszenie, tylko brak danych.
2. Guard porównujący ten status z polem `status:`. Naruszeniem jest różnica, nie brak.
3. Komunikat nazywa plik, obie wartości i datę ostatniego wpisu — żeby dało się rozstrzygnąć bez otwierania pliku.
4. Wpięcie w `worktrail check` jako czwarty guard oraz wiersz `log-status` w `doctor`.
5. Rozstrzygnij, czy to ma być błąd czy ostrzeżenie. Argument za ostrzeżeniem: wpis logu bywa dopisywany po zmianie statusu i przez chwilę stan jest sprzeczny w normalnej pracy. Argument za błędem: `check` biegnie przed commitem, a nie w trakcie edycji. Zapisz wybór i powód.
6. Test z kontrolą pozytywną w obie strony: plik zgodny przechodzi, plik z logiem `done` i polem `pending` OBLEWA. Bez tej drugiej połowy guard byłby zielony na całym dzisiejszym drzewie i nic by nie dowodził.

## Acceptance criteria

- [ ] Rozjazd ostatniego wpisu logu z polem `status:` jest wykrywany.
- [ ] Komunikat podaje plik, obie wartości i datę wpisu.
- [ ] Guard NICZEGO nie poprawia.
- [ ] Task bez wpisów w logu nie jest naruszeniem.
- [ ] Wpięte w `check` i widoczne w `doctor`.
- [ ] Test ma kontrolę pozytywną: fixture z rozjazdem MUSI oblać.
- [ ] Wybór błąd/ostrzeżenie zapisany w `## Log` z powodem.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 created — agent:claude — trafione na własnej pracy: TL-52 miał pięć wpisów `done` w logu i `status: pending` w polu, siedział w INDEX-ie jako otwarty i żadna bramka tego nie widziała
