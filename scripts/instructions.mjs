#!/usr/bin/env node
/**
 * The `instructions` command — the workflow, printed by the tool itself (TL-74).
 *
 * WHY A COMMAND AND NOT A FILE. Until this command the protocol for working a
 * backlog lived in an editor-specific skill file: it reached exactly one agent
 * in exactly one editor, and only for somebody who had installed our plugin. A
 * user who installed the package got a `--help` that says WHICH commands exist
 * and nothing that says HOW one works. The alternative — copying a guide into
 * every repository — is worse than nothing after six months: the copy freezes on
 * the day it was made and goes on teaching flags that no longer exist. A command
 * cannot drift from the tool, because it IS the tool.
 *
 * THE FOUR PROPERTIES THAT MATTER MORE THAN THE COMMAND EXISTING:
 *
 *   1. THE TEXT DOES NOT KNOW THE PROJECT'S VOCABULARY. Not one status,
 *      priority, type or id prefix is written out below; every one is a
 *      placeholder filled in from the configuration of the backlog being read.
 *      This is the third law applied to prose. A guide that says "set it to
 *      in_progress" is correct in this repository and wrong in a backlog whose
 *      statuses were renamed — and wrong there in the most expensive way, by
 *      being confidently specific.
 *   2. `overview` IS A SWITCHBOARD, NOT A PROCEDURE. It says when to act and
 *      which guide to open, and it says outright that it is not enough on its
 *      own. The phase guides carry the procedure. Three short pages read at the
 *      moment they apply beat one long page loaded always.
 *   3. THE NUDGE CARRIES A VERSION. What `init` appends to a repository's agent
 *      file is a pointer plus the version of that pointer, so a later release
 *      can recognise an old block and REPLACE it instead of appending a second.
 *   4. ONE QUESTION DECIDES WHETHER TO OPEN A TASK AT ALL: "do I have to think
 *      about HOW?". A list of exceptions is slower to apply and easier to argue
 *      with.
 *
 * ONE SOURCE. The skill under `.claude/` now points here rather than repeating
 * this text. Two documents saying the same thing are not redundancy; they are
 * two documents that will disagree.
 *
 * Tests: `node --test scripts/tests/instructions.test.mjs`
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigOrExit } from "./config.mjs";
import { CONTEXT_RULE, commandRunner, contextBudget } from "./context-budget.mjs";
import { HOME_ENV } from "./home.mjs";
import { STATE_DIR_ENV } from "./lock.mjs";
import { queueStatuses } from "./next-task.mjs";
import { printJson } from "./json-envelope.mjs";
import { resolveBacklogDir, resolveBacklogDirOrExit, takeDirFlag } from "./paths.mjs";
import { BLOCK_MARKER_NAME as MARKER, PRODUCT_NAME as N } from "./product.mjs";
import { inProgressStatus } from "./take-task.mjs";
import { failure } from "./ui.mjs";
import { writeOut } from "./stdout.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// ──────────────────────────────────────────────────────────────────────────
// The vocabulary the text is rendered with
// ──────────────────────────────────────────────────────────────────────────

/** A list of vocabulary values, each quoted. Empty says so rather than leaving
 *  a gap the reader has to interpret. */
function list(values) {
  const xs = (values || []).filter(Boolean);
  return xs.length ? xs.map((v) => "`" + v + "`").join(", ") : "(none declared)";
}

/** A single value, RAW — the template decides whether it is quoted, because the
 *  same value goes into prose and into a command line. */
function one(value) {
  return value ? String(value) : "(none declared)";
}

/**
 * Everything the guides are allowed to say about THIS backlog. PURE.
 *
 * Every key here is a value the project chose. If a guide needs a word that is
 * not in this object, that word is either the code's shape (a field name, a
 * flag, a command) — which is ours to spell — or it is a literal that does not
 * belong in the text at all.
 */
export function vocabulary(config) {
  return {
    tool: N,
    prefix: one(config.taskIdPrefix),
    project: one(config.projectName),
    statuses: list(config.statuses),
    active_statuses: list(config.activeStatuses),
    archived_statuses: list(config.archivedStatuses),
    // The archived statuses MINUS the default closing one: the guide has to name
    // the statuses that need a stated reason, and the closing status is exactly
    // the one that does not.
    other_archived_statuses: list((config.archivedStatuses || []).slice(1)),
    queue_statuses: list(queueStatuses(config)),
    reason_statuses: list(config.reasonRequiredStatuses),
    // Not `one()`: a backlog that never said which status means "in progress"
    // gets refused by `take` and `next`, and the guide is the place to say what
    // to do about it rather than to print an empty parenthesis.
    progress: inProgressStatus(config) || "not declared — set in_progress_status",
    closing: one((config.archivedStatuses || [])[0]),
    priorities: list(config.priorities),
    top_priority: one((config.priorities || [])[0]),
    types: list(config.types),
    estimates: list(config.estimates),
    boards: list((config.boards || []).map((b) => b.slug)),
  };
}

/**
 * Fill `{{key}}` from the vocabulary. An UNKNOWN key throws.
 *
 * Throwing is the point: a placeholder nobody defined would otherwise be printed
 * verbatim to a user, and `{{in_progress}}` in the middle of a sentence reads
 * like a broken install rather than like our mistake. A test renders every topic
 * against a configuration, so the throw happens here and not in somebody's
 * terminal.
 */
export function render(text, vocab) {
  return String(text).replace(/\{\{([a-z_]+)\}\}/g, (_m, key) => {
    if (!(key in vocab)) {
      throw new Error("unknown placeholder `" + key + "` (known: " + Object.keys(vocab).join(", ") + ")");
    }
    return vocab[key];
  });
}

// ──────────────────────────────────────────────────────────────────────────
// The guides
// ──────────────────────────────────────────────────────────────────────────

const OVERVIEW = `{{tool}} — working this backlog

The files under \`tasks/\` are the ONLY source of truth. Every index, board,
archive and viewer page is COMPUTED from them and is not versioned: deleting one
costs a rebuild, editing one is work the next \`{{tool}} build\` throws away.
Never read a generated view to answer a question — a status changed a minute ago
is invisible there, and the stale answer reads exactly like a real one.
\`{{tool}} query\` reads the task files, which is why it is always current.

An unknown command and an unknown flag both FAIL. A non-zero exit is the tool
saying the invocation was wrong, not that the backlog is empty. Read the message.

EDITING A TASK FILE BY HAND IS SUPPORTED, not merely tolerated: the file is the
truth, and this tool's job is to notice what changed, not to be the only way to
change it. Two things then fall to you, because nothing else can do them:
\`{{tool}} build\` after a frontmatter change, and \`{{tool}} history --actor
<ns:name> --source manual\` so the change reaches the log. What the tool cannot
recover is the REASON — a change it merely saw is recorded as \`unknown\` — so a
transition into {{reason_statuses}} is the one case where the command is worth
more than the editor.

SHOULD THIS BE A TASK AT ALL?

  One question: do I have to think about HOW to do it?

    No   Just do it. A rename, a typo, a one-line fix leaves no decision
         behind, and a file describing it costs more to read than the change
         cost to make.
    Yes  Write the task first. What you had to decide is the part nobody can
         reconstruct from the diff later, and the task file is where it lives.

A TOPIC THAT SURFACES MID-TASK IS A NEW TASK, AND YOU DO NOT ASK FIRST. The
criterion is one question, not judgement: does doing it NOW fit inside the
current task's thesis? A typo on the neighbouring line — fix it. A separate
design decision, a missing guard, debt spotted along the way — that is a new
session, so it goes to the backlog. The alternative rule, stopping to ask,
spends the one resource this whole arrangement exists to save; and a topic left
in the prose of an answer or in a \`TODO\` comment dies with the session,
because \`{{tool}} next\` can only hand out what is in the backlog.

WHERE TO GO NEXT — REQUIRED.

This page is a switchboard. It does not carry the procedure, so do not work from
it alone: open the guide that matches what you are about to do.

  {{tool}} instructions task-creation      before writing a new task
  {{tool}} instructions task-execution     before starting work on one
  {{tool}} instructions task-finalization  before calling one finished
  {{tool}} instructions autonomous-loop    running it as a queue, unattended
  {{tool}} instructions context-budget     what an answer costs a session

THIS BACKLOG'S OWN WORDS, read from its configuration. Do not carry values over
from another backlog and do not assume these:

  statuses    {{statuses}}
  archived    {{archived_statuses}}
  priorities  {{priorities}}
  task ids    {{prefix}}-<number>

\`{{tool}} --help\` lists the commands; \`{{tool}} <command> --help\` prints one
command's flags. Those two are the authority on what exists — this guide is the
authority on what to do with it.`;

const TASK_CREATION = `{{tool}} — writing a task

WHEN. Only when you had to think about HOW (\`{{tool}} instructions overview\`).
A bug you can fix in the time it takes to describe it is not a task; neither is
a TODO comment, an idea, or a standing operation such as a weekly deploy — those
are notes and scheduled jobs. A task is one discrete, verifiable piece of work
with a concrete outcome.

CREATE IT WITH THE TOOL.

  {{tool}} new --title "…" --priority {{top_priority}} [--board b] [--epic e] [--estimate e]

NEVER PICK THE NUMBER YOURSELF. \`new\` derives it from a scan of every branch and
worktree, because another branch can hold the next number before any file for it
exists — and two tasks with the same number surface only at merge time. \`max + 1\`
computed from your working tree is exactly the mistake this command prevents. If
it warns that it fell back to a local scan, believe the warning.

THE VALUES COME FROM THIS BACKLOG'S CONFIGURATION, not from habit:

  statuses    {{statuses}}
  priorities  {{priorities}}
  types       {{types}}
  estimates   {{estimates}}
  boards      {{boards}}

An unknown value FAILS the build instead of quietly creating a new category. Do
not guess the board either — \`{{tool}} board <task-file.md>\` derives it from the
path rules, and the board vocabulary is closed.

WHEN THE TEXT IS FINISHED. Somebody with no memory of your session has to be
able to execute it:

  Goal           what will be true when this is finished, and why that matters
  Context        where it came from, what was already tried, which alternatives
                 were rejected and why
  Pre-flight     the files to read first, each with the reason to read it
  Steps          concrete actions, not intentions
  Criteria       measurable, not subjective
  verification:  a command that can actually be run

\`verification:\` decides whether the task can ever be closed, because closing RUNS
it. "Check that it works" is not verification; a test command is. If you cannot
write it, the work is not understood well enough to start — say so and sharpen
the task instead of starting it.

REASONS RIDE WITH THE WRITE, not with prose in the file. There is no log section
to append to: \`{{tool}} history\` records an edit made by hand, and the statuses
that may not be entered without a stated reason are {{reason_statuses}}.

Before you commit:  \`{{tool}} check\` — id collisions, the board partition,
dangling references and the link from each acceptance criterion to the entry
that proves it.`;

const TASK_EXECUTION = `{{tool}} — working a task

FINDING WORK. \`query\` reads the task files, so it sees a change made a second
ago; a generated view does not.

  {{tool}} query --status <s> --priority <p>   what is urgent and untouched
  {{tool}} query --blocked-by <ID>            who is waiting on this one
  {{tool}} query --text "…" --limit 10        has this been discussed already
  {{tool}} query --count                      a number instead of hundreds of lines
  {{tool}} stats                              the whole backlog on one screen

ASK; DO NOT READ. \`query\` and \`stats\` cost what the answer is worth; reading
\`tasks/*.md\` in bulk spends most of a context window before any work starts,
and a GENERATED view is disqualified twice over — it costs several times what
\`stats\` costs and answers from the last build. Looking for work must not scale
with the backlog: prefer \`next\`, then \`--count\`, and ask for the full list only
with a filter narrow enough to act on. \`{{tool}} instructions context-budget\`
prints what each path costs in THIS tree, measured.

\`--json\`, \`--files\` and \`--count\` change the SHAPE of the answer, not the
question. The values \`<s>\` and \`<p>\` take are this backlog's own:

  statuses    {{statuses}}
  priorities  {{priorities}}

TAKING IT. Do not edit the status by hand to claim it.

  {{tool}} next [--actor <ns:name>]        the closest executable task, claimed
  {{tool}} take <ID> [--actor <ns:name>]   one named task, claimed

Both RESERVE the task before handing it over, so two sessions asking at the same
moment get two different tasks — selection and reservation are one act on
purpose. \`next\` hands out {{queue_statuses}} and skips anything whose
\`blocked_by\` is not closed. Taking sets the status to \`{{progress}}\`.

Actors are namespaced on purpose: \`local:\` declared and unverified, \`agent:\`
automated, \`user:\` authenticated. An actor without a namespace is refused.

THEN READ THE WHOLE FILE — the context section and every path under its
pre-flight reading. It was written for somebody with none of your conversation.
Ask \`{{tool}} query --blocked-by <ID>\` as well: if something is waiting on this
task, that changes how much you can safely defer.

WHILE YOU WORK.

  The scope grows      Open a NEW task instead of inflating this one, and record
                       the link in \`blocks:\` here and \`blocked_by:\` there. You
                       do not ask first — see the criterion in \`{{tool}}
                       instructions overview\`. Adding it to the task in flight
                       blurs both, and a blurred task has no verification.
  You hit a blocker    Move the task to the status this backlog uses for that and
                       name the blocking id in \`blocked_by:\`. That status with an
                       empty \`blocked_by\` tells the next reader nothing. The
                       writing commands REFUSE rather than ask when a status
                       needs a stated reason; here those statuses are
                       {{reason_statuses}}.
  Not yours to decide  A trade-off this task does not settle, an approval you do
                       not hold — that is a question, not a guess:

                         {{tool}} ask <ID> --question "…" \\
                           --option "… — why it is a candidate" \\
                           --option "…" --recommend <n>

                       CARRY THE OPTIONS YOU CONSIDERED, AND NAME ONE. You have
                       already weighed the candidate answers; sending the prose
                       alone throws that away and makes the reader redo it from a
                       worse position. Recommend the option that is SOLID — it
                       survives the most cases, not the one that is quickest —
                       and that COMPOSES: it is built from the commands and
                       vocabularies already here, not from a new layer or a
                       second source of truth. State both IN the option's text;
                       an option nobody can judge is not an option. Asking with
                       no options is still legal, and the event records that none
                       were offered.

                       The task stops in {{reason_statuses}} and \`next\` passes
                       over it until somebody answers with \`{{tool}} decide <ID>
                       --resolves <event id> --choose <n>\`, which lifts the block
                       and puts the task back where it came from.

                       Where what the work needs is a different OWNER rather than
                       an answer, that is \`{{tool}} handoff <ID> --to-owner
                       <name> --reason "…"\`, which returns it to the queue with
                       the exchange recorded. Where this backlog declares
                       \`roles:\`, \`--to-role\` hands it to one of those.
  Frontmatter changed  Run \`{{tool}} build\`. It is idempotent and near-instant;
                       skipping it leaves the views disagreeing with the file you
                       just edited.
  You edited by hand   \`{{tool}} history --actor <ns:name> --source manual\`
                       records what the viewer would have recorded for you. This
                       is a SUPPORTED path, not a fallback — but the reason
                       cannot be recovered after the fact, so a change into
                       {{reason_statuses}} belongs in the command that asks for
                       one, not in the editor.

Status transitions and rebuilds are part of doing the work, not decisions to
raise with anybody. Committing and pushing are not — those stay explicit.

When you believe you are finished:  \`{{tool}} instructions task-finalization\`
Running this unattended, in a loop:  \`{{tool}} instructions autonomous-loop\`
What an answer costs a session:      \`{{tool}} instructions context-budget\``;

const TASK_FINALIZATION = `{{tool}} — closing a task

ONE COMMAND CLOSES A TASK, and it is the only one that runs the contract:

  {{tool}} done <ID> --dry-run   run the whole contract, change nothing
  {{tool}} done <ID>             close it, if and only if everything passes

It runs every \`verification:\` entry from the repository root, ticks the
acceptance criteria those entries prove, sets the status, records the change
together with its reason, and rebuilds the views. Do not perform those steps by
hand: a status you set yourself is a claim, and refusing to accept a claim is
what this tool is for.

Closing to \`{{closing}}\` needs no stated reason — the verification run IS the
reason, and it is recorded as such beside the change. Any other archived status
({{other_archived_statuses}}) is a decision the run does not make, so it needs
\`--reason "…"\`. Two words are the tool's own and are refused when typed by hand:
one marks a change that was seen rather than made by the tool, the other marks a
reason that is a verification run.

THE FIRST FAILURE ends the run, exits non-zero and leaves the file untouched.
That is an answer, not an obstacle: the task stays where it is, you say why, and
you open a follow-up task for the gap. Do not edit the file to get past it.
There is no \`--force\` — editing by hand is the only bypass, and a reviewer can
see it in the diff.

THREE REFUSALS MEAN SOMETHING OTHER THAN "the work is unfinished":

  no closing contract          \`verification:\` is empty or still holds the
                               template placeholder. The task was never finished
                               being WRITTEN. Write the contract, then close it.
  a line of the closing        The contract is THERE and one of its lines is
  contract cannot be read      mistyped. The refusal quotes that line; fix it
                               rather than rewriting the contract.
  the criteria and the         An acceptance criterion names a proof id that no
  verification do not agree    entry defines. Fix the link; nothing was run.

A \`manual:\` entry asks a person to vouch, and records who did. Answer it only
when you actually hold the evidence it names — the prompt lists what is not
evidence, and "I checked" is on that list. With no terminal to ask at,
\`--confirm-manual\` vouches for every manual entry at once, under your actor.

A REFUSAL IS RECORDED TOO (TL-170). Declining, or having nobody to ask, leaves a
\`__unverified__\` entry in the log naming which entry stopped the run — the task
file is still untouched. \`{{tool}} audit\` lists those under \`awaiting a vouch\`,
so a task stopped at a human check is not read as one somebody walked away from.
That is the whole difference the record buys, and it is why you do not need to
re-run the contract to find out what a task is waiting for.

AFTERWARDS. Look at \`blocks:\` — a task you have just unblocked has a reader who
needs to know why it became actionable. Then \`{{tool}} check\` before the commit,
because the guards judge the SET and your change joined it.`;

const AUTONOMOUS_LOOP = `{{tool}} — one task, one session, in a loop

WHO THIS IS FOR. A queue that runs with nobody watching: a shell loop, a cron
entry, a fleet of worktrees. Everything below is composition — {{tool}} does not
start an agent, does not know your vendor, and never will. It answers WHICH task
and it judges whether one is finished; the loop around it is three lines of
shell that you own.

WHY A FRESH SESSION PER TASK, and not one long one. Context compaction is lossy
by construction, and what it drops first is the reasoning that led to a decision
— exactly the part a long session cannot reconstruct. So nothing that has to
survive may live in the conversation. It lives in the task file, which is
written for a reader with none of your conversation: the goal, the context, the
pre-flight reading, the steps, and the closing contract. Start a session, take
one task, finish it, exit. The file is the memory.

THE THREE EXIT CODES ARE THE WHOLE PROTOCOL.

  0  a task was taken, and its file is on stdout — go and do it
  3  nothing to take. NOT an error: an empty queue is an answer
  1  a refusal about a task that exists · 2  the call itself was wrong

A loop that cannot tell 3 from 2 will run forever on its own typo. Nothing else
is needed to drive one:

  while task=\$({{tool}} next --json --actor agent:worker); do
    echo "\$task" | your-agent-here
  done   # \`next\` exits 3 when the queue is empty, and the loop ends

\`your-agent-here\` is a one-shot, non-interactive run of whatever you use — for
the two common ones, \`claude -p\` and \`codex exec\`, both of which read the
prompt on stdin. What you pipe in is the task file \`next\` just printed, and it
is enough: it was written for a reader with none of your conversation. Nothing
in this loop is ours except the two commands at its ends.

THAT LOOP, WITH THE ACCOUNTING, IS \`{{tool}} run\`. Write your own when you want
it in your own shape; use the command when you want the bookkeeping the three
lines above do not do — attempts, per-task agent logs outside the repository, and
a report of what closed, what did not and where the run stopped.

  {{tool}} run --agent "claude -p @{task_file}" --max-attempts 2
  {{tool}} run --dry-run     # the order it would work in, claiming nothing

It changes nothing about the two commands at the ends: it calls \`{{tool}} next\`
and \`{{tool}} done\` exactly as your shell would, and the agent is a template of
yours
run through your shell. A task whose contract keeps failing is never closed —
after the last attempt it is parked in the status your \`reason_required_statuses\`
protects, with the reason, and the dispatcher stops offering it.

THE TWO ENDS OF A SESSION.

  starting   \`{{tool}} next --actor <ns:name>\` — one task, already claimed and
             printed in full. Ask it once and read what it gives you; a second
             call is a second task, not a repeat of the first.
  ending     \`{{tool}} done <ID>\` — it RUNS the \`verification:\` contract and
             refuses if anything fails. That refusal is the loop's exit
             criterion. A session that decides for itself that it is finished
             has replaced the contract with an opinion, and an unattended queue
             is precisely where nobody is left to notice.

Between them the session may lose its context to a compaction. \`{{tool}} take
<ID>\` under the SAME actor is idempotent — it re-prints the whole file and
changes nothing — so re-reading the task is one command, not a recovery
procedure. Wire it to whatever your vendor calls a pre-compaction hook, and wire
\`{{tool}} instructions overview\` to whatever it calls a session-start hook.

WHAT THE CLAIM GUARANTEES, AND WHERE IT STOPS. Two mechanisms answer two
different questions, and the boundary is where the SECOND one stops.

  the lock       Selection and reservation are one act, so two sessions asking
                 at the same moment get two different tasks. It is a file
                 OUTSIDE the repository, keyed by the shared git directory, so
                 it covers every worktree of one clone on one machine — and it
                 knows nothing about a decision already written to a file.
  the scan       Data travels with the branch (that is the point), so a task
                 taken on \`feature/x\` is still {{queue_statuses}} in \`main\`'s copy
                 of the file until the branch is merged. \`next\` therefore reads
                 every branch and worktree of this CLONE — local refs only, never
                 a \`git fetch\` — and passes over a task they report in a status
                 it does not hand out, naming the branch or tree it deferred to.
                 \`cross_branch_state: false\` switches that off and it reads this
                 checkout alone.

So the boundary is the clone, not the machine and not the branch. Two clones
will still hand out the same task and will find out when they merge. Merge
finished work promptly and the window closes; expect no more from a lockfile and
a set of local refs than they can give.

WHAT A SESSION MAY WRITE OUTSIDE ITS OWN TREE. Two paths, and no other:

  the state directory       \`${STATE_DIR_ENV}\`, or the XDG default under it:
                            locks, the activity log, and this run's per-task
                            agent logs. It is outside the repository on purpose
                            — every worktree carries its own backlog, so a lock
                            written into one of them would exclude nobody.
  the user configuration    \`${HOME_ENV}\`, the layer that holds facts about
                            the person rather than about the project.

Nothing ENFORCES that list. This is composition: the loop does not own your
agent's filesystem access and never will. What a run owes the other trees
instead is to SAY SO — \`{{tool}} run\` names both paths in its report, under
\`--json\` and on the terminal.

THE ASYMMETRY IS WHY IT IS WORTH SAYING. A write INSIDE the tree travels with a
branch and reaches the other trees when somebody merges. A write to either path
above is instant for every tree on this machine, and no branch mediates it.
Measured once already: one session moved a configuration key into the user layer
and wrote the file, correctly, and every other tree on that machine failed on
its next command until it merged the code that agreed with the new file. The
breakage looked like a defect in each of those trees and was not. An operator
who can read which files a run depended on can tell the two apart in one look.

WHEN A SESSION DIES MID-TASK. Its lock expires after \`lock_ttl_minutes\` — that
only frees the reservation. The CLAIM in the tree (\`status: {{progress}}\` and
\`owner:\`) outlives it, and by design: a task somebody is three days into is not
free. Set \`abandoned_after_days\` for a queue that genuinely runs unattended and
\`next\` will hand such a claim out again — after every untouched task, never
before one, and never quietly: the takeover names the previous owner in the
history entry and warns on stdout. Left at \`0\`, the default, a dead session's
task stays claimed until a person looks. Neither answer is safe in the abstract;
the number is yours to state.

  {{tool}} query --status {{progress}} --json   what is claimed, and by whom

WHAT THE LOOP MUST NOT DO. Do not filter, sort or re-rank candidates yourself:
that policy is \`next\`'s and it is tested. Do not set a status by hand to move a
task along — every writing command records who and why, and an edit does not.
Do not commit on the agent's behalf without saying so in the loop. And do not
give the loop a task id: a dispatcher that names tasks is a queue with the
choosing put back in.`;

/**
 * The context budget, as a guide page.
 *
 * IT HAS NO COST TABLE IN IT. The numbers come from `measure` below, which runs
 * the commands against the backlog being read — a table typed here would be
 * this repository's numbers printed into somebody else's terminal, which is the
 * defect law 3 exists to prevent, in prose.
 */
const CONTEXT_BUDGET = `{{tool}} — what an answer from this backlog costs

{{context_rule}}

MEASURED HERE, NOW, over {{context_tasks}}:

{{context_table}}

WHY THE TABLE IS COMPUTED AND NOT WRITTEN DOWN. A cost typed into a guide is
correct on the day it is typed and teaches a falsehood ever after — and a
backlog grows precisely when the tool is working, so the number goes wrong in
the direction that matters. Tokens are estimated at four characters each; what
carries is the ratio between two rows, and that survives any tokenizer.

  {{tool}} stats --context     the same table, on its own
`;

/**
 * The topics. `summary` is what the switchboard and `--json` list; `text` is the
 * guide, in placeholders.
 *
 * `overview` is FIRST on purpose — it is the entry point, and the listing is
 * printed in this order.
 */
export const TOPICS = {
  overview: {
    summary: "when to act, and which guide to open — a switchboard, not a procedure",
    text: OVERVIEW,
  },
  "task-creation": {
    summary: "before writing a new task: numbering, vocabulary, and what makes the text finished",
    text: TASK_CREATION,
  },
  "task-execution": {
    summary: "before starting work: finding a task, claiming it, and what to do while it is open",
    text: TASK_EXECUTION,
  },
  "task-finalization": {
    summary: "before calling one finished: the closing run, its refusals, and what follows",
    text: TASK_FINALIZATION,
  },
  "autonomous-loop": {
    summary: "running the backlog as a queue: one task per session, the exit codes, and what the claim does not cover",
    text: AUTONOMOUS_LOOP,
  },
  "context-budget": {
    summary: "what an answer costs a session, measured on this tree — ask with a query, do not read the tree",
    text: CONTEXT_BUDGET,
    // The one topic whose text is not fully known until a tree is in front of
    // it. `measure` runs the same module `stats --context` runs, so the two can
    // never disagree about what a path costs.
    measure: (config) => {
      const budget = contextBudget({
        root: config.root, config,
        run: commandRunner(join(HERE, "cli.mjs"), config.root),
      });
      return {
        context_rule: CONTEXT_RULE.join("\n"),
        context_tasks: budget.tasks + " task file(s)",
        context_table: budget.rows
          .map((r) => "  " + r.label.padEnd(34) + String(r.tokens).padStart(7) + " tok   " +
            (r.share * 100).toFixed(r.share < 0.01 ? 2 : 1) + "%")
          .join("\n"),
      };
    },
  },
};

export const TOPIC_NAMES = Object.keys(TOPICS);

/**
 * The prompt a launcher receives for a configured role. Roles stay a flat
 * vocabulary in config.yaml; long, reviewed text belongs in a file that git
 * can review with the branch. The result names both expected refusals so the
 * command can keep an unknown argument distinct from a missing optional brief.
 */
export function roleBrief(role, config) {
  if ((config.roles || []).indexOf(role) < 0) {
    return { ok: false, kind: "unknown-role" };
  }
  const path = join(config.paths.rolesDir, role + ".md");
  if (!existsSync(path)) return { ok: false, kind: "missing-brief", path };
  return { ok: true, role, path, text: readFileSync(path, "utf8") };
}

/** One topic, rendered against a backlog's configuration. Throws on an unknown
 *  topic — the caller turns that into a usage error with the list. */
export function topicText(name, config) {
  const topic = TOPICS[name];
  if (!topic) throw new Error("unknown topic: " + name);
  // A topic MAY measure the tree it is being rendered against. The measurements
  // join the vocabulary rather than replacing it, so the placeholder rule — an
  // unknown key throws — still covers them.
  const measured = topic.measure ? topic.measure(config) : {};
  return render(topic.text, { ...vocabulary(config), ...measured });
}

/** The listing printed when no topic is named. */
export function topicList(config) {
  const width = Math.max(...TOPIC_NAMES.map((t) => t.length));
  const out = [
    N + " instructions — the workflow for this backlog, printed by the tool",
    "",
    "topics:",
  ];
  for (const name of TOPIC_NAMES) out.push("  " + name.padEnd(width) + "  " + TOPICS[name].summary);
  out.push("");
  out.push("  " + N + " instructions overview   start here");
  out.push("");
  out.push(
    "The text is rendered with THIS backlog's vocabulary (" +
      one(config.projectName) + ", ids " + one(config.taskIdPrefix) + "-<number>), not with ours."
  );
  return out.join("\n");
}

// ──────────────────────────────────────────────────────────────────────────
// The nudge: one pointer, in the repository's agent file
// ──────────────────────────────────────────────────────────────────────────

/**
 * The version of the POINTER, not of the tool.
 *
 * It is what lets a later release recognise a block it wrote earlier and replace
 * it. Bump it when the text below changes; leave it alone when the guides
 * change, because the guides are not copied anywhere — that is the whole point.
 */
export const NUDGE_VERSION = 1;

/** Built from the FROZEN marker name, like the git-rules block: these markers
 *  identify data already written into somebody else's repository, so they must
 *  not move when the product name does. The reasoning is at `BLOCK_MARKER_NAME`
 *  in `product.mjs`. */
export const NUDGE_OPEN_PREFIX = `<!-- >>> ${MARKER}:instructions`;
export const NUDGE_CLOSE = `<!-- <<< ${MARKER}:instructions -->`;

/** The agent files a nudge is written into, most specific first. */
export const AGENT_FILES = ["CLAUDE.md", "AGENTS.md"];

/** Matches a block this tool wrote, whatever its version. */
function nudgeBlockRe() {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(esc(NUDGE_OPEN_PREFIX) + " v(\\d+) -->[\\s\\S]*?" + esc(NUDGE_CLOSE) + "\\n?", "m");
}

/** The block itself. Deliberately short: it is a POINTER, and a pointer that
 *  starts explaining is a copy that will go stale. */
export function nudgeBlock() {
  return [
    `${NUDGE_OPEN_PREFIX} v${NUDGE_VERSION} -->`,
    "## The backlog",
    "",
    `This repository's tasks live in markdown files driven by \`${N}\`. Before you`,
    "work on anything from the backlog, run:",
    "",
    "```bash",
    `${N} instructions overview`,
    "```",
    "",
    "That command IS the current instruction. It ships with the tool, so it cannot",
    "describe flags the tool no longer has, and it is rendered with this backlog's",
    "own vocabulary. Do not copy its output back into this file.",
    NUDGE_CLOSE,
  ].join("\n");
}

/**
 * Where the pointer belongs: the top of the repository, not the backlog
 * directory.
 *
 * WHY GIT DECIDES. An agent file is read from the repository root, and only git
 * knows where that is — `..` from the backlog is right for the nested layout and
 * wrong for a co-located one. Outside a repository we fall back to the backlog
 * directory ITSELF and not to its parent: writing above a directory the user
 * named is the scattering that `init --dir` is mandatory to prevent.
 */
export function nudgeRoot(root) {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8", timeout: 10_000 });
  if (r.status === 0 && String(r.stdout).trim()) return String(r.stdout).trim();
  return root;
}

/**
 * Install or refresh the pointer. Returns lines to print; empty means everything
 * was already current.
 *
 * THE RULES, and why each one:
 *   - an EXISTING agent file is appended to, never rewritten — the block is
 *     marked, so the rest of the file is not ours to touch;
 *   - when NO agent file exists, exactly one is created, and it is the
 *     editor-neutral one: the whole reason this command exists is the agent that
 *     is not running in our editor;
 *   - a block at a DIFFERENT version is replaced in place, not appended a second
 *     time. That is what the version in the marker is for.
 *
 * @param {string} root the backlog directory
 * @param {{create?: boolean}} opts `create: false` reports instead of writing
 */
export function ensureNudge(root, opts = {}) {
  const base = nudgeRoot(root);
  const present = AGENT_FILES.filter((f) => existsSync(join(base, f)));
  // Nothing to append to: create the neutral one rather than guessing which
  // editor the reader uses.
  const targets = present.length ? present : [AGENT_FILES[AGENT_FILES.length - 1]];
  const out = [];

  for (const name of targets) {
    const path = join(base, name);
    const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
    const found = existing.match(nudgeBlockRe());

    if (found && Number(found[1]) === NUDGE_VERSION) continue;

    if (opts.create === false) {
      out.push(`! ${name}: ` + (found ? "the pointer is at v" + found[1] : "no pointer to `" + N + " instructions`"));
      out.push(`  ${N} instructions --update-nudge   writes it`);
      continue;
    }

    if (found) {
      writeFileSync(path, existing.replace(nudgeBlockRe(), nudgeBlock() + "\n"), "utf8");
      out.push(`  ${name}: pointer updated v${found[1]} → v${NUDGE_VERSION}`);
      continue;
    }

    const pad = existing && !existing.endsWith("\n") ? "\n" : "";
    appendFileSync(path, pad + (existing ? "\n" : "") + nudgeBlock() + "\n", "utf8");
    out.push(`  ${name}: pointer appended (v${NUDGE_VERSION}) — \`${N} instructions overview\``);
  }

  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// The command
// ──────────────────────────────────────────────────────────────────────────

export const INSTRUCTIONS_FLAGS = ["--json", "--update-nudge"];

/** PURE — resolves the arguments. Throws on a usage error. */
export function parseInstructionsArgs(args) {
  let topic = null;
  let role = null;
  let json = false;
  let updateNudge = false;

  for (const a of args) {
    if (a === "--json") { json = true; continue; }
    if (a === "--update-nudge") { updateNudge = true; continue; }
    if (a.startsWith("-")) {
      throw new Error("unknown flag: " + a + "\nknown flags: " + INSTRUCTIONS_FLAGS.join(" ") + " --dir <path>");
    }
    if (topic === "role" && role === null) {
      role = a;
      continue;
    }
    if (topic) throw new Error("one topic at a time: " + topic + ", " + a);
    if (a === "role") {
      topic = a;
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(TOPICS, a)) {
      throw new Error("unknown topic: " + a + "\ntopics: " + TOPIC_NAMES.join(" ") + " role <name>");
    }
    topic = a;
  }
  if (topic === "role" && role === null) {
    throw new Error("role requires a declared role name\nusage: " + N + " instructions role <name>");
  }
  if (updateNudge && topic) {
    throw new Error("`--update-nudge` writes the pointer; it does not print a topic");
  }
  return { topic, role, json, updateNudge };
}

export function run(argv) {
  const cli = takeDirFlag(argv);
  let plan;
  try {
    plan = parseInstructionsArgs(cli.argv);
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N + " instructions", head, rest, [N + " instructions --help"]));
    return 2;
  }

  const root = resolveBacklogDirOrExit({ dir: cli.dir || undefined, moduleDir: HERE }, N + " instructions").root;
  const config = loadConfigOrExit(root);

  if (plan.updateNudge) {
    const lines = ensureNudge(root);
    console.log(N + " instructions: " + nudgeRoot(root));
    if (lines.length) for (const l of lines) console.log(l);
    else console.log(`  the pointer is already at v${NUDGE_VERSION} — nothing to do`);
    return 0;
  }

  let text = plan.topic && plan.topic !== "role" ? topicText(plan.topic, config) : null;
  if (plan.role !== null) {
    const brief = roleBrief(plan.role, config);
    if (!brief.ok) {
      if (brief.kind === "unknown-role") {
        console.error(failure(N + " instructions", "unknown role `" + plan.role + "`",
          (config.roles || []).length
            ? ["`roles` in config.yaml holds: " + (config.roles || []).join(", ")]
            : ["This backlog declares no `roles:` in config.yaml, so no brief is available."],
          [N + " instructions --help"]));
        return 2;
      }
      console.error(failure(N + " instructions", "role `" + plan.role + "` has no brief",
        ["add `roles/" + plan.role + ".md` beside this backlog's config.yaml"],
        [N + " instructions role " + plan.role]));
      return 1;
    }
    text = brief.text;
  }

  if (plan.json) {
    printJson("instructions", {
      topics: TOPIC_NAMES.map((name) => ({ name, summary: TOPICS[name].summary })),
      topic: plan.topic,
      role: plan.role,
      text,
      version: NUDGE_VERSION,
    });
    return 0;
  }

  if (plan.role !== null) {
    writeOut(text + (text.endsWith("\n") ? "" : "\n"));
  } else {
    console.log(plan.topic ? text : topicList(config));
  }
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("instructions.mjs")) {
  process.exit(run(process.argv.slice(2)));
}
