# Backlog — field editing and change history

**Status:** IMPLEMENTED 2026-08-29 ([TL-16](../backlog/tasks/TL-16-edycja-kazdego-pola-taska-w-viewerze.md), [TL-17](../backlog/tasks/TL-17-historia-zmian-pol-taska-z-autorem.md))
**Code SSOT:** `backlog/scripts/task-fields.mjs`, `backlog/scripts/history.mjs`, `backlog/scripts/serve-backlog.mjs`, `backlog/scripts/build-viewer.mjs`
**Tests:** `node --test backlog/scripts/tests/task-fields.test.mjs backlog/scripts/tests/history.test.mjs`

---

## 1. Goal

Two things the backlog previously only had half of:

1. **Editing** — the viewer could change only `status`. Every other field
   (priority, owner, estimate, labels, epic, board, blocked_by, related_docs,
   title) required opening the `.md` file in an editor.
2. **Attribution** — a task file says *what the state is*, but not *who set
   it*. The `## Log` section is manual and filled in irregularly, and
   `git blame` does not answer "who changed this task's priority", because a
   commit usually spans a dozen files and several fields at once. With one
   founder this is an inconvenience; with a founder plus agents plus more
   people, it is a missing piece of evidence.

Target state: clicking any field edits it, and beside the field you can see
**who** changed it last and **when**.

---

## 2. Data model

```
backlog/history/BL-NNNN.jsonl    ← append-only, VERSIONED in git
backlog/history/.snapshot.json   ← last-seen frontmatter (gitignored)
backlog/history/.migrations.jsonl ← id prefix changes, VERSIONED (TL-111)
```

One row = one change to one field:

```json
{"ts":"2026-08-29T13:17:10.970Z","task":"TASK-9999","field":"status",
 "from":"pending","to":"in_progress","actor":"local:founder","source":"viewer",
 "session":"s-2026-08-29-a"}
```

- `from` / `to` — a string or an array (list fields: `labels`,
  `blocked_by`, `blocks`, `related_docs`).
- `field` — a frontmatter key or a task-event pseudo-field: `__created__`,
  `__deleted__`, `__verified__`, `__role_override__`, `__comment__`.
- `actor` — **`<namespace>:<name>`** (TL-21): `local:` declared and
  unverified, `agent:` automated write, `user:` authenticated account;
  `unknown` is the only value with no namespace. **The name vocabulary is
  OPEN** — we validate shape, not membership in a list — but the namespace is
  CLOSED and the code does not guess it: a bare name in a new write lands as
  `unknown`. Entries from before TL-21 stay untouched and are given the
  `legacy` namespace on read. Target model:
  [worktrail-state-and-sync.md](worktrail-state-and-sync.md) §7 step 4.
- `id` — a ULID (TL-21). Sorting by it is sorting by time, so it is a
  ready-made sync cursor; `readHistory()` deduplicates by it entries that a
  union merge might have inserted twice.

**`__created__` and `__deleted__` are TASK EVENTS, not field changes** (TL-39),
and have their own dedup rule on read:

- **The key is the event, not the write.** One task being founded should
  yield one entry, no matter how many observers saw it. Dedup by `id` does
  not catch this, because a ULID identifies the WRITE — two writes of the
  same event have different ULIDs by definition.
- **The key is not `task + field + to`.** For `__created__` the value of `to`
  is the title, and the title can be changed between one observer and the
  next; a duplicate would then pass a content-based gate.
- **But not "at most one per task".** A task deleted and founded again has
  TWO genuine foundings. A duplicate is a repeat that changes no state:
  entries of the same kind adjacent in time, with no opposing event between
  them.
- **On a duplicate, the BETTER-ATTRIBUTED entry wins** (`local:`/`agent:`/
  `user:` beats `unknown`), and on a tie, the earlier one. "Last write wins"
  would be the worst choice here: the second observer knows less by
  definition than the one who actually saw the event.
- **Ordinary fields do NOT have this rule.** Two `pending → in_progress`
  transitions at different times are two events; deduplicating by value would
  eat genuine history.
- **`__comment__` does not have it either, and that is a decision** (TL-99).
  A comment is a pseudo-field but not a task event: the same sentence twice
  at different times is two utterances, and eating the second would be
  editing someone else's conversation. What remains is plain dedup by `id`,
  the same as everywhere. The whole comment content is `to`; `from` is empty,
  because a comment replaces nothing.
- `source` — which route the change arrived by: `viewer` | `hook` |
  `external` | `boot` | `cli`. This is metadata about how much `actor` is
  worth, not decoration (§4).
- `session` — which session wrote it (TL-164). **The same identifier the
  activity log records**, from `sessionId()` in `focus.mjs`, because
  `worktrail session <id>` joins the two logs and a second derivation of
  "which session is this" would break the join in exactly the cases it exists
  for. Before this field the report correlated by task and time window and
  said so on every answer; two agents working one task at overlapping times
  could not be told apart at all.

  **Only a write that MADE the change may carry it.** Reconciliation records
  changes it merely SAW — an editor, git, another session — so stamping the
  observing process there would attribute somebody else's work to whoever ran
  the reconcile, which is TL-130's defect with a new field. `reconcile()`
  therefore writes no session, and neither does any line predating this field.

  **Absent, never empty.** An empty string would be a third state beside
  "absent" and "present" meaning the same as the first. An entry with no
  session belongs to no session; `worktrail session` counts such changes
  apart instead of listing them under whichever session was running.

### Why JSONL per task, not one file / SQLite / git

| Option | Rejected because |
|---|---|
| One `history.jsonl` | Two sessions editing different tasks conflict in git on the same line; reading one task's history reads the whole backlog's history (1350+ tasks). |
| SQLite | The backlog is file-based by design and versioned together with the code (README §1). A binary database removes diff, code review and `grep`. |
| Plain `git log` | Needs nothing new, but a commit is the wrong unit: it spans many files and many fields, and the commit author ≠ the field's author (an agent commits as the founder). For **backfilling** history predating this mechanism, git remains the only source — see §6. |
| A `## Log` section in `.md` | Was narrative ("why"), manual and not machine-parseable. Retired in TL-105 at zero adoption: the reason travels with the WRITE, in the `reason` field. Sections in old tasks stay. |

The snapshot (`.snapshot.json`) **is not a source of truth** — it is a
reference point for diffing, reconstructible from the task files. That is why
it is gitignored: if it went into the repo, every `git pull` would produce a
conflict on a file nobody reads.

`.migrations.jsonl` (TL-111) is the snapshot's opposite: VERSIONED, because
its reader is EVERY clone. One row = one id-prefix change:

```json
{"id":"01K…","ts":"2026-09-01T07:13:34.277Z","kind":"prefix",
 "from":"BL","to":"TL","actor":"local:founder","source":"migrate-prefix"}
```

Without this record, `migrate-prefix` was, as far as history was concerned,
**deleting the whole backlog and founding it anew**: the snapshot stayed on
the old keys, and the next reconciliation honestly reported 74 disappearances
and 74 new tasks. Measured in this repository: 42 `history/BL-*.jsonl` files
with a single `__deleted__` record, all from one run. Because `history/*.jsonl`
travels in git with the `merge=union` rule, the tombstones would be
permanent — and any age or pace computed from such a log would point to the
migration day as the backlog's birthday.

RECOGNISING a migration through reconciliation ("`X-N` disappeared, `Y-N`
appeared with the same content") was rejected: that is guessing, and this
mechanism declares honesty instead of guessing (§4). Content equality is
exactly what a migration does not guarantee — a renumbering combined with an
edit in one commit breaks the match, and two unrelated tasks with the same
number and title falsely satisfy it. The record is a FACT to be read, not a
heuristic.

The snapshot key only carries over **when the old task has disappeared from
the tree and the new one is present in it** — this means a clone that has the
record but not yet the renamed files (an older checkout, a migration
interrupted midway) does not produce that same tombstone pair, and an
interrupted migration completes itself on the next run.

---

## 3. Three write paths, one field definition

Everything that knows "what a task field is" lives in `task-fields.mjs`: the
list of editable fields, their types, value vocabularies, validation, writing
to the frontmatter, and comparing two versions. The same file:

- validates requests in `serve-backlog.mjs`,
- is **pasted as source** into the generated viewer (like `viewer-url.mjs`
  since TL-15), so the browser draws editors from the same schema and cannot
  send a value the server would reject,
- is run by `node --test`.

Practical consequence: **a new field or a new status is added in one place.**
Previously the list of statuses lived in three (server, viewer, README); this
change reduced it to one.

### 3.1 Viewer (author: known)

`POST /api/field {id, field, value, actor}` → validation → write to `.md` →
`updated: <today>` → history entry → `build-backlog.mjs` (regenerating
NOW/INDEX/archive).

History is built from comparing the state **before the write** with the state
**read from the file after the write**, not with what the browser sent — the
entry describes what genuinely landed on disk.

`POST /api/status` became an alias of the same function. Two endpoints
writing the frontmatter would mean two places deciding validation, `updated:`,
and history.

### 3.2 Agent (author: known)

The `PostToolUse` hook (`worktrail regen-hook`), after every Edit/Write on
`backlog/tasks/BL-*.md`, calls:

```bash
node backlog/scripts/history-record.mjs --file <file> --actor claude --source hook
```

This is the **only moment the system knows for certain** that an agent
changed the task — the file alone doesn't say so. `$BACKLOG_ACTOR` overrides
the author when someone else triggers the hook.

### 3.3 The rest of the world (author: `unknown`)

The viewer's server watches `tasks/` (`fs.watch`) and, 2.5 s after a change,
runs a reconciliation: diffing every task against the snapshot, entries with
`actor: "unknown"`, `source: "external"`. This catches an editor, `git
checkout`, `git pull`, and an agent working without the hook. The same pass
runs at server startup (`source: "boot"`) — closing the "the server was off"
gap.

The 2.5 s delay exists so the agent's hook has time to write its entry
**first**; then reconciliation sees no difference left and stays silent.
Ordering, not guessing: "if it wasn't the viewer, it was probably the agent"
would produce entries signed by someone who didn't make them.

#### 3.3.1 Claiming a change afterwards (TL-130)

**The delay is a bet on timing, and a person loses it.** It works for a hook,
which writes in milliseconds. It does not work for somebody who edits a file
and attributes the change a minute later: by then the server's reconciliation
has written the change as `unknown` *and updated the snapshot*, so `worktrail
history --actor … --reason "…"` finds no difference left and answers `no
changes to record`. Measured on 2026-09-01 against TL-99 and TL-100. That
sentence reads as "everything is recorded" while the truth is "everything is
recorded as nobody's", and the author is then gone for good — the log is
append-only and is never rewritten.

Widening the window would still be a bet, only a bigger one. Making
reconciliation read-only would trade away the property that a change leaves a
trace even when nobody speaks for it. So the entry stays and is **claimed
beside it**: `worktrail history --attribute --actor <ns:name> --reason "…"`
appends an `__attributed__` event carrying the id of the change it claims.

Three properties this keeps that a correction would not:

- the log stays append-only, so nothing already read can change under a reader;
- the original entry goes on saying `unknown`, which was **true** when it was
  written — a claim is a later fact, not a repair of an earlier one;
- the claim carries its own author, timestamp and reason, so it is evidence of
  the same kind as everything else here.

A change is claimable **once**: two people claiming one change is a
conversation this log cannot represent, and the first claim was the one made in
good faith. Nothing is claimed automatically — reconciliation writes `unknown`
because it genuinely does not know, and only the caller does.

---

## 4. What this mechanism does NOT guarantee

History is an **observation log of a local tool**, not an audit log.
Deliberate limitations:

1. **`unknown` means `unknown`.** The server sees a changed byte, not a hand.
   The `source` field says how much the attribution is worth: `viewer`/`hook`
   = an author declared by a process that knows; `external`/`boot` = nobody
   saw it.
2. **The actor in the viewer is a declaration, not authentication.** The
   "Editing as founder/claude" switch sets the signature; there is no login
   or session. With one user on loopback that is adequate — with several,
   identity is needed (§7).
3. **Changes made while the server is off and without the hook only reach
   history at the next server startup**, in bulk and as `unknown`. They are
   not lost, but they lose both time and author.
4. **The snapshot is local.** A fresh clone has no snapshot → the first pass
   only founds it and **appends not a single entry**. This is deliberate:
   1350 invented "changes" on first run would be worse than no history before
   it.
5. **We do not version the body's content.** History covers the frontmatter.
   Changes to the `## Goal`, `## Steps` sections etc. stay in git — fields
   are what the backlog filters, plans and computes the dashboard from.
6. **The snapshot is local, history is shared — and this had to be
   reconciled.** A task or change brought in by `git merge`/`git pull` does
   not exist in YOUR snapshot, so reconciliation used to take it for new and
   write it again — into the same, versioned file (measured 2026-08-29 on
   `TL-18.jsonl` after merging a worktree into `main`: two `__created__`
   entries with identical content). Fixed at the source: before writing
   anything, reconciliation asks the history file what it already knows — a
   task missing from the snapshot but with NON-EMPTY history means "it came
   from outside", and a field change whose `to` equals the last recorded
   entry is skipped. Deliberate cost: when someone locally sets the same
   value someone else already recorded, no second entry is created — the
   state matches either way, and the first write's author stays attributed.
7. **A gate on WRITE is not enough, because its premise travels on a separate
   channel.** Reconciliation asks the history file before appending
   `__created__` (point 6) — and works when there is something to read.
   `.md` always travels with git; `.jsonl` only when someone committed it;
   measured 2026-08-31 in a consumer repository: 28 of 71 history logs were
   untracked. Hence a second layer sits at READ time (§2), and works even
   when both entries already exist.
8. **There is no undo.** An entry says what came before; restoring it is an
   ordinary edit (which writes another entry).

---

## 5. UI

The task detail view renders one row per field from the `EDITABLE_FIELDS`
spec:

- **click / Enter / Space** on a value opens the editor appropriate to its
  type: `select` (enum), `input` + a datalist (text with suggestions from
  real data), checkboxes (labels — a closed vocabulary), a "one value per
  line" textarea (blocked_by / blocks / related_docs). **Esc** cancels.
- next to a field's label sits an **`author · when`** marker for its last
  change; clicking it narrows the history list to that field.
- below the field grid: **Change history (N)** — a timeline from newest:
  date, actor, `field: old → new`, source.
- the write is optimistic and **reverts to the previous state if the server
  rejects it** — the displayed state always matches the file.

**Editing works only in server mode** (`backlog` in the terminal). In
`file://` mode fields are read-only, and history is visible (built in). The
reason: a second write path through the File System Access API would mean a
second set of validation rules, a second place aware of history and view
regeneration — the first schema change would drift silently between the two.
This also removed the previously existing duplication of writing the status
(fetch + FS Access).

---

## 6. Backfilling history predating this mechanism — deliberately NOT done

History of field changes can be reconstructed from git:
`git log -p --follow backlog/tasks/BL-*.md`, diffing the frontmatter commit
by commit, `actor` from the commit author. We are not doing this now,
because:

- the commit author in this repository is **always the founder**, even for
  agent work — backfilling would produce 1350 tasks "changed by the founder",
  a pretty and untrue attribution;
- commit date ≠ change date (work is sometimes committed in batches).

If a backfill were ever needed, the only honest form is `actor: "unknown"`,
`source: "git"`, and the commit's `ts`. Its being worthwhile depends on
commits already distinguishing authors beforehand (e.g. a `Co-Authored-By`
trailer) — until they do, the result carries none of the information we are
looking for.

---

## 7. The road to multiple users

Order of steps once real users besides the founder and agents arrive:

1. **An actor registry** — `backlog/actors.yaml` (slug, name, type
   `human|agent`), a pre-commit guard rejecting an actor not in the registry.
   The entry schema does not change; membership validation is added.
2. **Identity instead of declaration** — the namespace (`local:` vs `user:`)
   has been in the schema since TL-21, but nobody ENFORCES it: the server
   still trusts the `actor` field from the request. Closing this: take it
   from the session (even from a header set by a reverse proxy, or from
   `git config user.email` for local access). Only this turns the log into
   an audit log.
3. **History as the dashboard's source** — with the `ts` of a status
   transition, the dashboard stops counting "completed on day X" from
   `status: done` + `updated:` (today documented as an approximation — see
   the comment in `build-viewer.mjs`) and starts counting from real
   transitions.
4. **Presence / write conflicts** — with two people editing in parallel, a
   "has the file changed since it was read" test is added (ETag/mtime) and
   overwrites are refused. Today the last write wins, which is the right
   simplification for one user.

---

## 8. Classes of bug this mechanism has already caught

- **One event, one entry per observer.** A task founded in a worktree wrote
  `__created__` on its own; a second checkout that lacked that entry took the
  task for new and wrote its own — as `unknown`/`external`. Three occurrences
  (TL-33, BL-1445, BL-1446), the last one **with no merge at all**: a second
  observer of the same file was enough. Each found by hand, none by a test —
  the mechanism had no gate for this class, because dedup by `id` cannot see
  it by definition.
- **Writing a list field ate the neighbouring key.** A naive "swap the line"
  approach on `related_docs:` (a block list) ate the `verification:` block
  below it. The test `a block list does not eat the next key` guards this
  directly; it is the same class as "a replace anchor spanning the neighbour"
  — a match wider than intended erases a block nobody read.
- **A render → fetch → render loop.** `renderDetail()` fetched history, and
  the response called `renderDetail()` again — this erased an open editor
  mid-keystroke and hammered the server endlessly. History is now fetched
  once per task and redraws the view only when it genuinely changed.
- **A backslash in code pasted into a template literal.** The viewer's client
  code lives in a JS template literal — `\n` or `\'` written literally get
  eaten when the page is generated. Modules pasted **as source** (like
  `task-fields.mjs`) don't have this problem, because they are interpolated,
  not parsed; code written directly in the literal has to double its
  backslashes.
