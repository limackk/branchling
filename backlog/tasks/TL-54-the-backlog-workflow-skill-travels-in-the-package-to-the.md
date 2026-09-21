---
id: TL-54
title: "The backlog-workflow skill travels in the package to the user"
type: task
labels: [post-launch]
board: main
epic: "Backlog — open source publication"
priority: P2
status: done
owner: agent:claude
estimate: 4h
confidence: medium
created: 2026-08-31
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs:
  - .claude/skills/backlog-workflow/SKILL.md
  - docs/branchling-global-tool.md
verification:
  - id: in-the-tarball
    bash: "npm pack --dry-run 2>&1 | grep -q 'skills/backlog-workflow/SKILL.md' && echo 'skill in the tarball — OK'"
  - id: install-behaviour
    bash: "node --test scripts/tests/skills-install.test.mjs"
  - id: installs-for-a-user
    bash: "d=$(mktemp -d) && node scripts/cli.mjs init --dir \"$d/backlog\" --skills >/dev/null && test -f \"$d/.claude/skills/backlog-workflow/SKILL.md\" && echo 'skill installed for the user — OK'; rc=$?; rm -rf \"$d\"; exit $rc"
  - id: one-copy
    bash: "test -L .claude/skills/backlog-workflow && echo 'one copy in the tree, read through a symlink — OK'"
  - id: guards
    bash: "node scripts/cli.mjs check"
---

## Goal

Make it so that, after installing the tool, an agent in someone else's
repository **knows how to run it** — without copying the conventions from
the README into its own instructions.

## Context

`.claude/skills/backlog-workflow/SKILL.md` was created on 2026-08-31 and
describes working on the backlog independently of this repository: querying
instead of reading views, status transitions, regeneration after every
frontmatter change, closing through `verification:`, the standard for a
well-written task, a number from `worktrail new` instead of `max+1`. Today
it works only here, because it sits in this repository's `.claude/` and
does not enter `files` in `package.json`.

**Why this is an adoption lever, not an add-on.** The tool competes with
Jira and Linear for a developer's attention. The argument "install it, tell
the agent 'start TL-1234' and it knows what to do" is something those tools
do not have in this form — and at the same time it is an argument that
cannot be made if every user has to write their own instructions. All the
rest of the adoption work (README, colors, `--help`) lowers friction; this
one gives a reason.

**A boundary that must not be crossed.** The skill is an instruction, not
configuration. It must not hardcode statuses, priorities, or the ID prefix,
because those are the project's own values — it has to point to
`config.yaml`. A skill that states "statuses are pending/in_progress/…"
starts to be a second truth about the vocabulary and diverges the moment a
project defines its own. The same boundary as in Law 3.

**Installation has to be explicit.** Writing to `.claude/` of someone else's
repository without asking is a surprise, and the directory may already
contain their own version of the file. Hence a separate flag and no
overwriting.

Open question to settle within the task: `worktrail init --skills` or a
separate `worktrail skills install` command (useful in a repository where
the backlog already exists). Probably both, with `init` calling the same
entry point.

## Pre-flight reading

1. `skills/backlog-workflow/SKILL.md` — the content that travels. This
   repository's `.claude/skills/` points at it through a symlink.
2. `scripts/init-backlog.mjs` — the only command that writes to someone
   else's directory today; the "skip what already exists" pattern.
3. `scripts/tests/packaging.test.mjs` — how the package contents are
   tested.
4. `package.json` → `files` — the allow-list.

## Steps

1. Move the skill to the packaged directory
   (`skills/backlog-workflow/SKILL.md`) and add `skills/` to `files`.
   Decide whether this repository's `.claude/skills/` should be a copy or a
   symlink — two diverging copies of the same skill is the defect this
   project has been dealing with since TL-19.
2. Review the content for portability: no paths from this repository, no
   vocabulary values, the ID prefix shown as configuration.
3. The installing entry point: copies into the target directory's
   `.claude/skills/`, does NOT overwrite an existing file, prints what it
   did and what it skipped.
4. `worktrail init --skills` calls the same entry point.
5. Mention it in the README — without this nobody will know the skill
   exists.
6. Test: the skill is in the tarball; installation creates the file; a
   repeated installation overwrites nothing.

## Acceptance criteria

One line each: the parser reads the `- [ ]` line and nothing under it (TL-118).

- [x] `skills/backlog-workflow/SKILL.md` is in the tarball, and the skills about developing the tool are not. [proof: in-the-tarball, install-behaviour]
- [x] Installation creates `.claude/skills/backlog-workflow/SKILL.md` at the target REPOSITORY's root. [proof: installs-for-a-user, install-behaviour]
- [x] A repeated installation overwrites nothing and says what it skipped. [proof: install-behaviour]
- [x] The skill's body names no status, no priority and no path from this repository. [proof: install-behaviour]
- [x] One copy of the skill in the tree, not two. [proof: one-copy, install-behaviour]
- [x] The README says the skill exists. [proof: install-behaviour]
- [x] The guards still pass. [proof: guards]

## Decision (2026-09-02)

**Both entry points, and the open question in the Context is settled that way.**
`worktrail skills install` for a repository whose backlog already exists, and
`worktrail init --skills` while creating one — with `init` calling the same
function. Two commands writing the same files two different ways is one of them
being wrong later.

**A symlink, not a copy (step 1).** `.claude/skills/backlog-workflow` points at
`skills/backlog-workflow`, so this repository's own agent reads the file it
ships. Two copies would diverge, and the divergence would be between what this
project's agent is told and what a user's agent is told — which is the one place
nobody would be looking.

**Only `backlog-workflow` ships, and that is a closed list rather than "whatever
is in the directory".** The other three skills here are about developing the
TOOL — its CLI surface, its viewer, its release gate — and in somebody else's
editor they are noise at best. A test asserts nothing else reaches the tarball,
because the failure mode of a directory-wide rule is that a skill added later
ships silently.

**The skill already needed no editing for portability (step 2), and there is now
a test that keeps it that way.** It holds no procedure and no vocabulary by
design: it says to run `instructions overview` and stops. The test reads the
BODY and refuses any status or priority value — but deliberately NOT the
frontmatter `description:`, because that is matched against what a PERSON says
("what's blocked", "mark this done"). Those are English phrases, not a claim
about anybody's `config.yaml`, and judging them by the same rule would force the
trigger list to avoid the ordinary words users actually type. The description's
two id examples under two DIFFERENT prefixes (`TL-1234`, `BL-42`) are how it
says the prefix is configuration without naming anybody's.

**`skills` joined `PUBLIC_PATHS` in the language guard.** A file installed into
somebody else's editor is as public a surface as `--help`, and until now it had
never been under a guard that would keep it English.

**`repositoryRoot()` moved into `paths.mjs`.** TL-45 had written the same
function inside its own guard, and this task needed it to answer "where does
`.claude/` go". Two copies of "which repository is this" would have been two
answers the first time a backlog sat at an unusual depth.

## Verification

```bash
# 1. It ships — expected: OK message
npm pack --dry-run 2>&1 | grep -q 'skills/backlog-workflow/SKILL.md' && echo 'skill in the tarball — OK'

# 2. Installing, skipping, and the content's portability — expected: pass
node --test scripts/tests/skills-install.test.mjs

# 3. A user gets it — expected: the file exists in THEIR repository
d=$(mktemp -d) && node scripts/cli.mjs init --dir "$d/backlog" --skills >/dev/null
test -f "$d/.claude/skills/backlog-workflow/SKILL.md" && echo 'skill installed for the user — OK'
rm -rf "$d"

# 4. One copy in the tree — expected: OK message
test -L .claude/skills/backlog-workflow && echo 'one copy in the tree, read through a symlink — OK'

# 5. The guards
node scripts/cli.mjs check
```

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 created — agent:claude — from a publication readiness audit
