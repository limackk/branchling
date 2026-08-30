---
id: TL-11
title: "Guard pre-commit na pole board — partycja nie może się rozjechać po cichu"
type: code
labels: [post-launch, ops-hardening]
board: main
epic: ""
priority: P2
status: done
owner: claude
estimate: 2h
confidence: high
created: 2026-08-29
updated: 2026-08-29
blocked_by: []
blocks: []
related_docs:
  - backlog/boards.yaml
verification:
  - bash: "node --test backlog/scripts/tests/boards.test.mjs"
  - bash: "node backlog/scripts/check-backlog-boards.mjs --all"
---

## Cel

Zamknąć lukę zostawioną świadomie w TL-9: pola `board:` pilnował tylko test modułu, a nie hook. Commit z brakującym albo literówkowym slugiem przechodził, jeśli nikt po drodze nie odpalił generatora.

## Kontekst

`build-backlog.mjs` oblewa na nieznanym slugu od TL-9 — ale generator ocenia tylko to, o co się go zapyta. Task z `board: backlog_project` (podkreślnik zamiast myślnika) wchodził do repo bez sprzeciwu i psuł widoki dopiero u następnej osoby, która zawołała build. To ten sam kształt, który guard tożsamości ID zamknął w BL-900..903: detektor, na którym nic nie potrafi oblać, jest ostrzeżeniem, a nie zabezpieczeniem.

**Zakres jest inny niż w guardzie ID i to jest decyzja, nie niedopatrzenie.** Kolizja ID jest własnością ZBIORU — nie da się jej ocenić z jednego pliku, więc tamten guard czyta całe drzewo. Board jest własnością POJEDYNCZEGO pliku, a w tym drzewie pracują równolegle dwie sesje (podczas TL-9 obok leżał niezacommitowany task innej sesji, podczas tej sesji — BL-1381). Guard czytający całe drzewo oblewałby MÓJ commit z powodu CUDZEJ pracy w toku, czyli uczyłby `--no-verify`. Dlatego hook podaje guardowi pliki ze stage'a.

**Jeden wyjątek:** gdy w commicie jest sam `boards.yaml`, sprawdzane jest całe drzewo. Usunięcie albo przemianowanie boarda osierociłoby wszystkie taski wskazujące na ten slug — a żadnego z nich nie ma w commicie. Kontrola po samych staged plikach przepuściłaby więc dokładnie tę zmianę, która psuje najwięcej plików.

Guard waliduje też sam rejestr (zduplikowany slug, `default` wskazujący na nieistniejący board) — zepsuty rejestr wywraca generator, a jest jednym plikiem, więc sprawdzenie jest darmowe.

## Acceptance criteria

- [x] `backlog/scripts/check-backlog-boards.mjs` — brak pola, nieznany slug, zepsuty rejestr → exit 1 z nazwą pliku.
- [x] Wpięty w `.githooks/pre-commit` + zadeklarowany w `GUARD_MANIFEST` (brak skryptu = głośno, nie cichy skip).
- [x] Staged-only, z wyjątkiem commita ruszającego `boards.yaml` → `--all`.
- [x] Kontrola pozytywna: realna próba commita z taskiem bez `board:` została zablokowana z właściwym komunikatem.
- [x] Testy: 17/17 zielonych (8 nowych przypadków guardu).

## Verification

```bash
node --test backlog/scripts/tests/boards.test.mjs
node backlog/scripts/check-backlog-boards.mjs --all       # ✓ realne drzewo
```

Kontrola pozytywna (wykonana 2026-08-29, nie tylko opisana): task `BL-9999` bez `board:` → `git commit` odrzucony komunikatem „task bez poprawnego `board:`". Plik sondy usunięty.

## Notes

Testy guardu asertują też, że w wyjściu nie ma `MODULE_NOT_FOUND` — bo brakujący skrypt kończy się kodem 1 tak samo jak wykryte naruszenie. Bez tego przypadek „zduplikowany slug" był zielony, ZANIM guard w ogóle powstał (zaobserwowane w tej sesji).

Nie wpięte w `pre-merge-commit`: ten hook jest celowo wąski i pilnuje niezmiennika, który powstaje DOPIERO przy zetknięciu gałęzi (kolizja ID). Board jest własnością pliku i został sprawdzony przy commicie, który go wniósł — merge nie tworzy nowych naruszeń tego typu.

## Log

- 2026-08-29 done — claude — guard staged-only + `--all` przy zmianie rejestru; kontrola pozytywna na realnym commicie
