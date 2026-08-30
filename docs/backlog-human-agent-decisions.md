# Backlog — wykonawca human/agent, rejestr decyzji, panel i graf

**Status:** PLANNED 2026-09-01
([TL-113](../backlog/tasks/TL-113-pole-executor-wymog-czlowieka-egzekwowany-w-dyspozytorze.md),
[TL-114](../backlog/tasks/TL-114-zdarzenie-decision-i-komenda-worktrail-decide.md),
[TL-115](../backlog/tasks/TL-115-panel-decyzyjny-w-viewerze-co-czeka-na-czlowieka.md),
[TL-116](../backlog/tasks/TL-116-graf-zmian-taska-w-viewerze-z-osi-historii.md))
**Buduje na:** rolach i handoffie
([TL-97](../backlog/tasks/TL-97-pole-role-taska-wymog-roli-ze-slownika-konfiguracji.md),
[TL-98](../backlog/tasks/TL-98-role-w-dyspozytorze-i-petli-next-role-agent-per-rola.md),
[TL-99](../backlog/tasks/TL-99-worktrail-handoff-przekazanie-taska-z-powodem-i-sladem.md))
oraz mechanice historii ([backlog-field-editing-history.md](backlog-field-editing-history.md)).

---

## 1. Problem

W przepływie z agentami część decyzji może podjąć agent (odpowiedź jest
w dokumentacji), a część MUSI podjąć człowiek (decyzja produktowa) — i to
niezależnie od roli: ten sam „analityk" raz jest agentem, raz człowiekiem.
Do tego dwie potrzeby wglądu: każda decyzja ma być zapisana i możliwa do
obejrzenia jako graf przebiegu taska, a człowiek ma mieć jedno miejsce,
w którym widzi, co wisi na jego decyzji, i może odblokować pracę.

## 2. Human vs agent to trzecia oś, nie nowa rola

Cztery pytania, cztery różne miejsca — pomieszanie ich było głównym ryzykiem
tego projektu:

| Pytanie | Czyja własność | Gdzie |
|---|---|---|
| Jakiej KOMPETENCJI wymaga task? | taska (dane) | `role:` — słownik projektu (TL-97) |
| Czy TA decyzja wymaga człowieka? | taska (dane) | `executor: human` (TL-113) |
| Czy mam agenta do tej roli? | wdrożenia użytkownika | mapa `run_agent_commands` (TL-98) |
| Kto faktycznie zapisał zmianę? | historii | `actor` z przestrzenią `agent:`/`local:`/`user:` (TL-21) |

Rozstrzygnięcia (2026-09-01):

- **Odrzucone: role `analyst-human`/`analyst-agent`.** Kartezjański rozrost
  słownika; dyspozytor traci „analityk dowolny"; kompetencja i gatunek
  wykonawcy to różne osie.
- **Odrzucone: sama eskalacja przez brak wpisu w mapie `run`.** Brak wpisu
  to fakt o wdrożeniu („nie mam agenta-analityka"), wymóg człowieka to fakt
  o konkretnym tasku — jedzie w jego frontmatterze przez review (Prawo 1).
  Warstwy są rozłączne (Prawo 3); jedna nie zastępuje drugiej.
- **`executor` ma stały kształt `human|agent` w kodzie, bez słownika
  w `config.yaml`** — to kształt pola, jak zamknięte przestrzenie nazw
  aktorów, nie słownictwo projektu.
- **Dyspozytor zna gatunek wołającego z przestrzeni nazw aktora** —
  `agent:` vs reszta; zero nowej konfiguracji.
- **Egzekwowanie wyłącznie w dyspozytorze** (`next`/`run`): pominięcie
  z jawnym zliczeniem („N tasków czeka na człowieka"), nigdy cisza.
  Jawne `take` działa i jest odnotowywane — człowiek, który każe agentowi
  zrobić wskazany task, sam jest tą decyzją człowieka (zasada z TL-97).

## 3. Decyzja jako zdarzenie pierwszej klasy

Handoff (TL-99) zapisuje PYTANIE jako `__comment__`. Odpowiedź dostaje
własny typ zdarzenia `__decision__` (TL-114), bo komentarz i decyzja różnią
się maszynowo: panel liczy „pytania bez decyzji", graf rysuje decyzje jako
węzły.

```json
{"ts":"…","task":"TL-1234","field":"__decision__",
 "to":"Robimy wariant B, bo…","resolves":"<ULID pytania>",
 "actor":"local:kamil","source":"viewer","id":"<ULID>"}
```

- **Otwarte pytanie** := zdarzenie pytania, na które nie wskazuje żadne
  `__decision__.resolves`. To cała definicja stanu „czeka na decyzję" —
  wyliczalna z historii, bez nowego pliku stanu (Prawo 2).
- `resolves` jest opcjonalne (decyzja bez pytania jest legalna); wskazanie
  ULID-a spoza historii taska oblewa przed zapisem.
- Decyzja agenta i człowieka mają identyczny schemat — różni je przestrzeń
  aktora; audyt „decyzje agentów" to jeden filtr.
- Wejścia: `worktrail decide` (CLI, Prawo 4) i akcja w viewerze — obie tą samą
  drogą zapisu; obie zostawiają też ludzką linię w `## Log` taska.

## 4. Panel „czeka na Ciebie"

Czysty widok wyliczony z trzech zapytań (TL-115):

1. otwarte, odblokowane taski `executor: human` + taski z rolą bez wpisu
   w mapie agentów;
2. otwarte pytania (definicja z §3), z pytającym i wiekiem pytania;
3. dla każdej pozycji — przechodnie `blocks`: „odblokowuje N tasków" jest
   jednostką priorytetu i domyślnym sortowaniem panelu.

Rozstrzygnięcia: panel liczy z żywych `tasks/*.md` i historii (nigdy
z wygenerowanych widoków); akcje piszą wyłącznie istniejącymi endpointami
(jedna ścieżka zapisu — lekcja z [backlog-field-editing-history.md](backlog-field-editing-history.md) §5);
filtr „na mnie" działa na deklaracji aktora do czasu twardej tożsamości
(tamtejszy §7 pkt 2); w trybie `file://` panel jest widoczny bez akcji;
stan filtrów w URL.

## 5. Graf zmian taska

Drugi render istniejącej osi historii (TL-116), zero nowych danych: węzły
to zdarzenia znaczące (utworzenie, przejścia statusów, handoffy, pytania,
decyzje), pozostałe zmiany pól zwinięte; para pytanie→decyzja połączona po
`resolves`; kolor rozróżnia `agent:`, człowieka i `unknown`. Fold historii
jest współdzielony z time-lapsem boardu
([TL-91](../backlog/tasks/TL-91-time-lapse-boardu-odtwarzany-z-logu-zdarzen.md))
— dwa osobne foldy rozjechałyby się w definicjach. Granica danych jawna:
historia zaczyna się 2026-08-30 i graf tego nie ukrywa.

## 6. Kolejność wdrożenia

TL-113 (pole + dyspozytor) → TL-114 (zdarzenie + `decide`) →
TL-115 (panel) ∥ TL-116 (graf). Wszystko kompozycją istniejących
prymitywów; silnika workflow świadomie nie ma (decyzja z TL-97 — „role
nie są workflow").
