# worktrail

A backlog in markdown files, driven from the terminal. Tasks are files in git;
views, indexes and aggregates are COMPUTED and are not versioned.

- **Entry point:** `node scripts/cli.mjs` (or `worktrail` once installed). An
  unknown command and an unknown flag **fail** — a silent no-op looks like it
  worked.
- **Its own backlog:** `backlog/` — the tool tracks itself with itself.
- **Origin and milestones:** [`LINEAGE.md`](LINEAGE.md).

## Four laws

Extensibility comes from these rules, not from a plugin API. Full reasoning:
[`docs/worktrail-global-tool.md`](docs/worktrail-global-tool.md) §3.

1. **Data in the repository, pointers globally.** A task travels with its branch
   and goes through review. State divorced from the branch is the defect that
   external trackers were rejected for.
2. **What is computed may be deleted.** Views, index, registry. If deleting
   something hurts, it has become a truth it was never meant to be, and that is
   a design error.
3. **Configuration layers are DISJOINT, not prioritised.** A key in the wrong
   layer fails; the user layer does not override the project's vocabulary.
4. **Extensibility through composition** — `--json` on every reading command, a
   callable input on every writing one. No plugin API.

## Before you change the code

- **The data directory is resolved by `resolveBacklogDir()`** — four sources:
  `--dir` → `BACKLOG_DIR` → detection upwards from cwd → co-location. **Never
  compute it with your own `join(__dirname, "..")`** — that is co-location
  disguised as a general rule and works only where the code sits ABOVE the data.
  This class of bug was caught when the repository was extracted; the regression
  test is `scripts/tests/non-colocated-layout.test.mjs`.
- **The task id prefix comes from `config.yaml`**, never from a literal in the
  code — the patterns are built by `scripts/task-id.mjs`. A missing key means the
  prefix is read from the tree; a mismatch between configuration and tree FAILS
  before anything is written. Changing the prefix is `worktrail migrate-prefix`,
  not an edit to one line. Closing gaps in the NUMBERS is `worktrail renumber`.
- **The code knows the SHAPE of a field, `backlog/config.yaml` knows the
  VALUES.** An unknown key fails. Do not write the project's vocabulary into the
  code.
- **The reason for a change travels with the WRITE, not as prose in the file**
  (TL-105). `## Log` exists neither in the template nor in what `worktrail done`
  writes; the "why" is the `reason` field of a record in `backlog/history/`.
  `reason_required_statuses` in `config.yaml` says which statuses may not be
  entered without one (here: `blocked`, `cancelled`) — writing commands REFUSE
  rather than ask. Two values are reserved and must never be typed by hand:
  `unknown` (a change that was observed, not made by the tool) and `proven` (the
  reason is a verification run). `## Log` sections in old tasks stay — they are
  sentences nobody will reconstruct, not debt to tidy away.
- **The product name comes from `scripts/product.mjs`** (read from
  `package.json`), not from literals — in messages, in `--help`, in comments and
  in templates written into other people's repositories. `worktrail check
  --product-name` enforces this (TL-117): a literal in `scripts/` or `bin/`
  FAILS, and an exception (a real path on disk) is marked `product-name: allow`
  beside that ONE line. `scripts/tests/` is DELIBERATELY outside the guard — a
  test taking the expected name from the same constant as the code asserts
  `N === N`.
  **Two identities, not one:** `PRODUCT_NAME` is text to be read and is allowed
  to change; `BLOCK_MARKER_NAME` is a FROZEN key in the `.gitignore` and
  `.gitattributes` of other people's repositories — derived from the display
  name, a rename would produce a SECOND block instead of updating the first.
- **Session state (locks) lives OUTSIDE the repository** — `scripts/lock.mjs`,
  the `BACKLOG_STATE_DIR` / XDG directory, keyed by `git rev-parse
  --git-common-dir` (TL-87). The reason is not aesthetic: every worktree has its
  own `backlog/`, so a lock written into the backlog directory would be a
  different file in each of them and would exclude nobody — that is, it would
  look like it worked. A reservation is created by `link()` from a temporary
  file; `open(wx)` plus a write is TWO steps and the file exists empty between
  them, which was measured handing the same task to two sessions.
- **A guard that passes on a zero sample is green with no evidentiary force.**
  If a test can pass against an empty tree, add a positive control.

## Tests

```bash
node --test scripts/tests/*.test.mjs
```

693/693, green. Two rules keep it that way:

- **Take the backlog directory from `scripts/tests/_repo.mjs`**, never by
  counting upwards from the test file yourself. That module settles BOTH layouts
  — `<repo>/backlog` and the co-located `<repo>` — because the tool supports
  both.
- **Do not assert another project's values.** Statuses, labels, board slugs and
  thresholds computed from its size are DATA, not the tool's contract. If a test
  needs a specific value, it has to establish it with a fixture.

## Language: everything in this repository is English

**Every file is written in English. There is no directory-shaped exception.**

The boundary used to be drawn around what ships in the npm tarball, which put
`docs/` and `backlog/` on the other side. It is now drawn around **what a
stranger reads when they open the repository**, and by that test the backlog
qualifies more strongly than the code does: [`LINEAGE.md`](LINEAGE.md) states
outright that the tasks ARE this tool's development history, because the git
history was flattened at extraction. Nobody can be invited into a project whose
reasoning is in a language they do not read.

This covers, without exception: `scripts/`, `bin/`, `README.md`, `_template.md`,
`docs/`, `backlog/tasks/`, `backlog/config.yaml`, `backlog/plan.yaml`,
`backlog/boards.yaml`, this file, the dotfiles, **and the git surface** — commit
titles and bodies, branch names, worktree names.

Three things are enforced by a guard; the rest is this rule:

- `worktrail check --language` reads the source that ships (`scripts/`, `bin/`,
  `README.md`, `_template.md`). An exception there — a transliteration table,
  test data — is marked with a `language-guard: allow` comment beside that ONE
  line.
- Nothing checks the git surface, deliberately: history cannot be inspected
  before it is written or corrected afterwards, so a guard would either run too
  late to help or demand a rewrite that costs more than it returns.
- Nothing checks `docs/` or `backlog/` yet. Extending the guard is part of the
  migration below, and it cannot be switched on until the last file is done.

The commit history no longer carries a Polish exception. It was squashed to a
single English commit on 2026-09-01, while the repository had no remote and
nothing had been published, so no hash anybody relied on was voided. That
window has now closed: **from here on the history is immutable again**, and a
commit written in the wrong language is fixed by writing the next one correctly,
never by rewriting the old one.

**What was written in Polish before this rule STAYS until a deliberate
migration:**

- **`backlog/history/*.jsonl`.** The log is append-only. A `reason` written by a
  person is their sentence, not a field a later pass may correct.
- **`backlog/tasks/` and `docs/`.** Translating a task title changes its slug,
  which changes the filename — a MIGRATION, not a fix in passing. **Do not
  translate them opportunistically while doing other work:** half a backlog in
  each language is worse than all of it in one, because a reader cannot tell a
  missed file from an old one. There is a task for this.

Other conventions:

- **Technical, professional register.** Precise domain terminology, no slang, no
  shorthand, no jokes, no emoji. A comment explains WHY; it does not repeat what
  the line beside it already shows.
- After changing a task's frontmatter: `node scripts/cli.mjs build`.
- A new task: `node scripts/cli.mjs new --title "…"`.

## A topic that surfaces mid-task: a new task, not an aside

**If a topic surfaces while you work on a task and it is not something you do in
passing, create a task for it in the backlog — do not ask for permission.**
Permission is granted in advance and does not expire.

There is one criterion: does doing it NOW fit inside the current task's thesis?
A typo on the neighbouring line — you fix it. A separate design decision, a
refactor of an adjacent module, a missing guard, debt spotted along the way —
that is a new session, so it goes to the backlog. A topic left only in the prose
of an answer or in a `TODO` comment dies with the session; the backlog is the
only place `worktrail next` can ever hand it out from.

- **Create it with `node scripts/cli.mjs new --title "…"`**, not by writing the
  file by hand — the id and the shape of the frontmatter come from the tool.
- **The description has to stand on its own.** A new session will not see this
  conversation: write what is wrong, where (path, function), and how anyone will
  know it is done.
- **Do not inflate the current task.** Adding a surfaced topic to the scope of a
  task already in flight blurs both — and a blurred task has no verification.
- **A new task travels in its own commit**, or together with the current task's
  commit if it was created in the same tree — but never as a pretext for a code
  change the current task does not cover.

## A commit for every finished task

**Every finished task ends in a commit — do not ask for permission.** A task's
state has to travel with its branch (law 1), so a task file closed in the
working tree and left uncommitted is exactly the divergence that external
trackers were rejected for. Permission is granted in advance and does not
expire.

- **One task = one commit.** Work from two tasks in one commit blurs both; if a
  single file carries changes from both, split it by hunks.
- **The title starts with the task id**, then the thesis of the change — what is
  now true, not which files were touched. The body explains WHY, including the
  options rejected and what was deliberately NOT done.
- **The thesis outranks the imperative mood.** Common practice says to write the
  title as a command ("add X", "fix Y"), because a commit describes an operation
  on the tree. A stronger rule applies here: the title says what is now TRUE.
  The difference is measurable when reading `git log` months later — "add plan
  guard" makes the reader guess what the guard defends, while "an unexecutable
  plan fails" already says it. Do not mix both styles in one repository.
- **Shape, so that `git log --oneline` and `git log` stay readable:** the title
  on ONE line, up to 72 characters, with no trailing full stop; a blank line
  after it; the body wrapped at 72. No emoji and no `feat:`-style tags — the
  task id already says what the commit is about, and a second taxonomy beside it
  is a second place to be wrong.
- **Commit a task closed by `worktrail done` together with its entry in
  `backlog/history/`** — the evidence of closing is part of the closing.
- **A task that did not pass its own verification is NOT finished** and this rule
  does not apply to it. Commit the progress with an honest description in the
  body, never with `status: done`.
- **`git push` remains a separate decision** and needs an explicit request. This
  rule is about committing, not about publishing.

## After the commit: merge into `main` and close the worktree

**A commit does not finish a task — merging does.** Once a finished task is
committed, merge its branch into `main` and remove the worktree it was made in.
Permission is granted in advance and does not expire; `git push` STILL needs an
explicit request.

The reason is not tidiness but measurement. A task closed on a branch nobody
merged is still OPEN as far as the rest of the repository is concerned: every
worktree has its own `backlog/`, and `worktrail next` picks candidates from ITS
OWN tree — a reservation only excludes sessions running at the same moment, and
knows nothing about the state on somebody else's branch. This really happened:
on 2026-09-01 TL-74 was closed at 13:41, and at 13:43 a second session was
handed the same task by `next`, because in its tree the task was still
`pending`. An unmerged branch is not "work awaiting review", it is an invitation
to do it a second time.

- **Fast-forward where possible** — `git -C <main checkout> merge --ff-only
  <branch>`. No fast-forward means `main` has moved: use a merge commit, and
  settle conflicts by task id, not by file.
- **Rebuild the views in the main checkout** — `worktrail build`. The views are
  computed and unversioned, so after a merge they still show the state from
  before it.
- **Remove the worktree** — `git worktree remove <path>`. A worktree with no
  unmerged work of its own is just one more tree in which `next` will hand out a
  task that is already done.
- **A session does NOT remove the worktree it is standing in** — that is its
  working directory. Report the path to be removed and leave the command.
- **Branch and worktree names: `tl-<number>-<short-english-slug>`**, lowercase,
  hyphenated. Take the slug from the task's thesis rather than its whole title —
  three or four words is enough. A branch name appears in `git log` at the merge
  and in every `git branch -a`, so it falls under the language rule above. A
  branch named automatically by tooling (`claude/…`) is the one exception and is
  not renamed — renaming breaks its link to the session that created it.
