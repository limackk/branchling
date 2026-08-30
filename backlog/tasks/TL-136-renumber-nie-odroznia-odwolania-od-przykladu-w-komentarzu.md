---
id: TL-136
title: "renumber nie odroznia odwolania od przykladu w komentarzu"
type: task
labels: []
board: main
epic: "Integralność danych"
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
estimate: 2h                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs: []
verification:                      # JAK sprawdzić, że task naprawdę jest zrobiony
  - id: przyklad-nietkniety
    bash: "node --test scripts/tests/renumber.test.mjs"
---

## Cel

`worktrail renumber` ma **nie przepisywać ID, które jest przykładem, a nie
odwołaniem** — albo, jeśli nie da się ich odróżnić maszynowo, ma je wypisać
przed zapisem, żeby człowiek zdążył zareagować.

## Kontekst

Zmierzone 2026-09-01, na prawdziwym przebiegu renumeracji tego repozytorium
([[TL-135]]). Komentarze w kodzie ilustrowały działanie migracji przykładem:

```
 * function: `TL-1303` becomes `TL-1` only because of where it sat in one
 *           ordering of one tree at one moment.
```

`TL-1303` był w mapie jako prawdziwy task, więc został przepisany na `TL-1`
i zdanie zwinęło się w bezsensowne „`TL-1` becomes `TL-1`". To samo w trzech
plikach: `scripts/renumber.mjs` (3 miejsca), `scripts/history.mjs`,
`scripts/task-id.mjs` (3 miejsca).

**Dlaczego to nie jest literówka.** Przepisywarka zachowała się dokładnie
zgodnie ze specyfikacją — te ID BYŁY prawdziwymi ID i migracja miała je ruszyć.
Wada leży w tym, że w tekście dokumentacyjnym ID pełni dwie różne funkcje,
a narzędzie widzi tylko jedną. Uszkodzenie jest przy tym CICHE: żaden guard nie
oblewa, testy przechodzą, a zdanie tłumaczące najtrudniejszą decyzję w module
przestaje cokolwiek tłumaczyć. To najgorszy rodzaj uszkodzenia dokumentacji —
takie, które wygląda na poprawne.

**Jak naprawiono ręcznie** (i dlaczego to nie zamyka tematu): przykłady
przepięto na obcy prefiks `PROJ-`, którego żadna mapa tego repozytorium nie
obejmie. Działa, ale jest umową, o której nikt się nie dowie — następny autor
komentarza napisze `TL-1303`, bo tak wygląda ID w tym projekcie.

## Kroki

1. Rozstrzygnij, czy w ogóle da się to odróżnić maszynowo. Kandydaci:
   - ID w komentarzu/prozie stojące obok słowa „becomes", „→", „e.g." — kruche;
   - jawny znacznik przy linii, jak `product-name: allow` w [[TL-117]] —
     spójne z tym, co repozytorium już robi z wyjątkami dla guardów;
   - konwencja prefiksu przykładowego (`PROJ-`) UDOKUMENTOWANA i pilnowana
     guardem, zamiast ustnej umowy.
2. Jeśli odróżnienie jest niemożliwe: `renumber` ma przed zapisem wypisać
   ID trafione w plikach ŹRÓDŁOWYCH (`scripts/`, `bin/`) osobno od tych
   w backlogu i w `docs/`, bo to tam żyją przykłady.
3. Cokolwiek wyjdzie — nagłówek `scripts/renumber.mjs` ma o tym mówić.
   Dziś obiecuje, że nieznane ID zostaje nietknięte, i milczy o tym, że ZNANE
   ID w roli przykładu zostaje przepisane.

## Acceptance criteria

- [ ] ID użyte jako przykład przeżywa przebieg `renumber` nietknięte albo jest wypisane przed zapisem. [proof: przyklad-nietkniety]
- [ ] Test ma kontrolę pozytywną: fixture z przykładem, który BEZ poprawki zostaje uszkodzony. [proof: przyklad-nietkniety]
- [ ] Konwencja (znacznik albo prefiks przykładowy) jest zapisana tam, gdzie autor komentarza ją zobaczy, a nie tylko w tym tasku. [proof: przyklad-nietkniety]
