---
id: TL-65
title: "Settle import from an existing task tracker"
type: task
labels: [post-launch]
board: main
epic: "Onboarding"
priority: P3
status: done
owner: founder
estimate: 4h
confidence: low
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: [TL-67]
related_docs:
  - docs/worktrail-global-tool.md
  - docs/worktrail-state-and-sync.md
verification:
  - manual: "Decision recorded: import is in scope / not in scope, at this extent, with a reason. If in scope — a task exists for the implementation with a concrete source and a concrete field scope."
---

## Goal

Settle — not build — whether the tool should be able to accept tasks from an
existing tracker, and to what extent. This is a product-direction decision that
blocks any sensible planning in this area.

## Context

All the onboarding work so far reduces the friction of **starting a new
backlog**. It does not, however, answer the situation that decides whether the
tool gets adopted by a company: a team has two hundred issues in GitHub Issues
or in Jira, and the question is "how do we move them here", not "how do we
start from zero".

Without an answer, the tool suits a new project and a single person. With an
answer — also a team that is already somewhere. That is the difference between
"nice, I'll come back to this" and adoption.

**Why this is a decision, not an implementation task.** Import looks like a
simple transformation, but it carries decisions that cannot be undone after
the first external user:

- **One-off import or synchronization.** A one-off import is cheap and
  honest. Synchronization means a second source of truth, and
  `docs/worktrail-state-and-sync.md` is entirely about why that is costly. Law
  1 says that state divorced from the branch is the defect for which external
  trackers were rejected — synchronization would bring it back through the
  side door.
- **What to do about fields the source does not have.** `verification` is the
  closing condition for a task here, and no tracker has it. Importing without
  this field would produce two hundred tasks that by definition cannot be
  closed — which teaches that the field is optional, and disarms the only
  line of defense against "done" that is not done.
- **What to do about fields THIS project does not have.** Comments,
  attachments, status history, links. Silently dropping them is data loss;
  bringing everything over turns a task into a dump of someone else's format.
- **Numbering and identity.** The prefix is configuration, numbers are meant
  to be unique within the project, and imported tasks have their own
  identifiers. Does `GH-412` become `ACME-412`, or does it get a new number
  and a back-reference to the source?
- **Vocabulary scope.** Labels and statuses from that system need not have
  equivalents. The mapping is project configuration, not code — that is,
  another file to design.

**A cheap answer worth considering as a starting point:** don't build an
importer, just document that tasks are plain markdown files with frontmatter,
and show a twenty-line script that generates them from `gh issue list --json`.
This shifts the maintenance cost to the user and commits to nothing, while
still answering "it can be done" instead of "no". Composition instead of a
plugin API (Law 4) says exactly the same thing.

Recorded as a task because the question will come back — and it is better for
it to come back with a recorded answer than from scratch.

## Pre-flight reading

1. `docs/worktrail-state-and-sync.md` §6 — the mode boundary; import vs.
   synchronization.
2. `docs/worktrail-global-tool.md` §3 — Law 1 and Law 4.
3. `scripts/task-fields.mjs` — what fields exist at all and how they are
   normalized.
4. `scripts/new-task.mjs` — the only write path for a task; an importer would
   have to go through it or have a reason not to.

## Steps

1. Name the recipient: who specifically has two hundred tasks and wants to
   move them here. If you cannot name one, the answer is "not now" and that is
   the result of this task.
2. Settle three questions: one-off or synchronous; what about `verification`;
   what about fields with no equivalent.
3. Decide among three variants: (a) nothing, (b) documentation plus a sample
   script, (c) a `worktrail import` command.
4. Record the decision and the reason in `## Log` — even when it reads "we are
   not doing this". The reason is more valuable here than the decision, since
   it is the reason that will survive to next time.
5. If variant (b) or (c): open a separate implementation task with one
   concrete source. Not "importer" in the plural.

## Acceptance criteria

- [ ] Recipient named or explicitly acknowledged as unknown.
- [ ] The three questions from step 2 have recorded answers.
- [ ] The chosen variant with its reasoning in `## Log`.
- [ ] If the variant implies work — an implementation task with one source
      exists.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 created — agent:claude — from the onboarding audit; a question
  about team adoption, not a defect
- 2026-08-31 done — founder — DECISION: an importer will be built, done
  properly, not now. Rejected variant (b) "documentation plus a sample
  script", which the agent recommended — the argument for it was cheap
  maintenance, the argument against it is that it leaves the hardest part
  (mapping, idempotency, `verification`) to every user individually, from
  scratch every time.
- 2026-08-31 done — agent:claude — the three questions from step 2 settled and
  recorded in [TL-67](TL-67-import-z-github-issues-jednorazowy-ze-stdin-z-dry-run.md):
  (1) ONE-OFF — synchronization is a second source of truth, i.e. Law 1; (2)
  `verification` stays EMPTY, and the number of such tasks is a RESULT of the
  import — a placeholder would disarm the only line of defense against
  "done" that is not done; (3) fields with no equivalent do NOT come along —
  import moves the task, not the archive, and access to comments is kept via
  a link to the source.
- 2026-08-31 done — agent:claude — recipient and source: GitHub Issues, one
  and concrete. `gh issue list --json` gives clean JSON with no
  authentication configuration on our side. Jira is a separate task, once a
  team that uses it shows up — an adapter for two systems at once would start
  from an abstraction nobody needs yet. The architectural decision that holds
  the rest together: THE TOOL DOES NOT REACH THE NETWORK, JSON comes in
  through stdin. Zero dependencies stays zero, other people's tokens stay in
  `gh`, and the test gets a fixture instead of a mock server.
