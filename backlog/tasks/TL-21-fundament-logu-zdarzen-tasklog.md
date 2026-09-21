---
id: TL-21
title: "Foundation of the worktrail event log — 5 decisions that cannot be undone"
type: code
labels: [pre-launch]
board: main
epic: "branchling — the tool"
priority: P1
status: done
owner: claude
estimate: 1d
confidence: medium
created: 2026-08-29
updated: 2026-08-29
blocked_by: []
blocks: []
related_docs:
  - docs/branchling-state-and-sync.md
  - docs/backlog-field-editing-history.md
verification:
  - bash: "git merge-tree --write-tree <two branches with no task in common> — NO conflict in INDEX.yaml"
  - bash: "node --test backlog/scripts/tests/history.test.mjs"
  - manual: "delete backlog/history/.snapshot.json and the views, run worktrail — everything rebuilds without losing history"
---

## Goal

Remove the measured, present-day cause of conflicts in parallel work (steps
1–3) and **close three schema decisions that would require migrating an
outside user's data after the fact** (steps 4–5).

Steps 1–3 pay off even if hosting is never built. Steps 4–5 cost a line today
and — after release — a migration of someone else's data. That is why they
are in one task despite their different weight.

## Context

Analysis and full rationale: [worktrail-state-and-sync.md](../../docs/branchling-state-and-sync.md).
In short — what was measured on this repository on 2026-08-29:

- **7 live worktrees**, but **0 tasks touched by more than one branch**.
- Even so, `git merge-tree --write-tree` on two branches **with no task in
  common** gives a **CONFLICT in `INDEX.yaml`** — because views are sorted
  aggregates of all 1362 tasks.
- **896 of 1142** commits (78%) touching `tasks/` also touch generated views.
- Mutations of existing tasks: `status` 639, `owner` 498, `updated` 272 —
  against `title` 43 and everything else below 35. **Coordination ≈ 91%,
  content ≈ 9%.**

Conclusion: the conflict does not come from versioning tasks, but from
**versioning state computed from tasks** — and from keeping coordination state
in a branched file.

The target direction (event log as the SSOT of state, git as the SSOT of
content, SQLite as a rebuildable index) is described in the document. This
task does NOT build a server, or SQLite, or reverse the direction of
reconciliation — it only lays the foundation without which that would be a
migration rather than an addition.

The history entry from [TL-17](TL-17-historia-zmian-pol-taska-z-autorem.md)
already has the shape of an LWW-Register per field. What it lacks is an
identifier and an actor namespace.

## Pre-flight reading

1. `docs/architecture/worktrail-state-and-sync.md` — §3 (what's missing), §5.1 (who wins), §7 (these five steps)
2. `backlog/scripts/history.mjs` — `entry()`, `ACTOR_RE`, `reconcile()`
3. `backlog/scripts/task-fields.mjs` — `TRACKED_FIELDS`
4. `docs/architecture/backlog-field-editing-history.md` §4.6 — why reconciliation asks the log before it writes

## Steps

1. **`id` on every event.** ULID or a hash of `(ts, task, field, actor, to)`.
   Reading old entries **without** an `id` must keep working (the log is
   append-only — history is never rewritten). Test: two events identical in
   content but with different `id`s are two events; the same `id` twice is
   one.
2. **`.gitattributes`:** `backlog/history/*.jsonl merge=union`. Test on a real
   merge of two branches appending to the same file — no conflict markers,
   both entries present, deduplicated by `id`.
3. **Generated views into `.gitignore`** (`INDEX.yaml`, `NOW.yaml`,
   `archive/done.yaml`, `boards/*/`). Necessary condition: the generator must
   run BY ITSELF — at `worktrail` startup and from a hook. Without this, an
   empty clone has no views and looks broken. `git rm --cached` on anything
   already versioned.
4. **`actor` with a namespace** — `local:<nick>`, `agent:<name>`,
   `user:<uuid>`. The old format with no prefix is read as `local:` (backward
   compatibility), new writes always carry a prefix. `ACTOR_RE` extended,
   `normalizeActor()` maps it.
5. **Event type allowing for a body and comments.** We do not implement them
   — the schema has to anticipate them, so adding them later is not a
   migration. Today `TRACKED_FIELDS` covers only the frontmatter; the
   pseudo-fields `__body__` and `__comment__` get a reserved place alongside
   `__created__` / `__deleted__`.

## Acceptance criteria

- [x] Every NEW event has an `id` (ULID); entries without an `id` are still
      read without error.
- [x] Dedup by `id` — the same entry read twice gives one event; different
      `id`s with the same content remain two.
- [x] `backlog/.gitattributes` with `merge=union`, confirmed by a **real
      merge** in a temporary repository + a positive control (without the
      rule, the merge conflicts).
- [x] `git merge-tree --write-tree` of two branches with no task in common
      does **NOT** report a conflict in `INDEX.yaml` — with a positive control
      that the versioned aggregate does conflict.
- [x] A fresh clone with no views: `worktrail` regenerates them **before
      listening** (once, outside `listen()`, which tries successive ports);
      the hook does the same.
- [x] STEP 4 — `actor` with a prefix (`local:` / `agent:` / `user:`, plus
      `unknown`). **Criterion CHANGED mid-flight:** it was meant to read
      "`local:kamil` and `kamil` are the same actor", but that would force
      promoting bare names to human — and `claude` is an agent and would have
      landed as one. A bare name in a new write = no declaration (`unknown`);
      an old entry gets the `legacy` namespace on read. Rationale:
      [worktrail-state-and-sync.md §7 step 4](../../docs/branchling-state-and-sync.md).
- [x] STEP 5 — `__body__` and `__comment__` reserved in `PSEUDO_FIELDS` (in
      `task-fields.mjs`, so the viewer gets them from the source);
      `diffMeta` does not produce them.
- [x] `docs/architecture/worktrail-state-and-sync.md` — status PARTIALLY
      IMPLEMENTED, §7 with steps 1-3 checked off, new §7.1 (cost of the
      transition) and §7.2 (how this is proven).
- [x] `qa/worktrail-state-and-sync.yaml` founded (16 cases) + entry in
      `qa/INDEX.yaml`.

## Verification

```bash
# 1. A test that FAILS today — two disjoint branches must not conflict on a view
git merge-tree --write-tree <branch-a> <branch-b> | grep -i "KONFLIKT\|CONFLICT" && echo "STILL WRONG" || echo "OK"

# 2. History — full suite
node --test backlog/scripts/tests/history.test.mjs

# 3. Rebuildability: delete everything derived, and check nothing was lost
rm -f backlog/history/.snapshot.json backlog/INDEX.yaml backlog/NOW.yaml
./scripts/worktrail --no-open --port 4409
# expected: views rebuilt, ZERO new history entries (the snapshot is a reference point, not the truth)
```

## Notes

**Deliberately OUT of scope** (separate tasks, when the time comes):

- Reversing the direction of reconciliation for coordination fields (the log
  wins over the file) — [worktrail-state-and-sync.md §5.1](../../docs/branchling-state-and-sync.md).
- SQLite as an index (§5.4), locks (§6.1), server, accounts, roles, web UI.
- History of the task body and comments — step 5 reserves a place for them, it
  does not build them.

**Assumption to disprove before starting:** whether the real pain is merge
conflicts or agent collisions on the same task. The measurement only sees what
made it to a commit — an agent that walked into a taken task and backed off
leaves no trace in git. If collisions dominated, locks would be the priority,
not steps 1–3.

## Log

- 2026-08-29 created — claude — from an analysis of "task state under parallel work + hosted mode", measured on 7 worktrees
- 2026-08-29 in_progress — claude — steps 1-3 done (ULID + dedup, merge=union, views outside git); 122/122 tests green. Steps 4-5 remain (actor namespace, reservation of event types) — to be closed before the first outside user.
- 2026-08-29 done — claude — steps 4-5 done: actor namespace (local/agent/user + legacy on read) and reservation of `__body__`/`__comment__`. Along the way: the viewer lost its own copy of the pseudo-field list and the hardcoded `.actor-claude` in CSS, and the CLI stopped lying about authorship. 137/137 green. Scope of steps 1-5 closed; the continuation (reversing reconciliation, SQLite, locks, server) is separate tasks, when the time comes.
</content>
