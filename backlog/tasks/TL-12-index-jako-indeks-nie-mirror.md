---
id: TL-12
title: "INDEX.yaml jako indeks, nie kopia frontmattera — 149 KB → 70 KB"
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
  - backlog/README.md
verification:
  - bash: "node --test backlog/scripts/tests/boards.test.mjs"
  - bash: "node backlog/scripts/build-backlog.mjs && wc -c backlog/INDEX.yaml"
---

## Cel

`INDEX.yaml` powielał cały frontmatter — 337 tasków × ~15 linii = 149 KB, czyli ~37k tokenów przy każdym odczycie. Indeks ma pozwolić **wybrać** task, a nie go opisać; opis stoi w pliku taska, który jest SSOT.

## Kontekst

Zmierzone przed zmianą: `FOCUS.yaml` 14 KB (~3,5k tok), `INDEX.yaml` 149 KB (~37k tok). Rozmowa zaczęła się od pytania, czy usunąć pole `focus` „dla oszczędności tokenów" — pomiar pokazał, że cały focus to 3,5k, a dziesięciokrotność tego leży w indeksie, który przepisuje dane obecne w taskach.

Co wypadło z wiersza i dlaczego akurat to:
- `type`, `owner`, `estimate`, `confidence`, `created`, `updated` — opis taska, nie kryterium wyboru pracy;
- `file` — nazwa pliku to `tasks/<id>-*.md`, a glob po samym ID jest jednoznaczny, bo pilnuje tego guard tożsamości (BL-900..903);
- `epic` — stoi w nagłówku grupy, w wierszu był płacony 337 razy;
- `board` w widokach **per board** — z tego samego powodu co epic (nagłówek pliku już go podaje);
- `blocks` — odwrotność `blocked_by`, wyprowadzalna z pozostałych wierszy tego samego pliku.

Zostało to, po czym realnie wybiera się pracę: `id`, `priority`, `status`, `board`, `labels`, `blocked_by`, `title` (+ `focus`, dopóki pole istnieje).

Wiersz jest flow-mappingiem YAML, nie tekstem — indeks ma zostać maszynowy. Wymusiło to osobne cytowanie: w `{...}` wartość kończy nie tylko koniec linii, ale też `,` i `}`, więc tytuł „Rozdziel produkcję IG na posts i stories, bo…" bez cudzysłowów rozpadłby się na dwa pola (`yFlowStr`, obok istniejącego `yStr` dla formy blokowej).

Nikt nie parsuje `INDEX.yaml` maszynowo poza generatorem — sprawdzone gerpem po repo przed zmianą (viewer i guardy czytają `tasks/*.md`), więc zmiana formatu nie miała konsumenta do zepsucia. Konsumentem jest człowiek i agent.

## Acceptance criteria

- [x] Jedna linia na task, poprawny YAML (zweryfikowany prawdziwym parserem: 337 + 337 + 55 + 1006 wpisów w czterech widokach).
- [x] `INDEX.yaml` < 75 KB — jest 69,6 KB (~17k tok, było ~37k).
- [x] Widoki per board bez kolumny `board`.
- [x] README: §2, §3.3, §5.1 i quick-reference zgodne z nowym kształtem.
- [x] Testy: 28/28 zielonych (4 nowe przypadki kontraktu INDEX-u).

## Verification

```bash
node backlog/scripts/build-backlog.mjs
wc -c backlog/INDEX.yaml            # < 75 000
node --test backlog/scripts/tests/boards.test.mjs
```

## Notes

Próg 75 KB w teście jest ratchetem: gdy backlog urośnie, ma paść po to, żeby ktoś **świadomie** zdecydował, co dalej (paginacja? indeks per board jako domyślny odczyt?), a nie po to, żeby indeks po cichu wrócił do roli kopii.

Dwa protokoły w README wskazywały pola, których już nie ma — poprawione w tym samym commicie: §5.1 krok 3 mówił „sprawdź `blocks:` w INDEX-ie" (teraz: `grep 'blocked_by:.*BL-NNN'`), a quick-reference pokazywał `yq` z polem `owner`.

Zaobserwowane przy okazji, NIE naprawiane (dane, nie format): kilka tasków ma w tytule literalne `\"` zamiast cudzysłowu zamykającego (np. BL-1157, BL-1055). Stary indeks niósł dokładnie to samo — to defekt źródła, nie regresja.

Następny krok w tej samej rozmowie: `NOW.yaml` wyliczany zamiast pola `focus` (osobny task, gdy founder zdecyduje).

## Log

- 2026-08-29 done — claude — wiersz jednolinijkowy, próg rozmiaru w teście, README zsynchronizowane
- 2026-08-29 renumbered — claude — kolizja BL-1384 z taskiem dashboardu (9 odwołań w kodzie mobilnym vs 1 tutaj); numer 1385 z `next-backlog-id.mjs`, kryterium „mniej odwołań" z backlog/README.md §3.4
