# The branchling viewer — a brief for a redesign

**Status:** PROJECT (2026-09-05) — a brief handed to a designer; nothing in the
"What to design" sections is implemented
([TL-208](../backlog/tasks/TL-208-the-viewer-s-snapshot-banner-says-tryb-snapshot.md),
[TL-232](../backlog/tasks/TL-232-the-served-viewer-answers-404-when-the-backlog-is-not-in-a.md),
[TL-253](../backlog/tasks/TL-253-plan-reports-the-open-work-outside-every-wave-as-a-share.md))

This document is written for somebody who has never opened this repository. It
describes what the product is, who reads its one screen, what that screen
contains today — element by element — what the backlog says will land on it
later, and where it fails. The last part, §7, is the actual commission: the
**Execution** tab is unreadable and has to be redesigned.

Read §1–§3 before designing anything. §4 is an inventory. §7 is the job.

---

## 1. What the product is

branchling is a backlog that lives in a git repository as markdown files. One
task is one file: YAML frontmatter (id, title, status, priority, owner, estimate,
dependencies) followed by prose (Goal, Context, Decisions, Acceptance criteria)
and a machine-readable `verification:` block — the shell commands that must pass
before the task may be called done.

Three things follow from that, and every one of them shapes the interface:

1. **The record is the git history, not a database.** Every change to a field is
   appended to a log with a timestamp, an actor and a stated reason. Nothing is
   overwritten. The interface can therefore always answer "who changed this, when
   and why" — and it is expected to.
2. **The work is done by agents as much as by people.** The actor of a change is
   `local:me`, `agent:claude` or `user:<id>`. Several agents run at once, each in
   its own git worktree — its own copy of the repository — so the same task can be
   in one state here and another state in a tree three directories away. The
   interface has to say which.
3. **Views are computed and disposable.** Boards, indexes, charts — all rebuilt
   from the task files. Deleting them costs nothing. The task file is the only
   truth.

The tool is driven from a terminal. **The viewer is the one surface a
non-technical person ever sees**, and it exists so that a founder, a product
owner or a reviewer can look at what a fleet of agents has been doing without
learning a CLI.

The name of the project is set per repository. The reference project is called
"branchling" and its task ids are `TL-<number>`. Every figure in this brief was
taken from its own backlog on 2026-09-05, and every one of them is reproducible
in a clone of this repository:

```
branchling stats   # -> 272 tasks, 203 closed, 69 open, 2 in progress
branchling plan    # -> 14 waves, wave 10 active, 64 open tasks outside the plan
```

---

## 2. Who reads this screen

Design for these three, in this order of priority:

**A. The person who is not running the agents** (founder, PM, reviewer). Opens
the page once or twice a day. Wants, within five seconds: is anything moving, is
anything stuck, is anything waiting for *me*. Will not scroll to find out. Reads
no documentation. This reader is the reason the "Waiting on you" tab exists and
the reason §7 is a commission rather than a nicety.

**B. The operator of the fleet** (the engineer who started the agents). Watches
the page while work runs. Wants to see a task move from pending to in progress to
done without reloading, wants to know which worktree a running task is in, and
wants to catch a wave that has stopped progressing.

**C. The person doing a retrospective.** Opens the Dashboard, picks a date range,
wants throughput, lead time and where the backlog is growing faster than it
closes.

The page is also mailed around as a single file (see §3), so a fourth reader —
somebody who received it as an attachment and opened it by double-clicking — must
get something coherent with no server behind it.

---

## 3. Constraints that are not negotiable

These are architectural, not stylistic. A design that breaks them cannot ship.

- **One self-contained HTML file.** The whole page — CSS, JS, data — is generated
  into a single file that works over `file://`. **No web fonts, no CDN, no
  external images, no icon font, no build step in the browser.** Icons must be
  inline SVG or text characters. Typography must be a system font stack.
- **Two modes of the same page.** *Snapshot* — the file as generated, read-only,
  data frozen at build time. *Live* — the same page served from `127.0.0.1` (or
  connected to a local folder from the browser), where editing a field writes the
  markdown file, appends to the log and rebuilds the views. Every screen must be
  designed for both; the difference is announced by one bar (§4.2) and by whether
  fields are editable.
- **Colour is generated from the project's own vocabulary, not chosen by the
  designer.** Statuses, priorities and labels are values in a per-project config
  file. The build assigns each value a colour from a cycling eight-colour palette
  unless the project names a hex. So: *a design may not assume there are exactly
  four priorities, or that "done" is green, or that there are three statuses.* It
  must survive a project with seven statuses and one with two. What the designer
  owns is the **shape** of a badge, its size, its placement and its contrast
  behaviour — not its hue.
- **Colour is never the only carrier of meaning.** This is a written rule in the
  codebase. Every state that colour marks also carries a word, a border style, a
  strikethrough or an icon: "critical path" is written on the card *and* drawn as
  a thicker border; a task running in another worktree gets a dashed border *and*
  the name of the tree in words. Keep this. It also means the page survives being
  printed and being read by somebody who does not separate two hues.
- **Light and dark come from the operating system.** There is no theme switch and
  none is wanted. Both themes must be designed. Current tokens: light
  `--bg #FAF8F5`, `--bg-card #FFFFFF`, `--fg #1E3A5C`, `--border #E5E0D8`,
  `--accent #C97B5C`; dark `--bg #1A1F2E`, `--bg-card #232938`, `--fg #E2E8F0`,
  `--border #2D3748`, `--accent #E89A7D`. The palette is warm-neutral with a
  terracotta accent; it may be revised, but every colour must remain a CSS custom
  property, because generated per-project colours are injected into the same
  `:root`.
- **Motion is opt-out through `prefers-reduced-motion`,** never through a control
  in the page. Animation is only ever used to announce a change that actually
  happened (a card that just moved, a wave that just closed) — never on first
  paint.
- **The URL is the state.** Filters, search, sort, board, selected task and active
  tab all live in the address, and a "Copy link" button hands it over. Any new
  control must be able to live in a URL.
- **Everything is in English.** Enforced by a guard.

---

## 4. What is on the screen today, element by element

The page is one document with four tabs. The header is shared; the body swaps.

### 4.1 Header

- **Product name** (18px, semibold) — read from the project's configuration, so
  it can be any length.
- **Build meta** — `snapshot: <ISO timestamp>` in live mode this reads
  `read from disk: 07:39:37`. Small, muted, tabular numerals.
- **Tab bar** — four pill buttons: `Tasks`, `Dashboard`, `Execution`,
  `Waiting on you`. The last carries a **count badge** when decisions are
  pending (currently `4`). The active tab is a filled pill in the accent colour.
- **Copy link** — a text button at the right end, `⧉ Copy link`. Copies the
  current view's address including filters and selection.

### 4.2 Connection bar

A full-width bar under the header, in one of two states.

*Snapshot state* — a dot, the words "Snapshot mode", a hint ("Data from the
moment of the build. Connect to the folder to work on live files and edit
statuses."), and a primary button **"Connect to the backlog folder"**.

*Live state* — the dot turns live, the label reads "Live (local server)", the
hint explains that a field edited in the panel is written to the `.md` file,
appended to the history and rebuilt. Then, right-aligned:

- **Worktree picker** — a `<select>` labelled `WORKTREE`, currently showing
  `branching-redesign-description-e596dc`. This is *which copy of the repository
  the page is reading*. It is one of the most consequential controls on the page
  and it currently looks like a form field on a settings screen.
- **Refresh from disk** button.
- **Actor picker** — labelled `EDITING AS`, three chips: `me`, `claude`,
  `founder`, one of them selected. This is the identity that will be written into
  the log for every edit the reader makes. It is currently a row of small pills
  at the far right of a dense bar.
- **Disconnect** button (folder mode only).

*Note for the designer:* the bar is doing four unrelated jobs at once — announce
the mode, explain what editing does, choose which repository copy is being read,
and choose who you are. It reads as a warning banner and is ignored after the
first visit, which means the reader can be editing the wrong tree as the wrong
person without noticing.

### 4.3 Board scope

A row: `Board:` followed by pills — `All 272`, `Main 272`. Boards are a
per-project grouping of tasks (a project may have one board or twelve). Each pill
carries its own count.

### 4.4 Stats strip

A row of clickable chips, each a filter shortcut. In the reference project they
read:

```
272 tasks in total | 203 closed (75%) | P0: 13 | P1: 87 | task: 139 | code: 71 | bug: 62
```

The chips after the first two are generated from the project's vocabularies, so
how many there are varies from project to project.

### 4.5 Filters bar

- Four dropdowns: `Status`, `Priority`, `Type`, `Epic`. Multi-select. The values
  come from the project's config; `Epic` is free text collected from the tree, so
  its list can be long and its entries can be sentences.
- Below them, a row of **active filter chips**, each removable.

### 4.6 Tasks tab — the default view

A two-column layout: a fixed-width list on the left (≈210px in the current
build), a detail panel filling the rest.

**The list column**

- **Search field** at the top — "Search titles and ids…". Matches the id and the
  title only, never the body.
- **Sort bar** — `Sort:` with three toggles (`Priority`, `ID ↑`, `ID ↓`) and a
  count at the right — the whole total, or `12 / 272` while a filter is on.
- **Task cards**, one per task, vertically scrolling. A card carries:
  - a coloured left rule keyed to priority;
  - the **task id** (small, accent, top-left);
  - an optional **in-flight badge** (somebody is working on this right now, from
    a heartbeat log) and the **priority badge** (filled, white text) top-right;
  - the **title** (2–3 lines, wraps, never truncated);
  - a footer row of badges: status, type, every label, the board (only when
    viewing all boards), an "elsewhere" marker, the epic, and the estimate
    rendered as `~30m`.
  - Extra card states: `active` (selected), `in-flight` (green outline — an agent
    is on it now), `elsewhere` (amber dashed — this task is in a different state
    in another worktree).

  *Known defect:* every badge is `text-transform: uppercase` at 10px, which turns
  the estimate `~30m` into `~30M` and `~2h` into `~2H`. Units become unreadable.

**The detail panel**

- **Head row:** task id, then status / priority / type / label / epic badges.
- **Title** as an H1, editable in place.
- **A field grid**, three to four columns, each cell:
  - a small uppercase field label (`STATUS`, `PRIORITY`, `TYPE`, `OWNER`, `ROLE`,
    `ESTIMATE`, `CONFIDENCE`, `BOARD`, `EPIC`, `LABELS`, `BLOCKED BY`, `BLOCKS`,
    `EXECUTOR`, `RELATED DOCS`, `CREATED`, `UPDATED`);
  - **an attribution line under the label** — `agent:claude · 2 days ago` — who
    last set this field and when. This is the product's whole thesis rendered as
    UI, and today it is 9px grey text that nobody reads.
  - the value, as a badge, a chip, a link to another task, or plain text.
  - In live mode, clicking a value turns that cell into a control: a native
    `<select>` for an enumerated field, a text input with suggestions for a free
    field, a chip editor for lists. Enum values come from the project's config, so
    the interface may not hard-code them. Some statuses may not be entered without
    a stated reason, and the write is refused — with a message — until one is
    given.
  - `blocked_by` / `blocks` render as clickable task ids.
  - `FILES CHANGED` — a wrapped block of file paths computed from commit messages
    naming this task. On a mature task this is 15–40 paths and currently occupies
    a third of the panel as an unstructured wall of monospace text.
- **`▸ Change graph (15)`** — a collapsible. Expands into a horizontal timeline:
  a dated axis, one node per change, each node an icon (agent / person /
  not recorded / dashed ring = an open question), labelled underneath with
  `<from> → <to>` and the actor. Dense, 10px, and it scrolls off the right edge.
- **`▸ Change history (15)`** — the same events as a list, with reasons.
- **The task body**, rendered markdown: `Goal`, `Context`, `Decisions`,
  `Acceptance criteria`, `Verification`. Long — 200 to 600 lines of prose on a
  substantial task. *Known defect:* ordered lists whose items contain multiple
  paragraphs render with the paragraph text escaping the list indentation, so
  numbered arguments visually interleave with body text.

### 4.7 Dashboard tab

A single scrolling column of panels, roughly 4400px tall. In order:

1. **Date range bar** — `30 days`, `60 days`, `90 days`, `Whole history`,
   `Custom` with two date inputs, and a computed summary
   (`11 days · 2026-08-26 → 2026-09-05`). A note explains that the range measures
   *flow* while *state* is always current.
2. **Nine KPI tiles:** All tasks (272), Open (69), In progress (2), Blocked (0),
   P0/P1 open (1 / 24), Closed in the selected range (0), Throughput in range
   (203), Balance in range (+69), Median lead time (0 days). Each has a caption
   underneath in small grey.
3. **"Backlog over time (cumulative)"** — a filled area chart with two lines
   (created, completed); the gap between them is the open backlog. Days are
   clickable and open a per-day panel.
4. **"Day by day"** — a diverging bar chart: closed above the axis, created below.
5. **"Burndown"** — a line chart with a solid line (open) and a dashed line
   (scope), plus a scope selector (`Main` / `epic` / a dropdown). Currently empty
   and says so in a sentence.
6. **"Epics — 24 active"** — a sortable table: epic name, a progress bar with a
   percentage, total, done, open, in progress, blocked, P0, P1, last movement.
   Clicking a name filters the task list.
7. **A row of distribution panels**, each with its own sort control
   (`order` / `value` / `name`) and horizontal bars: Statuses, Priorities of open
   tasks, Type of open tasks, Owners of open tasks, Labels on open tasks, Lead
   time of closed tasks.
8. **Three columns:** "In progress with no movement for ≥ 7 days", "Blocked",
   "Oldest open P0/P1" (a sortable list of task rows with an age).
9. **"The queue in hours"** — bars per type plus a paragraph of prose arithmetic
   ("144 h (18 working days) to task, 26 h to code…") and a second paragraph
   explaining what the number does *not* mean.
10. **"Age of open tasks"** — a matrix: age bucket × priority.
11. **"Backlog hygiene"** — a list of ways the backlog contradicts its own fields
    (P0 untouched: 1, a live blocker with a status other than blocked: 1,
    owner unassigned: 67, no epic: 47, confidence low: 6). Rows expand.
12. **"Forecast to completion"** — one sentence of prose.

The Dashboard is dense but honest, and it is *not* the subject of this
commission. It is described here because the redesign must not leave it looking
like a different product.

### 4.8 Execution tab

Described in full in §7 — it is the job.

### 4.9 "Waiting on you" tab

The smallest and clearest screen in the product. A title, a paragraph explaining
the three row types, then a list of rows:

- a task id, the title, and at the right either a consequence (`releases 1 task`)
  or nothing;
- a `▸ note a decision` disclosure at the right of each row which opens a single
  text input ("What was decided, and why") and a **Record** button;
- rows are tinted when the work is finished and only a person's sign-off is
  missing;
- ordered by how many tasks the decision would release, never by age;
- a small `everything` toggle beside the heading widens the list.

---

## 5. Writing, editing and adding — how the interface must behave

The viewer is not read-only, and the write paths carry most of the product's
promises.

- **Editing a field is a click on the value**, in the detail panel, in live mode
  only. There is no edit mode and no save button: the change is written on
  commit (blur / Enter / selection), the file on disk changes, the log grows, the
  views rebuild. `Escape` cancels.
- **The vocabulary of every enum is the project's, not the tool's.** The control
  is populated at build time. A design that draws four status buttons is wrong.
- **A write can be refused, and the refusal is the point.** Entering `blocked` or
  `cancelled` without a reason is refused rather than prompted for; a value
  outside the vocabulary is refused; a reason over 500 characters is refused. The
  interface needs a first-class, non-modal way to show "this write did not
  happen, and here is the sentence that says why" — today it does not have one.
- **Every write is attributed to the actor chosen in `EDITING AS`.** A reader who
  has not noticed that control is signing somebody else's name. See TL-209 below.
- **Recording a decision** is a write of a different shape: free text plus the
  task it answers, from the "Waiting on you" tab.
- **There is no "new task" button in the viewer today.** Tasks are created from
  the terminal, from a template, with an id allocated across every branch and
  worktree. Whether creation belongs on this screen is an open design question,
  not a settled requirement — if it is drawn, it must collect: title, type,
  priority, board, epic, estimate, and the `verification:` block, and it must be
  obvious that the last one is mandatory in spirit.
- **Optimistic feedback with a real failure path.** Because a write goes through
  a local server to a file and then to a rebuild, the interface must be able to
  say "written", "refused, because…" and "the folder moved out from under us".

---

## 6. Elements the backlog says will exist later

These are open tasks. Design the page so that they have somewhere to go; do not
design them fully unless the section says so.

- **TL-91 — Board time-lapse replayed from the event log.** *The largest future
  element.* The viewer gets a replay mode: a slider scrubs the whole history from
  day zero to today, tasks animate across the board, an `agent:` actor is
  distinguished from a person by colour. It doubles as "the board on day X" for
  retrospectives. This wants a persistent transport control — a timeline with a
  playhead — and it is the one place where motion is the content. Leave room for
  it. *(role: spec, P3)*
- **TL-55 — Export the viewer to a single file for sending.** A non-technical
  recipient gets the backlog with no terminal: one file, double-clickable,
  filterable. The header needs a place for an export action, and the snapshot
  state (§4.2) is what the recipient will see.
- **TL-177 — A project switcher.** The viewer shows one project or all of them,
  with every row identified by the pair (project, id). A *second* switcher beside
  the worktree picker — which means the connection bar's controls need a real
  information architecture, not one more select.
- **TL-76 — Transitive dependency graph at read time.** The detail panel shows the
  full chain a task is waiting on and the full chain it unblocks, not just the
  direct neighbours. Needs a compact graph or nested-list treatment in the panel.
- **TL-80 — Comments, implementation notes and the final summary become three
  different things** with three different places in the task body, because three
  different people read them. Today they are one undifferentiated markdown blob.
- **TL-256 / TL-270 — Decisions recorded against a task must be visible on the
  task**, not only in the raw log. A "Decisions" region in the detail panel.
- **TL-150 — An actor's record**, computed from the log: per agent, first-pass
  closings, reopenings, tasks handed back as too large, cost per closed task.
  "Which of these can I trust with a P0." Likely a new panel, possibly a new tab.
- **TL-253 — Unplanned work is reported as a share, not a list of ids.**
  Directly relevant to §7: the sentence wanted is *"36 of 49 open tasks (73%) are
  outside every wave"*.
- **TL-232 — The served viewer answers 404 when the backlog is not in a git
  repository.** An error state needs designing: what the page looks like when the
  server is up but the data cannot be read.
- **TL-208 — The snapshot banner still carries an untranslated string;**
  **TL-209 — the write paths cannot refuse a bad actor.** Both touch the
  connection bar and both argue for redesigning it rather than restyling it.

---

## 7. The commission: redesign the Execution tab

### 7.1 What the tab is for

A project may declare an **execution plan**: an ordered list of **waves**. A wave
is a named batch of tasks that share a thesis ("The loop may be trusted
unattended", "The record says who did what"). Waves are executed in order; inside
a wave, tasks may be marked as a **`together` group** — work that has to be
closed as one. The plan is a decision a person makes; nothing computes it. It is
advisory: it changes no task's status and blocks nothing.

The tab exists to answer four questions, and it should answer them in the order
they are asked:

1. **Where are we?** Which wave is active, how far through the plan is the
   project.
2. **What is happening right now?** Which tasks are running, for how long, in
   which worktree, and against which estimate.
3. **What is next, and what is in the way?** The next tasks in the active wave,
   the dependency chain, and the **critical path** — the longest chain of
   blocking dependencies, with its total in hours.
4. **How much of the work is not in the plan at all?** The plan rots; unplanned
   open work is the measure of the rot.

### 7.2 What it looks like today

One long scrolling column, ≈3300px tall in a project with 14 waves:

- A heading `Execution`, a line `plan updated 2026-09-04`, and a **rationale
  paragraph** — three lines of prose written by whoever made the plan.
- Then **one card per wave, in plan order, every wave the same size**: a
  rounded panel with a header (`wave name` · `5 / 5 done` · an `ACTIVE WAVE`
  pill on one of them) and a wrapped row of task cards inside.
- A task card is 230px wide and carries: the id (11px accent), a status badge
  (10px uppercase), the title (12px, clipped at three lines), a meta line (11px
  grey: `agent:claude · 2h`, plus `critical path` in words when applicable, plus
  `⇠ TL-nnn` for a blocker the plan does not schedule), and — only while running
  — a 14px progress bar with `elapsed / estimate` centred inside it.
- **Dependency edges** are drawn as SVG paths *behind* the cards: dashed grey for
  an ordinary dependency, thick solid accent for an edge on the critical path.
- A **`now` line** — an uppercase word and a dashed horizontal rule — separates
  finished waves from the rest, with the critical-path total beside it
  (`critical path: ~40h · 1 task`).
- Clicking a card **focuses a chain**: everything not in that task's dependency
  chain drops to 22% opacity.
- At the bottom, **`Unplanned (64)`**: a heading, a sentence, and 64 chips, each
  a status badge plus `id + title`, each capped at 340px with `white-space:
  nowrap` and an ellipsis.
- Past waves are dimmed to 55% opacity; the active wave gets an accent border.
- When there is no plan, an empty state explains what a plan is and prints an
  example YAML block.

### 7.3 Why it fails — measured, on its own project

- **The answer is below the fold, and history is above it.** Of 14 waves, nine
  are 100% closed. They are drawn first, full size, and they push the `now` line
  and the active wave to roughly 65% of the scroll height. The reader opens the
  tab and sees five bands of finished work. Question 1 of §7.1 takes a scroll to
  answer; questions 2 and 3 take two.
- **Finished and unstarted work is priced the same as live work.** A wave with
  five closed tasks occupies exactly as much vertical space as the wave with the
  one task somebody is holding. Opacity 55% is the only difference, and at 55% on
  a dark ground the text is still perfectly legible — so it does not read as
  "behind you", it reads as "slightly less important".
- **There is no progress figure anywhere.** "wave 10 of 14", "9 waves closed",
  "34 of 34 planned tasks done" — none of it is on the screen. The reader has to
  count bands.
- **The task card is four typographic levels between 10px and 12px** — id, badge,
  title, meta — with no dominant element. In a row of five, nothing separates
  them; the eye has no entry point. Titles are sentences ("The viewer's push does
  not see a status change in another worktree") clipped at three lines, so
  neighbouring cards begin with the same word and end mid-clause.
- **The dependency edges are invisible in practice.** They are 1.5px, 45%
  opacity, dashed, drawn *behind* opaque cards, and they connect cards in
  different rows of a wrapping flex layout — so a line leaves a card, travels
  behind three others and arrives somewhere the eye cannot follow. The one
  genuinely valuable structure on the screen — what blocks what — is the least
  visible thing on it.
- **`Unplanned (64)` is a wall.** 64 chips, single-line, ellipsised mid-word,
  with a 10px uppercase status badge on each. It is 93% of the open work in this
  project and it is presented as visual noise at the bottom of the page. This is
  the single worst region of the interface.
- **The critical path — the one number a reader might act on — is a 11px inline
  label** hidden beside the `now` line, in the middle of the page.
- **Nothing tells you the plan is stale.** A plan covering 5 of 69 open tasks is
  drawn with exactly the same confidence as a plan covering all of them.

### 7.4 What to design

Keep the *model* — waves, order, `together` groups, dependencies, critical path,
running tasks, unplanned work. Redesign how it is priced on the screen.

Directives, in order of importance:

1. **Open on "now", not on the beginning of history.** The active wave and the
   running tasks must be the first thing in the viewport, at full size and full
   contrast. Everything finished collapses by default into something small and
   summarised — a rail, a strip of dots, a single row per wave with its count —
   expandable on demand. Everything not yet started is present but quiet.
2. **Put a progress statement at the top, in words and one figure.** Something a
   reader can repeat out loud: *"Wave 10 of 14 · 31 of 36 planned tasks done · 1
   running · critical path ~40 h."* This is the summary the tab does not have.
3. **Give the running work a treatment of its own.** A task that is in flight is
   the most valuable object on this screen and today it is a 230px card with a
   14px bar. It should carry: the title at a readable size, elapsed against
   estimate, the actor, and — when it is running in another worktree — the name
   of that tree, prominently, because that reader cannot touch it. Consider a
   dedicated "in flight" region above the plan rather than leaving these cards
   buried inside their wave.
4. **Make the dependency structure legible, or make it deliberate.** Either
   commit to a real graph layout where an edge can be followed, or drop the
   drawn edges and express the relation on the card ("waiting on TL-176",
   "unblocks 3") with the focus interaction doing the rest. The current
   half-measure is worse than either. Whatever is chosen, the **critical path
   must be readable as a path** — an ordered chain the reader can trace from end
   to end — with its total in hours attached to it.
5. **Redesign the unplanned region as a measurement, not a list.** Lead with the
   share (TL-253: *"64 of 69 open tasks (93%) are outside every wave"*), because
   that number is the health of the plan. Then let the reader *get at* the tasks
   — grouped, filtered, sorted, paginated, searchable — rather than dumping every
   id at once. It should be possible to look at this region and feel the size of
   the problem without reading a single title.
6. **Design the wave header to carry its own state.** Name, progress (closed of
   total), and which of four states it is in: closed, active, next, later. Four
   states need four visibly different treatments — not one opacity value and one
   border colour.
7. **Give the plan's rationale a home.** Three lines of prose written by a person
   explaining why this order exists is genuinely useful and currently reads as a
   subtitle nobody finishes.
8. **Keep the focus interaction.** Clicking a task and having the rest of the
   plan recede is the best thing on this screen. Make sure the redesign preserves
   an obvious way back out of it.

### 7.5 States that must be designed

- **No plan at all** — the empty state (this is not an error; ordering is
  optional). Must explain what a plan is and how one is written.
- **A plan that does not parse** — the view shows the problems instead of drawing
  half an order.
- **Every wave closed** — no active wave, so there is no "now" marker; the summary
  has to say the plan is finished rather than hiding the answer.
- **A wave with a `together` group** — two or more cards inside a shared frame
  labelled "done as one".
- **A task in the plan that does not exist in this repository** — drawn with a
  dashed border and the badge "not in this backlog", because plans travel between
  branches and ids can go missing.
- **A task running in another worktree** — dashed border, the tree named in words,
  and a progress bar sourced from *that* tree's log (or no bar at all when that
  log could not be read; the card still says it is running).
- **A task blocked by something the plan does not schedule** — currently `⇠ TL-176`
  in the meta line.
- **A task that has just changed state**, and **a wave that has just closed** —
  both animate once, and only when a change actually happened.
- **Snapshot mode** — no live durations are advancing; the page is a photograph.
- **Reduced motion** — every animation off, no information lost.
- **Dark and light**, both, for every one of the above.

### 7.6 What must not be lost

- Every state above is carried by more than colour.
- The wave order is the plan's order and may not be re-sorted by the interface.
- A card always shows its id, and the id is a link to the task in the Tasks tab.
- The critical-path total is written as `~40h` with an explicit count of
  unestimated tasks appended, because a total that silently drops what it could
  not count is a total nobody should plan against.
- Nothing on this tab may imply the plan is binding. It orders; it does not
  block.

---

## 8. What to hand back

1. **Execution tab** — the commission: default state, the focus interaction, and
   at least four of the states in §7.5, in both themes.
2. **Header, connection bar and board scope** — redesigned as one system (§4.1–4.4),
   with room for the project switcher (TL-177) and an export action (TL-55).
3. **Tasks tab** — list card and detail panel, with the per-field attribution line
   treated as content rather than as fine print, and a designed refusal message.
4. **A component sheet** — badge, chip, pill, tile, panel, table row, progress
   bar, disclosure, empty state, refusal — because everything on this page is
   built from about a dozen shapes repeated eight hundred times, and their sizes
   and contrasts are the whole design.

Type scale, spacing and the light/dark token set are the designer's to propose.
The colour *assignments* for statuses, priorities and labels are not: they are
generated per project.
