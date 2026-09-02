---
id: TL-121
title: "This repo's template lost fields that the shipping template has"
type: task
labels: []
board: main
epic: "History and attribution"
priority: P2
status: done
owner: agent:claude
estimate: 2h
confidence: medium
created: 2026-09-01
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: shape-parity
    bash: "node --test scripts/tests/template-shape.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`backlog/_template.md` and the root `_template.md` share the same SHAPE: the
same frontmatter keys, a `verification:` entry with `id:`, and an acceptance
criteria section teaching `[proof: <id>]`. They differ ONLY in the language of
the prose. A test guards this by DERIVING the field list from the shipping
template instead of duplicating it.

## Context

The repository keeps two templates, and that is fine: the root `_template.md`
ships in the tarball into other people's repositories (English, guarded by
`check --language`), while `backlog/_template.md` is THIS backlog's template
and is in Polish. The defect is not that there are two of them — it is that
they drifted apart along a dimension where they must not drift.

The boundary runs where CLAUDE.md draws it: **the code knows the SHAPE, the
data knows the VALUES.** The frontmatter keys and the structure of the
`verification:` entry are shape — `task-fields.mjs` and `criteria.mjs` read
them. The `## Acceptance criteria` heading is also shape: `criteria.mjs` has
it hard-coded in English (`CRITERIA_HEADING`) precisely because it is a
FORMAT, not project vocabulary. `## Cel`, `## Kontekst`, `## Kroki` and the
annotation texts are prose — and in Polish.

**Measured drift (2026-09-01):**

| what `backlog/_template.md` is missing | cost |
|---|---|
| `confidence:` | 106 of 120 tasks have this field — added BY HAND, because the template does not provide it |
| `id:` on the `verification:` entry | without it a criterion has nothing to point at; `check --criteria` reports 62 of 63 open tasks with no link |
| the paragraph teaching `[proof: <id>]` | the tool checks off a criterion after a green run, and the template says nothing about it |
| `## Pre-flight reading` | 89 of 121 tasks have this section, in English — the convention exists, just not in the template |
| the header comment block from the frontmatter | states where the vocabularies come from (`config.yaml`), not from the template |

Separately: `id: BL-NNN` in `backlog/_template.md` carries the prefix from
before the TL-111 migration, while `task_id_prefix` in `config.yaml` is `TL`.
This does not break `new`, since `createTask` replaces the whole `^id:` line
regardless, but the placeholder LIES to a human who opens the file.

**Why this was noticed.** TL-120 was removing `## Log` from the same file, and
in the process it turned out the file was stale in other respects too.
TL-120 deliberately left this untouched — it is a different defect from the
one being fixed there.

**What this task does NOT do.** `scripts/migrate-prefix.mjs` does not touch
`_template.md` at all — grepping this file for `TEMPLATE`/`_template` gives no
hits. That means EVERY repository that changes its prefix is left with the
placeholder on the old one; here we fix the effect, not the cause. That is a
tool defect, not a data one, and belongs to a separate task.

**A neighboring task this is NOT.** TL-69 concerns the same file from the
other side: there it is about VALUES smuggled in from the template after the
vocabularies change in someone else's repository, here it is about the SHAPE
of the template in this repository. They do not block each other and should
not be merged.

**What must NOT be done.** Do not touch existing tasks: the missing
`confidence:` field in fourteen of them is not cleanup that belongs to this
task.

**A premise of this task expired before it was executed.** It was written
saying `backlog/` is in Polish and that `check --language` does not read it,
and the acceptance criterion below said the prose must STAY in Polish. TL-137
has since translated `backlog/` and pointed the guard at it, and CLAUDE.md now
draws the language boundary around what a stranger reads when they open the
repository — which includes this file. `backlog/_template.md` was already in
English when this task was taken, so there was nothing to translate and
nothing to preserve; the criterion is restated as what is actually checked,
which is that the guard stays green.

## Pre-flight reading

1. `_template.md` — the shape reference; the field list in the test should be
   derived from here.
2. `backlog/_template.md` — the file to bring into alignment.
3. `scripts/criteria.mjs:55-70` — `CRITERIA_HEADING` and `PROOF_ID`; proof
   that the criteria heading is a format, not project vocabulary.
4. `scripts/task-fields.mjs:185-215` — the list of fields and their kinds,
   including `confidence` (`allowEmpty: true`, which is why its absence does
   not fail the build and the drift could live unnoticed).
5. `scripts/tests/_repo.mjs` — where the backlog directory comes from.
6. `scripts/tests/change-reason.test.mjs` (tail, TL-120) — a model of a guard
   comparing both templates, with a positive control.
7. `CLAUDE.md`, "Before you change the code" — the shape/values rule and the
   language boundary.

## Steps

1. Add the missing `confidence:` field to `backlog/_template.md`, in the same
   position as in the shipping template (after `estimate:`).
2. Extend the `verification:` entry with `id:`, as in the shipping template,
   and add a paragraph about `[proof: <id>]` to the criteria section along
   with a sample criterion carrying a link. The `## Acceptance criteria`
   heading stays in English.
3. Add a `## Pre-flight reading` section — in English, because that is the
   name 89 existing tasks already carry, and renaming it would drift them
   away from the template.
4. Fix `id: BL-NNN` to carry the prefix from `config.yaml`.
5. New file `scripts/tests/template-shape.test.mjs`: the frontmatter keys of
   `backlog/_template.md` must equal the keys of the shipping template —
   DERIVE the list from the shipping file, do not hard-code it. Take the
   paths from `_repo.mjs`; in the co-located layout both point to the same
   file and the test then passes trivially — say so in the code, rather than
   comparing the file to itself and pretending that is proof.
6. Add to the same test: the `verification:` entry carries `id:`, the criteria
   section contains `[proof: …]` matching `PROOF_ID`, and the prefix in `id:`
   matches `task_id_prefix` from `config.yaml`.
7. Add a positive control: remove the field from a sandbox copy and check
   that the same test CATCHES it. Without this, a green result has no
   evidentiary force.
8. Check `node scripts/cli.mjs check` — the number of tasks without a
   `criterion→verification` link must not increase.

## Acceptance criteria

- [x] The frontmatter keys of both templates are identical, and the list is derived from the shipping one. [proof: shape-parity]
- [x] The `verification:` entry in the repo template carries `id:`, and the criteria teach `[proof: <id>]`. [proof: shape-parity]
- [x] The `id:` placeholder carries the prefix from `config.yaml`, not the pre-migration one. [proof: shape-parity]
- [x] The guard FAILS after the field is removed from a copy — positive control. [proof: shape-parity]
- [x] `worktrail check --language` stays green over `backlog/_template.md`. [proof: suite-green]
- [x] The full test suite is green. [proof: suite-green]
