---
id: TL-196
title: "The foreign-context guard stops at docs/, and the backlog is the larger public surface"
type: task
labels: [pre-launch]
board: main
epic: "Backlog — open-source publication"
priority: P0
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs:
  - scripts/check-no-foreign-context.mjs
verification:
  - bash: "node -e \"import('./scripts/check-no-foreign-context.mjs').then(m => process.exit(m.PUBLIC_DOCS.some(d => /backlog/.test(d)) ? 0 : 1))\" || { echo 'the guard still does not read the backlog'; exit 1; }; echo 'backlog inside the guard scope — OK'"
  - bash: "node scripts/cli.mjs check --foreign-context"
  - bash: "node -e \"const {execSync}=require('child_process');const out=execSync('git grep -lIE \\\"origin\\\" -- backlog docs README.md || true').toString().trim();if(out){console.log('foreign project still named in: '+out);process.exit(1)}console.log('no foreign project named — OK')\""
---

## Goal

`branchling check --foreign-context` has to read the backlog, because that is
where a stranger opening this repository does most of their reading.

## Context

Found on 2026-09-03, while auditing the tree before the first push to
`github.com/limackk/branchling`.

`PUBLIC_DOCS` in `scripts/check-no-foreign-context.mjs` is
`["docs", "README.md", "LINEAGE.md", "CONTRIBUTING.md"]` — four entries,
12 files, 4413 lines. The guard passes on them. `backlog/tasks/` is 195 files
and is not read at all.

That is not a gap in coverage, it is a gap in the SAME direction the guard was
built to defend. [`LINEAGE.md`](LINEAGE.md) states outright that the tasks ARE
this tool's development history, because the git history was flattened at
extraction. So the backlog is not an internal appendix that happens to be
committed — it is the primary document, and it is the one place the guard does
not look.

What is actually there, measured with `git grep` on the same day:

| What | Where |
|---|---|
| `origin` — another project's name | 16 tracked files |
| foreign task ids (`BL-1445`, `BL-1446`, `BL-1471`, and 20 more) | `backlog/tasks/`, `docs/` |
| that project's internal document paths (`qa/*.yaml`, `docs/architecture/legal-and-compliance.md`) | `related_docs:` of TL-17, TL-18, TL-19, TL-31, TL-37 |
| its size and configuration (`0 of 1397`, "declares seven statuses") | TL-156 |
| absolute paths `/Users/limack/workspace/origin` | TL-37 |
| this project's own early counts (1145, 1265, 1346 tasks) — the same project measured | TL-1, TL-13, TL-14 |

The guard already owns every detector this needs: `PERSONAL_PATH`, `EMAIL`,
`BIG_COUNT`, `SHARE_OF` and the forbidden-word list. Nothing has to be
invented — the scope has to be widened, and then the hits have to be dealt
with one by one.

**The verdict on each hit is the owner's, not the guard's.** Whether naming
`origin` is a disclosure or a triviality depends on what that project
is, and this task must not decide it. What the task decides is that the
question gets ASKED before a push, instead of being answered by a guard that
was not looking.

**Not the same thing as TL-37.** That task cleaned the DOCUMENTS of foreign
context and passed. This one says the guard drew its perimeter around the
smaller half.

## Pre-flight reading

1. `scripts/check-no-foreign-context.mjs` — `PUBLIC_DOCS` (line 68) and the
   header comment at line 44 that names the perimeter out loud.
2. `scripts/tests/foreign-context.test.mjs` — the existing cases; widening the
   scope needs a case proving the backlog is now read.
3. TL-37 — what was already cleaned, and the rule that `origin`
   documents stay untouched.

## Steps

1. Widen `PUBLIC_DOCS` to cover `backlog/tasks/` (and decide, explicitly, about
   `backlog/history/*.jsonl` — the walk only reads `.md`, `.mjs` and `.js`, so
   the log is excluded by extension today, and four history entries carry
   `origin` in a `related_docs` change).
2. Run it. Expect it to fail — that failure is the point.
3. Take the list to the owner and get a verdict per class of hit, not per line.
4. Apply the verdict: rewrite, or mark `foreign-context: allow` beside the ONE
   line, with the reason.
5. A test proving the backlog is inside the perimeter — a positive control that
   fails if `PUBLIC_DOCS` is narrowed back.

## Acceptance criteria

- [ ] `PUBLIC_DOCS` includes the backlog, and a test fails if it is removed.
- [ ] `branchling check --foreign-context` is green on the whole tree.
- [ ] Every remaining foreign reference carries a `foreign-context: allow`
      marker with a reason on that one line, or is gone.
- [ ] No absolute `/Users/` path outside a fixture.
