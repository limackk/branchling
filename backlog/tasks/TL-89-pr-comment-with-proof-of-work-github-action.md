---
id: TL-89
title: "PR comment with proof of work: GitHub Action"
type: task
labels: []
board: main
epic: "Agentic differentiators"
priority: P2
status: done
owner: agent:claude
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
verification:                      # HOW to check the task is really done
  # REWRITTEN 2026-09-21, for two defects in the old block.
  #
  # (1) TL-260. `no-zeros` grepped the comment rendered from THIS backlog for
  # `token|$|model` and failed — because two task TITLES contain those words
  # (`TL-30 Token and session cost adapter`, `TL-112 Contribution model …`).
  # The entry judged the project's data instead of the tool's contract, so it
  # would have gone on failing however correct the code was. The question is
  # now asked structurally of `--json`: cost is absent unless `--cost`, and
  # under `--cost` nothing is invented.
  #
  # (2) TL-424. `rendered` was a manual vouch that ONLY a real pull request
  # could discharge, which makes closing the task depend on a push. The
  # behaviour it was guessing at — one comment, updated in place, rendering as
  # a table — is now executed locally: the posting script is lifted out of the
  # workflow and run twice against a fake API, and the markdown is checked for
  # GFM table well-formedness. What stays GitHub's half of the contract (that
  # `checkout`, `setup-node` and `github-script` behave on a runner as
  # documented) is stated in the workflow, not vouched for by anybody.
  #
  # Every range below is `<root commit>...HEAD`, not `HEAD~1`: a range that
  # happens to contain no task change would make the entries pass on nothing.
  - id: transport
    bash: "for f in scripts/tests/pr-summary-workflow.test.mjs scripts/tests/pr-summary.test.mjs examples/pr-summary.yml .github/workflows/pr-summary.yml; do test -f \"$f\" || { echo \"missing: $f\"; exit 1; }; done; node --test scripts/tests/pr-summary-workflow.test.mjs scripts/tests/pr-summary.test.mjs"
  - id: from-git
    bash: "root=$(git rev-list --max-parents=0 HEAD | head -1); node scripts/cli.mjs pr-summary --base \"$root\" --json | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);if(r.kind!=='pr-summary'||r.scanned!==true){console.error('the range was not read from git');process.exit(1)}if(!r.tasks.length){console.error('positive control failed: the whole history contains no task change');process.exit(1)}console.log(r.tasks.length+' task(s) read from the git range — OK')})\""
  - id: cost-is-opt-in
    bash: "root=$(git rev-list --max-parents=0 HEAD | head -1); PLAIN=$(node scripts/cli.mjs pr-summary --base \"$root\" --json) COSTED=$(node scripts/cli.mjs pr-summary --base \"$root\" --cost --json) MD=$(node scripts/cli.mjs pr-summary --base \"$root\") node -e \"const p=JSON.parse(process.env.PLAIN),c=JSON.parse(process.env.COSTED);if(!p.tasks.length){console.error('positive control failed: nothing was summarised');process.exit(1)}if(p.cost!==null){console.error('cost information without --cost');process.exit(1)}if(/### Cost/.test(process.env.MD)){console.error('a cost section in the default comment');process.exit(1)}if(!c.cost||!c.cost.reason){console.error('--cost said nothing at all');process.exit(1)}for(const k of ['tokens','amount','model'])if(c.cost[k]!==null){console.error('--cost invented a '+k+' nothing recorded');process.exit(1)}console.log('cost is opt-in, and opting in invents nothing — OK')\""
  - id: no-tasks
    bash: "node scripts/cli.mjs pr-summary --base HEAD | grep -q 'No task changed' && echo 'a range with no tasks says so rather than going quiet — OK'"
  - id: standalone
    bash: "root=$(git rev-list --max-parents=0 HEAD | head -1); node scripts/cli.mjs pr-summary --base \"$root\" | head -1 | grep -q 'the backlog on this branch' && echo 'the command works with no GitHub anywhere near it — OK'"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`branchling pr-summary --base main` prints (markdown to stdout) a summary of
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
- **The Action is dumb** — checkout, `npx branchling pr-summary`, comment. Per
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

- [x] Task detection via git diff, not via any computed view. [proof: from-git]
- [x] The time/token sections disappear entirely when there is no data — no zeros. [proof: transport]
- [x] Without `--cost`, the output contains no tokens, amounts or model names. [proof: cost-is-opt-in]
- [x] The comment is posted once and updated in place on the next push, and its markdown is a well-formed GFM table. [proof: transport]
- [x] The workflow invokes a command line this CLI still accepts — a renamed flag fails here, not in somebody else's CI. [proof: transport]
- [x] The command works without GitHub (stdout) — the Action is only the transport. [proof: standalone]

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
