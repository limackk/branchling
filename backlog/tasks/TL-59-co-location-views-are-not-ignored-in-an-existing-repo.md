---
id: TL-59
title: "Co-location: views are not ignored in an existing repo"
type: bug
labels: [pre-launch]
board: main
epic: "Data integrity"
priority: P1
status: done
owner: claude
estimate: 4h
confidence: high
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-config-and-portability.md
verification:
  - bash: "node --test scripts/tests/init-gitignore.test.mjs"
  - bash: "T=\"$PWD/bin/branchling.mjs\"; d=$(mktemp -d) && cd \"$d\" && git init -q . && printf 'node_modules/\\n' > .gitignore && node $T init --dir . >/dev/null && git check-ignore -q INDEX.yaml && echo 'views ignored in an existing repo — OK'"
  - bash: "node --test scripts/tests/views-not-versioned.test.mjs"
---

## Goal

After `worktrail init`, views must be ignored by git in **both directory
layouts** — including when the repository already has its own `.gitignore`.

## Context

Measured 2026-08-31, a fresh repo with a one-line `.gitignore`:

```
$ worktrail init --dir .
  skipped (already existed, not touching): .gitignore
$ worktrail new --title "Task" && worktrail build
$ git check-ignore -v INDEX.yaml NOW.yaml
(empty — NOT ignored)
$ git status --porcelain
?? INDEX.yaml
?? NOW.yaml
```

Mechanism: `init` writes its own `.gitignore` with rules for the views, but
the rule "an existing file is SKIPPED, never overwritten" — correct and not
to be touched — means that in the **co-located** layout (`--dir .`, i.e.
`tasks/` at the repository root) the rules never get written at all. The
skip is printed, but as one line among nine, in a sentence that reads like
routine bookkeeping information.

In the nested layout (`--dir ./backlog`) there is no problem, because
`backlog/.gitignore` is created from scratch. Both layouts are supported —
`scripts/tests/_repo.mjs` settles this — so the gate cannot work in only one
of them.

**Why this is a P1, not a nit.** The result is a committed `INDEX.yaml`, the
sorted aggregate of ALL tasks. Every branch then rewrites the same file, and
two branches conflict even when they do not share a single task — this is
exactly the failure for which views are unversioned in the first place, and
which `scripts/tests/views-not-versioned.test.mjs` proves with a positive
control. The price is paid later, and by someone other than whoever ran
`init`.

The same problem affects `.gitattributes` (`history/*.jsonl merge=union`).
Without this rule, the append-only history log conflicts on every merge, even
though there is no semantic conflict at all.

**A constraint that shapes the fix.** Overwriting someone else's
`.gitignore` is unacceptable. Appending to it is not obviously fine either —
the file may be generated, may be shared, and `init` is writing into someone
else's directory with no undo. The safe minimal version: **detect it and say
so loudly**, with a ready-to-paste block. The more convenient version:
append a block marked with a sentinel, when the file is not read-only, and
print exactly what was appended.

## Pre-flight reading

1. `scripts/init-backlog.mjs` — `GITIGNORE`, `GITATTRIBUTES`, the loop over `FILES` and the skip rule.
2. `scripts/tests/views-not-versioned.test.mjs` — proof of why a versioned aggregate conflicts.
3. This repository's `.gitignore` — the comment explaining the reason; this text is meant to reach the user.
4. `scripts/tests/_repo.mjs` — why both directory layouts must be handled.

## Steps

1. After `init` writes its files, check whether the views are actually
   ignored in the target directory — not "did I write `.gitignore`" but
   whether the RULE APPLIES. `git check-ignore` is the right tool for this,
   because it also knows about `.git/info/exclude` and parent files.
2. When it does not apply: print this as a WARNING (not as an item in the
   skip list), with a ready-to-paste block of rules and one sentence on why
   it matters.
3. Decide on appending: a block with a sentinel (`# worktrail: …`), only with
   explicit consent (`--gitignore` / a prompt), never silently. Appending
   must be idempotent — a second `init` must not add a second block.
4. The same for `.gitattributes` and the `merge=union` rule.
5. If the directory is not a git repository, do not alarm — say neutrally
   that the rules will be needed after `git init`.
6. Test `scripts/tests/init-gitignore.test.mjs`: a repo WITHOUT `.gitignore`
   (works today) and a repo WITH `.gitignore` (fails today) — in both cases,
   after `init` the views are either ignored or the user got a warning.
   Positive control: without the fix, the second case MUST fail.

## Acceptance criteria

- [ ] After `init` in a repo with an existing `.gitignore`, the views are ignored OR the user got a clear warning with a ready-to-paste block.
- [ ] An existing `.gitignore` is never overwritten.
- [ ] Appending (if implemented) is idempotent and marked with a sentinel.
- [ ] The same resolution for `.gitattributes`.
- [ ] The test covers both directory layouts and has a positive control.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 created — agent:claude — measured on a fresh repo during an onboarding audit
- 2026-08-31 in_progress — agent:claude — starting implementation
- 2026-08-31 done — agent:claude — `init` checks `git check-ignore` after writing and appends a block marked with the `# >>> worktrail` sentinel to an existing `.gitignore`/`.gitattributes`; `--no-gitignore` disables this and prints the rules to paste in. Rules extracted into `IGNORE_RULES`/`ATTRIBUTE_RULES` — a single source for both writing and appending. Additionally: an already-tracked view is named explicitly, with `git rm --cached`, because ignoring does not act retroactively. Test `init-gitignore.test.mjs`, 10 assertions; evidentiary strength checked by disabling the behavior — the co-location assertion then fails while the nested layout still passes. 273/273.
</content>
