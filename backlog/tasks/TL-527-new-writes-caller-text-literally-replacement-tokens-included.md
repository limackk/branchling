---
id: TL-527
title: "new writes caller text literally, replacement tokens included"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: literal-text
    bash: "node --test scripts/tests/new-literal-replacement.test.mjs"
---

## Goal

Text a caller hands `new` (the verification commands, the title, the epic, labels, related docs, release and target) lands in the task file byte for byte, whatever characters it contains.

## Context

Found by branchling-ui (its task UI-15). `scripts/new-task.mjs` writes each caller-supplied value into the template with `text.replace(pattern, replacementString)`. A replacement STRING is not literal in JavaScript: a dollar sign followed by an apostrophe inserts everything after the match, a dollar sign followed by a backtick everything before it, a dollar sign followed by an ampersand the match itself, and a dollar sign followed by a digit a capture group. Shell commands carry exactly these sequences: a grep pattern anchored at the end of a line and closed by a single quote is the dollar-apostrophe pair. Reproduction, against 0.2.0 and upstream main: create a task through `new --body-file` whose one verification entry is `bash: grep -q x` followed by a dollar sign, an apostrophe and ` f`. The task file then holds the whole template body (the `## Goal` placeholder through `[proof: the-name]`) spliced inside that verification string, then the real body after it. `new` exits 0 and `check` passes, so nothing reports it; it surfaces only when `done` refuses because the criteria and the verification no longer agree. The verification block (around line 427), related_docs, labels, epic, title, release and target all build their replacement by concatenation, so the same text in any of them corrupts the file the same way. `seed` should be checked too, if it shares the path. The fix is a replacer FUNCTION (`text.replace(pattern, () => replacement)`), whose return value is inserted literally, at every call site that inserts caller text.

## Steps

1. Write a failing test: `new` with each special replacement sequence in a verification command, the title, the epic and a related doc writes them literally and leaves no template text behind
2. Replace every caller-text replacement string in scripts/new-task.mjs with a replacer function
3. Check seed and any other writer that fills the template the same way

## Acceptance criteria

- [ ] Caller text containing JavaScript replacement tokens is written to the task file literally, in every field `new` fills. [proof: literal-text]
