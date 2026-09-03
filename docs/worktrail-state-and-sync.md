# worktrail — state, synchronization and the boundary between modes

**Status:** FOUNDATION IMPLEMENTED 2026-08-29 ([TL-21](../backlog/tasks/TL-21-fundament-logu-zdarzen-tasklog.md)) — **all 5 steps from §7 done; from §6, locks (TL-87, §6.1) and reading state across multiple branches (TL-73, §6.2) are done; §5 and the rest of §6 (reversing the direction, SQLite, the server) are still a project**
**Concerns:** `backlog/` as the future `worktrail` tool (working name — [TL-20](../backlog/tasks/TL-20-domknij-nazwe-narzedzia-przed-publikacja.md))
**Predecessors:** [backlog-field-editing-history.md](backlog-field-editing-history.md) (the field change log), [backlog-config-and-portability.md](backlog-config-and-portability.md) (separating code from data)

---

## 1. Why this document

The tool is eventually meant to work in three modes at once:

1. **Locally, open source** — `git clone && npx worktrail`, no account and no
   server.
2. **As a team, hosted** — an account and a paid plan, in the shape any hosted
   sync product takes.
3. **For non-technical people** — an analyst, support: no repository clone,
   through the browser.

These three modes place conflicting requirements on one question: **where
does the truth about a task live.** This document records the answer, the
measurement that led to it, and the schema decisions that are cheap today and
irreversible once data exists in other people's hands.

The document is NOT a description of implemented state. §2 and §3 are
implemented today — the rest is a project.

## 2. Measurement — the conflict does not come from tasks

Every claim below is something you can measure on your own repository in a
couple of minutes. A result from a tree you cannot open is not evidence — it
asks you to trust the author — so what this table carries is the COMMAND.

| Question | How to measure it | What you will find |
|---|---|---|
| How many branches are live at once | `git worktree list` | more than one, or none of this matters |
| Do two branches ever touch the same task | `git diff --name-only main...<branch> -- backlog/tasks/` | almost never: work is partitioned by task |
| Do they touch the generated views | the same, for `INDEX.yaml`, `NOW.yaml`, `archive/done.yaml`, `boards/` | almost always, and that is the problem |
| Does a merge conflict between branches with NO task in common | `git merge-tree --write-tree <a> <b>` | yes, in `INDEX.yaml` — and that single result is the whole argument |
| What share of commits touching `tasks/` also touches the views | `git log --since=60.days --name-only` and count | the large majority, in any tree where the views are committed |

The fourth row is the crux, and it needs no statistics: `INDEX.yaml` and
`archive/done.yaml` are **sorted aggregates of every task**, so every branch
rewrites the same file even when working on a completely different one. The
conflict is structural, not incidental — one trial merge on your own tree
settles it.

> **The pain does not come from tasks being versioned. It comes from
> versioning state computed from tasks.**

### 2.1. What actually changes in tasks

Modifications to **existing** files (`--diff-filter=M`, so no file creation;
excluding the one-off `board:` backfill = 1339):

```
status   639  ┐
owner    498  ├─  ~91% of all mutations
updated  272  ┘
blocked_by 85 ┐
title      43 ├─  content: ~9%
rest      <35 ┘
```

This distribution is the foundation for every decision below: **a task's
content barely changes, a task's state changes constantly.** Today both live
in the same file, on the same branch, under the same merge mechanism — the
architecture does not reflect a boundary that genuinely exists.

**Two limits of this number, because everything below leans on it.** The
filter is `--diff-filter=M`, so **creation is excluded by construction** — the
one act that writes a whole task body at once contributes nothing to the 9%.
And it was taken from a backlog worked by one person and their agents, where
the author of a task is almost always the person who then does it. Neither
limit makes the number wrong; both mean it describes THIS population, and a
team whose normal flow is one person writing a task for another has not been
measured at all. §9 assumption 4.

## 3. What we already have (and did not know we had)

[TL-17](../backlog/tasks/TL-17-historia-zmian-pol-taska-z-autorem.md)
introduced a history entry shaped like this:

```json
{"ts":"…","task":"BL-1401","field":"status","from":"pending","to":"done","actor":"unknown","source":"boot"}
```

This is an **LWW-Register per field** — exactly the primitive synchronization
without CRDTs is built on. It was created as an audit mechanism, but it is fit
to be the foundation of distributed state. It does not need to be invented;
it needs to be **reversed** (§5.1) and given an `id` (§7.1).

Today, however:

- **The direction is the opposite of what's needed** — the source of truth
  for state is the `.md` file, and the log is its DERIVATIVE (reconciliation
  diffs the file against a snapshot). A derivative cannot be synchronized.
- **Entries have no identifier** — without one, merging and syncing produce
  duplicates indistinguishable from genuine repeats.
- **`actor` is a bare nickname** (`^[a-z0-9][a-z0-9._-]{0,31}$`), with no
  namespace — a declared "anna" cannot be told apart from an authenticated
  Anna.
- **A task's body is not tracked at all** — `TRACKED_FIELDS` covers only
  frontmatter fields.
- **No `.gitattributes`** — two branches appending to the same append-only
  file will conflict on every character. It doesn't hurt today because the
  history is 9 files and one day old.

## 4. The decision

> **Content in git. State in an append-only event log, which IS the source
> of truth for state. SQLite as a local, rebuildable index — never as SSOT.
> Hosting = the same log + auth + roles.**
>
> **"Content in git" states where content lives in the LOCAL mode.** In the
> hosted mode the server holds it and the repository is a replica — §6 says
> so in the table, and §4.4 says why that is the same decision at a
> different scale rather than a second answer to one question.

### 4.1. Why not "just SQLite"

A database with mutable rows works locally and **falls apart the moment
hosting is added.** Two clients change the `status` of the same task offline
— now the rows hold two truths and no merge rule. Then `updated_at` gets
added, then version vectors, then CRDTs — and a year later you have written
your own, worse copy of a hosted sync product.

An event log does not have this problem, because **there is no conflict by
definition**: two events are two events. State is `fold(log)`, and the merge
rule is LWW per field (the highest `ts` for the pair `(task, field)` wins).

### 4.2. Why not "everything into the database"

Moving the whole task into the database costs: content review in a PR, an
offline mode, a task travelling with its branch, and simplicity of cloning
for open source — and it solves a problem that, per §2.1, accounts for **9%
of the traffic**. A bad trade.

### 4.3. Why not an external service (Linear / Jira / Notion API)

The open-source tool has to work after `git clone`, without an account and
without a token. An external service breaks mode 1, which is the core of the
project.

### 4.4. Why the hosted mode moves content to the server

This is the sentence that used to be missing, and its absence read as a
contradiction: §4 said content lives in git, the §6 table said the hosted
mode's source of truth for content is the server. Both are true, of different
modes, and the reason is forced rather than chosen.

**A person without a repository cannot write content into git first.** §5.2
names the two roles the hosted mode exists for — analyst and support — and
what they do is read, *found new tasks*, comment, and change status. Founding
a task is authoring content. So either those roles cannot create a task, which
removes the reason for hosting them at all, or the server accepts content
directly. There is no third option that keeps `git clone` as the only write
path.

**This is not what §4.2 rejected.** §4.2 rejected moving the task INTO a
database, in place of files. Here the files stay and so does everything that
was defended with them: the repository remains a full replica, a developer
still edits `.md` in the tree, content still travels through a pull request,
and the offline mode still works. What moves is only **who wins when the two
diverge**, and §5.3 already answers that — the web writer carries a
base-version hash and is refused with a 409, the git writer gets an ordinary
file conflict.

**What it costs, stated plainly:** in the hosted mode a task's body can change
without a commit. That is a real loss against the local mode, where every
change to content is in somebody's history. It buys the only thing that makes
a team plausible — a task written by a person who will never clone the
repository.

## 5. Data model

### 5.1. Who wins on divergence — per field class

This is the answer to the question from set B ("is reconciliation
one-directional and which side wins"). The answer is **different for
different classes**, and deliberately so — because §2.1 measures two
different populations of changes.

| Class | Fields | Who writes most | Who wins |
|---|---|---|---|
| **Coordination** (~91%) | `status`, `owner`, `updated`, labels, locks | everyone, including the analyst and support | **The log**, LWW per field |
| **Content** (~9%) | `title`, body, acceptance criteria, `related_docs`, `epic` | developer, agent | **The server** (hosted mode) / **the file** (local mode), with base-version control |
| **Comments** | — | analyst, support | **Nobody** — append-only, never conflict |
| **Attachments / links** | — | support | same |

Consequence for the frontmatter: coordination fields become a **projection of
the log**, not the original. An agent editing `status:` in the file
(Edit/Write) is not writing state — it is **proposing an event**, tagged with
`actor` and `ts`. If a newer event exists in the log for that
`(task, field)` pair, the frontmatter is written back over it.

Agents still have to edit `.md` directly — that is the whole point of the
tool. Ingestion (today's reconciliation) stays; what changes is which side is
authoritative after ingestion.

### 5.2. Comments as the write channel for non-technical people

An analyst or support does not rewrite an engineering task's acceptance
criteria. They read, found new tasks, comment, change status and
assignments — that is, they write **in the coordination class and in
comments**, and both are structurally conflict-free.

This is not a restriction imposed on these roles. It is a description of how
they work. The split of personas **matches** the measured split of fields —
and that is why one architecture serves both populations without compromise.

### 5.3. Editing the body — the conflict lands with whoever can resolve it

- **Web UI (analyst, support):** the write carries a base-version hash.
  Mismatch with the head → **409 and "someone changed this, refresh"**. A
  non-technical person **never** sees a conflict marker, because they are
  never handed a merge to resolve.
- **Git (developer, agent):** divergence materialises as an **ordinary
  conflict in the file**, resolved in the editor — a tool this person already
  knows.

No CRDTs and no dependency. CRDTs solve **simultaneous writing to the same
paragraph**, not "two people edited the same task during the day". The event
log is the right foundation, should this ever need to be added.

### 5.4. SQLite as an index, not as truth

`node:sqlite` is built into Node (≥22; verified on v24.18.0 —
`new DatabaseSync(':memory:')` works with zero dependencies), so it does not
break the module's zero-dependency rule.

The database is **100% rebuildable from the log** and lives **outside git**
(`.worktrail/` or `backlog/.state/`, gitignored). **Deleting the database
file must be harmless — and that is this architecture's correctness test.**
If it is ever no longer harmless, it means the database has quietly become
the SSOT and the decision in §4 has been broken.

## 6. The boundary between modes

| | Local (open source) | Hosted (paid plan) |
|---|---|---|
| SSOT for content | files in the repo | server (repo = replica) |
| SSOT for state | log in the repo | log on the server |
| Sync transport | **git** | server |
| Attribution | declared | **authenticated** |
| Locks | within one machine (lockfile, TL-87) | **guaranteed** |
| Access without a repo | none | **available** (analyst, support) |
| Account | not needed | required |

**Creating a task is the one action this table cuts through**, because it
writes content and state in a single stroke. The rule that follows from the
row above: in the hosted mode `new` is **server-first** — the task, body
included, exists for everyone before it exists on any branch, and the file
that later appears on a branch is the replica the table already calls it. A
teammate therefore reads the body immediately, which is what a hand-off
between two people requires; in the local mode the same creation reaches
nobody until the branch is merged, and that is a difference between modes, not
a defect in either.

**Offline is the remainder, and it is shown, never guessed.** `new` with no
server reachable writes locally and reconciles on the next sync, content
settled by the base-version check of §5.3. Until that sync the creation exists
as a `__created__` event with no body behind it on the server — which is also
the shape of a task created on an unmerged branch in the local mode (§6.2).
Both are displayed by naming the branch, the way TL-73 decided for state:
divergence is SHOWN, not resolved. A task whose branch is abandoned keeps its
creation event, because a creation did happen; the log is append-only and
retracting it is a `__deleted__` written by whoever abandons the branch, never
an edit to what is already recorded.

### 6.1. What the local version cannot give — and why that is a fair paid boundary

**True mutual exclusion without a single writer.** A lock is also an event,
and LWW only resolves it after the fact. Two machines connected only by git
can take the same task and find out only when they sync — not before. An
atomic lock exists only where there is one writer: locally, the filesystem
(which covers today's case of seven worktrees on one disk); in a team, only
the server does.

**Done in TL-87** — `worktrail take` / `worktrail next`, `scripts/lock.mjs`.
The single writer is the filesystem, not SQLite: `link()` from a temporary
file into the target name either succeeds or fails on EEXIST, whereas the
database would be a dependency and a second source of truth for one bit. Two
things measured along the way, both real:

1. **`open(wx)` + a write is NOT one step.** The file exists empty for the
   duration of the write, and a process hitting that window reads "a lock
   with no content", judges it corrupt, and takes over. Six parallel `next`
   calls handed the same task to two sessions. `link()` closes the window:
   the name appears only with complete content already in place.
2. **Locks must live OUTSIDE the repository.** Every worktree has its own
   `backlog/`, so a lock in the backlog directory would be a different file
   in each of them and would exclude nobody. The key is
   `git rev-parse --git-common-dir` — the same path from every worktree of
   one repository.

The boundary is stated in `take --help` and in the README, not only here: the
guarantee covers one machine and one user account.

### 6.2. Reading state across multiple branches — done in TL-73

A lock settles who TAKES a task. A separate problem is what someone
**reading** the backlog sees: a view computed from one checkout lies about
the rest of the repository. A task started on `feature/x` is still `pending`
in the copy from `main`, so `query --status pending` reported it as free —
the same state-divorced-from-branch defect that external trackers were
rejected for, only inverted.

`scripts/branch-scan.mjs` generalises the scan that `next-backlog-id.mjs`
already did for NUMBERS, since BL-1452, to STATE. One module, two consumers —
two copies would have drifted on the question "which branches exist", and
that is exactly the kind of difference that hands one task to two sessions.

Four settled decisions that cannot be walked back quietly:

1. **The discrepancy is SHOWN, not resolved.** `query`, `stats` and the
   viewer report both statuses and name the branch
   (`elsewhere: [feature/x: in_progress]`). Picking a winner would again be
   one value posing as the truth — the same defect as a view from a single
   checkout, only harder to notice.
2. **Local refs only.** No `git fetch`. Enforced by a test that substitutes
   its own `git` on PATH and checks the REGISTERED calls — an assertion on
   the source would miss a fetch hidden behind an alias or a helper.
3. **The activity window** (`active_branch_days: 30`) bounds the cost, but a
   branch CHECKED OUT in a worktree is always read — someone is standing in
   it and most likely holding the task. The switch is
   `cross_branch_state`.
4. **A branch's own state is not a second opinion.** An uncommitted `take` on
   `main` must not report "main: pending" to itself; the warning shown after
   every `take` stops being read, and the real one gets lost with it.

**Existence, on the same rule — TL-145.** A task that exists only on an
unmerged branch used to be left out of the listing entirely. That was
defensible while the reader and the writer were one person on one disk; with
two it is not, because the failure mode reads as success — the task is not
reported as hidden, it is reported as absent. `query` and `stats` now name it
and name the branch it lives on (`absentHere` in the same module, no second
enumeration), and they keep it OUT of the rows and the tallies: only its id and
the status each branch gives it are known, so filtering, sorting or counting it
like a task of this tree would be inventing the fields that make those numbers
mean anything. This is the same shape as the two questions already asked of the
scan — `next-id` asks it about NUMBERS, `scanTaskStates` about STATE — and it
is what §6 above calls displaying a creation by naming its branch.

This is a **read** using git as transport, i.e. §6's "Sync transport" row. It
does not replace the log from §4: the true state remains the file on its own
branch, and the scan only says that branches disagree.

Three things the local mode **by definition** cannot do — none of them needs
to be deliberately crippled: verified attribution, true locks, access without
a repository. The free version stays fully useful for a developer working
with agents, i.e. for the open-source core.

## 7. Schema decisions — cheap today, irreversible after the first outside user

These points are in [TL-21](../backlog/tasks/TL-21-fundament-logu-zdarzen-tasklog.md).
Why they are TOGETHER despite differing in weight: 1–3 pay off even if the
server never gets built (they solve pain measured today), and 4–5 cost one
line today, and after release — a migration of other people's data.

1. ✅ **`id` on every event** — **a ULID** (48 bits of time + 80 bits of
   randomness, Crockford base32, 26 characters), `eventId()` in
   `history.mjs`. A content hash was dropped: two replicas stamp the same
   event with their own clock, so it would drift anyway, and a ULID gives
   something a hash does not — **ordering**, i.e. a ready-made sync cursor
   ("give me events after X"). A counter was dropped because it requires one
   writer, and there are three write paths in separate processes. Dedup by
   `id` lives in `readHistory()`; entries from before TL-21 (with no `id`)
   still read fine and are **not** deduplicated — there is nothing to
   compare them by, and guessing from content would merge two genuine
   changes into the same value.
2. ✅ **`backlog/.gitattributes`: `history/*.jsonl merge=union`.** The file
   lives **in the backlog directory**, not the repository root —
   gitattributes applies per directory, so the rule travels with the backlog
   into someone else's repo. The rule and point 1 work **only together**:
   without `id`, union merge would glue together a log nobody could untangle.
3. ✅ **Generated views into `.gitignore`** (`INDEX.yaml`, `NOW.yaml`,
   `archive/done.yaml`, `boards/*/`) + `git rm --cached`. A necessary
   condition delivered alongside them: `serve-backlog.mjs` regenerates views
   **before it listens** (once, outside `listen()`, which recursively tries
   further ports), and the hook does the same after every task edit.
4. ✅ **A namespaced `actor`** — `local:<nick>` (declared, unverified),
   `agent:<name>` (automated write), `user:<id>` (authenticated account),
   plus `unknown` as the only value with no namespace. Without this, once
   accounts arrive, there is no way to tell a declaration from an
   authentication apart — and that is **exactly the difference a company
   pays for**.

   **The code does not guess a namespace.** A bare name in a NEW write is a
   missing declaration, so it lands as `unknown` — bulk-prepending `local:`
   would reclassify the `claude` agent as a human, i.e. it would be a pretty
   untruth of the same class as the rejected git backfill (§6 in
   [backlog-field-editing-history.md](backlog-field-editing-history.md)).
   Entries from before TL-21 stay in the log byte for byte and are given the
   `legacy` namespace at READ time — that is the truth about them, unlike
   forcing them into today's category.

   Degradation had to become LOUD in both places it could have stayed
   quiet: `validateConfig` rejects a bare actor in `config.yaml` with a
   message naming the three allowed forms, and `history-record.mjs` exits
   with code 2 instead of reporting "changes saved (me)" and writing
   `unknown` — the output would lie about the author, i.e. about the one
   thing this history exists for.
5. ✅ **An event type admitting body and comments** — `__body__` and
   `__comment__` reserved alongside `__created__` / `__deleted__` in
   `PSEUDO_FIELDS`. The list lives in `task-fields.mjs`, because this file is
   pasted as source into the viewer; the viewer used to have its own,
   hand-copied version of the condition
   `field === "__created__" || field === "__deleted__"` — the "same decision
   in two places" class disappeared along the way.

   **`__comment__` is IMPLEMENTED since TL-99**, `__body__` still is not. The
   first writer is `worktrail handoff`, but the shape is generic and knows
   nothing about handoff: the whole content is `to`, `from` stays empty
   (a comment replaces nothing), and dedup works **by `id` alone** — the
   event rule from `__created__` does NOT apply to it, because the same
   sentence said twice at different times is two utterances, not one event
   seen twice. The reservation paid off exactly as intended: a write was
   added, not a migration of other people's data.

   Reading is a single rule for every event — `historyEntryKind()` in
   `task-fields.mjs` decides whether a row reads as `message` (all content in
   `to`), `event` (just the label), or `transition` (`from → to`). This is
   the same reason the pseudo-field list lives here: the viewer pastes this
   file as source, so the rule cannot drift from the page, and a test can
   call it instead of asserting on HTML.

### 7.1. The one-time transition cost (measured)

Branches created **before** step 3 still have views in the index, so the
merge that introduces this change **will report a conflict once more** —
measured on a live branch: `CONFLICT (content)` in `backlog/INDEX.yaml` and
`backlog/archive/done.yaml`. The fix is one-off and mechanical: accept the
deletion (`git rm`) and regenerate the views. From the next merge onward the
problem does not return, because the file is absent on both sides.

On the day of the change **7 worktrees** were alive, so this one operation
awaits each of them at its next merge with `main`.

### 7.2. How this is proven

Each of the three steps has a test with a **positive control** — without one
a green result is indistinguishable from "this mechanism never failed
anyway":

| Step | Evidence | Positive control |
|---|---|---|
| 1 | `history.test.mjs` — id, uniqueness within the same millisecond, lexicographic ordering, dedup | "dedup does NOT merge two distinct events with the same content" + "entries without an id are never deduplicated" |
| 2 | `history-merge.test.mjs` — a **real** merge of two branches in a temporary repository, with OUR attributes file | the same merge **without** `.gitattributes` MUST conflict |
| 3 | `views-not-versioned.test.mjs` — disjoint branches merge cleanly; in this repo views are ignored **and** untracked | a versioned aggregate conflicts despite disjoint tasks |
| 4 | `history.test.mjs` — validation, parsing, the whole write path; `config.test.mjs` — configuration with a bare actor fails | a bare name is NOT promoted to `local:`; the log from before TL-21 reads byte for byte; the CLI exits with an error instead of silently writing `unknown` |
| 5 | `history.test.mjs` — pseudo-fields pass write and read | `diffMeta` NEVER produces them (otherwise reconciliation would invent body changes it does not read) |

An assertion of "the file contains `merge=union`" would be worthless — it
would check that the rule was written, not that git applies it.

## 8. Order and risk

The server gets built **only once somebody besides the author uses the local
version.** Before that, optimising for a user who does not yet exist comes at
the expense of the users who already do.

What §6 describes is a SaaS product with accounts, roles, billing,
synchronization and a web UI, to be run alongside whatever else its authors
are already responsible for. The document does not advise against it; it
records that **order matters here more than the choice of technology**, and
steps 1–5 are exactly the part that is valuable regardless of whether hosting
ever gets built.

## 9. Assumptions to be falsified

Things I did NOT measure, which would overturn part of the above:

1. **Whether the real pain is conflicts or task collisions.** §2 only
   measures what reached a commit. An agent that walked into a taken task and
   backed off leaves no trace in git. If collisions dominated, the priority
   would be locks (§6.1), not steps 1–3.
2. **Whether non-technical people will edit the body after all.** §5.2 rests
   on an observation of roles, not a measurement. If an analyst genuinely
   rewrote task content, §5.3 stops being enough and the CRDT question comes
   back.
3. **Whether git is enough as transport for a small team.** This assumes
   everyone on the team has the repo and syncs regularly. A team with one
   non-technical member breaks this assumption from day one — and then the
   server is needed earlier than §8 says.
4. **Whether content really is 9% of the traffic for a TEAM.** §2.1 measured
   modifications only (`--diff-filter=M`), so it excluded creation, and it
   measured one person plus their agents. The team flow this document exists
   to support — one person writing a task for another to pick up — is content
   authored for somebody else, and it is absent from the sample. If content
   turns out to dominate a team's traffic, §4.2's "a bad trade" is being
   argued from the wrong population, and the balance between the modes in §6
   shifts towards the server.
