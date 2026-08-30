---
id: TL-95
title: "Adapter LLM do seeda: opis projektu w plan taskow"
type: task
labels: []
board: main
epic: "Wyróżniki agentowe"
priority: P2
status: pending
owner: unassigned
estimate: 1d
confidence: low
created: 2026-08-31
updated: 2026-08-31
blocked_by: [TL-94]
blocks: []
related_docs:
  - docs/worktrail-global-tool.md
verification:
  - bash: "node --test scripts/tests/seed-adapter.test.mjs"
---

## Cel

Adapter zamieniający opis projektu (`spec.md`, README, dowolna proza) na plan
JSON w formacie wejściowym `worktrail seed` (TL-94), przy użyciu modelu
wskazanego w konfiguracji użytkownika. Pierwszy obsługiwany backend: **Ollama**
(`localhost:11434`) z wymuszeniem struktury odpowiedzi przez `format` ze
schematem JSON; ten sam kod obsługuje każdy endpoint zgodny z API OpenAI, więc
jeden adapter pokrywa modele lokalne i hostowane.

Efekt użytkownika: `worktrail seed --from spec.md` bez klucza API i bez
abonamentu — `ollama pull` wystarcza, żeby demo z README zadziałało za darmo.

## Kontekst

Powstało z decyzji produktowej (2026-08-31) o scenariuszu „jeden prompt →
działający projekt". Granica z TL-94 jest twarda: rdzeń `seed` waliduje
i zapisuje, adapter WYŁĄCZNIE produkuje plan. Adapter może być osobnym
skryptem wołanym przez `seed --from` albo samodzielnie (`adapter | worktrail
seed`) — obie drogi mają działać, bo druga jest powierzchnią dla cudzych
adapterów (Prawo 4).

Decyzje i ograniczenia:
- **Endpoint i model to warstwa użytkownika** (`~/.worktrail/config.yaml`,
  TL-34): fakt o maszynie człowieka, nie o projekcie — zgodnie z Prawem 3
  ([docs/worktrail-global-tool.md](../../docs/worktrail-global-tool.md) §3).
  Żadnego URL-a ani nazwy modelu w kodzie.
- **Prompt-szablon jest daną** (plik w pakiecie, nadpisywalny), nie stringiem
  w kodzie — użytkownik musi móc go dostroić bez forka.
- **Wynik modelu jest niezaufany**: walidacją planu zajmuje się rdzeń seeda
  i to jest jedyna bramka. Adapter przy odrzuceniu planu przez seed może
  JAWNIE ponowić z komunikatem błędów (limit prób w konfiguracji); po
  wyczerpaniu prób pokazuje surowy plan i błędy, zamiast poprawiać go po
  cichu własną heurystyką.
- **Lokalne modele planują słabiej niż frontier** — to jest założenie do
  obalenia pomiarem, nie do ukrycia: adapter loguje model w metadanych planu,
  a jakość planów per model zmierzy się później danymi z backlogu
  (odsetek tasków oblewających weryfikację, reopeny — TL-90).
- Testy NIE wołają prawdziwego modelu: backend HTTP jest mockowany
  fixture'ami odpowiedzi (poprawna, niepoprawny JSON, plan bez weryfikacji).
  Jeden test ręczny end-to-end z żywą Ollamą opisany w tasku jako procedura,
  nie jako test automatyczny.

## Pre-flight reading

- `backlog/tasks/TL-94-worktrail-seed-plan-projektu-jako-wejscie-do-backlogu.md`
  — format planu i zachowanie walidacji; adapter jest jego klientem.
- [docs/worktrail-global-tool.md](../../docs/worktrail-global-tool.md) §3 —
  Prawo 3 (warstwa użytkownika) i Prawo 4 (kompozycja).
- `scripts/config.mjs` — jak czytana jest konfiguracja; klucze adaptera
  dochodzą do warstwy użytkownika, nie projektu.

## Kroki

1. Klucze konfiguracji użytkownika: endpoint, model, limit prób; brak
   konfiguracji = czytelny komunikat z instrukcją (w tym `ollama pull`),
   nie traceback.
2. Prompt-szablon jako plik: rola, format planu (z przykładem), wymóg
   wykonywalnych weryfikacji i zależności; podstawienie treści `spec.md`.
3. Wywołanie backendu: Ollama `format` ze schematem / OpenAI-compatible
   `response_format`; timeout i czytelne błędy sieci.
4. Pętla popraw: plan → `worktrail seed --dry-run` → przy odrzuceniu ponowienie
   z listą błędów w prompcie, do limitu; każda próba raportowana na stderr.
5. Testy na mockowanym HTTP: szczęśliwa ścieżka, JSON niedomknięty, plan
   odrzucony przez seed i naprawiony w drugiej próbie, wyczerpany limit.

## Acceptance criteria

- [ ] Adapter działa przez `seed --from` I jako samodzielny producent na
      stdout — oba przypadki mają test.
- [ ] Żadnego endpointu, modelu ani promptu zaszytego w kodzie.
- [ ] Odrzucenie planu przez seed kończy się jawnym ponowieniem albo jawną
      porażką — nigdy cichą korektą planu przez adapter.
- [ ] Testy przechodzą bez uruchomionej Ollamy i bez sieci.
- [ ] Metadane planu niosą użyty model (wejście do przyszłego pomiaru jakości
      planów per model).

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 blocked — agent:claude — task założony pod scenariusz „jeden
  prompt → działający projekt"; czeka na format planu z TL-94. Pierwszy
  backend: Ollama, ten sam kod dla endpointów OpenAI-compatible.
