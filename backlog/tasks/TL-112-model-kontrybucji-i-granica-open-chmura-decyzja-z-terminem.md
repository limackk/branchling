---
id: TL-112
title: "Model kontrybucji i granica open/chmura — decyzja z terminem ważności"
type: task
labels: [pre-launch]
board: main
epic: "Backlog — publikacja open source"
priority: P1
status: done
owner: agent:session
estimate: 2h
confidence: high
created: 2026-09-01
updated: 2026-09-02
blocked_by: []
blocks: [TL-53]
related_docs:
  - .claude/skills/worktrail-release/SKILL.md
verification:                      # English filename and probes: CLAUDE.md admits no
                                   # directory-shaped exception, and the original contract
                                   # grepped for a Polish stem that English text cannot carry
  - bash: "test -f docs/license-and-contributions.md && echo 'the decision document exists — OK' || { echo 'docs/license-and-contributions.md is missing'; exit 1; }"
  - bash: "for q in 'DCO' 'CLA' 'cloud' 'dual licensing'; do grep -qi \"$q\" docs/license-and-contributions.md || { echo \"the decision does not answer: $q\"; exit 1; }; done; echo 'four questions settled — OK'"
  - bash: "grep -q 'license-and-contributions' README.md CONTRIBUTING.md 2>/dev/null && echo 'the decision is visible to a contributor — OK' || { echo 'the decision is nowhere visible from outside'; exit 1; }"
---

## Cel

Wiadomo, na jakich warunkach przyjmujemy cudzy kod i gdzie biegnie granica
między tym, co publiczne, a tym, co zasila usługę w chmurze. Rozstrzygnięte
**przed publikacją**, bo po pierwszym przyjętym PR-ze ta decyzja przestaje być
możliwa do podjęcia jednostronnie.

To jest task DECYZYJNY, jak [TL-81](TL-81-kanaly-dystrybucji-i-kolizja-nazwy-worktrail-w-npx.md).
Wykonaniem jest zapisany wybór z uzasadnieniem, nie kod.

## Kontekst

Wyszło 2026-09-01 przy TL-48, z informacji, której **w backlogu nie było**:
właściciel rozważa uruchomienie worktrail jako usługi w chmurze. Zapytanie
`worktrail query --text "chmur|saas|monetyz"` zwracało zero tasków — cała analiza
publikacji stała dotąd na założeniu, że wydajemy tylko narzędzie.

**Dlaczego to ma termin ważności, a nie tylko priorytet.** Bez ustalonego modelu
każdy przyjęty PR jest cudzą własnością na licencji publicznej. Od tego momentu
zmiana licencji albo wydanie kodu na warunkach komercyjnych wymaga zgody
KAŻDEGO współautora z osobna. Decyzja nie drożeje — ona przestaje istnieć.
Projekty, które próbowały zmienić model po fakcie, płaciły za to latami.

**Co zostało już rozstrzygnięte i nie jest przedmiotem tego taska.** Licencja
narzędzia to MIT (TL-48, decyzja 2026-09-01). Ustalono tam również, że MIT i
Apache-2.0 są IDENTYCZNE na osi „czy konkurent może postawić usługę na naszym
kodzie" — obie na to pozwalają. Zamknęłaby to dopiero AGPL albo BSL/SSPL i obie
odrzucono: AGPL jest samobójcza dla narzędzia wciąganego do CUDZYCH
repozytoriów (część korporacyjnych polityk OSS zakazuje jej wprost), a
BSL/SSPL nie są open source i kosztują dokładnie tę wiarygodność, po którą się
publikuje.

**Wniosek, z którego bierze się ten task:** ochrona usługi ma iść z
architektury i znaku towarowego, nie z licencji CLI. To znaczy, że granica
open/chmura musi być NARYSOWANA, a nie domniemana — inaczej pierwszy sensowny
PR do CLI trafi w funkcję, która miała być po stronie płatnej.

## Pre-flight reading

1. `backlog/tasks/TL-48-*.md`, sekcja `## Log` — pełna analiza licencji z 2026-09-01,
   wraz z argumentami, które zostały ODRZUCONE i dlaczego. Nie powtarzaj tej pracy.
2. [TL-81](TL-81-kanaly-dystrybucji-i-kolizja-nazwy-worktrail-w-npx.md) — nazwa jako aktywo;
   przy usłudze w chmurze znak towarowy jest jedyną rzeczą chroniącą przed forkiem postawionym obok.
3. [TL-53](TL-53-ci-contributing-i-szablony-zgloszen-przed-publikacja.md) — `CONTRIBUTING.md`
   jest miejscem, w którym ta decyzja się MATERIALIZUJE; dlatego ten task go blokuje.
4. `.claude/skills/worktrail-release/SKILL.md` §8 — „zgłaszaj braki, nie twórz ich bez pytania";
   każdy element tej listy jest zobowiązaniem, które ktoś musi dotrzymać.

## Kroki

1. **Rozstrzygnij, czy przyjmujemy zewnętrzne kontrybucje w ogóle.** „Nie" jest
   pełnoprawną odpowiedzią i najtańszą w utrzymaniu — ale wtedy README ma to
   powiedzieć wprost, zamiast milczeć i odrzucać PR-y po fakcie.
2. Jeśli tak — wybierz między **DCO** (podpis `Signed-off-by`, lekki, bez
   przenoszenia praw) a **CLA** (przeniesienie lub szeroka licencja zwrotna,
   jedyna opcja zachowująca możliwość wydania kodu komercyjnie). Zapisz, co
   każdy z nich ODBIERA.
3. **Narysuj granicę open/chmura**: które funkcje z definicji należą do CLI, a
   które do usługi. Bez tej listy nie da się uczciwie odrzucić PR-a.
4. Rozstrzygnij, czy planujemy **dual licensing** (ten sam kod na MIT i na
   licencji komercyjnej). To jest możliwe TYLKO przy CLA lub przy jednym
   posiadaczu praw.
5. Zapisz wynik w `docs/licencja-i-kontrybucje.md` — po polsku, `docs/` to
   dokumentacja TEGO repozytorium — i podlinkuj go z README oraz z
   `CONTRIBUTING.md`, gdy ten powstanie (TL-53).

## Acceptance criteria

- [ ] `docs/licencja-i-kontrybucje.md` istnieje i odpowiada na wszystkie cztery
      pytania: kontrybucje tak/nie, DCO czy CLA, granica open/chmura, dual licensing.
- [ ] Przy każdej odpowiedzi zapisane, co ona ODBIERA — decyzja bez kosztu jest
      notatką, nie decyzją.
- [ ] Granica open/chmura ma postać listy, po której da się rozstrzygnąć
      konkretny PR, a nie zdania ogólnego.
- [ ] Dokument jest podlinkowany z README lub `CONTRIBUTING.md` — decyzja
      niewidoczna dla kontrybutora nie działa.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-09-01 created — agent:claude — wydzielone z TL-48 przy analizie licencji. Powód wydzielenia: to jedyna rzecz z tamtej analizy, która ma TERMIN — wygasa przy pierwszym przyjętym PR-ze, a nie przy publikacji. Blokuje TL-53, bo CONTRIBUTING.md nie da się napisać przed tą decyzją.
