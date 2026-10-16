---
id: TL-470
title: "Show the logo at the top of the README via picture"
type: task
labels: []
board: main
epic: "Brand identity"
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-10-16
updated: 2026-10-16
blocked_by: [TL-469]                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: readme-picture
    bash: "grep -q '<picture>' README.md && grep -q 'prefers-color-scheme: dark' README.md && grep -q 'branchling-horizontal-on-dark.svg' README.md && grep -q 'branchling-horizontal-color.svg' README.md"
  - id: readme-logo-paths-exist
    bash: "node -e 'const s=require("fs").readFileSync("README.md","utf8");const p=[...s.matchAll(/(?:src|srcset)="([^"]+)"/g)].map(m=>m[1].replace(/^https:\/\/raw\.githubusercontent\.com\/limackk\/branchling\/[^/]+\//,"")).filter(x=>x.includes("docs/brand"));if(p.length<2)process.exit(2);for(const x of p)if(!require("fs").existsSync(x)){console.error("missing",x);process.exit(1)}'"
  - id: readme-suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

The README opens with the branchling logo, and the logo follows the reader's colour scheme on GitHub: the color variant on a light page, the on-dark variant on a dark one, through a `<picture>` element with `prefers-color-scheme` sources.

## Context

Depends on TL-469, which puts `docs/brand/logo/branchling-horizontal-color.svg` and `docs/brand/logo/branchling-horizontal-on-dark.svg` in the repository with English names and metadata.

The README is deliberately a short front door (TL-453); the long form lives in `docs/guide.md`. The logo must not push the one-line pitch and the install command below the fold: keep it modest (a height around 48-64 px).

Keep a real text heading: the logo image carries `alt` text, but `# branchling` (or the picture inside the h1) is what screen readers, search and npm's page title read. Badges stay below or beside it.

GitHub renders `<picture><source media="(prefers-color-scheme: dark)" srcset=…><img src=… alt=…></picture>` and honours the dark source. A plain markdown image would show the light-background variant on a dark GitHub page, where the graphite b disappears.

The README also ships to npm (`package.json` `files`), but `docs/` does not. Whether npmjs.com resolves a relative image path against the GitHub repository has to be CHECKED, not assumed: if it does not, the `img` fallback needs an absolute `https://raw.githubusercontent.com/limackk/branchling/main/...` URL, which only resolves after a push. Record which one was chosen and why in the commit body.

The README is covered by tests (e.g. `scripts/tests/agent-onboarding.test.mjs`, `scripts/tests/demo-scenario.test.mjs`); run the whole suite.

## Steps

1. Read the top of `README.md` and decide where the picture goes relative to the h1 and the badges.
2. Add the `<picture>` block with the dark source, the light `img` fallback, `alt` text, and an explicit height or width.
3. Determine how npmjs.com treats relative image paths for this package and choose relative or absolute URLs accordingly.
4. Preview the README in both colour schemes (GitHub, or a local markdown preview with emulated prefers-color-scheme).

## Acceptance criteria

- [ ] The README shows the logo through a picture element with a dark-scheme source and a light fallback. [proof: readme-picture]
- [ ] Every logo path the README references exists in the tree, and at least two were found. [proof: readme-logo-paths-exist]
- [ ] The README tests and the rest of the suite stay green. [proof: readme-suite-green]
