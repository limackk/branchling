---
id: TL-31
title: "Retencja, korekta atrybucji i prawo do usunięcia"
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
blocked_by: [TL-28]
blocks: []
related_docs:
  - docs/backlog-time-tracking.md
  - origin#docs/architecture/legal-and-compliance.md
verification:
  - bash: "node --test backlog/scripts/tests/retention.test.mjs backlog/scripts/tests/reassign.test.mjs"
  - bash: "node backlog/scripts/cli.mjs activity forget --actor local:test --dry-run"
---

## Cel

Domknąć trzy rzeczy, bez których log aktywności nie może opuścić jednej maszyny: **ile go trzymamy**, **jak się go pozbyć** i **jak poprawić błędną atrybucję**. Bez nich moduł zbiera dane osobowe bez terminu ważności i bez ścieżki wyjścia.

## Kontekst

Od TL-28 `backlog/activity/` zaczyna zawierać zapis tego, **o której godzinie konkretny człowiek pracował**, dzień po dniu. W publicznym repozytorium to metadane nadzoru, a nie telemetria projektu; w repo firmowym to dane pracownicze; w UE — dane osobowe.

Trzy braki, wszystkie zidentyfikowane w adwersarialnym przeglądzie projektu, wszystkie o tej samej naturze („mechanizm zbiera, nic nie oddaje"):

1. **Brak retencji.** Log rośnie w nieskończoność i nie ma odpowiedzi na pytanie „jak długo to trzymacie". To pierwsze pytanie zewnętrznego użytkownika z UE i pierwsze pytanie każdego zespołu, który to wdroży u siebie.
2. **Brak usunięcia.** Nie ma polecenia, którym osoba wycofuje swoje dane. Kasowanie ręczne plików nie wystarcza, bo agregaty (`rollup/BL-NNNN.json`) są wyliczone z surowych wierszy i przeżyłyby usunięcie źródła — czyli dane wróciłyby przy pierwszym raporcie.
3. **Brak korekty.** Log jest append-only, więc pierwsza pomyłka atrybucji (praca nad BL-A zapisana na BL-B) zostaje na zawsze i po cichu psuje kalibrację. To jest gwarantowany pierwszy zgłoszony błąd, a nie hipotetyczny.

**Dlaczego to faza 1b, a nie 4:** dane osobowe zaczynają powstawać w chwili uruchomienia TL-28. Mechanizm ich kasowania nie może przyjść „później" — może być za TL-28 w kolejności prac, ale nic nie ma prawa opuścić jednej maszyny, zanim ten task będzie zamknięty.

## Pre-flight reading

1. `docs/architecture/backlog-time-tracking.md` — §9 (prywatność, retencja, korekta), §5 (kształt wiersza, `kind: reassign`), §13 (czym ten mechanizm NIE jest).
2. `docs/architecture/legal-and-compliance.md` — konwencje workspace'u dla danych osobowych i okien retencji.
3. `backlog/scripts/activity.mjs` (TL-27) i `attribution.mjs` (TL-28).
4. `backlog/scripts/config.mjs` — `activity_retention_days` i `activity_privacy` są już w schemie (TL-27 krok 7); tu dochodzi tylko ich UŻYCIE.

## Kroki

1. `worktrail activity prune` — kasuje surowe heartbeaty starsze niż `activity_retention_days` (domyślnie 90) i **przelicza agregaty przed kasowaniem**, żeby okno retencji nie zjadało historycznej kalibracji. Agregat przeżywa, bo w tej rozdzielczości nie jest już danymi o osobie.
2. Uruchamianie `prune`: przy starcie serwera viewera i z hooka, tą samą konwencją co `build-backlog.mjs` — mechanizm, o którym trzeba pamiętać, nie jest mechanizmem.
3. `worktrail activity forget --actor <a>` — kasuje surowe wiersze aktora **i** przelicza agregaty, żeby dane nie wróciły przy najbliższym raporcie. `--dry-run` drukuje, co by zniknęło, i niczego nie dotyka.
4. `worktrail activity reassign --from BL-A --to BL-B --session S [--since TS]` — dopisuje zdarzenie `kind: "reassign"`. Log jest append-only, więc korekta jest **nowym zdarzeniem, nie edycją historii**; czytnik stosuje ją przy odczycie, tak jak `readHistory()` stosuje dedup.
5. Kolejność stosowania korekt musi być deterministyczna (po ULID), a `reassign` na `reassign` musi się składać — jest na to test.
6. `worktrail activity report --privacy` — drukuje aktualne okno retencji, tryb `activity_privacy` i to, które pliki są wersjonowane. Jedno miejsce, w którym użytkownik sprawdza, co narzędzie o nim trzyma.
7. Sekcja w publicznym README (EN): co jest zbierane, gdzie leży, jak długo, jak usunąć. Treść po angielsku — powierzchnia publiczna, patrz [TL-20](TL-20-domknij-nazwe-narzedzia-przed-publikacja.md).

## Acceptance criteria

- [ ] `prune` kasuje wyłącznie wiersze starsze niż okno i NIE rusza agregatów — jest na to test.
- [ ] Agregat jest przeliczony PRZED kasowaniem; test sprawdza, że minuty sprzed okna nie znikają z kalibracji.
- [ ] `forget --actor` kasuje surowe wiersze i przelicza agregaty; po nim raport nie odtwarza danych aktora.
- [ ] `forget --dry-run` niczego nie dotyka — test porównuje sumy kontrolne plików przed i po.
- [ ] `reassign` jest zdarzeniem dopisanym, nie edycją istniejących wierszy — test czyta plik i sprawdza, że stare wiersze są nietknięte.
- [ ] Dwa `reassign` na tej samej sesji składają się w deterministycznej kolejności (po ULID).
- [ ] Minuty po `reassign` przenoszą się w całości: suma per task się zgadza, nic nie ginie i nic się nie dubluje.
- [ ] `report --privacy` drukuje okno retencji, tryb i listę wersjonowanych ścieżek.
- [ ] README (EN) opisuje zbierane dane, retencję i ścieżkę usunięcia.
- [ ] `qa/backlog-time-tracking.yaml` rozszerzone o przypadki retencji, `forget` i `reassign`.

## Verification

```bash
# 1. Retencja i korekta — expected: pass, w tym reassign na reassign
node --test backlog/scripts/tests/retention.test.mjs backlog/scripts/tests/reassign.test.mjs

# 2. forget --dry-run niczego nie dotyka — expected: sumy identyczne
find backlog/activity -name '*.jsonl' -exec shasum {} \; | sort > /tmp/przed.txt
node backlog/scripts/cli.mjs activity forget --actor local:test --dry-run
find backlog/activity -name '*.jsonl' -exec shasum {} \; | sort > /tmp/po.txt
diff /tmp/przed.txt /tmp/po.txt && echo 'dry-run czysty — OK'

# 3. Użytkownik widzi, co narzędzie o nim trzyma — expected: okno, tryb, ścieżki
node backlog/scripts/cli.mjs activity report --privacy

# 4. Guardy modułu nadal zielone
node backlog/scripts/cli.mjs check
```

## Notes

- **To nie czyni z modułu narzędzia zgodnego z RODO „z pudełka"** i README nie ma tego sugerować. Daje wdrażającemu mechanizmy (minimalizacja, retencja, usunięcie, sprostowanie); podstawa prawna, informowanie osób i ocena skutków zostają po stronie tego, kto to wdraża.
- Świadomie poza zakresem: uwierzytelnianie aktora (bez niego `forget --actor` opiera się na deklaracji, nie dowodzie — to samo ograniczenie, które [worktrail-state-and-sync.md §6.1](../../docs/worktrail-state-and-sync.md) nazywa granicą wersji lokalnej), szyfrowanie logu, eksport danych osoby.
- `--dry-run` w `forget` jest wymagany, nie opcjonalny: to polecenie kasuje dane bez kosza.

## Log

- 2026-08-30 created — claude — z adwersarialnego przeglądu projektu pomiaru czasu; trzy braki (retencja, usunięcie, korekta atrybucji) blokujące wypuszczenie modułu poza jedną maszynę
