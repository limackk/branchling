---
id: TL-188
title: "A worktree switcher in the viewer, over the branch scan it already runs"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
  - id: switcher
    bash: "node --test scripts/tests/viewer-worktree-switcher.test.mjs"
---

## Goal

The viewer's top bar lists the worktrees of this clone and lets the reader make
one of them the SUBJECT of the view. Picking a worktree shows that tree's
backlog — its statuses, its board, its execution plan — rather than the
checkout the server happens to stand in.

## Context

Came out of watching the first unattended run on 2026-09-03. A `run` was
driving a task in the worktree `autonomous-flow-tasks-35273f` while the viewer,
served from the main checkout, showed a board that had not moved for two hours.
Nothing was broken: data travels with the branch (law 1), every worktree has
its own `backlog/`, and the server was telling the truth about ITS tree. But
the reader watching an autonomous fleet saw a still image, and the only way to
see the work was to merge it.

**The scan already exists; only the framing is missing.** `crossBranchState()`
(`scripts/branch-scan.mjs:446`) reads every local branch and worktree of this
clone and is already called by the viewer build
(`scripts/build-viewer.mjs:218`) — which is why a card can carry an
`elsewhere: in_progress` badge today. What the page cannot do is change its
own subject. So this task is presentation over data already gathered, not a new
source of truth (law 2: what is computed may be deleted).

**It is the sibling of TL-177, not a duplicate.** TL-177 switches between
PROJECTS — separate backlogs registered on this machine, joined by the pair
(project, id). This switches between WORKTREES of one repository, which share
an id space and differ only by branch. Both are switchers in the same bar and
should end up looking alike; whichever lands second follows the first one's
shape.

**It does not stand alone.** A switcher with no push still needs a reload to
show a change made a second ago — that is TL-122, which polls the scan and
pushes over SSE. The two together are the feature; either alone is half of it.
Land this one first: pushing a change the page cannot be pointed at is
pointless.

**What must NOT happen.** The viewer must not write into another worktree. It
reads their files; every writing route (field editing, `done`, `take`) stays
bound to the tree the server was started in, and the page must say so when a
foreign worktree is selected, rather than offering an edit that will fail or,
worse, silently write to the wrong tree.

## Pre-flight reading

1. `scripts/branch-scan.mjs` — `crossBranchState()`: what it already reads per
   worktree, and what it deliberately does not (`git fetch` is never called).
2. `scripts/build-viewer.mjs:218` — where the scan enters the page today.
3. `scripts/serve-backlog.mjs` — the request path, and where the served
   backlog directory is decided.
4. `backlog/tasks/TL-177-*.md` — the project switcher, for the shape of the
   control and the vocabulary in the bar.

## Steps

1. Enumerate the worktrees (`git worktree list --porcelain`), each with its
   branch, its path, and whether it is the tree the server stands in.
2. A control in the top bar; the selection is part of the URL view state, so a
   link to "the fleet's worktree" can be shared.
3. Render the selected tree's backlog read-only, with the writing routes
   visibly disabled and a reason.
4. `scripts/tests/viewer-worktree-switcher.test.mjs` over a fixture with two
   worktrees, asserting that selecting the second changes the rendered
   statuses and that no write reaches it.

## Decisions

**The selection re-runs the server-side build for that directory.** The open
question is settled against the JSON-fetch alternative, and the reason is the
configuration: a worktree brings its own `backlog/config.yaml` — its statuses,
its priorities, its boards, and the palette generated from all three. Swapping
only the tasks under an open page would paint one tree's data in another tree's
vocabulary, and a status with no badge and no colour is the kind of wrong that
still looks rendered. A navigation makes the server build the page from the
subject's own configuration, which is the same guarantee the terminal gives.

The cost is a reload, and it is paid for: the hash goes along, so the filters,
the sort, the board scope and the open task all survive the switch. This was
measured in the browser, not assumed.

**The subject lives in the QUERY STRING, not the hash.** The hash is per-view —
`#tasks`, `#dashboard`, `#execution` — so a subject encoded there would be
dropped the moment somebody clicked a tab; the worktree is not part of a view,
it is what every view is a view OF. It also has to be readable by the server
before the page exists, and a browser never sends a fragment. The link functions
therefore live in `viewer-url.mjs` (`withWorktree`, `readWorktreeParam`) beside
the hash contract, which is what makes them testable: the page carries that file
as pasted source, so `node --test` runs the same code the browser does.

**The key is the tree's directory name, not its path.** A shared link is the
whole point, and an absolute path is both unreadable in a URL and specific to
one machine. Two trees that share a name get a digest of the full path appended,
so a key does not change when a third tree appears.

**`resolveWorktree()` is an allowlist, and an unknown key is refused rather than
falling back.** The parameter arrives from a URL anyone can type, so it is
matched against the trees `git worktree list` itself reported and never turned
into a directory a request composed. Falling back to the server's own tree on a
typo would answer about the wrong backlog and look exactly like a correct
answer — the failure this whole task exists to remove.

**A foreign tree's configuration is loaded by hand, not with
`loadConfigOrExit`.** That function ends the process, which is right for a
command and fatal here: an unreadable `config.yaml` in a worktree the server
merely OFFERED to show would take the viewer down for everybody. It becomes a
502 naming the tree instead. `readTasks()` grew an optional pre-loaded config
for the same reason.

**Nothing writes through the switch.** The write routes take no directory —
they address the server's own backlog and only that — so a foreign tree cannot
be written to even by mistake. They still REFUSE a request naming another tree
(403 `foreign-worktree`, query or payload), because the failure worth preventing
is not "the wrong file changed" but "the caller believed its edit went elsewhere
and this tree changed instead". The page matches: no edit pens, no actor picker,
and a bar that says which tree it is showing and where edits do go.

**Deliberately NOT done.** The SSE push still watches only the server's own
tree, so a foreign subject needs a refresh to show a change made a second ago —
that is TL-122, and the two together are the feature. A `file://` page renders
no switcher at all: with no server there is nothing to switch to, and a control
that cannot work is furniture.
