---
id: TL-54
title: "The backlog-workflow skill travels in the package to the user"
type: task
labels: [post-launch]
board: main
epic: "Backlog — open source publication"
priority: P2
status: pending
owner: unassigned
estimate: 4h
confidence: medium
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - .claude/skills/backlog-workflow/SKILL.md
  - docs/worktrail-global-tool.md
verification:
  - bash: "npm pack --dry-run 2>&1 | grep -q 'skills/backlog-workflow/SKILL.md' && echo 'skill in the tarball — OK'"
  - bash: "node --test scripts/tests/skills-install.test.mjs"
  - bash: "d=$(mktemp -d) && node scripts/cli.mjs init --dir \"$d/backlog\" --skills >/dev/null && test -f \"$d/.claude/skills/backlog-workflow/SKILL.md\" && echo 'skill installed for the user — OK'"
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

1. `.claude/skills/backlog-workflow/SKILL.md` — the content that has to
   travel.
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

- [ ] `skills/backlog-workflow/SKILL.md` is in the tarball.
- [ ] Installation creates `.claude/skills/backlog-workflow/SKILL.md` in the
      target directory.
- [ ] A repeated installation does not overwrite the existing file and says
      so.
- [ ] The skill's content contains no vocabulary values or paths from this
      repository.
- [ ] One copy of the skill in the tree, not two.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 created — agent:claude — from a publication readiness audit
