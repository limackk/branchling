---
id: TL-39
title: "Reconciliation in the second checkout duplicates __created__"
type: bug
labels: []
board: main
epic: "History and attribution"
priority: P2
status: done
owner: claude
estimate: 4h
confidence: medium
created: 2026-08-30
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-field-editing-history.md
  - docs/worktrail-state-and-sync.md
verification:
  - bash: "node --test scripts/tests/history-duplicate-created.test.mjs"
---

## Goal

One task creation is to produce **one** `__created__` entry, regardless of how
many observers see the file. Today it produces one per observer.

## Context

Observed twice on 2026-08-30 while working in worktrees (TL-33, BL-1445). The
sequence is always the same:

1. The task is created in a worktree; the hook writes `__created__` with
   `actor: agent:claude`, `source: hook`, and ULID **A**.
2. The same task appears in the main checkout after a merge or after the views
   are rebuilt. Reconciliation compares the frontmatter against its snapshot,
   sees a task that was not there before, and writes a **second** `__created__`
   — with `actor: unknown`, `source: external`, and ULID **B**.

Deduplication in `readHistory()` works by `id`, and the ULIDs are different, so
both stay. The history claims the task was created twice — once by the agent,
once by nobody.

**Why this is not cosmetic.** `__created__` is a task event, so two such
entries corrupt every metric that counts creations (lead time, throughput, the
future calibration in `backlog-time-tracking.md`). With two observers that's
one duplicate; with seven worktrees — six.

**This is NOT the same as the complementary case.** In TL-33 the two log
copies were different events (`__created__` in one, `status`+`owner` in the
other) and the union was correct. Here both rows describe ONE event. The
resolution must be able to distinguish these two cases, not merge everything
or reject everything.

**Why deduplication by ULID is not enough.** A ULID identifies the WRITE, not
the EVENT. Two writes about the same event have different ULIDs by
definition.

## Pre-flight reading

1. `docs/backlog-field-editing-history.md` §2 (entry shape), §4 (what the
   mechanism does not guarantee) — check whether this class is already named
   there.
2. `docs/worktrail-state-and-sync.md` §5.1 (who wins on divergence, per field
   class) — `__created__` is a pseudo-field and may need its own rule.
3. `scripts/history.mjs` — `reconcile()`, `readHistory()`, deduplication by
   `id`.

## Steps

1. Reproduce in a test: two checkouts of the same repo, a task created in one,
   reconciliation run in the other. Red-first.
2. Decide the rule and **record it in the documentation**, not only in code.
   Candidates:
   - `__created__` is **idempotent per task** — at most one exists; a second
     write is skipped (reconciliation queries the log, not only the
     snapshot);
   - or deduplication by an **event** key (`task` + `field` + `to`) for
     pseudo-fields, alongside deduplication by `id` for ordinary changes.
3. Decide **which entry wins** when both already exist: better-attributed
   (`agent:`/`user:` beats `unknown`), and on a tie the earlier ULID. A silent
   "last write wins" choice would be the worst option here — it is usually the
   `unknown` one.
4. Write a migration for logs that already have duplicates (in this repo:
   TL-33, BL-1445), or deliberately leave them alone and record why.
5. Check whether the same path also duplicates `__deleted__`.

## Acceptance criteria

- [x] Two checkouts, one task creation → **one** `__created__` entry. Test.
- [x] The rule (idempotence or event key) recorded in
      `docs/backlog-field-editing-history.md`, not only in code.
- [x] When a duplicate already exists, the better-attributed entry wins — test
      on the pair `agent:claude` vs `unknown`.
- [x] `__deleted__` checked from the same angle.
- [x] Ordinary field changes **still** deduplicate by `id` and are not merged
      by value — two real `pending → in_progress` transitions at different
      times are two events, not one. Negative test.
- [x] Existing duplicates in this repo: fixed, or deliberately left with a
      reason in `## Log`.

## Verification

```bash
# expected: pass, including the two-checkout case
node --test scripts/tests/history-duplicate-created.test.mjs

# How many duplicates exist in this repo today — expected: a number to record in ## Log
node -e 'import("./scripts/history.mjs").then(m=>{const h=m.readAllHistory("backlog");
  for(const [id,es] of Object.entries(h)){const c=es.filter(e=>e.field==="__created__");
  if(c.length>1)console.log(id, c.length, c.map(e=>e.actor).join(" + "));}})'
```

## Notes

- Found manually while merging branches, not by a test — i.e. the mechanism
  today has no gate at all for this class.
- Related to `docs/worktrail-state-and-sync.md`: the direction of
  reconciliation is still a design there, so the resolution here should not
  foreclose that path.

## Log

- 2026-08-31 done — claude — commit below. **The rule from step 2 turned out
  different from what the task proposed**, on two points. (a) The key
  `task+field+to` is NOT enough: for `__created__` the value of `to` is the
  title, so a rename between one observer and another would let a duplicate
  through — the key is the event itself. (b) "`__created__` idempotent per
  task" is TOO STRONG: a task deleted and created again has two genuine
  creations. Final rule: a duplicate is a repetition that does not change
  state — entries of the same kind adjacent in time, with no opposing event
  between them. The layer sits in `readHistory()`, so it covers all readers
  (viewer, server, `readAllHistory`) from one place, and **does not rewrite
  files** — the log stays append-only.

- 2026-08-31 measurement — claude — duplicates TODAY: **0** in both
  repositories (71 history logs at the consumer, 20 in the tool). This does
  not mean the bug never existed: TL-33/1445/1446 were resolved manually with
  the same rule the code now enforces. Step 4 (migration) is therefore moot
  and deliberately NOT written — there is nothing to migrate, and a dead
  migration script is debt.

- 2026-08-31 root cause narrowed — claude — the gate from TL-17
  (reconciliation queries the history before writing) **exists and works**;
  the third occurrence happened downstream of it, because it lacked its
  PREMISE: the `.md` arrived via git, the `.jsonl` did not. Measured at the
  consumer: **28 of 71 history logs untracked**. Hence the second layer on
  read — a write-side gate cannot be the only defense when its data travels a
  different channel than the task. The log delivery path was split off into
  TL-43.

- 2026-08-31 step 5 — claude — `__deleted__` was duplicating the same way and
  **did not even have the TL-17 gate**: the deletion loop wrote directly,
  without querying the history. Added symmetrically. Along the way, the
  opposite bug that nobody had reported was fixed: the condition "empty
  history = new task" meant that recreating a task after deletion NEVER made
  it into the history. It now has a test.

- 2026-08-31 positive control — claude — on the consumer's real data the rule
  eats nothing (140 rows → 140 entries), but that is a zero result, so
  separately, on a COPY of the `BL-1446` log, a second `__created__` was
  appended: 4 rows → 3 entries, the one with `agent:claude`/`hook` survived.
  Without this second run, "nothing disappeared" would be indistinguishable
  from a dead rule.

- 2026-08-31 in_progress — claude — 11 tests, red-first: 8 red for the right
  reason, 3 negative controls green from the start (meant to stay that way).
  Suite 263/263.

- 2026-08-30 third occurrence — claude — with BL-1446 in the consumer's repo,
  and this time **without any merge**: the task was created in a worktree
  (hook: `agent:claude`/`hook`, ULID …37N2X), an ordinary `build` in the main
  checkout appended a second `__created__` (`unknown`/`external`, ULID
  …38WW8) 41 seconds later. This narrows the cause — a SECOND OBSERVER of the
  same file is enough, merging is not required. Resolved manually with the
  rule from step 3 (the better-attributed entry wins), which confirms the
  rule is workable, but also that today nobody enforces it except a human.

- 2026-08-30 created — claude — observed twice that day (TL-33, BL-1445)
  while merging a worktree into the main checkout; deduplication by ULID does
  not catch this, because a ULID identifies the WRITE, not the EVENT
