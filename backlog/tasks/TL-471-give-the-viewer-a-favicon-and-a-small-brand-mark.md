---
id: TL-471
title: "Give the viewer a favicon and a small brand mark"
type: task
labels: []
board: main
epic: "Brand identity"
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-10-16
updated: 2026-10-16
blocked_by: [TL-469]                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/build-viewer.mjs]                   # paths relative to the repository root
verification:
  - id: viewer-favicon-inline
    bash: "node scripts/cli.mjs build >/dev/null && grep -q 'rel="icon"' backlog/viewer.html && grep -q 'data:image/svg+xml' backlog/viewer.html"
  - id: viewer-title-is-project
    bash: "node scripts/cli.mjs build >/dev/null && node -e 'const s=require("fs").readFileSync("backlog/viewer.html","utf8");const t=s.match(/<title>([^<]*)<\/title>/)[1];const h=s.match(/<div class="app-title">\s*<h1>([^<]*)<\/h1>/);if(!h||h[1]!==t)process.exit(1)'"
  - id: viewer-product-name-guard
    bash: "node scripts/cli.mjs check --product-name"
  - id: viewer-suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

The viewer page has the branchling symbol as its favicon and a small, secondary branchling mark in its header, while the project's own name stays the page title and the h1. The page remains a single self-contained HTML file.

## Context

Depends on TL-469, which versions the symbol SVG under `docs/brand/`.

The viewer is built by `scripts/build-viewer.mjs` into `backlog/viewer.html` and served by `scripts/serve-backlog.mjs`. Its `<head>` currently has no `<link rel="icon">`, so the browser asks the server for `/favicon.ico` and gets the JSON 404 from the fallback route. `<title>` and the header `<h1>` (class `app-title`) both come from `config.projectName`.

The viewer shows SOMEBODY ELSE'S backlog. The mark identifies the tool, not the project: it must not replace or out-weigh the project name. A favicon plus a small symbol (with an accessible label and, optionally, a link to the repository) is the intended weight.

Constraints:

- The page is self-contained and is mailed around as one file, so the icon must be inline (an SVG `data:` URI or inline `<svg>`), not a path to `docs/brand/`. `docs/` is not in the npm tarball; the SVG source the build reads must live under `scripts/` (which ships), e.g. a small module exporting the symbol markup.
- The symbol SVG (`ikony/icon.svg` in the source package) is about 1.5 KB with a dark square background; a favicon may want the transparent symbol instead. Keep the AI-disclosure `<desc>` in the shipped SVG source.
- The product name in code comes from `scripts/product.mjs`; `node scripts/cli.mjs check --product-name` fails on a literal in `scripts/`.
- The viewer has light and dark themes (`--bg`, `--fg`, `--accent` on `:root`, overridden under `prefers-color-scheme: dark`); the header mark must read in both, which the brand's on-dark variant covers.

Out of scope, deliberately: aligning the viewer palette with the brand palette. The viewer accent is terracotta #C97B5C / #E89A7D, the brand accent is tangerine #D9480F / #FF7A3D; changing it touches contrast across every badge and deserves its own task with its own measurements.

Branches `tl-450-inline-editing` and `tl-451-dashboard` also edit the viewer; expect to rebase on whichever lands first.

Use the `branchling-viewer` skill.

## Steps

1. Add a module under `scripts/` holding the symbol SVG markup (English title and desc, AI disclosure kept).
2. Emit `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,…">` in the viewer head.
3. Add the small mark to the header beside, not instead of, the project-name h1, with an accessible name derived from PRODUCT_NAME.
4. Rebuild and check the page in light and dark mode, and that no request to /favicon.ico is made when served.

## Acceptance criteria

- [ ] The built viewer carries an inline SVG favicon rather than a path to a file it does not ship. [proof: viewer-favicon-inline]
- [ ] The project name is still both the page title and the header h1; the mark did not take its place. [proof: viewer-title-is-project]
- [ ] No product-name literal was introduced into scripts/. [proof: viewer-product-name-guard]
- [ ] The viewer tests and the rest of the suite stay green. [proof: viewer-suite-green]
