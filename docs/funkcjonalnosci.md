# Functionality — state and direction

What `worktrail` does today and what it is meant to do. State as of **2026-09-01**.

This document describes SCOPE. The reasoning behind decisions lives elsewhere:
[`docs/worktrail-global-tool.md`](worktrail-global-tool.md) (the four laws),
[`LINEAGE.md`](../LINEAGE.md) (the order of decisions), and in the `## Context`
section of each task. The "What's coming" section is a snapshot of the backlog,
not a promise — the source of truth is `backlog/tasks/*.md`, not this list.

> The root `README.md` is still a document of the project this tool was
> extracted from: it says `backlog` instead of `worktrail`, `BL-NNN`
> instead of `TL-NNN`, and carries that project's vocabulary. TL-49 lists it;
> until then this file is the more accurate one.

---

## 1. What this is

A backlog in markdown files, driven from the terminal. One task is one file
with a YAML frontmatter, versioned in git together with the code it concerns.
Everything besides the task files — indexes, views, boards, the viewer — is
COMPUTED and untracked in git.

Four rules everything else follows from:

1. **Data in the repository, pointers globally.** A task travels with its
   branch and goes through review. State divorced from the branch is the
   defect that external trackers were rejected for.
2. **What is computed may be deleted.** If deleting a view hurts, it has
   become a truth it was never meant to be, and that is a design error.
3. **Configuration layers are DISJOINT, not prioritised.** A key in the wrong
   layer fails; the user layer does not override the project's vocabulary.
4. **Extensibility through composition** — `--json` on every reading command,
   a callable input on every writing one. No plugin API.

---

## 2. What works today

### 2.1 Data model

| Thing | Where | Versioned |
|---|---|---|
| Task | `backlog/tasks/TL-NNN-slug.md` | yes |
| Project vocabularies | `backlog/config.yaml` | yes |
| Board registry | `backlog/boards.yaml` | yes |
| Field change history | `backlog/history/TL-NNN.jsonl` | yes |
| Task template | `backlog/_template.md` | yes |
| Indexes, boards, viewer | `INDEX.yaml`, `NOW.yaml`, `archive/`, `viewer.html` | **no** |

**A task's frontmatter** carries: `id`, `title`, `type`, `labels`, `board`, `epic`,
`priority`, `status`, `owner`, `estimate`, `confidence`, `created`, `updated`,
`blocked_by`, `blocks`, `related_docs`, `verification`.

**The code knows the SHAPE of a field, `config.yaml` knows the VALUES.**
Statuses, priorities, labels, types, owners, estimates and the id prefix are
the project's vocabularies. An unknown key fails the build. `labels_closed: true`
turns a typo in a label into an error instead of a new, silent category.

**A board is a partition, an epic is a group.** Every task has exactly one
`board:` from a closed vocabulary (`boards.yaml`); `epic:` is free text
within a board. Neither replaces the other.

**`verification:` says HOW to check that a task is done** — as a list of
commands (`- bash: "…"`) or manual steps (`- manual: "…"`). This is the field
that sets this tool apart from other markdown-based trackers: "done" is meant
to be checkable, not declared.

### 2.2 Commands

An unknown command and an unknown flag **fail** — a silent no-op looks like it
worked. `--dir <path>` works on every command; the data directory is resolved
by `resolveBacklogDir()` from four sources: `--dir` → `BACKLOG_DIR` →
detection upwards from cwd → co-location.

**Reading**

| Command | What it does |
|---|---|
| `query` | questions about tasks straight from `tasks/*.md`, so it sees changes without regeneration; filters by status, priority, board, label, epic; `--json` / `--files` / `--count` |
| `stats` | backlog state on one screen: statuses, priorities, blockers, hours; `--json` |
| `doctor` | whether the backlog is well set up — configuration, tree, git, guards; `--json` |
| `board <file>` | which board a task belongs to — from path rules, not guessing |
| `next-id` | next free number, counted across ALL branches and worktrees; `--explain` |
| `check` | guards: id collisions, board partition, dangling references |

**Writing**

| Command | What it does |
|---|---|
| `new --title "…"` | founds a task from the template; the number comes from scanning all branches, not `max+1` |
| `init --dir <path>` | founds a new backlog in an empty directory, with a sample task |
| `history --actor …` | appends to history changes made while the server was off |
| `migrate-prefix --to X` | renumbers the whole backlog to a different prefix (filenames, IDs, dependencies, history); `--dry-run` |

**Maintenance**

| Command | What it does |
|---|---|
| `build` | rebuilds views from `tasks/*.md` |
| `serve` | viewer on `127.0.0.1` (the default command) |
| `viewer` | rebuilds `viewer.html` without starting a server |
| `regen-hook` | input for the editor hook: regeneration after a task edit (JSON on stdin) |

### 2.3 Computed views

`build` produces: `INDEX.yaml` (active), `NOW.yaml` (in progress), `archive/done.yaml`
(closed), `boards/<slug>/{INDEX,NOW}.yaml` and `viewer.html`. All of them are
in `.gitignore` — and not out of aesthetics: they are sorted aggregates of
ALL tasks, so every branch would rewrite the same file and two branches would
conflict even without a task in common.

### 2.4 Viewer

One self-contained HTML page plus a local server. For a reader who does not
work in the terminal.

- **Task list** — filters, search, sorting, task detail.
- **Board as scope, not filter** — switches the scope of lists, counters and
  the dashboard.
- **View state in the URL** — every filter, search, sort, scope and selected
  task lands in the hash, so the view can be handed on as a link. An absent
  parameter means "default", not "leave what you have" — otherwise the link
  would lie to the recipient.
- **Dashboard** — KPIs, a cumulative chart, day by day, an epic table,
  distributions, attention lists (stale, blocked, oldest P0-P1), a forecast.
  Ignores list filters (it answers "how does the backlog stand", not "what do
  I have open"), respects board scope. Drill-down: clicking an epic, status,
  priority, label sets the list filter.
- **In-place field editing**, saved to the task file.
- **Change history in the detail view** — an `author · when` marker beside
  each field and a timeline.
- **Live mode** — SSE, the viewer refreshes when the file changes.
- Dark mode, palette derived from `config.yaml`.

### 2.5 Guards

`check` runs three and exits with the WORST result:

- **ID collisions** — one `TL-NNN` = one task; a property of the WHOLE SET,
  reads the entire tree.
- **Board partition** — every task has a board from the registry; a property
  of ONE file, so `--boards <files…>` judges only the ones given (which is
  all a pre-commit hook should do).
- **Dangling references** — `blocked_by` / `blocks` point to existing tasks.

`doctor` answers the broader question "is this backlog well set up":
configuration, tree, git, presence of guards.

### 2.6 Change history

Every field change appends a row to `history/TL-NNN.jsonl` (append-only,
versioned): `ts`, `task`, `field`, `from`, `to`, `actor`, `source`.

**An actor carries a mandatory namespace** — `local:<nick>` (declared,
unverified), `agent:<name>` (automated write), `user:<id>` (authenticated
account). The namespace says HOW MUCH this attribution is worth; `source`
says which route it arrived by (`viewer`, `hook`, `manual`, `external`). A
bare name is rejected loudly, not guessed.

### 2.7 Tests

```bash
node --test scripts/tests/*.test.mjs
```

Green, and the command above is the only thing entitled to say how many — a
number written here is stale by the next commit (TL-172). Two rules keep the
suite honest: the backlog directory comes from `scripts/tests/_repo.mjs` (it
settles both layouts — `<repo>/backlog` and co-located), and the tests do not
assert another project's values, because statuses, labels and board slugs are
DATA, not the tool's contract.

---

## 3. What's coming

What is still open — `worktrail stats` counts it, this list does not. Grouped
below by topic; the ID leads to the file with the full reasoning.

### 3.1 Closing a task must be proven — the highest priority

Today `verification:` is written and validated, but **no script runs it**.
Execution is carried out by the instructions given to the agent — the same
agent it was meant to police. This is the tool's single distinguishing
feature and today it exists only as a convention, not a mechanism.

- **TL-86** — acceptance criteria ticked from `verification:`, not declared.
  The measurement that prompted this, taken on this repository and
  reproducible on any other with `worktrail check --criteria`: a quarter of
  the closed tasks had criteria left unticked while their `verification:` was
  green and real. Two lists about the same "done", only one of them run.
- **TL-82** — `worktrail done <ID>` runs `verification:`, shows its output
  and REFUSES to close on failure. An empty list and a template literal also
  fail the check; `manual:` requires confirmation recorded in the history.

### 3.2 Before publication

- **TL-48** — LICENSE and package metadata (today `private`, `UNLICENSED`).
- **TL-49** — the README is a document of a different project.
- **TL-81** — distribution channels and the name collision on `npx`.
- **TL-53** — CI, CONTRIBUTING, issue templates.
- **TL-56**, **TL-69** — the `types` vocabulary has drifted from the tree; the
  template smuggles in a value outside the vocabularies.
- **TL-68** — the log says `done`, the frontmatter says `pending`, nobody
  catches it.
- **TL-57** — `--json` on `check`, `next-id`, `board`.
- **TL-84** — settle and record whether manually editing a task file is a
  supported path or merely a tolerated one.

### 3.3 Machine contract

- **TL-72** — a JSON envelope with `schemaVersion` and `kind` instead of a
  bare array. `--json` IS our extension API, and a bare array cannot grow a
  field without breaking consumers.
- **TL-83** — enums from the vocabularies in `--help --json` and
  `--append-<field>` on writing commands (agent sandboxes reject
  `$'…\n…'` syntax).
- **TL-76** — a transitive dependency graph computed on read, with explicit
  handling of cycles, repeats, and unknown or ambiguous IDs.
- **TL-75** — `modified_files` and searching for tasks by touched file.
- **TL-77** — shell completions with values from the vocabularies.
- **TL-79** — `board export` as markdown to paste elsewhere.

### 3.4 State across branches

- **TL-73** — a task's state computed from active branches, not from the
  current checkout. The branch and worktree scan already exists (`next-id`);
  this task generalises it from "which numbers are taken" to "what is this
  task's state". A discrepancy is shown with the branch name, never resolved
  silently.

### 3.5 Surface for agents

- **TL-74** — `worktrail instructions`: workflow instructions issued by the
  CLI, not a file rotting in someone else's repo. Text templated with the
  vocabulary of the backlog being read, split into a dispatcher and phase
  guides.
- **TL-104** — an autonomous loop: `next --claim`, recovery of abandoned
  tasks, a fresh-session-per-task pattern (context compaction at vendors is
  lossy; the loop's memory is the task file).
- **TL-85** — settle the scope policy: does an agent found a task itself or ask.
- **TL-54** — the `backlog-workflow` skill ships in the package to the user.
- **TL-46** — `init --hooks`: a gate that installs itself.
- **TL-78** — `on_status_change`: a configurable command on status change.
- **TL-80** — separating comments, execution notes and the final summary.

### 3.6 Time tracking

A separate axis, described in [`docs/backlog-time-tracking.md`](backlog-time-tracking.md).

- **TL-27** — the foundation and an honest point zero.
- **TL-28** — activity heartbeats and the attribution chain.
- **TL-31** — retention, attribution correction, the right to deletion.
- **TL-35** — the raw activity log moved to the home directory.
- **TL-29**, **TL-30** — estimate calibration from data; a token and cost
  adapter.

### 3.7 Multiple projects

- **TL-34** — home directory: preferences and project registry (pointers
  globally, data in the repository).
- **TL-36** — a cross-project view over multiple projects.

### 3.8 Input and output

- **TL-67** — import from GitHub Issues: one-off, from stdin, with
  `--dry-run`. Raised to P2: a path to trying the tool without migration cost.
- **TL-55** — exporting the viewer to a single file to send.
- **TL-37** — splitting the documents apart: the mechanism ships, the
  measurements stay.
- **TL-32** — an English public surface (P1): the condition for entering the
  market.

### 3.9 Launch

From a competitive analysis (2026-09-01): a mechanism without a demo is
invisible, and a project in this category grows from one good launch.

- **TL-102** — the first-contact demo: `worktrail done` refusing to close in
  60 seconds, in the README's header.
- **TL-103** — launch material: the 27% measurement as the thesis, Show HN,
  every number paired with a command to reproduce it.

### 3.10 Hygiene

- **TL-43** — the history log sometimes goes untracked in git, and the gate
  loses its premise.
- **TL-45** — a gate against dead links and `related_docs`.
- **TL-47** — a missing backlog surfaces as an unhandled exception with a
  stack trace.
- **TL-58** — a value starting with a hyphen fails in `new`.

---

## 4. What deliberately will not happen

Rejected during the Backlog.md analysis (2026-08-31) and earlier. Recorded so
they don't come back as "maybe after all".

| Thing | Why not |
|---|---|
| **An MCP server** | A second surface with its own lifecycle. `worktrail instructions` (TL-74) gives the same reach at a fraction of the maintenance cost. |
| **Prioritised configuration layers** | Contradicts law III. More convenient and quieter — and rejected for exactly that reason. |
| **Drafts as a separate entity** | This is `status: pending`. An extra state buys nothing. |
| **Milestones as files with their own IDs** | `epic:` as free text within a board is enough and removes the cost of operating on someone else's IDs. |
| **A plugin API** | Law IV: extensibility through composition. `--json` and callable inputs instead of a hook registry. |
| **An external tracker as source of truth** | Law I: state divorced from the branch is the defect this project exists to fix. |

---

## 5. How to check whether this document is current

It is not the source of truth — the backlog is. Reproduce the snapshot with:

```bash
node scripts/cli.mjs stats
node scripts/cli.mjs query --status pending --priority P0,P1
node scripts/cli.mjs check
```
