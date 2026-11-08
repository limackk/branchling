# Functionality — scope record

What `branchling` did on **2026-09-01**, what was open on that day and what
became of it, and what it deliberately does not do.

**This is a dated record, not a description of the current tool.** §1 and §4
are maintained and true today. §2 is the state of 2026-09-01, kept as written:
the tool has grown since, and a command or guard missing from §2 is not missing
from the tool. §3 is the backlog of 2026-09-01, each entry with its outcome as
of 2026-11-08. What ships now is described by [`README.md`](../README.md) and
[`docs/manual.md`](manual.md), and listed by `branchling --help`.

The reasoning behind decisions lives elsewhere:
[`docs/branchling-global-tool.md`](branchling-global-tool.md) (the product
boundary), [`LINEAGE.md`](../LINEAGE.md) (the order of decisions), and the
`## Context` section of each task. The source of truth for what is open is
`backlog/tasks/*.md`, not this file.

> On 2026-09-01 the root `README.md` was still a document of the project this
> tool was extracted from, and this file was the more accurate of the two.
> TL-49 replaced it; the README now describes this tool.

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

## 2. What worked on 2026-09-01

A snapshot, not maintained. Read it as the state of that day: the frontmatter,
the commands and the guards listed below are a subset of what ships now.

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
worked. `--dir <path>` is available to commands that select a backlog
independently. The editor-only `regen-hook` instead takes that answer from its
edited-file payload. Backlog overrides are resolved by `resolveBacklogDir()`
from four sources: `--dir` → `BACKLOG_DIR` → detection upwards from cwd →
co-location.

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

## 3. What was open on 2026-09-01, and what became of it

The backlog of that day, grouped by topic. Each entry keeps the sentence that
described it then and adds its outcome as of 2026-11-08: **done**, **cancelled**
with the date, or **open**. What is open now is `branchling query --status
pending` and `branchling plan`, not this list; the id leads to the file with the
full reasoning.

### 3.1 Closing a task must be proven — the highest priority

On 2026-09-01 `verification:` was written and validated, but **no script ran
it**. Execution was carried out by the instructions given to the agent — the
same agent it was meant to police.

- **TL-86** (done) — acceptance criteria ticked from `verification:`, not
  declared. The measurement that prompted this, reproducible on any backlog
  with `branchling check --criteria`: a quarter of the closed tasks had
  criteria left unticked while their `verification:` was green and real.
- **TL-82** (done) — `branchling done <ID>` runs `verification:`, shows its
  output and REFUSES to close on failure. It is now the only command that runs
  it.

### 3.2 Before publication

- **TL-48** (done) — LICENSE and package metadata (then `private`,
  `UNLICENSED`).
- **TL-49** (done) — the README was a document of a different project.
- **TL-81** (done) — distribution channels and the name collision on `npx`.
- **TL-53** (done) — CI, CONTRIBUTING, issue templates.
- **TL-56**, **TL-69** (done) — the `types` vocabulary had drifted from the
  tree; the template smuggled in a value outside the vocabularies.
- **TL-68** (done) — the log said `done`, the frontmatter said `pending`, and
  nothing caught it.
- **TL-57** (done) — `--json` on `check`, `next-id`, `board`.
- **TL-84** (done) — settle and record whether manually editing a task file is
  a supported path or merely a tolerated one.

### 3.3 Machine contract

- **TL-72** (done) — a JSON envelope with `schemaVersion` and `kind` instead of
  a bare array.
- **TL-83** (done) — enums from the vocabularies in `--help --json` and
  `--append-<field>` on writing commands.
- **TL-75** (done) — `modified_files` and searching for tasks by touched file
  (`query --modified-file`).
- **TL-76** (cancelled 2026-09-08) — a transitive dependency graph computed on
  read: tracker convenience outside the evidence-gated delivery core.
- **TL-77** (cancelled 2026-09-08) — shell completions with values from the
  vocabularies: convenience surface outside the reduced product boundary.
- **TL-79** (cancelled 2026-09-08) — `board export` as markdown to paste
  elsewhere: tracker reporting, not a delivery capability.

### 3.4 State across branches

- **TL-73** (done) — a task's state computed from active branches, not from the
  current checkout. `branchling show <ID>` reports a discrepancy with the
  branch name and never resolves it silently.

### 3.5 Surface for agents

- **TL-74** (done) — `branchling instructions`: workflow instructions issued by
  the CLI, templated with the vocabulary of the backlog being read.
- **TL-104** (done) — an autonomous loop: claiming on `next`, recovery of
  abandoned tasks, a fresh-session-per-task pattern.
- **TL-85** (done) — the scope policy: an agent opens a task for a topic outside
  its own, without asking.
- **TL-54** (done) — the `backlog-workflow` skill ships in the package
  (`branchling skills`).
- **TL-46** (done) — a gate that installs itself; it ships as `branchling
  hooks`, not as the `init --hooks` flag this entry named.
- **TL-78** (cancelled 2026-09-08) — `on_status_change`, a configurable command
  on status change: it widened integration scope without strengthening
  evidence-gated delivery.
- **TL-80** (cancelled 2026-09-04) — separating comments, execution notes and
  the final summary: TL-105 had already ended `## Log`, which removed the
  premise.

### 3.6 Time tracking — shipped, then removed

TL-27 (the foundation), TL-28 (activity heartbeats), TL-29 (estimate
calibration), TL-30 (a token and cost adapter), TL-31 (retention and the right
to deletion) and TL-35 (the raw activity log in the home directory) all
closed as done. On 2026-09-08 TL-378 removed activity telemetry from the
product: the shipped tool records no heartbeats, sessions, working time or
token cost, and keeps no activity log. The single question that came back,
how long an agent takes on a task of a given estimate, is answered from the
task ledger by `stats --agent-time` (TL-480), under the reporting rules TL-29
settled. See [`docs/backlog-time-tracking.md`](backlog-time-tracking.md) and
§4.

### 3.7 Multiple projects — shipped, then removed

TL-34 (a home directory with preferences and a registry of projects) and
TL-36 (a view over several projects at once) closed as done. On 2026-09-08
TL-380 made one repository the complete product boundary: the project
registry, the cross-project query and the project switcher no longer ship.
Machine-local preferences remain. See
[`docs/branchling-global-tool.md`](branchling-global-tool.md) and §4.

### 3.8 Input and output

- **TL-67** (done) — import from GitHub Issues: one-off, from stdin, with
  `--dry-run`. It now also reads Jira (`branchling import`).
- **TL-37** (done) — splitting the documents apart: the mechanism ships, the
  measurements stay.
- **TL-32** (done) — an English public surface.
- **TL-55** (cancelled 2026-09-08) — exporting the viewer to a single file to
  send: outside the read-only current-work boundary of the viewer.

### 3.9 Launch

From a competitive analysis (2026-09-01): a mechanism without a demo is
invisible.

- **TL-102** (open) — the first-contact demo: `branchling done` refusing to
  close in 60 seconds, in the README's header.
- **TL-103** (cancelled 2026-09-08) — launch material built on the 27%
  measurement: launch material has to follow product validation rather than a
  superseded narrative.

### 3.10 Hygiene

- **TL-43** (done) — the history log sometimes went untracked in git, and the
  gate lost its premise.
- **TL-45** (done) — a gate against dead links and `related_docs`
  (`branchling check --docs`).
- **TL-47** (done) — a missing backlog surfaced as an unhandled exception with
  a stack trace.
- **TL-58** (done) — a value starting with a hyphen failed in `new`.

---

## 4. What deliberately will not happen

Rejected during the Backlog.md analysis (2026-08-31) and earlier, unless a row
names a later date. Recorded so they don't come back as "maybe after all". A
rejection that was later reversed stays in the table, marked with the date and
the task that reversed it, so the reasoning on both sides remains readable.

| Thing | Why not |
|---|---|
| **An MCP server** — reversed on 2026-09-02 (TL-146) | Rejected on 2026-08-31 as a second surface with its own lifecycle, `branchling instructions` (TL-74) being the cheaper reach. Reversed because instructions reach only an agent that runs shell commands; for every other agent host the CLI was a barrier at the door. `branchling mcp` ships as a thin adapter over the `--json` envelopes and the writing commands, with no logic, validation or vocabulary of its own: a rule that existed only there would be a rule the CLI does not enforce. |
| **Prioritised configuration layers** | Contradicts law III. More convenient and quieter — and rejected for exactly that reason. |
| **Drafts as a separate entity** | This is `status: pending`. An extra state buys nothing. |
| **Milestones as files with their own IDs** | `epic:` as free text within a board is enough and removes the cost of operating on someone else's IDs. The later `release:` field answers the same need the same way: a value from `releases:` in `config.yaml`, not a file with an id. |
| **A plugin API** | Law IV: extensibility through composition. `--json` and callable inputs instead of a hook registry. |
| **An external tracker as source of truth** | Law I: state divorced from the branch is the defect this project exists to fix. |
| **Activity telemetry** (2026-09-08, TL-378) | Heartbeats, sessions, working time, token cost and per-actor scorecards shipped (TL-27 to TL-31, TL-35) and were removed: collecting and retaining that data is a privacy and retention product that strengthens neither authorization, scope nor proof. Agent time per estimate is computed from `backlog/history/` (TL-480), and nothing is collected for it. See [`backlog-time-tracking.md`](backlog-time-tracking.md). |
| **A project registry and cross-project views** (2026-09-08, TL-380) | Shipped (TL-34, TL-36) and removed: one invocation answers about one resolved repository. A portfolio view is not reviewable with the branch that produced the work, and trackers that aggregate repositories already own that problem. See [`branchling-global-tool.md`](branchling-global-tool.md). |
| **Sprints as an entity** (2026-11-05, TL-578) | Of the five things a sprint bundles, four are already here or deliberately absent. Committed scope is `release:`, a wave in `plan.yaml`, `epic:` or a label; the goal is a wave's name and the plan's `rationale`; progress is `plan` and the viewer's burndown. Velocity is the productivity analytics TL-377 put outside the product and TL-378 removed. What remains, a time window, serves a team of people; work handed out by `next` is bounded by a person's vouch, not by a session's time. This repository's own plan on 2026-11-05 had 25 tasks closed in waves after the active one and 12 of 22 open tasks outside every wave, so an order without dates did not hold for three weeks. A team that plans in sprints keeps them in its tracker, which this tool composes with, or labels them and asks `query --label <sprint>`. Not as a release either: `check --release` gates shipping on the current release's scope (TL-515), and a sprint read as a release would change what that gate means. Reopen only as a filter computed from `backlog/history/` (what closed between two dates), never as stored state. |

---

## 5. How to check whether this document is current

It is not the source of truth — the backlog is. §2 and §3 are dated and are not
kept current; §4 is. What ships today, and what is open today:

```bash
node scripts/cli.mjs --help
node scripts/cli.mjs stats
node scripts/cli.mjs query --status pending --priority P0,P1
node scripts/cli.mjs check
```
