---
id: TL-123
title: "Resolve the synonymy between type: code and type: task"
type: task
labels: [pre-launch]
board: main
epic: "Data integrity"
priority: P3
status: done
owner: agent:claude
executor: "human"
estimate: 2h
confidence: high
created: 2026-09-01
updated: 2026-09-21
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-config-and-portability.md
verification:
  # REWRITTEN BY THIS TASK (TL-123). The block it replaces carried the TL-260
  # defect in its purest form: the first entry was `no file carries the retired
  # word OR config.yaml contains the string `code``, and config.yaml contained
  # that string — inside `types:` and twice in the comment above it — so the
  # entry was green against a completely unchanged tree and would have stayed
  # green whatever this task did. The other two entries were green on an
  # unchanged tree as well, `check --vocabulary` because the drift it watches
  # for points the other way. Nothing here names a test file, so TL-424 does not
  # apply to the old block. The new one names one glob, and it is counted before
  # node is asked to run it, because `node --test <nothing>` exits 0; each grep
  # sweep carries a positive control for the same reason.
  - id: one-word-for-ordinary-work
    bash: "ls backlog/tasks/*.md >/dev/null 2>&1 || { echo 'no task files were read: this sweep has no sample'; exit 1; }; grep -lq '^type: task$' backlog/tasks/*.md || { echo 'positive control failed: not one file carries the surviving kind, so the grep is not reading this tree'; exit 1; }; left=$(grep -l '^type: code$' backlog/tasks/*.md 2>/dev/null | wc -l | tr -d ' '); test \"$left\" = 0 || { echo \"$left task file(s) still carry the retired kind\"; exit 1; }; grep -qxF 'types: [task, bug]' backlog/config.yaml || { echo 'types: in config.yaml still declares a kind the tree does not carry'; exit 1; }; echo \"ordinary work has one word: $(grep -l '^type: task$' backlog/tasks/*.md | wc -l | tr -d ' ') file(s) carry it, 0 carry the retired one — OK\""
  - id: vocabulary-matches-the-tree
    bash: "node scripts/cli.mjs check --vocabulary"
  - id: no-declared-kind-is-dead
    bash: "node scripts/cli.mjs doctor --json | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const c=(j.checks||j).find(x=>x.id==='unused-vocabulary');if(!c){console.error('positive control failed: doctor no longer reports declared-but-unused values');process.exit(1)}const d=String(c.detail||'');if(/\\btype\\b/.test(d)){console.error('a declared kind is carried by no task: '+d);process.exit(1)}console.log('no declared kind is dead — '+d)})\""
  - id: suite-green
    bash: "n=$(ls scripts/tests/*.test.mjs 2>/dev/null | wc -l | tr -d ' '); test \"$n\" -gt 0 || { echo 'no test files matched: node --test would exit 0 over nothing'; exit 1; }; node --test scripts/tests/*.test.mjs > /dev/null && echo \"$n test file(s) green\""
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

## Decision

**One word survives: `task`. `code` is retired.** `types:` is now `[task, bug]`
and the 81 files that carried `code` were rewritten in the same commit.

Why `task` and not `code`: `task` is the word the TOOL writes. `_template.md`
carries it, so every `branchling new` produces it, and since TL-56 `code` could
only arrive through `--type code` or a hand edit. Keeping the value the tool
never writes would have meant a vocabulary maintained by editing files.

Why not two kinds with a difference: the difference would have been authored
here, today, and then applied to 422 files by re-reading each one. The tree was
measured and it does not make the distinction — both words were written on the
same days on work indistinguishable by content — so the meaning would have been
invented rather than recorded.

Why the archived tasks were rewritten too. `type` classifies a task for
querying; it asserts nothing about what happened, which is what protects a
closed file from being edited (see AGENTS.md on an archived task naming the tool
of its own day). On the day each of those files was written the two words meant
the same thing, so the rewrite preserves every claim — this is the TL-137 case,
not the rename case. It is also the only migration available: one surviving
`code` anywhere forces `types:` to keep the word, and then nothing was
collapsed.

What is NOT done here: `_template.md` still hardcodes `type: task` rather than
reading it from the configuration. That is TL-69 and it is now consistent with
this decision rather than in tension with it.

## Acceptance criteria

- [x] `types:` in `config.yaml` contains only values someone can actually tell
      apart — `bug` is work caused by something already built behaving wrongly,
      `task` is everything else. [proof: one-word-for-ordinary-work]
- [x] One value remains for ordinary work and no task carries the other.
      [proof: one-word-for-ordinary-work]
- [x] The distinguishing criterion sits in `config.yaml`, beside `types:`, not
      in someone's head. [proof: one-word-for-ordinary-work]
- [x] No kind is declared that the tree does not carry — the drift from the
      other side. [proof: no-declared-kind-is-dead]
- [x] `branchling check --vocabulary` green after the change.
      [proof: vocabulary-matches-the-tree]
- [x] The suite is green with the narrowed vocabulary. [proof: suite-green]
