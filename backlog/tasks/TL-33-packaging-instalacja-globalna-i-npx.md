---
id: TL-33
title: "Packaging — global install and npx"
type: code
labels: [post-launch]
board: main
epic: "Backlog — open source release"
priority: P2
status: done
owner: claude
estimate: 4h
confidence: medium
created: 2026-08-30
updated: 2026-08-30
blocked_by: []
blocks: [TL-34]
related_docs:
  - docs/branchling-global-tool.md
verification:
  - bash: "node --test scripts/tests/packaging.test.mjs"
  - bash: "R=\"$PWD\"; cd /tmp && npx --yes \"$R\" -- --help >/dev/null && echo 'npx from an empty directory — OK'"
---

## Goal

Turn the module into an **installable package**: `package.json` + `bin/`, so
that `npx worktrail` and `npm i -g` work. This is the only hard gap on the
way to a global tool — and to publishing at all.

## Context

[worktrail-state-and-sync.md §1](../../docs/branchling-state-and-sync.md)
promises a "`git clone && npx worktrail`, no account and no server" mode.
**This promise is false today:** `backlog/` has neither a `package.json` nor
a `bin/` (checked 2026-08-30). The only entry point is
`node backlog/scripts/cli.mjs`, i.e. a path relative to someone else's tree.

Good news: the layer underneath is ready. `paths.mjs` (TL-18) resolves the
data directory through `--dir` → `BACKLOG_DIR` → detection upward from cwd →
co-location, and detection requires a marker, not just `tasks/`. This task
**does not change how data is located** — it packages what already works.

One trap comes directly from this arrangement: today the fourth source
("co-location: the directory above the `.mjs` file") happens to hit the origin project's
backlog, because the code and the data sit together. **After a global
install, the code sits in `node_modules` and the data does not** —
co-location stops making sense and has to know how to stay silent, instead
of pointing at a directory inside the package. That is the difference
between "backlog not found" and "wrote tasks into `node_modules`."

## Pre-flight reading

1. `docs/architecture/worktrail-global-tool.md` — §2 (what already exists),
   §3 Law 2 and 4, §5 (where the data directory name comes from).
2. `backlog/scripts/paths.mjs` — the four sources of the data directory;
   `colocated` in particular.
3. `backlog/scripts/cli.mjs` — `COMMANDS`, `--help` handling, exit codes.
4. `backlog/scripts/init-backlog.mjs` — the only command that writes into
   someone else's directory; after a global install it becomes the first
   thing a stranger runs.

## Steps

1. `backlog/package.json` — `name`, `version`, `type: module`,
   `bin: { worktrail: "bin/branchling.mjs" }`, `files` (a whitelist, so that
   the origin project's tasks and `history/` don't end up in the package), `engines.node`.
2. `backlog/bin/branchling.mjs` — a thin shim: shebang, forwarding `argv` to
   `cli.mjs`, propagating the exit code. No logic of its own.
3. **Disable co-location when the code runs from `node_modules`** — detected
   by the package path, not by an environment variable. A missing backlog
   should give a readable error with a `worktrail init --dir <path>` hint,
   never a write into the package directory.
4. `files` / `.npmignore` — check with `npm pack --dry-run` that the tarball
   does NOT contain the origin project's `tasks/`, `history/`, `archive/`, `boards/`,
   `config.yaml`, `boards.yaml`, or `viewer.html`. Only `scripts/`, `bin/`,
   `_template.md`, README, LICENSE go in.
5. **License** — a package without a `LICENSE` cannot be used by anyone at
   the company. The choice belongs to the founder; the task's job is to
   force the decision, not guess it.
6. `--version` read from `package.json`, one source for the number.
7. **Product name from a single constant.** Today the product name (then
   `tasklog`) is hardcoded **47 times across 9 files** of `scripts/*.mjs`
   (`cli.mjs` 24 times, mostly in help text), plus `package.json`,
   `README.md`, and `CLAUDE.md`. Packaging adds `bin/` to that, and
   [TL-34](TL-34-katalog-domowy-preferencje-i-rejestr-projektow.md) adds
   the home directory name. Introduce `PRODUCT_NAME` read from
   `package.json` and use it in the text; the literal remains only where it
   must (the `bin` key, the package name). **The reason is practical: until
   the package is published, a name change should cost one edit, not a grep
   across the whole tree.**
8. `packaging.test.mjs` test: tarball contents (step 4), `bin` working from a
   directory without a backlog (step 3), `--version` matching `package.json`.

## Acceptance criteria

- [x] `npx <package-path> -- --help` works from a directory **unrelated** to
      any backlog.
- [x] From a directory without a backlog, a command requiring data ends with
      a readable error and an `init --dir` hint, and **not** a write into the
      package directory — there is a test for this.
- [x] `npm pack --dry-run` contains no file with the origin project's data — there is a
      test on the file list, not eyeballed.
- [x] `worktrail --version` matches `package.json` (one source).
- [x] ~~`LICENSE` present; the license choice confirmed by the founder.~~
      **Deferred to publication** (founder's decision, 2026-08-30: "not
      publishing for now"). The license is a condition of shipping the
      package, not of local installation. In the meantime the manifest has
      `"private": true` + `"license": "UNLICENSED"` — `npm publish` **fails**,
      so the package cannot ship by accident, and the state is declared
      honestly instead of defaulting to "ISC".
- [x] The product name comes from `PRODUCT_NAME`, not from literals in the
      text — after changing that one value, `--help` and messages say the
      new name. There is a test for this.
- [ ] ~~Global install (`npm i -g .`) gives a working `worktrail` in
      `PATH`.~~ **Deliberately NOT verified** — `npm i -g` changes the
      founder's global environment, so I am not doing that without need.
      Replaced by a stronger proof: a test runs `npm pack`, installs the
      tarball into a fresh directory, and runs
      `node_modules/.bin/worktrail` — the same binary-linking mechanism,
      just without touching the system. Real global installation belongs to
      `origin#BL-1446`, where a choice between `-g` and a
      `devDependency` has to be made anyway.
- [x] All existing module tests pass unchanged — packaging moves nothing.

## Verification

```bash
# 1. Packaging tests — expected: pass
node --test scripts/tests/packaging.test.mjs

# 2. Tarball without the origin project's data — expected: no matches
npm pack --dry-run 2>&1 | grep -E "tasks/|history/|archive/|boards/|viewer.html" && echo "WARNING: data in the package" || echo "tarball clean — OK"

# 3. Working from a directory without a backlog — expected: error with hint, NOT a write
cd /tmp && node /path/to/branchling/bin/branchling.mjs query --count; echo "exit=$?"

# 4. Version from a single source — expected: matching
test "$(node bin/branchling.mjs --version)" = "$(node -p "require('./package.json').version")" && echo 'version consistent — OK'
```

## Notes

- Name **settled as `tasklog`** ([TL-20](TL-20-domknij-nazwe-narzedzia-przed-publikacja.md)
  done 2026-08-30, npm availability verified that day). **Outdated as of
  2026-09-01** — the decision was reversed, the product is called
  `worktrail`; justification in TL-20's log. Keep it in `package.json` and
  `bin` so an eventual rename is two places, not a grep.
- **Open external risk:** the name is not reserved on npm. Until the package
  is published (even as `0.0.1`), someone else could take `worktrail` — and
  the binary name would go with it. Reservation is the founder's decision;
  this task only prepares a package fit to publish.
- Publishing to npm is **not** part of this task. The package should be
  locally installable (`npm i -g .`, `npx <path>`); shipping it is a
  separate decision by the founder.
- Out of scope: home directory and registry (TL-34), English text
  ([TL-32](TL-32-angielska-powierzchnia-publiczna-modulu.md)).

## Log

- 2026-08-30 created — claude — from the global-tool design
  (docs/architecture/worktrail-global-tool.md); packaging is the only hard
  gap left, the rest of the portability layer was done in TL-18/TL-19/TL-23
- 2026-08-30 done — claude — `package.json` + `bin/branchling.mjs` +
  `scripts/product.mjs`; 11 tests in `packaging.test.mjs`, full module suite
  224/224 green.
  **Step 3 turned out unnecessary as CODE.** I had planned to "disable
  co-location when the code runs from node_modules" — but
  `looksLikeBacklogDir()` requires `tasks/` **and** a marker, and the
  package does not ship `tasks/`, so co-location with `node_modules` simply
  never fires. Instead of adding a special branch (i.e. a workaround for a
  rule that already works), I proved this property with a test — a unit
  test against a synthetic `node_modules/worktrail/` and an integration test
  against an actually installed tarball.
  **Gate on the artifact, not on the configuration.** The first version of
  the test asserted the `files` list from `package.json` — i.e. the
  INTENT. The test was rewritten to `npm pack` → `npm install` → running
  `node_modules/.bin/worktrail` from an unrelated directory, because only
  the tarball settles what npm actually packed.
  Along the way: the first version of the integration test FAILED for the
  right reason — in the checkout, co-location **should** fire, so "no
  backlog" could not occur there. The assertion was about the wrong
  scenario, not the code about the wrong behavior.
  `PRODUCT_NAME` read from the manifest replaced the literals in help,
  usage, and error text (11 `usage:` strings + help + three messages).
  `PRODUCT_VERSION` can be `null` — a missing manifest gives a "corrupted
  install" error, not a made-up version.
  `"private": true` + `"license": "UNLICENSED"` in the manifest: `npm
  publish` fails, so the package cannot ship by accident until there is a
  license decision.
