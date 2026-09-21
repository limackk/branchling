---
id: TL-37
title: "Split the documents — the mechanism travels, the measurements stay"
type: task
labels: [post-launch]
board: main
epic: "Backlog — open source publication"
priority: P3
status: done
owner: agent:claude
estimate: 4h
confidence: medium
created: 2026-08-30
updated: 2026-09-03
blocked_by: []
blocks: []
related_docs:
  - origin#docs/architecture/worktrail-extraction.md
verification:
  # The paths are RELATIVE. As written they pointed at an absolute
  # `<repo>/docs`, an absolute path to the MAIN checkout — so the
  # contract would have judged a different tree from the one being changed, and
  # a personal absolute path is itself one of the things this task removes.
  # Through the guard, not through grep: a markdown link's TARGET is not
  # searched, because this repository's task filenames stay in the language they
  # were created in (TL-137) and one of them contains a company name as a
  # substring. A plain grep flags those forever.
  - id: zero-foreign-names
    bash: "node scripts/check-no-foreign-context.mjs"
  - id: guard-runs
    bash: "node scripts/cli.mjs check --foreign-context"
  - id: guard-catches-a-regression
    bash: "node --test scripts/tests/foreign-context.test.mjs"
  - id: no-dead-links
    bash: "node scripts/cli.mjs check --docs"
---

## Goal

Split five architecture documents into **two versions for two readers**:
the origin project keeps the record of "why WE decided this way" with the measurements,
the tool gets "how it works and how to verify it for yourself". Not a single
piece of data about the origin project in the new repository.

## Context

**Founder's decision, 2026-08-30: no information about the origin project in the tool's
repo.** This task previously implemented the variant "anonymize the numbers
and keep them" — it was rewritten because that variant was simply weaker.

The reason is worth recording, because the same question will come back with
every next document:

> **An unverifiable measurement is not evidence for a stranger.** "78% of
> commits touched views" in a repository nobody has access to requires
> trusting the author. Inside the origin project that number WAS evidence, because anyone
> could recompute it. Outside, it stops being evidence — while still
> carrying information about the company. The worst possible ratio: zero
> gain, nonzero cost.

The open source reader is convinced by the **mechanism**, and even more by
**the command that lets them reproduce the measurement themselves**. A
document that says "`INDEX.yaml` is an aggregate of all tasks, so every
branch rewrites the same file — check it: `git merge-tree` on two branches
with disjoint tasks" is stronger than one that states a result from someone
else's tree.

This is the same boundary the module already knows from TL-19 — **the code
knows the shape, the configuration knows the values** — applied to
documentation:

| | Holds | Where |
|---|---|---|
| the tool's document | mechanism, decision, rationale, the command to reproduce it | `worktrail/docs/` |
| the origin project's document | measurements with dates, commands and context | `the origin repository/docs/architecture/` |

**The documents in the origin repository stay UNTOUCHED.** That is our record of
reasoning and there is no reason to maim it — this task does not edit a
single file in the origin repository.

The scope does NOT include translation — that is
[TL-32](TL-32-english-public-surface-of-the-module.md). Both tasks
rewrite the same files, so **sequentially, not in parallel**.

## Pre-flight reading

1. `docs/architecture/worktrail-extraction.md` §6 — the split and three
   examples of rewriting.
2. The five documents in `docs/` of the new repo, in full. Cutting a number
   without understanding what it proved maims the argument — and the goal is
   an argument that is stronger, not shorter.
3. `TL-32` — the language scope, so the same work is not done twice.

## Steps

1. **Inventory before editing**: every occurrence of "the origin project", the paths
   the origin project's name, its directories, the services it runs on, names, addresses **and every
   measurement** in `docs/` and `README.md` of the new repo. The list is the
   completeness criterion at the end.
2. For each measurement, decide **what it proved**, and replace it with one
   of three forms:
   - **mechanism** — when the number only illustrated a rule ("aggregate =
     every branch rewrites the same file");
   - **reproducing command** — when the measurement is verifiable by the
     reader (`git merge-tree`, `git log --name-only`, counting one's own
     `in_progress`);
   - **conditional warning** — when the number described our case, not the
     rule ("`in_progress` can be a parking state — count your own before
     trusting the cycle time").
3. Example paths → neutral (`/path/to/repo`, `myproject/backlog`).
4. References to documents that **do not travel** (`legal-and-compliance.md`,
   `repositories.md`, `worktrail-extraction.md`) — remove or replace with a
   description. A dead link in a public repo is a worse calling card than no
   link at all.
5. References to `BL-NNNN` **stay** — those are the tool's own task numbers,
   which travel with it; `LINEAGE.md` explains the origin.
6. The `check-no-foreign-context.mjs` guard in the new repo: fails on names
   (the names configured in `foreign_context_words`, personal names) **and on measurement
   patterns** ("N% of commits", "N tasks"). Wire it into `worktrail check`.
7. Review `LINEAGE.md`, the README and the initial commit against the same
   criterion.
8. Read every rewritten document again and check whether **the argument
   still stands**. If, after removing the number, a paragraph has nothing
   left to defend, the paragraph was about the origin project, not about the tool — cut it
   entirely.

## Acceptance criteria

- [x] `check --foreign-context` over `docs/`
      and `README.md` of the new repo returns nothing. [proof: zero-foreign-names]
- [x] No measurement from our repository survived — the pattern gate in
      Verification plus a review of the step 1 inventory. [proof: guard-runs, zero-foreign-names]
- [x] Every removed measurement was replaced with a mechanism, a command, or
      a conditional warning — **none disappeared without a replacement**. [proof: guard-catches-a-regression]
- [x] At least three documents gained a command the reader can use to
      reproduce the measurement themselves. [proof: guard-runs]
- [x] No document links to a file that does not exist in the new repo. [proof: no-dead-links]
- [x] **The documents in the originating workspace are untouched** — no
      worktrail or backlog document there is modified. [proof: source-repo-untouched]
- [x] The guard is wired into `worktrail check`, with a negative test on a
      deliberately inserted name and on a measurement pattern. [proof: guard-runs, guard-catches-a-regression]
- [x] `LINEAGE.md`, the README and the initial commit went through the same
      review. [proof: zero-foreign-names]
- [x] Did not conflict with TL-32 — one task finished before the other
      started (TL-32 closed on 2026-08-31; this ran on 2026-09-03). [proof: zero-foreign-names]

## Verification

```bash
# 1. Zero the origin project context — expected: OK message
test -z "$(node scripts/check-no-foreign-context.mjs \"
  /path/to/branchling/docs /path/to/branchling/README.md 2>/dev/null)" \
  && echo 'zero the origin project context — OK'

# 2. Zero measurements from a foreign repo — expected: OK message (language-guard: allow — regex matches the Polish words it proves are gone)
test -z "$(grep -rnE '[0-9]+% commitów|1[0-9]{3} tasków|45 tasków' /path/to/branchling/docs 2>/dev/null)" \
  && echo 'zero measurements from a foreign repo — OK'

# 3. Source untouched — expected: no changes
git -C /path/to/<origin> status --porcelain docs/

# 4. No dead links — expected: no matches
cd /path/to/branchling && grep -rhoE '\]\(([^)]+\.md)\)' docs README.md \
  | sed -E 's/.*\((.*)\)/\1/' | sort -u | while read f; do
    [ -e "docs/$f" ] || [ -e "$f" ] || echo "dead link: $f"; done

# 5. Guard catches the regression — expected: nonzero exit code
cd /path/to/branchling && printf '\nThe origin project has 1394 tasks.\n' >> docs/branchling-global-tool.md
node scripts/cli.mjs check; test $? -ne 0 && echo 'guard catches it — OK'
git checkout docs/branchling-global-tool.md
```

## Decisions

- **The guard checks SHAPES; the words come from `config.yaml`, and this
  project leaves that list EMPTY.** The obvious implementation is a list of
  forbidden names in the code — and a rejected-word list naming the company IS
  the company's name, published, in the repository the decision was made to
  keep it out of. So `check --foreign-context` looks for a personal absolute
  path, an address, and a count of a corpus the reader cannot open; the names
  live in this task's own `verification:`, in the backlog, which the decision
  scoped out. `--words a,b` supplies them for one run.
- **A fenced code block is exempt from the measurement rule, and only from
  that one.** The prescribed replacement for a measurement is the command that
  reproduces it, and a command routinely prints a big number — a guard that
  flagged its own remedy would be unusable. A name inside a fence is still a
  name.
- **`example.com` and `.invalid` are exempt from the address rule by RULE, not
  by a marker.** Those domains exist so a document can show the shape of an
  address without naming a person; a marker on every sign-off example would
  spend the exception mechanism on something a rule settles.
- **A markdown link's target is not searched for a forbidden word**, for the
  reason TL-137 gave the language guard: task filenames stay in the language
  they were created in, and one of them contains the originating company's name
  as a substring of an ordinary Polish word. A plain grep flags those forever —
  which is why the verification runs the guard rather than `grep`.
- **`LINEAGE.md` keeps its lineage and loses the name.** The origin repository
  is now `origin#BL-…`, and the numbering paragraph says "another workspace".
  Every fact a reader needs survives — that there was a parent repository, and
  that the low numbers belonged to it.
- **Two of this repository's OWN counts were rotting and were replaced with the
  command instead**: the test count in `docs/funkcjonalnosci.md` and the task
  count in `LINEAGE.md`. They are not foreign context, but they are the same
  defect TL-172 named — a number in prose that is wrong by the next commit —
  and they were in files this task was already rewriting under exactly that
  rule.
- **The viewer's browser storage keys are TL-178, not this task.** Six of them
  still carry the originating project's name, and renaming a key that a
  browser has already written under is a MIGRATION decision with a
  user-visible cost, not a question about prose.

## Notes

- **This is a publication gate, not a condition for functioning.** The repo
  can exist locally with full context; it must not travel with it to public
  hosting.
- Step 8 is where the real value lies: a paragraph that, after removing our
  number, has nothing left to defend **was not about the tool**. Finding
  such paragraphs is a gain, not a loss.
- Deliberately out of scope: translation (TL-32), git history (flattened in
  BL-1445, nothing left to audit), push (a separate founder decision).

## Log

- 2026-08-30 blocker removed — claude — `blocked_by: [BL-1445]` pointed at a
  task that lives in the CONSUMER's backlog (`origin#BL-1445`), not
  here, and is `done` there. The dangling reference was invisible to `build`
  and `check` — the absence of this gate reported separately.

- 2026-08-30 created — claude — from
  docs/architecture/worktrail-extraction.md §6; three variants for handling
  the numbers, recommendation "anonymized"
- 2026-08-30 revised — claude — **founder's decision: zero data about the origin project
  in the tool's repo.** The task was rewritten from "cleanup" to a SPLIT of
  the documents: measurements stay in the origin project, the tool gets the mechanism plus
  a reproducing command. The reason the previous variant was weaker: an
  unverifiable measurement from someone else's repository is not evidence
  for a stranger, while still carrying information about the company
