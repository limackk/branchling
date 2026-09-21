---
id: TL-123
title: "Resolve the synonymy between type: code and type: task"
type: task
labels: [pre-launch]
board: main
epic: "Data integrity"
priority: P3
status: pending
owner: unassigned
executor: "human"
estimate: 2h
confidence: high
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-config-and-portability.md
verification:
  - bash: "test $(grep -c '^type: code' backlog/tasks/*.md 2>/dev/null | grep -vc ':0') -eq 0 || grep -q 'code' backlog/config.yaml   # either a migration, or a recorded decision to keep it"
  - bash: "node scripts/cli.mjs check --vocabulary"
  - manual: "Decision recorded in config.yaml next to `types:` — which word describes ordinary work and why the other one stays or disappears"
---

## Goal

Make it so ordinary work has ONE word — or so the two words have a recorded,
checkable difference.

## Context

A side effect of TL-56, deliberately excluded from it. While reconciling
`types:` with the tree, the distribution was measured:

| value | files | first | last |
|---|---|---|---|
| `code` | 59 | 2026-08-26 | 2026-09-01 |
| `task` | 48 | 2026-08-31 | 2026-09-01 |
| `bug`  | 13 | 2026-08-30 | 2026-08-31 |

`code` and `task` do not split the backlog into two classes of work — both are
actively written on THE SAME DAY and both sit on tasks indistinguishable by
content. A sample from 2026-09-01: under `code` sit "JSON envelope in writing
commands" and "Autonomous loop"; under `task` — "worktrail plan command with  <!-- former-name: allow -->
--json" and "Product name from a single constant". This is the same work
described with two words.

Where both came from: `code` is the value from the first commit, `task` came
in on 2026-08-31 together with `_template.md`, which carries `type: task`
hardcoded. Since then `branchling new` writes `task`, and `code` gets added by
manually editing the file — because `--type code` was REJECTED by the writing
path until TL-56.

**Why this did not go into TL-56.** That task closed the drift between the
vocabulary and the tree, and its fix is one line in `config.yaml`. Collapsing
a synonymy is a migration of 59 files and a decision about the project's
VOCABULARY, not a side effect of fixing a guard. The owner chose on
2026-09-01 the variant "the tree is the truth, no mass rewrite" — this task
was left as the remainder of that choice.

**What must be decided is whether the difference should be created or made to
disappear.** A third path is real and cheaper than either: `type` may not be
an axis this project measures at all — in which case the answer is
`types: [task, bug]` and a migration, rather than inventing a meaning for
`code`.

## Pre-flight reading

1. `backlog/config.yaml` — the comment next to `types:` describes the state and this deferred decision.
2. `scripts/check-backlog-vocabulary.mjs` — the guard that, since TL-56, checks that the tree and the vocabulary agree.
3. `backlog/_template.md` — the source of `type: task` on every `branchling new`.

## Steps

1. Decide with the owner: one word, or two with a recorded difference.
2. If one — rewrite the tree and NARROW `types:` in the same commit; a
   vocabulary wider than the tree is the same drift, just from the other
   side.
3. If two — record the difference next to `types:` in `config.yaml` so it can
   be applied without asking the author, and check it against ten existing
   tasks.
4. Reconcile `_template.md` with the outcome — today it smuggles in `task`
   regardless of the decision (that is separately TL-69).

## Acceptance criteria

- [ ] `types:` in `config.yaml` contains only values someone can actually tell apart.
- [ ] If one value remains for ordinary work — no task carries the other.
- [ ] If two remain — the distinguishing criterion sits in `config.yaml`, not in someone's head.
- [ ] `branchling check --vocabulary` green after the change.
</content>
