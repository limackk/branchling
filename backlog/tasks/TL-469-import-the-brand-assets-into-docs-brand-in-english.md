---
id: TL-469
title: "Import the brand assets into docs/brand in English"
type: task
labels: []
board: main
epic: "Brand identity"
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-10-16
updated: 2026-10-16
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: [TL-470, TL-471, TL-472]                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: brand-files-present
    bash: "test -f docs/brand/logo/branchling-horizontal-color.svg && test -f docs/brand/logo/branchling-horizontal-on-dark.svg && test -f docs/brand/logo/branchling-symbol-color.svg && test -f docs/brand/social/og-1200x630.png && test -f docs/brand/README.md"
  - id: brand-english-only
    bash: "! find docs/brand | grep -E 'kolor|czarny|bialy|ciemnym|jasny|ikony|wytyczne|fonty|przeglad|decyzje|licencja' && ! grep -rIl -E 'Wygenerowano|udziałem|decyzje|kolor|czarny|biały|ciemnym' docs/brand"
  - id: brand-ai-disclosure-kept
    bash: "n=$(find docs/brand -name '*.svg' | wc -l); test "$n" -gt 0 && test -z "$(grep -L 'Article 50' $(find docs/brand -name '*.svg'))""
  - id: brand-not-in-tarball
    bash: "npm pack --dry-run --json 2>/dev/null | node -e 'const f=JSON.parse(require("fs").readFileSync(0))[0].files.map(x=>x.path); if(!f.includes("README.md")) process.exit(2); if(f.some(p=>p.startsWith("docs/brand"))) process.exit(1)'"
  - id: brand-suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

The approved brand assets live in the repository under `docs/brand/`, every filename and every sentence in them is English, the AI-disclosure metadata survives in English, and none of it ships in the npm tarball. The README, the viewer and the GitHub social preview tasks all depend on this one: they reference files that must be versioned first.

## Context

The logo was produced in Brand Studio and delivered outside the repository as an export that exists only on the owner's machine (`~/workspace/backup/branchling-brand`); anyone else has to obtain it from the owner, because it is not versioned anywhere. It is a lowercase b whose bowl leans away from the stem like a shoot growing from a trunk; palette 'Graphite and tangerine' (primary #1E1C1A, accent #D9480F, background #FBF9F6; dark: background #171514, primary #F5F2EE, accent #FF7A3D); typeface Manrope 700, outlined to curves (SIL OFL 1.1, licence text in `fonty/OFL-manrope.txt`).

The source package is in Polish and cannot be copied as is, because AGENTS.md requires every file and filename in the repository to be English:

- directories `ikony/`, `wytyczne/`, `fonty/`, files `przeglad.png`, `DECYZJE.md`, `LICENCJA.md`;
- variant suffixes `kolor` (color), `mono-czarny` (mono-black), `mono-bialy` (mono-white), `kolor-na-ciemnym` (color-on-dark), `jasny` (light);
- every SVG carries `<desc>Wygenerowano z udziałem AI (Brand Studio, Claude + VectorCraft); decyzje projektowe podjął klient. Treść syntetyczna w rozumieniu art. 50 AI Act.</desc>` and a `<title>` such as `Branchling horizontal kolor`.

`LICENCJA.md` point 5 says the AI-involvement notice must not be removed from source files (EU AI Act, Article 50). Translating it keeps the disclosure; deleting it does not. PNG files may carry the same text in compressed text chunks (`strings` found nothing, which does not prove absence).

Do NOT import `wytyczne/index.html` (68 KB Polish guidelines page) or `DECYZJE.md` (Polish decision log of the design process) verbatim; if the guidelines are wanted, they become a short English `docs/brand/README.md`. Skip `.DS_Store`, the PDFs and the Android/iOS app-icon sizes unless a consumer exists — a file nobody references is an asset somebody will later be afraid to delete.

Licensing is an open decision for the owner and must be written down, not assumed: the repository is MIT, and an MIT logo lets anyone use the mark. Common practice is to exclude the name and logo from the code licence. Brand Studio also states it did not run a trademark search.

`package.json` `files` does not list `docs/`, so the tarball should already exclude it; the verification proves that rather than trusting it.

## Steps

1. Pick the minimum set with a consumer: horizontal logo (color, color-on-dark, mono-black, mono-white) as SVG, symbol (color, color-on-dark) as SVG, the square app icon `ikony/icon.svg`, `social/og-1200x630.png`, and the organisation avatar `social/avatar-1080.png`.
2. Copy them to `docs/brand/logo/`, `docs/brand/icon/`, `docs/brand/social/` with lowercase English hyphenated names, e.g. `branchling-horizontal-color.svg`, `branchling-horizontal-on-dark.svg`, `branchling-symbol-color.svg`.
3. In every SVG replace the Polish `<title>` and `<desc>` with English equivalents; the desc must keep the facts: generated with AI involvement (Brand Studio, Claude + VectorCraft), design decisions made by the client, synthetic content within the meaning of Article 50 of the EU AI Act.
4. Inspect PNG text chunks (e.g. `exiftool` or a small node reader of tEXt/zTXt/iTXt) and translate any Polish metadata the same way.
5. Write `docs/brand/README.md`: what each file is for, the palette tokens, minimum size and clear space if known, the AI-disclosure requirement, the Manrope OFL notice, and the owner's licensing decision for the mark.
6. Copy `fonty/OFL-manrope.txt` as `docs/brand/OFL-manrope.txt` only if the README cites it.

## Acceptance criteria

- [x] The logo variants the README and the viewer need, the social preview image and the brand README exist under docs/brand. [proof: brand-files-present]
- [x] No Polish filename and no Polish metadata text remains under docs/brand. [proof: brand-english-only]
- [x] Every imported SVG still carries the AI-involvement disclosure, in English, and the check ran on a non-empty set. [proof: brand-ai-disclosure-kept]
- [x] The npm tarball does not ship docs/brand, checked against a tarball listing that is known to contain README.md. [proof: brand-not-in-tarball]
- [x] The test suite stays green with the new files in the tree. [proof: brand-suite-green]
