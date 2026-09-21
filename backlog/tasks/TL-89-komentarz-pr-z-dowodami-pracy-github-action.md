---
id: TL-89
title: "PR comment with proof of work: GitHub Action"
type: task
labels: []
board: main
epic: "Agentic differentiators"
priority: P2
status: pending
owner: ""
executor: ""
estimate: 1d
confidence: medium
created: 2026-08-31
updated: 2026-09-21
blocked_by: []
blocks: []
related_docs:
  - docs/branchling-state-and-sync.md
  - docs/backlog-time-tracking.md
verification:
  - id: suite
    bash: "node --test scripts/tests/pr-summary.test.mjs"
  - id: from-git
    bash: "node scripts/cli.mjs pr-summary --base HEAD~1 --json | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);if(r.kind!=='pr-summary'||r.scanned!==true)process.exit(1);console.log('the range is read from git — OK')})\""
  - id: no-zeros
    bash: "node scripts/cli.mjs pr-summary --base HEAD~1 | grep -qi 'token\\|\\$\\|model' && { echo 'cost information leaked into a comment that did not ask for it'; exit 1; }; echo 'no tokens, amounts or model names without --cost — OK'"
  - id: no-tasks
    bash: "node scripts/cli.mjs pr-summary --base HEAD | grep -q 'No task changed' && echo 'a range with no tasks says so rather than going quiet — OK'"
  - id: standalone
    bash: "node scripts/cli.mjs pr-summary --base HEAD~1 | head -1 | grep -q 'the backlog on this branch' && echo 'the command works with no GitHub anywhere near it — OK'"
  - id: rendered
    manual: "The markdown from `branchling pr-summary` was pasted into a real pull-request comment and renders correctly there — the table has its columns, the transitions read as a list, and nothing shows as raw markup"
---

## Goal

`worktrail pr-summary --base main` prints (markdown to stdout) a summary of
the tasks the current branch touches: status transitions, per-field change
authorship (human vs `agent:`), and — when measurement data exists — estimate
versus time and tokens. A thin GitHub Actions workflow publishes this as a PR
comment.

Effect: the reviewer sees not just the code diff in the PR, but the backlog
diff and the agent's work accounting — and every consumer's PR becomes an
advertisement for the tool inside someone else's repository. The task travels
with the branch (Law 1), so only a tool with this architecture can do this
without integrating with an external tracker.

## Context

Came out of a review of differentiators against Backlog.md (2026-08-31).

The split of responsibilities is a decision here, not a detail:
- **All the intelligence lives in the CLI command** — `git diff --name-only
  <base>...HEAD -- <backlog>/tasks/` gives the list of tasks, `history/` gives
  transitions and actors, `activity/rollup/` (once it exists, after
  TL-27/25) gives time and tokens.
- **The Action is dumb** — checkout, `npx worktrail pr-summary`, comment. Per
  Law 4 (extensibility through composition): the Action is a script over a
  stable output, not a plugin. The same command works in GitLab CI or a hook
  with no change at all.

The time/token sections are CONDITIONAL: no measurement data means no
section. Do not block this task on the measurement phases — status
transitions and per-field attribution are valuable on their own and already
exist today in `history/`.

**The cost information in the PR comment is opt-in.** The comment lands in a
public place (or a company-wide visible one), and amounts, token counts and
model names are information about the author's spend and stack. By default
the measurement section shows time; tokens, model and amount are only turned
on by `--cost`. The amount is then subject to the billing modes from TL-30
(step 4): subscription-based data (Claude Code, Codex) gives tokens without
an amount, a local model — a declared zero; the comment does not invent
dollar figures where none exist.

## Pre-flight reading

- [docs/backlog-field-editing-history.md](../../docs/backlog-field-editing-history.md)
  — history record format, actor namespaces, what attribution does NOT
  guarantee (§4) — the comment cannot promise more than the data supports.
- [docs/branchling-state-and-sync.md](../../docs/branchling-state-and-sync.md) §2 —
  why views are not versioned; pr-summary reads tasks and history, never
  `INDEX.yaml`.
- `scripts/history.mjs` — reading and deduplicating entries.

## Steps

1. `pr-summary` command: tasks touched relative to `--base` (git diff over
   `tasks/` paths), per task: status transitions within the branch range,
   actor share of field changes, `verification:` result if recorded.
2. Measurement section (conditional): estimate vs engaged time from the
   rollup; tokens, model and amount only under `--cost`, respecting the
   billing modes.
3. Outputs: markdown (default) and `--json`.
4. A workflow template in the repo (`.github/workflows/` example in README
   or `examples/`), publishing a comment that updates in place (not a new
   comment on every push).
5. Tests on a temporary repository with a branch: touched tasks detected,
   untouched ones skipped; positive control — a branch with no changes under
   `tasks/` gives an explicit "no tasks", not an empty comment.

## Acceptance criteria

- [ ] Task detection via git diff, not via any computed view. [proof: from-git]
- [ ] The time/token sections disappear entirely when there is no data — no zeros. [proof: suite]
- [ ] Without `--cost`, the output contains no tokens, amounts or model names. [proof: no-zeros]
- [ ] The markdown output renders correctly as a GitHub comment (checked on a real PR before closing). [proof: rendered]
- [ ] The command works without GitHub (stdout) — the Action is only the transport. [proof: standalone]

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-09-02 in_progress — agent:claude — two decisions worth keeping. (1) Both
  sources are GIT, never a view: `git diff --name-status` over the task files
  says which tasks, and the lines ADDED to `history/*.jsonl` in the same range
  say what happened. The second works because the log is append-only, so "added
  in this range" and "happened on this branch" are the same set — comparing
  timestamps would need a clock everybody agrees on, which a distributed history
  does not have. (2) Whether a task was OPENED here comes from git's `A`, not
  from a `__created__` entry: `new` writes no history entry at all, so a summary
  waiting for one would silently miss every task somebody opened while working.
  That was found by the test rather than by reading the code.
- 2026-09-02 in_progress — agent:claude — `unknown` is rendered two different
  ways, decided by the entry's `source`. After a reconcile it means "nobody was
  there to ask"; after a command it means "nobody typed a reason". Rendered
  identically — which is what the first draft did — one of them libels the tool
  in a public comment. An unrecognised source takes the milder reading.
- 2026-09-02 in_progress — agent:claude — `--cost` has nothing to report today,
  because no measurement in this repository records tokens (TL-30 is not built).
  It says so in a sentence rather than printing a zero: a silent omission is
  indistinguishable from a cost of nothing.

- 2026-08-31 pending — agent:claude — task opened from a review of agentic
  differentiators; the measurement section is deliberately conditional
  instead of blocking on TL-27/25.
- 2026-08-31 revised — agent:claude — cost section made opt-in (`--cost`):
  the comment is public, and tokens/model/amount are information about spend
  and stack; amounts follow the billing modes from TL-30.
