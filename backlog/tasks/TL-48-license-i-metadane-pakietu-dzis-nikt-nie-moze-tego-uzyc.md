---
id: TL-48
title: "LICENSE i metadane pakietu — dziś nikt nie może tego użyć"
type: task
labels: [pre-launch]
board: main
epic: "Backlog — publikacja open source"
priority: P1
status: in_progress
owner: agent:claude
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - docs/worktrail-global-tool.md
  - .claude/skills/worktrail-release/SKILL.md
verification:
  - bash: "test -f LICENSE && echo 'LICENSE jest — OK'"
  - bash: "grep -q '\"private\": true' package.json && { echo 'nadal private'; exit 1; }; echo 'private zdjęte — OK'"
  - bash: "for k in license repository bugs homepage keywords description; do grep -q \"\\\"$k\\\"\" package.json || { echo \"brak metadanej: $k\"; exit 1; }; done; echo 'metadane komplet — OK'"
---

## Cel

Doprowadzić pakiet do stanu, w którym **da się go legalnie i praktycznie
przyjąć**: plik licencji, zdjęte `private`, i te pola `package.json`, które
składają się na stronę pakietu w npm.

## Kontekst

Zmierzone 2026-08-31 na czystym drzewie:

| Co | Stan |
|---|---|
| `LICENSE` | **nie istnieje** |
| `package.json` → `private` | `true` — `npm publish` odmawia |
| `package.json` → `license` | `"UNLICENSED"` |
| `repository`, `bugs`, `homepage`, `keywords` | brak wszystkich |

Dwie różne konsekwencje, obie twarde:

**Prawna.** Kod bez pliku licencji jest domyślnie „wszystkie prawa
zastrzeżone". W firmie przegląd prawny kończy się na brakującym pliku, niezależnie
od tego, co obiecuje README — a to właśnie firmowe wdrożenia są celem, do którego
ma prowadzić entuzjazm dewelopera.

**Handlowa.** Bez `repository`/`homepage`/`keywords` strona pakietu na npm jest
pustym prostokątem, a to ona jest ostatnim ekranem przed decyzją „spróbuję".

[TL-33](TL-33-packaging-instalacja-globalna-i-npx.md) (zamknięty) miał krok 5
„Licencja — wybór należy do foundera; task ma go wymusić, nie zgadnąć". Wymuszenie
nie zadziałało: task został zamknięty, pliku nie ma. Ten task jest tym samym
wymuszeniem, tym razem z weryfikacją, która oblewa na braku pliku.

**Wybór licencji należy do właściciela i nie jest do zgadnięcia.** MIT i Apache-2.0
różnią się w rzeczy, która ma znaczenie akurat dla adopcji firmowej: Apache-2.0
zawiera jawną klauzulę patentową, której działy prawne części firm oczekują, i jest
dłuższy. To jest decyzja do podjęcia, nie do wydedukowania z kodu.

## Pre-flight reading

1. `package.json` — całość; to sześć linii do zmiany, ale każda coś obiecuje.
2. `.claude/skills/worktrail-release/SKILL.md` §1 i §7 — bramka publikacji.
3. [TL-33](TL-33-packaging-instalacja-globalna-i-npx.md) — co już zrobiono w pakowaniu i dlaczego `files` jest listą dozwoleń.

## Kroki

1. **Zapytaj właściciela o licencję** (MIT / Apache-2.0 / inna) — nie wybieraj sam.
2. Dodaj `LICENSE` z pełnym tekstem wybranej licencji, z rokiem i właścicielem praw.
3. `package.json`: `"license"` na SPDX-owy identyfikator wybranej licencji, usuń `"private": true`.
4. Dodaj `repository` (typ + URL), `bugs`, `homepage`, `keywords`, dopracuj `description`.
5. `LICENSE` do listy `files` — pakiet bez tekstu licencji w tarballu nie niesie jej dalej.
6. `npm pack --dry-run` — potwierdź, że `LICENSE` jest w środku.

## Acceptance criteria

- [x] `LICENSE` istnieje i zawiera pełny tekst wybranej licencji.
- [x] `package.json` nie ma `"private": true`.
- [x] `license` jest identyfikatorem SPDX zgodnym z plikiem `LICENSE`.
- [ ] `repository`, `bugs`, `homepage`, `keywords`, `description` wypełnione.
- [x] `npm pack --dry-run` pokazuje `LICENSE` w tarballu.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 created — agent:claude — z audytu gotowości do publikacji
- 2026-09-01 in_progress — agent:claude — DECYZJA LICENCYJNA: **Apache-2.0**. Właściciel zapytany zgodnie z krokiem 1, oddelegował wybór po analizie. Trzy powody z TEGO projektu, nie z ogólnej tabelki: (1) task sam nazywa firmowe wdrożenia celem, a jawna klauzula patentowa §3 jest jedyną osią, na której MIT i Apache-2.0 różnią się w sposób dotykający tego celu; (2) §6 rezerwuje znak towarowy — ma to wartość, bo nazwa (wtedy `tasklog`, od 2026-09-01 `worktrail`) jest wciąż wstępna, a TL-81 zgłasza podejrzenie kolizji w npm, i MIT o nazwie nie mówi nic; (3) §5 definiuje warunki wkładu, więc pierwszy zewnętrzny PR nie wymaga osobnego CLA. Zero zależności = brak jakiegokolwiek ograniczenia zgodności od dołu. Koszt: ~200 linii zamiast ~20 i konwencja NOTICE. KONTRARGUMENT ZAPISANY UCZCIWIE: MIT jest normą npm i niższym progiem dla pojedynczego dewelopera; jeśli priorytetem jest rozpoznawalność, a nie przegląd prawny, MIT jest lepszy. Zamiana jest tania DOPÓKI właściciel jest jedynym posiadaczem praw autorskich — od pierwszego przyjętego PR-a wymaga zgody współautorów. To jest moment, w którym ta decyzja drożeje, a nie moment publikacji.
- 2026-09-01 in_progress — agent:claude — tekst licencji pobrany z kanonicznego źródła (https://www.apache.org/licenses/LICENSE-2.0.txt, 202 linie, 11358 B), nie przepisany z pamięci; sprawdzone obecnością pięciu znaczników (§3 patenty, §6 znaki towarowe, §9 gwarancje, nagłówek wersji, APPENDIX). Placeholder appendixu wypełniony: `Copyright 2026 Kamil Kwiatkowski`. NOTICE świadomie NIE utworzony — Apache-2.0 §4(d) czyni go obowiązkowym dla redystrybutorów dopiero gdy istnieje, a pusty NOTICE w projekcie bez cudzego kodu to zobowiązanie bez treści (skill worktrail-release §8: zgłaszaj braki, nie twórz ich bez pytania).
- 2026-09-01 in_progress — agent:claude — NIE ZAMKNIĘTY: weryfikacja 3/3 oblewa na `repository`, `bugs`, `homepage`. Właściciel wstrzymał metadane URL — repozytorium nie ma remote'a i adres nie jest do wydedukowania. Zrobione: LICENSE, zdjęte `private`, `license: Apache-2.0`, `keywords` (10), dopracowany `description`, LICENSE w `files` i potwierdzony w tarballu (11.3 kB, 35 plików, zero danych backlogu). Do domknięcia brakuje JEDNEGO wejścia: adresu repozytorium. Osobnego taska celowo nie zakładam — to krok 4 tego taska, odłożony decyzją właściciela, a nie nowy zakres. UWAGA: zdjęcie `private: true` usunęło bramkę przed przypadkową publikacją, którą TL-33 postawił świadomie; `npm publish` już nie oblewa, a nazwa pakietu jest wciąż otwarta w TL-81.
- 2026-09-01 in_progress — agent:claude — **DECYZJA ZMIENIONA: Apache-2.0 → MIT.** Właściciel podważył rekomendację kontrprzykładem (Backlog.md, bezpośredni odpowiednik w tej samej niszy, jest na MIT) i miał rację. Trzy argumenty za Apache rozebrane: (1) argument patentowy był PRZEJĘTY Z TREŚCI TEGO TASKA, nie zweryfikowany — korporacyjne polityki OSS mają listy dozwolonych licencji i MIT jest na każdej, a §3 chroni przed współautorem egzekwującym patent, co dla CLI czytającego markdown jest bliskie zeru; (2) argument o znaku towarowym był BŁĘDNY — §6 Apache doprecyzowuje, że licencja nie przyznaje praw do znaku, ale MIT też ich nie przyznaje: licencja copyright nie obejmuje nazwy, więc §6 nie jest ochroną, tylko doprecyzowaniem; (3) argument o CLA jest realny, ale mały — na GitHubie inbound=outbound wynika z regulaminu. PRZECIW Apache, niedoważone wcześniej: §4(b) wymaga od forkujących zaznaczania zmian, a to narzędzie jest z założenia wciągane do CUDZYCH repozytoriów — lżejszy warunek MIT to mniej pytań u adoptującego.
- 2026-09-01 in_progress — agent:claude — USŁUGA W CHMURZE (nowa informacja od właściciela, nieobecna dotąd w backlogu) NIE zmienia tego wyboru. MIT i Apache-2.0 są IDENTYCZNE na osi „czy konkurent może postawić usługę na moim kodzie" — obie na to pozwalają. Zamykają to dopiero AGPL (samobójcza tutaj: wiele korporacyjnych polityk zakazuje jej wprost, a to narzędzie jedzie do cudzych repozytoriów) albo BSL/SSPL (nie są open source). Ochrona usługi ma iść z ARCHITEKTURY — niepublikowany kod serwera, znak towarowy, wartość operacyjna — a nie z licencji CLI. Wniosek pochodny: nazwa awansuje z kosmetyki na aktywo, patrz TL-81. Model kontrybucji wydzielony do osobnego taska decyzyjnego, bo jako jedyna rzecz z tej analizy ma TERMIN WAŻNOŚCI.
- 2026-09-01 in_progress — agent:claude — tekst MIT pobrany ze SPDX (https://spdx.org/licenses/MIT.txt), zawinięty do 80 kolumn i sprawdzony słowo w słowo względem źródła (porównanie po tokenach: identyczne). `license: "MIT"` w manifeście, `LICENSE` w tarballu (1.1 kB, 35 plików bez zmian).
- 2026-09-01 in_progress — agent:claude — HAMULEC ODTWORZONY. Zdjęcie `private: true` usunęło bramkę, którą TL-33 postawił świadomie; w jej miejsce `scripts/check-publish-metadata.mjs` wpięty w `prepublishOnly`. `npm publish --dry-run` oblewa z kodem 2, dopóki brakuje `repository`/`bugs`/`homepage`. Świadome decyzje: (1) `prepublishOnly`, nie `prepublish` — ten drugi odpala się też przy zwykłym `npm install` i psułby stawianie drzewa roboczego; (2) bramka NIE jedzie w tarballu (`!scripts/check-publish-metadata.mjs` w `files`) — to narzędzie wydawcy, nie instalującego, potwierdzone `npm pack --dry-run` (35 plików bez zmian); (3) sprawdza WYŁĄCZNIE trzy adresy i mówi to w nagłówku pliku — pełna lista przedpublikacyjna jest procedurą ludzką (skill worktrail-release), a skrypt udający tę listę byłby gorszy niż jego brak, bo zielony przebieg czytałoby się jako „pakiet gotowy"; (4) placeholder (`example.com`, `<…>`, `TODO`) NIE przechodzi — bramka akceptująca wypełniacz uczy dokładnie tego, przed czym stoi. Test `scripts/tests/publish-gate.test.mjs`, 8 asercji, w tym kontrola pozytywna na WPIĘCIE (rozpięcie `prepublishOnly` oblewa test) — bramka podpięta do niczego przechodzi każdy test o własnej logice, a `npm publish` przelatuje obok. 375/375.
- 2026-09-01 in_progress — agent:claude — przy okazji dodany `scripts.test` (`node --test scripts/tests/*.test.mjs`) — blok `scripts` z samym `prepublishOnly` i bez `npm test` byłby dziwny, a TL-53 (CI) i tak tego potrzebuje. Poza zakresem tego taska; do usunięcia jedną linią, jeśli ma tam nie być.
