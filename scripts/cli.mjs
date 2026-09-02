#!/usr/bin/env node
/**
 * The command dispatcher — one entry point to every backlog command (BL-1411).
 *
 * WHY. Until BL-1411 the bare command was hard-wired to `serve-backlog.mjs`, and every
 * other capability lived as a separate `node backlog/scripts/<something>.mjs`
 * with its own flag convention. Worse than the inconvenience: the server read
 * only the flags it knew about and IGNORED the rest, so `query --status
 * blocked` went through without a trace and ended in an open browser tab — a
 * silent no-op with a side effect, which is to say something that looks like
 * the tool working.
 *
 * WHY SUBCOMMANDS AND NOT FLAGS ALONE. a bare `--port 4400` already meant
 * "start the server". If a flag picked the command, `--status` would mean
 * "ask", `--port` would mean "serve", and `--dir` (accepted by BOTH) would mean
 * nothing decisive. A subcommand removes that ambiguity and keeps the habit:
 * the bare command with no arguments is still the server.
 *
 * WHY SPAWN AND NOT IMPORT. The scripts are standalone programs today, each
 * with its own flag validation (query.mjs fails on a typo) and its own exit
 * codes. Rewriting them into libraries plus a thin `main` is separate work; a
 * dispatcher that calls them and PROPAGATES the exit code gives one entry point
 * without touching five working programs. The boundary is deliberate: the
 * command table, the help and the resolution live here, flag validation stays
 * in the command.
 *
 * Resolution is PURE (`resolveCommand`) — a test does not have to start the
 * server to check that `frobnicate` is an error.
 *
 * Tests: `node --test scripts/tests/cli.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { PRODUCT_NAME as N, PRODUCT_VERSION } from "./product.mjs";
import { ConfigError, formatConfigError, loadConfig } from "./config.mjs";
import { printJson } from "./json-envelope.mjs";
import { failure } from "./ui.mjs";
import { resolveBacklogDir } from "./paths.mjs";
import { FIELD_SHAPES } from "./task-fields.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const CHECK_USAGE = [
  `${N} check [--dir <path>] [--id-collisions] [--boards] [--refs] [--criteria] [--reasons] [--log-status] [--vocabulary] [--plan] [--language] [--product-name] [--proofs] [--since <sha>] [task-file.md …]`,
  "",
  "  no selector          every guard; exit code = the WORST of them",
  "  --json               the whole run as one document: which guards ran, which failed,",
  "                       and what each one said. Stdout carries the JSON and nothing",
  "                       else — a tick from a guard would break every consumer at once.",
  "                       The exit code is unchanged: JSON describes the result, it does",
  "                       not replace it",
  "  --id-collisions      id collisions only — a property of the SET, reads the whole tree",
  "  --boards             boards only — a property of ONE file",
  "  --boards <file…>     judge the named files instead of the whole tree",
  "  --refs               blocked_by/blocks only — also a property of the SET",
  "  --criteria           only whether every acceptance criterion names the `verification:`",
  "                       entry that proves it; how hard it judges a MISSING link comes from",
  "                       `criteria_links` in config.yaml (off / warn / require)",
  "  --history            only whether the history logs reach git. It FAILS on a log",
  "                       left untracked while its own task file is tracked — that pair",
  "                       can only mean the log was left behind, and another tree then",
  "                       sees a task with no history. A backlog nobody has committed",
  "                       yet passes, and outside git the command says so rather than",
  "                       printing a tick it did not earn",
  "  --docs               only whether a markdown link or a `related_docs` entry leads",
  "                       to a file that exists. Judges the REPOSITORY holding the backlog",
  "                       — top-level *.md, docs/ and the task files — because that is the",
  "                       tree those paths resolve against. External URLs are not fetched,",
  "                       an anchor does not break a path, and a `<repo>#<path>` reference",
  "                       to another repository is skipped by a rule, not by accident",
  "  --reasons            only which recorded transitions into a status named by",
  "                       `reason_required_statuses` carry no reason. It REPORTS and never",
  "                       fails: the gaps it finds are in the past, and the rule is enforced",
  "                       when the change is written, not here",
  "  --log-status         only whether a task's legacy `## Log` still agrees with its",
  "                       `status:` field. The two directions are not the same defect: a log",
  "                       naming a CLOSED status while the field is open FAILS — that is work",
  "                       finished and counted as open, and the views misreport it without",
  "                       looking wrong. A log merely BEHIND its field warns, because since",
  "                       TL-105 nothing writes `## Log` any more, so a legacy section going",
  "                       stale is the normal end state rather than anybody's mistake",
  "  --plan               only whether plan.yaml can be executed — that no wave stands before",
  "                       a task it is blocked by. A backlog with no plan.yaml passes: the",
  "                       execution order is an optional decision, not a required file",
  "  --language           only whether the public surface is English — a property of the CODE,",
  "                       so it reads this installation, not the backlog named by --dir.",
  "                       For that reason it does NOT run when --dir points outside this",
  "                       checkout: it would answer about the tool and fail a run about",
  "                       somebody else's tree. The run says when it was skipped",
  "  --product-name       only whether the name is written out in scripts/ or bin/ instead of",
  "                       imported from product.mjs — also a property of the CODE, not the",
  "                       data, and skipped outside this checkout for the same reason",
  "  --proofs             re-run the `verification:` contract of every task this tool CLOSED",
  "                       with a proven reason, against the tree as it is now, and name each",
  "                       one that no longer passes. NEVER part of a bare `check`: those",
  "                       contracts are test suites, and one of them may be this command",
  "  --since <sha>        with --proofs, keep the closings the range could plausibly have",
  "                       broken — a file the task changed, or a path its contract names",
].join("\n");

/**
 * The command table. `script` is relative to this directory; `passthrough`
 * means the remaining arguments go to the script untranslated.
 */
export const COMMANDS = {
  serve: {
    script: "serve-backlog.mjs",
    summary: "run the viewer on 127.0.0.1 (the default command)",
    usage: `${N} serve [--port <n>] [--no-open] [--dir <path>]`,
  },
  query: {
    script: "query.mjs",
    summary: "ask about tasks — reads tasks/*.md, so it sees changes before a rebuild",
    usage: [
      `${N} query [--status s] [--priority p] [--board b] [--label l] [--epic e]`,
      `            [--modified-file <path>] [--json|--files|--count]`,
      "",
      "  --modified-file <path>  which task touched this file, and therefore WHY it looks",
      "                          the way it does. Computed from the commit messages that",
      "                          name a task id — nothing to fill in and nothing that can",
      "                          go stale. Paths are relative to the REPOSITORY root, not",
      "                          to the backlog directory; a trailing `/` matches a whole",
      "                          directory. Remember the default filter still hides closed",
      "                          work, and most files were touched by tasks that are closed",
      "",
      `  ${N} query --modified-file scripts/cli.mjs --status done`,
    ].join("\n"),
  },
  build: {
    script: "build-backlog.mjs",
    summary: "rebuild the views (INDEX / NOW / archive / boards) from tasks/*.md",
    usage: `${N} build [--dir <path>]`,
  },
  viewer: {
    script: "build-viewer.mjs",
    summary: "rebuild viewer.html without starting the server",
    usage: `${N} viewer [--dir <path>]`,
  },
  "next-id": {
    script: "next-backlog-id.mjs",
    summary: "the next free task number (computed across ALL branches and worktrees)",
    usage: `${N} next-id [--explain] [--json]`,
  },
  board: {
    script: "suggest-board.mjs",
    summary: "which board a task belongs to — from path rules, not from guessing",
    usage: `${N} board <task-file.md> [--json]`,
  },
  history: {
    script: "history-record.mjs",
    summary: "record changes made outside the tool — and claim the ones already logged as nobody's",
    usage: [
      `${N} history [--file <task.md>] --actor <ns:name> [--source s] [--reason "…"] [--attribute]`,
      "",
      "  Diffs the tree against `history/.snapshot.json` and appends what changed, under",
      "  the actor you give. This is the supported path for an edit made by hand.",
      "",
      "  --file <task.md>  just this task, not the whole directory",
      "  --actor <ns:name> who made the changes; a namespace is required",
      "  --source <s>      how they were made — `manual` for a hand edit, `hook` for a",
      "                    post-edit hook. Free text; it is a note to the reader",
      `  --reason "…"      why, for the whole run — that is the granularity this route has`,
      "  --attribute       CLAIM the recorded changes that carry no author. Needs a reason",
      "",
      "  WHY `--attribute` EXISTS (TL-130). A running `" + N + " serve` reconciles on a timer,",
      "  so a change made by hand can reach the log — as `unknown` — before the session",
      "  that made it says anything. There is then no DIFFERENCE left to record, and this",
      "  command used to answer `no changes to record`, which reads as `all recorded`",
      "  while the truth was `recorded as nobody's`. It now names them, and `--attribute`",
      "  claims them.",
      "",
      "  THE CLAIM STANDS BESIDE THE CHANGE, never over it. The log is append-only, so",
      "  the original entry keeps saying `unknown` — which was true when it was written",
      "  — and the claim is a second entry with its own author, time and reason. An actor",
      "  that could be rewritten afterwards is an actor nobody can rely on.",
      "",
      "  exit: 0 · 2 the invocation was wrong",
    ].join("\n"),
  },
  take: {
    script: "take-task.mjs",
    summary: "claim ONE named task — reserve it, set it in progress, print it",
    usage: [
      `${N} take <ID> [--actor <ns:name>] [--role <r>] [--reason "…"] [--json] [--dir <path>]`,
      "",
      "  --actor <ns:name>  who is claiming it; becomes `owner:` and goes into the history",
      "  --role <r>         the role you are acting as. It NEVER blocks the take — an",
      "                     explicit instruction outranks the task's `role:` — but a",
      "                     mismatch is recorded in the history",
      "  --reason \"…\"       why — required only when `reason_required_statuses` names",
      "                     the status this moves the task INTO",
      "  --json             the task, the file and the lock, for a program to read",
      "",
      "  The reservation is a lockfile outside the repository, shared by every worktree",
      "  of this repository ON THIS MACHINE. Two machines connected only by git can",
      "  still both take one task and will find out when they merge.",
      "",
      "  exit: 0 taken · 1 refused (held, closed, somebody else's) · 2 usage error",
    ].join("\n"),
  },
  next: {
    script: "next-task.mjs",
    summary: "take the closest executable task — the queue for a fleet of agents",
    usage: [
      `${N} next [--actor <ns:name>] [--board b] [--label l] [--priority p] [--epic e]`,
      `${N} next [--role r[,r]] [--role-strict] [--status s] [--reason "…"] [--json]`,
      "",
      "  Chooses by the same filters `query` uses, skips anything whose `blocked_by` is",
      "  not closed, then claims it exactly as `take` does — selection and reservation",
      "  in one act, so two sessions asking at the same moment get two different tasks.",
      "",
      "  Without `--status` it hands out the ACTIVE statuses, minus the one that means",
      "  `in progress`, minus every status `reason_required_statuses` protects — those",
      "  were entered by a decision an unattended agent must not undo.",
      "",
      "  --role r[,r]       hand out tasks asking for one of these roles OR asking for",
      "                     none — a task that names nobody can be done by anybody. The",
      "                     vocabulary is `roles` in config.yaml; a role outside it fails,",
      "                     because a filter that matches nothing reads as an empty queue",
      "  --role-strict      narrow that to EXACTLY those roles, leaving the role-less",
      "                     tasks for somebody else",
      "",
      "  A protected task that NAMED its condition is the exception: once every task in",
      "  its `blocked_by` is closed it is handed out, and the history says which ones",
      "  discharged it. With an empty `blocked_by` it waits on something outside the",
      "  tree that nothing here can see arrive, and it is never offered.",
      "",
      "  It also reads every branch and worktree of this CLONE (local refs only, never",
      "  a fetch) and passes over a task they report in a status it does not hand out,",
      "  naming the branch or tree. `cross_branch_state: false` turns that off.",
      "",
      "  exit: 0 taken · 3 nothing to take · 1 refused · 2 usage error",
    ].join("\n"),
  },
  handoff: {
    script: "handoff-task.mjs",
    summary: "hand a task to another role — with the reason, and a trace of the exchange",
    usage: [
      `${N} handoff <ID> --to-role <r> --reason "…" [--to-owner <o>] [--actor <ns:name>]`,
      `${N} handoff <ID> [--status <s>] [--json] [--dir <path>]`,
      "",
      "  --to-role <r>      the role the task now asks for. Its vocabulary is `roles` in",
      "                     config.yaml; a backlog that declares none has nothing to hand to",
      "  --to-owner <o>     hand it to a named person instead of, or as well as, a role",
      "  --reason \"…\"       REQUIRED, and recorded twice on purpose: as the reason for the",
      "                     field change, and as a `__comment__` event an answer can point at",
      "  --status <s>       which status it goes back to. Only needed when more than one of",
      "                     this backlog's statuses means `waiting for somebody`",
      "  --json             the task, the changed fields and the comment, for a program",
      "",
      "  A task in progress stops being in progress and returns to the queue; every other",
      "  status was entered by a decision this command does not make, so it is left alone.",
      "  The owner is cleared and this session's reservation is released.",
      "",
      "  exit: 0 handed off · 1 refused (held, closed, somebody else's) · 2 usage error",
    ].join("\n"),
  },
  decide: {
    script: "decide-task.mjs",
    summary: "record a decision as an event — and answer the question that waited for it",
    usage: [
      `${N} decide <ID> --reason "…" [--resolves <event id>] [--actor <ns:name>]`,
      `${N} decide <ID> [--json] [--dir <path>]`,
      "",
      "  --reason \"…\"       REQUIRED — the decision itself. A record that something was",
      "                     settled with the settling left out is the one thing a later",
      "                     reader cannot reconstruct",
      "  --resolves <id>    the `id` of the event this answers, usually the `__comment__`",
      "                     a handoff left behind. Optional: deciding unprompted is legal.",
      "                     An id that is not in this task's history fails before the write",
      "  --json             the decision and what remains unanswered, for a program",
      "",
      "  Nothing in the task file changes: a decision is an EVENT, and the status, the",
      "  owner and this session's reservation are left exactly as they were. A question",
      "  nothing points at is OPEN, and that is the whole definition of `waiting for a",
      "  decision` — computed from the log, with no second file to keep in step.",
      "",
      "  exit: 0 recorded · 1 refused (no such task, no such event) · 2 usage error",
    ].join("\n"),
  },
  time: {
    script: "time-report.mjs",
    summary: "lead time and throughput, from the one instant that can be recovered honestly",
    usage: [
      `${N} time [--engaged] [--cost] [--json] [--dir <path>]`,
      "",
      "  Reads the completion stamps in `activity/` and reports lead time",
      "  (median, p80, p95) and tasks closed per week — plus, always, how many closed",
      "  tasks have NO stamp and are therefore outside every number above.",
      "",
      "  That much is CALENDAR time: the start of a lead time has a DAY's resolution,",
      "  because that is what `created:` has.",
      "",
      "  --engaged  the measured time AT THE KEYBOARD, derived from the heartbeats:",
      "             effort (parallel sessions summed) beside calendar time (the same",
      "             sessions merged), the count of runs too short to measure, and the",
      "             share of minutes no leg of the attribution chain could place.",
      "             That share is printed FIRST and is never omitted — a sum without",
      "             it is a metric asserting its own trustworthiness.",
      "",
      "  --cost     the SECOND axis (TL-30): tokens per model, and an amount only",
      "             where one exists. Time depends on model speed and on how often",
      "             somebody interrupted; tokens do not.",
      "",
      "             Four distinguishable answers, never collapsed into two: an",
      "             AMOUNT (`api` with a rate in `model_pricing`), TOKENS WITH NO",
      "             AMOUNT and the reason (`subscription` — the marginal cost of one",
      "             task on a plan is fiction), a DECLARED ZERO (`local`), and",
      "             `null` — no adapter ran, or the model has no pricing entry.",
      "             `null` is never printed as 0: that would say the work was free.",
      "",
      "             A host reports tokens by writing them on a row",
      "             (`activity record --tokens-in --tokens-out --model`). The",
      "             adapter that does it for Claude Code is a PLUGIN, not a",
      "             dependency — nothing in the tool imports it:",
      "               node <path>/scripts/cost-adapter.mjs   (from a SessionEnd hook)",
      "",
      "  `--json` carries the engaged figures, `unknown_ratio`, `tokens` and `cost`",
      "  whether or not the flags were passed: a key that appears only with a flag",
      "  is a contract nobody can build against.",
      "",
      "  exit: 0 reported · 2 usage error",
    ].join("\n"),
  },
  activity: {
    script: "activity-command.mjs",
    summary: "the heartbeat log: record into it, and get it back out — retention, erasure, correction",
    usage: [
      `${N} activity record   [--task <ID>] [--kind tool] [--actor <ns:name>] [--source <s>]`,
      `${N} activity prune    [--days <n>] [--dry-run] [--json]`,
      `${N} activity forget   --actor <ns:name> [--dry-run] [--json]`,
      `${N} activity reassign --from <ID> --to <ID> --session <s> [--since <ts>] [--dry-run]`,
      `${N} activity report   --privacy [--json]`,
      `${N} activity migrate  [--dry-run] [--json]`,
      "",
      "THE RAW LOG LIVES OUTSIDE EVERY REPOSITORY — in your data directory, one",
      "  subdirectory per backlog. `where` prints the path. Only the per-task",
      "  AGGREGATE under `activity/rollup/` is committed: a record of what hour",
      "  somebody worked cannot be taken back out of a public history, so keeping it",
      "  out is a property of where the file is rather than a `.gitignore` every",
      "  future user has to maintain.",
      "",
      "RECORD — one piece of evidence that somebody was working, appended to that",
      "  log. The host's payload may arrive as JSON on STANDARD",
      "  INPUT — that is the callable input, so a hook from any editor, a git hook",
      "  or a shell prompt feeds the same log without the core knowing about it.",
      "",
      "  --task <ID>     state the task outright. Without it the attribution chain",
      "                  decides: focus → this session's `in_progress` write → the",
      "                  edited file's path → the branch name → `unknown`",
      "  --kind <k>      tool (default), prompt, commit, edit, reassign, session",
      "  --tokens-in <n> the cost axis (TL-30), and ABSENT is not zero: a host with",
      "  --tokens-out    no adapter writes rows complete in every other respect. All",
      "  --model <m>     three travel together — tokens of two models are two",
      "                  different units of effort, so a count with no model is",
      "                  refused rather than averaged into one later",
      "  --no-throttle   write even inside the window. The window exists because the",
      "                  matcher has to cover EVERY tool, and without it the log grows",
      "                  with how chatty the agent is",
      "",
      "  A throttled call succeeds and writes nothing: the adapter fires on every",
      "  tool invocation by design, so an error there would be an error banner over",
      "  most of an editing session.",
      "",
      "PRUNE — raw rows past `activity_retention_days` go; the per-task AGGREGATE",
      "  stays, and is recomputed from the FULL log BEFORE anything is deleted. The",
      "  order is not an implementation detail: deleting first would silently rewrite",
      "  every historical figure to `the last N days`, and the report would look",
      "  exactly as healthy as before.",
      "",
      "FORGET — one person's raw rows go, and the aggregates are recomputed WITHOUT",
      "  them. That inversion is the whole difference from `prune`: an aggregate left",
      "  standing over deleted rows is the data coming back at the next report. There",
      "  is no undo and no trash, so `--dry-run` first. It acts on a CLAIM — nothing",
      "  here authenticates an actor.",
      "",
      "REASSIGN — work measured against the wrong task. The log is append-only, so",
      "  this writes a NEW row and every reader applies it; nothing on disk is",
      "  edited. `--session` is required: without it the correction would move every",
      "  row ever recorded on that task, which is a merge and not a correction.",
      "",
      "MIGRATE — move a log written before the relocation out of the repository.",
      "  Idempotent by ROW ID, not by file: run twice it moves nothing and doubles",
      "  nothing. It does not touch `rollup/`.",
      "",
      "REPORT --privacy — the window, the mode, how many raw rows exist, whose they",
      "  are, and which paths are versioned. One place a person can see what the tool",
      "  holds about them. It is a set of MECHANISMS and not a compliance claim.",
      "",
      "  exit: 0 done · 1 refused · 2 usage error",
    ].join("\n"),
  },
  focus: {
    script: "focus-command.mjs",
    summary: "say which task THIS session's heartbeats belong to",
    usage: [
      `${N} focus <ID> [--actor <ns:name>]   point this session at a task`,
      `${N} focus --clear                    forget it`,
      `${N} focus [--json]                   what is it pointed at`,
      "",
      "  It does NOT claim the task, change its status or touch the tree — that is",
      `  \`${N} take\`, and the two are separate on purpose: pointing a measurement at`,
      "  a task somebody else holds is legitimate, and refusing it would push that",
      "  time into `unknown` instead.",
      "",
      `  \`${N} take\` and \`${N} next\` set this themselves. The command exists for the`,
      "  work they cannot see: a session on a branch with no id in its name, touching",
      "  no task file. A measurement that depended on somebody remembering to run",
      "  this would have the defect that disqualified the off-the-shelf tools.",
      "",
      "  The pointer is session state and lives OUTSIDE the repository, beside the",
      "  locks — a file in the backlog would be a different file in every worktree.",
      "",
      "  exit: 0 set, cleared or reported · 1 no such task · 2 usage error",
    ].join("\n"),
  },
  "backfill-completions": {
    script: "backfill-completions.mjs",
    summary: "recover WHEN each closed task was finished, from git — and nothing else",
    usage: [
      `${N} backfill-completions [--dry-run] [--actor <ns:name>] [--dir <path>]`,
      "",
      "  For every closed task, the commit that first introduced its closing status,",
      "  at second resolution. Written to `activity/<ID>.jsonl` as one `commit` row.",
      "",
      "  It backfills the STAMP, never a duration: an agent usually commits a task",
      "  from open to closed in one move, so there is no start to find, and inventing",
      "  one would be a number nobody can check.",
      "",
      "  Idempotent by EVENT — running it twice writes nothing the second time. A",
      "  closed task git cannot see the closing of is COUNTED, never guessed at.",
      "",
      "  exit: 0 done · 2 usage error",
    ].join("\n"),
  },
  new: {
    script: "new-task.mjs",
    summary: "create a task from the template — numbered across every branch, not max+1",
    usage: [
      `${N} new --title "<text>" [--board <b>] [--priority <p>] [--status <s>] [--type <t>]`,
      `          [--owner <o>] [--epic <e>] [--estimate <2h>] [--dir <path>]`,
      "",
      "  Every field marked below draws its values from THIS project's config.yaml,",
      "  and a value outside the vocabulary FAILS rather than being written:",
      "",
      "  --priority <p>  from `priorities:`",
      "  --status <s>    from `statuses:`",
      "  --type <t>      from `types:`",
      "  --owner <o>     from `owners:`",
      "  --board <b>     from the board registry; the default is used when omitted",
      "",
      `  \`${N} new --help --json\` prints those lists, so nothing has to be guessed.`,
    ].join("\n"),
  },
  seed: {
    script: "seed-backlog.mjs",
    summary: "create a whole backlog from a structured plan on stdin — no model involved",
    usage: [
      `${N} seed [--dir <path>] [--dry-run] [--json] [--actor <ns:name>] [--reason "…"] < plan.json`,
      `${N} seed --from <spec-file> [--dry-run] [--dir <path>]`,
      "",
      "  The plan is JSON on STANDARD INPUT — that is the callable input, so whatever",
      "  produced the plan (a script, an LLM adapter, another tool) pipes straight in.",
      "",
      "  --from <spec>      a project DESCRIPTION instead of a plan: the adapter turns it",
      "                     into one and this command validates and writes it as usual.",
      `                     Needs \`llm_endpoint\` and \`llm_model\` in your own preferences`,
      `                     file — see \`${N} plan-from --help\`. It is a shortcut for a`,
      "                     pipe, never a second way in",
      "  --dry-run          what would be created, with the numbers it would take. Nothing",
      "                     is reserved, so those numbers are provisional",
      "  --json             the plan_id → task id mapping, or every complaint, for a program",
      "  --actor <ns:name>  who is seeding; goes into the history as the author of each",
      "                     task's creation (local: / agent: / user:)",
      "",
      "  A `--dir` that is not a backlog yet is created first, exactly as `init` would.",
      "",
      "  THE PLAN:",
      '    { "planVersion": 1, "meta": { … }, "tasks": [ … ] }',
      "",
      "  and one entry of `tasks`:",
      '    plan_id       required · this item\'s LOCAL key, [a-z0-9_-]. Never a task id:',
      "                  the numbers are the tool's to allocate",
      "    title         required · unique within the plan",
      "    goal          required · why the task exists and what is true once it is done",
      "    context       optional · what the next person needs before their first edit",
      "    steps         optional · array of strings",
      "    blocked_by    optional · array of plan_id values from THIS plan; a cycle fails",
      "    verification  required · non-empty; a command string, or an object with",
      '                  { "id", "bash" | "manual", "proves" }. `proves` becomes the',
      "                  acceptance criterion that points back at the entry",
      "    estimate      optional · free text, e.g. \"2h\"",
      "    priority      optional · a value from YOUR config.yaml",
      "",
      "  An unknown key FAILS, a task with no runnable verification FAILS THE WHOLE PLAN,",
      "  and every complaint is reported at once with nothing written.",
      "",
      "  exit: 0 seeded · 2 the plan (or the invocation) was refused · 1 the write failed",
    ].join("\n"),
  },
  import: {
    script: "import-github.mjs",
    summary: "bring an existing GitHub Issues backlog over ONCE, from stdin — no network",
    usage: [
      `${N} import --from github [--dry-run] [--label <from>=<to>] [--label-map <file.json>]`,
      `                        [--actor <ns:name>] [--reason "…"] [--json] [--dir <path>]`,
      "",
      "  The issues are JSON on STANDARD INPUT. This command makes NO network request:",
      "  authentication stays inside `gh`, where it already works, and the test runs",
      "  against a fixture instead of a mock server.",
      "",
      `    gh issue list --state all --limit 500 --json number,title,body,state,labels,url \\`,
      `      | ${N} import --from github --dry-run`,
      "",
      "  --from <source>      required. `github` is the only one, deliberately: an adapter",
      "                       for two trackers at once starts from an abstraction nobody",
      "                       needs yet",
      "  --dry-run            print the plan and write nothing. Run it first — a command",
      "                       that creates hundreds of files should show them to you",
      "  --label <from>=<to>  map ONE label; repeatable. An empty <to> drops it",
      "  --label-map <file>   the same mapping as a JSON object of \"from\": \"to\" pairs",
      "  --actor <ns:name>    who is importing; recorded beside every created task",
      "",
      "  IT IS ONE-OFF, NOT SYNCHRONOUS. Synchronisation would be a second source of",
      "  truth living outside the branch — the defect external trackers were rejected",
      "  for. Import copies and forgets.",
      "",
      "  WHAT IT BRINGS: the title, the body, and open/closed mapped onto YOUR statuses.",
      "  WHAT IT DOES NOT: comments, attachments, status history, assignees — the",
      "  conversation around a task, one click away at the source link it writes.",
      "  `verification:` stays EMPTY, and how many tasks that leaves unfinishable is",
      "  part of the report rather than a footnote to it.",
      "",
      "  Numbers are LOCAL, allocated the way `new` allocates them; a re-import of the",
      "  same issues creates nothing, recognised by the source link in the task body.",
      "",
      "  exit: 0 imported · 2 the invocation or the input was refused · 1 the write failed",
    ].join("\n"),
  },
  "plan-from": {
    script: "seed-adapter.mjs",
    summary: "turn a project description into a `seed` plan, using YOUR model — prints JSON",
    usage: [
      `${N} plan-from <spec-file> [--prompt <file>] [--dir <path>]`,
      "",
      "  Reads a project description and prints a plan on stdout. It writes nothing:",
      "  pipe it, or read it first.",
      "",
      `    ${N} plan-from spec.md | ${N} seed --dir ./backlog`,
      `    ${N} seed --from spec.md --dry-run          # the same, in one step`,
      "",
      "  --prompt <file>  a prompt template of your own. The one that ships is",
      "                   templates/seed-plan.md, and it is DATA — tuning what the",
      "                   model is told must not need a fork",
      "",
      "  THE ENDPOINT AND THE MODEL ARE YOURS, and live in your own preferences file",
      "  rather than in the project's config.yaml: two people on one repository can",
      "  reasonably run a local model and a hosted one, and both be right.",
      "",
      "    llm_endpoint: http://localhost:11434",
      "    llm_model: llama3.1",
      "",
      "  With Ollama that is `ollama pull llama3.1` and nothing else — no key, no",
      "  account. Any OpenAI-compatible endpoint goes through the same code.",
      "",
      "  A PLAN IS NEVER REPAIRED HERE. It goes to `seed --dry-run`, and a rejected",
      "  one goes back to the model with the errors attached, `llm_retries` times.",
      "  After that the plan and the complaints are printed and the command fails —",
      "  a plan this command edited into shape would be one nobody wrote.",
      "",
      "  exit: 0 a plan · 1 no plan survived the retries · 2 the invocation was wrong",
    ].join("\n"),
  },
  sessions: {
    script: "sessions-command.mjs",
    summary: "every working session the activity log recorded — including the empty ones",
    usage: [
      `${N} sessions [--since <YYYY-MM-DD>] [--actor <ns:name>] [--task <ID>] [--json] [--dir <path>]`,
      "",
      "  Who worked, on what, for how long, and what moved. Written for the morning",
      "  after a fleet of agents worked overnight.",
      "",
      "  A SESSION THAT MOVED NOTHING IS LISTED, marked `nothing moved`. That is a",
      "  signal — it worked and closed nothing — and a report that quietly dropped",
      "  those would be one you could not trust to be complete.",
      "",
      "  --since <date>   only sessions still running on or after this day",
      "  --actor <a>      only this actor's sessions",
      "  --task <ID>      only sessions that touched this task",
      "",
      "  Minutes come from the same clustering every other report uses — there is no",
      "  second counter. Field changes are joined on the session id every history entry",
      "  carries; entries written before that field existed belong to no session and are",
      "  counted apart rather than guessed at.",
      "",
      `  \`${N} session <id>\` tells one session's story.`,
    ].join("\n"),
  },
  session: {
    script: "session-command.mjs",
    summary: "one session's narrative — tasks, clusters, what moved, tokens per model",
    usage: [
      `${N} session <id> [--json] [--dir <path>]`,
      "",
      "  The tasks it touched, its working clusters with their minutes, and the field",
      "  changes recorded against those tasks while it was running.",
      "",
      "  THE CHANGES ARE CORRELATED BY TASK AND TIME WINDOW, not by session id: the",
      "  history log does not carry one. A change another actor made to the same task",
      "  inside the same window is shown WITH its actor rather than claimed for this",
      "  session.",
      "",
      "  Tokens are reported PER MODEL or not at all. `280k tokens` means three",
      "  different things for a frontier model over an API, an agent on a",
      "  subscription and a local model on a laptop, so a bare total is a number a",
      "  reader will misinterpret. Nothing here records them yet, and an absent",
      "  section is not a zero.",
      "",
      "  exit: 0 reported · 1 no such session · 2 the invocation was wrong",
    ].join("\n"),
  },
  audit: {
    script: "audit.mjs",
    summary: "the declarations, against the traces they left — a report, not a gate",
    usage: [
      `${N} audit [--since <YYYY-MM-DD>] [--json] [--dir <path>]`,
      "",
      "  Cross-checks what the task files DECLARE against what the history log",
      "  recorded, and reports where the two disagree:",
      "",
      "    closed with no trace    a task in a closed status that no recorded",
      "                            transition ever put there",
      "    reopened after closing  rework, counted per the actor who CLOSED it",
      "    parked                  in progress, with nothing recorded for",
      "                            `audit_stale_days` days",
      "    no premise              a status you may not enter without saying why,",
      "                            carrying an empty `blocked_by`",
      "",
      "  --since <date>  the earliest closing date to judge. Defaults to the day the",
      "                  log first recorded a status transition — a task closed before",
      "                  that left no trace for a reason that is nobody's fault, and",
      "                  reporting those in bulk would bury the real ones",
      "  --json          the same findings for a program",
      "",
      "  THIS IS A TOOL FOR BACKLOG HYGIENE, NOT FOR JUDGING PEOPLE. The per-actor table",
      "  exists to find a process that keeps producing rework. A bucket with fewer than",
      "  `min_report_n` closings reports `not enough`, never a rate.",
      "",
      `  It is not \`${N} check\`: that one judges STRUCTURE and fails a commit, this one`,
      "  judges DECLARATIONS and is read by a person. Merging them would give one",
      "  command that gets switched off and another that gets ignored.",
      "",
      "  exit: 0 nothing found · 1 findings · 2 the invocation was wrong",
    ].join("\n"),
  },
  "docs-drift": {
    script: "docs-drift.mjs",
    summary: "which documents have gone stale, with the signals that say so — and, on request, tasks for them",
    usage: [
      `${N} docs-drift [--document <path>] [--signal <name>] [--seed-tasks] [--json] [--dir <path>]`,
      "",
      "  Detects that a document is dying. It NEVER writes documentation: the only",
      "  write it can make is `--seed-tasks`, which turns a finding into a task for",
      "  whoever holds `docs_role`, closed through the same verification gate as any",
      "  other work.",
      "",
      "    tasks-newer    `docs_drift_task_threshold` tasks or more naming the document",
      "                   in `related_docs:` closed AFTER the document last changed",
      "    dead-refs      a link to a file that is not there, or a task id this backlog",
      "                   does not have",
      "    status-claim   a line matching `docs_status_pending_patterns` that names",
      "                   only tasks which have since closed",
      "",
      "  --document <p>  judge this one document (repository-relative), not the tree",
      "  --signal <n>    run only these detectors; repeatable",
      "  --seed-tasks    one task per flagged document, its signals written into the",
      "                  body. Idempotent — a document already named in the",
      "                  `related_docs:` of an open docs task is skipped",
      "  --json          the same findings for a program",
      "",
      "  EVERY FLAG LISTS ITS SIGNALS: which tasks, which dead targets. There is no",
      "  bare verdict, because a verdict with no evidence cannot be argued with and so",
      "  is never acted on. Below `docs_drift_min_signals` a document is named under",
      "  `too little signal` rather than flagged — one dead link is a typo.",
      "",
      "  exit: 0 nothing to report · 1 documents flagged · 2 the invocation was wrong",
    ].join("\n"),
  },
  "pr-summary": {
    script: "pr-summary.mjs",
    summary: "what this branch did to the backlog, as markdown for a pull-request comment",
    usage: [
      `${N} pr-summary [--base <ref>] [--cost] [--json] [--dir <path>]`,
      "",
      "  Markdown on stdout: the tasks this branch touched, the status transitions it",
      "  made, and who made them. A reviewer sees the backlog diff beside the code diff",
      "  — which only works because the task travels with the branch.",
      "",
      "  --base <ref>  what to compare against; default `main`. The range is",
      "                `<base>...HEAD`, so it reports what THIS branch did rather than",
      "                what happened on the base meanwhile",
      "  --cost        include token counts, model names and amounts. OFF by default:",
      "                the comment lands somewhere public, and those are facts about the",
      "                author's spend and stack rather than about the change",
      "  --json        the same summary for a program",
      "",
      "  BOTH SOURCES ARE GIT, never a computed view: `git diff --name-only` over the",
      "  task files says WHICH tasks, and the lines ADDED to history/*.jsonl in the",
      "  same range say WHAT happened. On CI nothing has been rebuilt, so a view would",
      "  answer for a state that does not exist there.",
      "",
      "  A section with no data does not appear as zeros: no engaged-time measurement",
      "  means no time section. A branch that touched no task says so outright rather",
      "  than producing an empty comment.",
      "",
      "  It talks to nothing. The CI job is checkout, run, comment — examples/pr-summary.yml",
      "  is a working GitHub Actions workflow, and the same command needs no change in",
      "  GitLab CI or a hook.",
    ].join("\n"),
  },
  where: {
    script: "where-command.mjs",
    summary: "which directories this run uses, and WHICH RULE chose each one",
    usage: [
      `${N} where [--json] [--dir <path>]`,
      "",
      "  The backlog this run would read, the rule that found it (`explicit`, `env`,",
      "  `discovery`, `colocated`), and this machine's own directories: the config",
      "  and data homes, the preferences file, and the project registry.",
      "",
      "  It names the SOURCE and not only the path. `it is reading the wrong backlog`",
      "  is otherwise a guess across four rules, and the source is the half of the",
      "  answer that cannot be worked out afterwards.",
      "",
      "  It creates nothing. Asking where a directory would be must not bring it",
      "  into existence.",
      "",
      "  exit: 0 reported · 2 usage error",
    ].join("\n"),
  },
  project: {
    script: "project-command.mjs",
    summary: "the index of backlogs this machine knows about — never a source of truth",
    usage: [
      `${N} project add [<backlog path>] [--name <label>] [--json]`,
      `${N} project list [--json]`,
      `${N} project remove <name|path> [--json]`,
      "",
      "  REGISTRATION IS NEVER A PRECONDITION. No command needs it: a backlog is",
      "  found by walking upwards from where you are, and that answer must never be",
      "  contradicted by a file. Deleting the registry costs the cross-project view",
      "  and nothing else.",
      "",
      "  What it is for is the case detection cannot reach — standing outside every",
      "  repository and asking what exists.",
      "",
      "  The unit is the BACKLOG directory, not the git repository. A workspace of",
      "  nine repositories around one backlog is ONE project, not ten.",
      "",
      "  A name is your own label on your own machine; the path is the identity, so",
      "  `add` on a path already registered renames rather than duplicating. An entry",
      "  whose path is gone is REPORTED, never skipped.",
      "",
      "  exit: 0 done · 1 refused · 2 usage error",
    ].join("\n"),
  },
  skills: {
    script: "install-skills.mjs",
    summary: "install the agent instructions into this repository's .claude/skills/",
    usage: [
      `${N} skills install [--dry-run] [--json] [--dir <path>]`,
      "",
      "  Copies the packaged `backlog-workflow` skill into `.claude/skills/` of the",
      "  repository holding your backlog, so an agent in YOUR repository knows how to",
      "  run this tool without you writing the instructions yourself.",
      "",
      "  It never overwrites. The file may be your own edit of it, and replacing that",
      "  silently would take back a decision you made in your own repository — so an",
      "  existing file is skipped and named.",
      "",
      "  The skill deliberately holds no procedure and no vocabulary: it says to run",
      `  \`${N} instructions overview\`, which is rendered with YOUR config.yaml. A skill`,
      "  that listed statuses would be a second truth about them, wrong the moment you",
      "  renamed one.",
      "",
      `  \`${N} init --skills\` does the same thing while creating a backlog.`,
      "",
      "  exit: 0 installed or nothing to do · 1 the packaged skill is missing · 2 usage error",
    ].join("\n"),
  },
  init: {
    script: "init-backlog.mjs",
    summary: "create a new backlog in an empty directory (--dir is mandatory)",
    usage: `${N} init --dir <path>`,
  },
  instructions: {
    script: "instructions.mjs",
    summary: "the workflow, printed by the tool — the guide to read before touching a task",
    usage: [
      `${N} instructions [topic] [--json] [--dir <path>]`,
      `${N} instructions --update-nudge [--dir <path>]`,
      "",
      "  no topic           the topics, with what each one is for",
      "  overview           when to act and which guide to open — a switchboard, not a",
      "                     procedure, and it says so",
      "  task-creation      before writing a new task",
      "  task-execution     before starting work on one",
      "  task-finalization  before calling one finished",
      "  autonomous-loop    running the backlog as a queue, with nobody watching",
      "  --update-nudge     write (or refresh) the pointer to this command in the",
      "                     repository's agent file, keeping everything else in it",
      "",
      "  The text is rendered with the vocabulary of the backlog it is pointed at, so",
      "  no status, priority or id prefix of ours reaches somebody else's project.",
      "",
      "  exit: 0 printed · 2 unknown topic or flag",
    ].join("\n"),
  },
  doctor: {
    script: "doctor.mjs",
    summary: "is the backlog set up correctly — configuration, tree, git, guards",
    usage: `${N} doctor [--dir <path>] [--json]`,
  },
  stats: {
    script: "stats-report.mjs",
    summary: "the state of the backlog in the terminal: statuses, priorities, blockers, hours",
    usage: [
      `${N} stats [--dir <path>] [--json]`,
      `${N} stats --context`,
      `${N} stats --calibration [--json] | --correlation-only [--json]`,
      "",
      "  --context          what an answer costs a session, measured in THIS tree by",
      "                     running the commands it reports on",
      "",
      "  ESTIMATE CALIBRATION (TL-29) is a separate report and reads",
      "  `activity/rollup/`: what was estimated against what closed work measurably",
      "  cost, per estimate bucket.",
      "",
      "  --correlation-only step 0 alone — is the spread WITHIN a bucket smaller than",
      "                     the difference BETWEEN buckets? Below that, a table of",
      "                     medians is a formatted picture of noise. Every verdict,",
      "                     including a negative one, exits 0: it is a measurement.",
      "  --calibration      the gate, then the table. A bucket under `min_report_n`",
      "                     says `not enough data` instead of a number, a bucket that",
      "                     speaks gives a range and not just a median, and a",
      "                     breakdown by board/type/owner appears only when EVERY",
      "                     cell clears the threshold.",
      "",
      "  exit: 0 read · 2 usage error",
    ].join("\n"),
  },
  plan: {
    script: "plan-report.mjs",
    summary: "where the execution order has got to: the active wave, what is next up, what is unplanned",
    usage: [
      `${N} plan [--dir <path>] [--json]`,
      "",
      "  Reads `plan.yaml` — the execution ORDER, which is data somebody decided — and",
      "  measures it against tasks/*.md: which wave is active, which of its tasks may be",
      "  started now, what is in flight, what the plan does not schedule at all, and what",
      "  it has been overtaken by.",
      "",
      "  --json             the same answer structurally — one call instead of assembling",
      "                     the graph out of every task file",
      "",
      "  A backlog with no plan.yaml is not an error: the order is an optional decision,",
      "  so the command says so and exits 0. A plan that CONTRADICTS `blocked_by` is",
      "  refused with the same message `check --plan` gives.",
      "",
      "  exit: 0 read (no plan.yaml included) · 1 unreadable or contradictory · 2 usage error",
    ].join("\n"),
  },
  run: {
    script: "run-loop.mjs",
    summary: "drive the queue to empty: take a task, hand it to your agent, close it",
    usage: [
      `${N} run --agent "<command>" [--max-attempts N] [--max-tasks N] [--timeout <s>]`,
      `${N} run [--dry-run] [--json] [--actor <ns:name>] [--stuck-status <s>] [--dir <path>]`,
      `${N} run [--board b] [--label l] [--priority p] [--epic e] [--log-dir <path>]`,
      `${N} run --agent "<command>" --agent-for <role>=<command> [--agent-for …]`,
      "",
      "  The loop is `next` → your agent → `done`, repeated until the queue is empty.",
      "  It is NOT an agent and never will be: `--agent` is a command template of",
      "  yours, with `{task_file}` and `{id}` substituted, run through your shell.",
      "  The task — and, from the second attempt, what `done` refused — arrive on",
      "  stdin. BACKLOG_AGENT_COMMAND is read when the flag is absent.",
      "",
      "  A task that fails its contract `--max-attempts` times is moved to the open",
      "  status this project protects with a reason, WITH the reason. It is never",
      "  closed: a run that could not verify a task may not say it is done.",
      "",
      "  ONE QUEUE, SEVERAL HANDS. `--agent-for <role>=<command>` names a command per",
      "  role, repeatable; `--agent` then serves the tasks that ask for no role. With no",
      "  `--agent-for` the single command serves everything, as before. A role you gave",
      "  no command for is NOT handed out and NOT failed over — it waits for a hand you",
      "  do not have, possibly a person, and the report counts it by name. A role the",
      "  project does not declare fails before the loop starts.",
      "",
      "  --dry-run prints the order and claims nothing. Agent output goes to one log",
      "  file per task, outside the repository, and the path is in the report.",
      "",
      "  exit: 0 the run finished (blocked tasks included) · 2 usage error",
    ].join("\n"),
  },
  done: {
    script: "done-task.mjs",
    summary: "close a task by RUNNING its verification — the only command that runs it",
    usage: [
      `${N} done <ID> [--dry-run] [--json] [--actor <ns:name>] [--status <s>] [--confirm-manual] [--reason "…"]`,
      "",
      "  --dry-run          run the whole contract, change nothing — the mode for checking",
      "                     yourself BEFORE announcing you are finished",
      "  --json             the result of every entry, its exit code and its duration",
      "  --actor <ns:name>  who is closing it; goes into the history (local: / agent: / user:)",
      "  --status <s>       close as another status from `archived_statuses` (e.g. cancelled)",
      "  --confirm-manual   vouch for EVERY `manual:` entry at once — for a run with no",
      "                     terminal to ask at. It is recorded, with the actor.",
      "  --reason \"…\"       why this closure — required for an archived status that",
      "                     `reason_required_statuses` names and that the run does not",
      "                     prove (the default closing status is proved by the run itself)",
      "",
      "  There is no `--force`. Editing the file by hand is the bypass, and it leaves a",
      "  diff somebody can see; a flag would leave one word in a CI job nobody reads.",
    ].join("\n"),
  },
  check: {
    composite: [
      "check-backlog-id-collisions.mjs", "check-backlog-boards.mjs",
      "check-backlog-refs.mjs", "check-backlog-criteria.mjs",
      "check-backlog-vocabulary.mjs", "check-backlog-plan.mjs",
    ],
    summary: "backlog guards: id collisions + boards + references + criteria links + vocabularies + the execution plan vs the tree + the language and product name of the source",
    usage: CHECK_USAGE,
  },
  "migrate-prefix": {
    script: "migrate-prefix.mjs",
    summary: "renumber the backlog onto a different id prefix (names, ids, dependencies, history)",
    usage: `${N} migrate-prefix --to <NEW> [--actor <ns:name>] [--dry-run]`,
  },
  renumber: {
    script: "renumber.mjs",
    summary: "close the gaps: renumber every task into a contiguous range, keeping the prefix",
    usage: [
      `${N} renumber [--start <n>] [--also <path>] [--actor <ns:name>] [--dry-run] [--dir <path>]`,
      "",
      "  --start <n>        first number (default 1)",
      "  --also <path>      also rewrite ids in this file or directory OUTSIDE the",
      "                     backlog — docs, source comments. Repeatable.",
      "  --dry-run          print the plan, write nothing",
      "",
      "  Unlike `migrate-prefix` this DOES rewrite prose: after a renumber an id left",
      "  behind still exists and names a DIFFERENT task, so silence is the dangerous",
      "  option. Ids it does not know are left alone and listed.",
      "",
      "  An id that ILLUSTRATES the renumbering instead of pointing at a task is an",
      "  example, and rewriting it turns the sentence around it into nonsense. Put",
      "  `renumber: allow` in a comment on that ONE line and its ids stay as written.",
      "",
      "  Commit messages are out of reach and stay as written.",
      "",
      "  exit: 0 renumbered (or nothing to do) · 1 refused · 2 usage error",
    ].join("\n"),
  },
  mcp: {
    script: "mcp-server.mjs",
    summary: "speak the Model Context Protocol on stdio, so a non-shell agent can use this backlog",
    usage: [
      `${N} mcp [--dir <path>]`,
      "",
      "  Every tool is one of the commands above and every refusal is that command's",
      "  own — this server validates nothing of its own, so an agent on another host",
      "  meets the same rules a shell does. The phase guides are readable as MCP",
      "  resources, rendered with THIS backlog's vocabulary.",
      "",
      "  --dir <path>       the backlog to serve. Without it each call resolves the",
      "                     directory the way every other command does",
      "",
      "  Started by an MCP client, not by hand: JSON-RPC goes in on stdin and out on",
      "  stdout, so anything else written there would corrupt the stream.",
    ].join("\n"),
  },
  ask: {
    script: "ask-task.mjs",
    summary: "stop a task on an open question, and wait for a person to decide it",
    usage: [
      `${N} ask <ID> --question "…" [--actor <ns:name>] [--status <s>] [--json] [--dir <path>]`,
      "",
      "    --question \"…\"    REQUIRED. The question itself, recorded as an event with an",
      "                       id — the id a later `decide --resolves` names",
      "    --status <s>       which status it stops in. Only needed when more than one of",
      "                       this backlog's statuses means `waiting for somebody`",
      "    --json             the question, the changed fields and the reason, for a program",
      "",
      "    The move an unattended session has for `this is not mine to decide`. The task",
      "    goes into a status this project protects with a stated reason, and the reason",
      "    names the question — so `next` passes over it until somebody answers with",
      `    \`${N} decide <ID> --resolves <event id> --reason "…"\`, which lifts the block`,
      "    and puts the task back where it came from. Nothing is stored in the file: an",
      "    open question is a comment no decision answers.",
      "",
      "    exit: 0 asked · 1 refused (closed, no such task) · 2 usage error",
    ].join("\n"),
  },
  "regen-hook": {
    script: "regen-hook.mjs",
    summary: "entry point for an editor hook: rebuild the views after a task edit (stdin: JSON)",
    usage: `${N} regen-hook   # the hook's JSON on stdin`,
  },
};

const HELP_FLAGS = ["--help", "-h", "help"];
/** Inside a COMMAND's arguments the bare word `help` is a value, not a request
 *  for help: `query --text help` is meant to search for the word "help". A bare
 *  `help` stays, because there the word stands where a command goes. */
const COMMAND_HELP_FLAGS = ["--help", "-h"];
const VERSION_FLAGS = ["--version", "-v", "version"];

/** `--version` returns the version from the manifest, or `null` when there is no
 *  manifest. A missing manifest means a broken install, and an invented version
 *  number is something the user will later paste into a bug report. */
export function versionText() {
  if (PRODUCT_VERSION) return N + " " + PRODUCT_VERSION;
  return null;
}

export function helpText() {
  const width = Math.max(...Object.keys(COMMANDS).map((k) => k.length));
  const rows = Object.entries(COMMANDS)
    .map(([name, spec]) => "  " + name.padEnd(width) + "  " + spec.summary)
    .join("\n");
  return [
    `${N} — a backlog in markdown files, driven from the terminal`,
    "",
    "usage:",
    "  " + N.padEnd(27) + "run the viewer (the same as `" + N + " serve`)",
    `  ${N} <command> [flags]`,
    "",
    "commands:",
    rows,
    "",
    `\`${N} <command> --help\` prints that command's flags.`,
    "`--dir <path>` points at a different backlog; it works on every command.",
  ].join("\n");
}

/**
 * Resolves the arguments to a command. PURE — it starts nothing.
 *
 * The rule: the first argument that does not begin with `-` MUST be a known
 * command. An unknown word is an error, not an argument quietly handed to the
 * server — that is exactly the defect this file was created for.
 *
 * @returns {{name: string, spec: object, args: string[]}}
 */
export function resolveCommand(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  const first = args[0];

  if (first !== undefined && !first.startsWith("-")) {
    if (!Object.prototype.hasOwnProperty.call(COMMANDS, first)) {
      throw new Error(
        "unknown command: " + first + "\n" +
          "available: " + Object.keys(COMMANDS).join(" ") + "\n" +
          "`" + N + " --help` prints what each one does."
      );
    }
    return { name: first, spec: COMMANDS[first], args: args.slice(1) };
  }

  // No subcommand means the server. The flags go to it whole, so that
  // a bare `--port 4400` means what it has always meant.
  return { name: "serve", spec: COMMANDS.serve, args };
}

/**
 * The help for ONE command, assembled from the table — `summary` says WHY,
 * `usage` says HOW.
 *
 * Both fields already existed; the only thing missing was a route by which the
 * user could see them. The shape is the same as in the main help (name — what
 * it does, then `usage:`), so that moving from one to the other does not mean
 * reading from scratch.
 *
 * PURE — a test asks for the text without running the command.
 */
export function commandHelpText(name, spec) {
  const usage = String(spec.usage || "").split("\n").map((l) => (l ? "  " + l : l));
  return [N + " " + name + " — " + spec.summary, "", "usage:", ...usage].join("\n");
}

/**
 * The flags a command accepts, READ OUT OF ITS OWN HELP (TL-83).
 *
 * WHY DERIVED AND NOT DECLARED IN A SECOND TABLE. The obvious design is a
 * `flags:` array beside `usage:` in the command table — and it would be a
 * SECOND place to be wrong, drifting from the prose the moment somebody
 * documents a flag in one and not the other. Worse, the drift would be
 * invisible: an agent reading `--help --json` and a person reading `--help`
 * would be told different things about the same command, and neither would
 * have a reason to compare. Derivation cannot drift, because there is one
 * source.
 *
 * WHAT COUNTS AS A DECLARATION, precisely, so prose does not become surface:
 *
 *   - a SYNOPSIS line — one beginning with the product name — contributes every
 *     flag on it;
 *   - a FLAG line — one whose first non-space token is `--something` —
 *     contributes that flag.
 *
 * A `--json` mentioned mid-sentence contributes nothing, which is the point: an
 * explanation is not an interface. A flag that exists but is documented in
 * neither place is invisible here, and that is the correct answer — an
 * undocumented flag is not a promise the tool has made.
 *
 * `required` is read from the synopsis: a flag NOT wrapped in `[…]` there is
 * one the command refuses to run without.
 *
 * PURE — a test asks about a usage string, not about a spawned command.
 *
 * @returns {Array<{flag: string, arg: string|null, required: boolean}>}
 */
export function describeFlags(usage) {
  const found = new Map();
  const add = (flag, arg, required) => {
    const prev = found.get(flag);
    if (!prev) return void found.set(flag, { flag, arg: arg || null, required: !!required });
    if (arg && !prev.arg) prev.arg = arg;
    if (required) prev.required = true;
  };

  // THE SYNOPSIS IS THE BLOCK BEFORE THE FIRST BLANK LINE, wrapped continuation
  // lines included. Recognising it by "starts with the product name" would drop
  // every second line of a two-line synopsis — and drop it SILENTLY, which is
  // the failure this whole mechanism exists to prevent.
  let inSynopsis = true;
  for (const raw of String(usage || "").split("\n")) {
    const line = raw.trim();
    if (!line) { inSynopsis = false; continue; }

    if (inSynopsis) {
      // A flag is OPTIONAL when it stands inside brackets, and the test is the
      // bracket DEPTH at its position rather than a `[` immediately before it:
      // in `[--json|--files|--count]` only the first alternative has one, and a
      // naive test would report the other two as required — the tool demanding
      // flags it does not want. The optional quotes catch `--title "<text>"`,
      // quoted in the synopsis because a caller has to quote it too.
      let depth = 0;
      const re = /\[|\]|(--[a-z][a-z0-9-]*)(?:[ =]"?(<[^>]+>)"?)?/g;
      for (const m of line.matchAll(re)) {
        if (m[0] === "[") { depth++; continue; }
        if (m[0] === "]") { depth = Math.max(0, depth - 1); continue; }
        add(m[1], m[2], depth === 0);
      }
      continue;
    }

    const m = line.match(/^(--[a-z][a-z0-9-]*)(?:[ =]"?(<[^>]+>)"?)?/);
    if (m) add(m[1], m[2], false);
  }
  return [...found.values()].sort((a, b) => a.flag.localeCompare(b.flag));
}

/**
 * Which configuration vocabulary a flag draws its values from.
 *
 * The mapping is from the FIELD, not from the flag's spelling, and the field's
 * dictionary is `FIELD_SHAPES`' — the same one the viewer and every guard read.
 * A list of values written here would be this file's opinion about somebody
 * else's project (Law 3), and it would be wrong for every backlog that renamed
 * a status.
 *
 * The two entries not in `FIELD_SHAPES` are the tool's OWN closed vocabularies:
 * `--actor` takes a namespace this code defines, and `--to-role` is `role` under
 * another name.
 */
const FLAG_DICTIONARY = {
  "--to-role": "roles", "--from-role": "roles",
  // Two fields whose values are OBSERVED in the tree rather than declared, and
  // which the writing commands nevertheless refuse outside `config.yaml`.
  "--owner": "owners", "--to-owner": "owners", "--board": "boards",
  // The field is `labels`, the flag is singular on every command that filters by
  // one — so the derivation from FIELD_SHAPES below cannot reach it.
  "--label": "labels",
};
for (const shape of FIELD_SHAPES) {
  if (shape.dictionary) FLAG_DICTIONARY["--" + shape.key.replace(/_/g, "-")] = shape.dictionary;
}

/**
 * A vocabulary's values, and whether it is CLOSED — that is, whether a value
 * outside it is refused.
 *
 * The distinction is the whole usefulness of this for an agent. `labels:` is
 * open unless the project says otherwise, so an empty list there means "invent
 * your own", while an empty `statuses:` would mean the opposite. Reported as one
 * array, the two would be indistinguishable and an agent would be wrong about
 * one of them every time.
 */
function vocabulary(dictionary, config) {
  if (!config) return { values: null, closed: null };
  if (dictionary === "boards") return { values: (config.boards || []).map((b) => b.slug), closed: true };
  if (dictionary === "labels") return { values: config.labels || [], closed: !!config.labelsClosed };
  return { values: config[dictionary] || [], closed: true };
}

/**
 * One command's input surface, for a program (TL-83).
 *
 * WHY THE VALUES COME FROM THE BACKLOG BEING READ. An agent that has to guess a
 * status will guess, fail and retry, and that loop is the only reason a strict
 * vocabulary is ever experienced as a nuisance. The strictness is not the
 * problem — the list being unavailable at the moment it is needed is. So this
 * narrows the input space rather than validating after the fact, and it narrows
 * it to THIS project's words: `config.yaml`, never a literal here.
 *
 * A backlog that cannot be resolved is not an error: `--help` is exactly what
 * somebody types before they have one. The flags are then described without
 * their values, and `dictionary` still names where the values would come from.
 */
export function commandHelpJson(name, spec, config) {
  const flags = describeFlags(spec.usage).map((f) => {
    const dictionary = FLAG_DICTIONARY[f.flag] || null;
    const { values, closed } = dictionary ? vocabulary(dictionary, config) : { values: null, closed: null };
    return { ...f, dictionary, values, closed };
  });
  return {
    command: name,
    summary: spec.summary,
    usage: String(spec.usage || ""),
    // `null` and not `[]` when there is no backlog: an empty vocabulary is a
    // decision a project can make, and it must not read as "we did not look".
    configured: !!config,
    flags,
  };
}

/**
 * Whether a command's arguments are asking for help (TL-51).
 *
 * WHY THIS SITS HERE AND NOT IN EVERY COMMAND. The main help promises
 * "`<command> --help` prints that command's flags", and the promise was
 * false in eight commands out of twelve: BL-1417 was right to close flag
 * validation, it just never put `--help` on the list of known flags — so a good
 * change turned the HELP flag into a usage error. `--help` is typed exactly when
 * one does NOT know which flags exist; answering "unknown flag" with exit code 2
 * teaches that the tool has no help.
 *
 * The resolution: intercept HERE, before the spawn, and print `usage` from the
 * table. Then no command has to remember the flag, and a new command gets help
 * simply by being written into `COMMANDS`.
 *
 * The scan stops at `--`, so that a value beginning with a dash is not mistaken
 * for a flag once the separator lands in TL-58.
 */
export function wantsHelp(args) {
  for (const a of args) {
    if (a === "--") return false;
    if (COMMAND_HELP_FLAGS.includes(a)) return true;
  }
  return false;
}

/**
 * The fields `--append-<field>` may build up, one call argument at a time.
 *
 * ONE ENTRY TODAY, and that is not an oversight: `--reason` is the only input
 * anybody writes a paragraph into. TL-80 and TL-82 add commands that write
 * prose, and they join this list rather than inventing their own mechanism.
 * A general "append to any text flag" would make `--append-title` look like an
 * interface the tool offers, which it does not.
 */
export const APPENDABLE_FIELDS = ["reason"];

/**
 * `--append-<field> "line"` folded into one `--<field>` before the spawn (TL-83).
 *
 * WHY THIS EXISTS AT ALL. Agent sandboxes built on tree-sitter reject the
 * `$'a\nb'` shell syntax, so an agent inside one has no way to put a second line
 * into a flag value in a single call. It is not a nuisance but a hard wall: the
 * only inputs it can express are single-line ones. Repeatable `--append-` flags
 * are the way round it, which is why they are the form recommended to agents.
 *
 * THE ORDER IS DEFINED, because an undefined one makes the same set of flags
 * mean different things on different days: `--<field>` REPLACES and is applied
 * first, then every `--append-<field>` in COMMAND-LINE order, each on its own
 * line. So `--reason A --append-reason B` is "A\nB" and never "B\nA", whichever
 * side of the line the flags were typed on.
 *
 * WHY IN THE DISPATCHER and not in each command, the same argument
 * `takeColorFlags` makes: the alternative is adding the flag to the allowed list
 * in every writing command — that is, one chance per command to forget it, and
 * one place per command to change for the next such flag. The commands keep
 * their own validation and never learn this flag exists.
 *
 * A command that does not accept `--<field>` is REFUSED here rather than handed
 * a flag it will reject as unknown: the second message would name a flag the
 * user did not type.
 *
 * @returns {{argv: string[], error: string|null}}
 */
export function foldAppendFlags(argv, accepts = () => true) {
  const appends = new Map();
  const base = new Map();
  const rest = [];
  let passthrough = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (passthrough) { rest.push(a); continue; }
    if (a === "--") { passthrough = true; rest.push(a); continue; }

    const m = a.match(/^--append-([a-z][a-z0-9-]*)$/);
    if (!m) {
      // Remember where the base value was given, so the fold rewrites it in
      // place rather than moving the flag to the end of the line.
      const field = APPENDABLE_FIELDS.find((f) => a === "--" + f);
      if (field && argv[i + 1] !== undefined) {
        base.set(field, rest.length + 1);
        rest.push(a, argv[++i]);
        continue;
      }
      rest.push(a);
      continue;
    }
    const field = m[1];
    if (APPENDABLE_FIELDS.indexOf(field) < 0) {
      return { argv, error: "unknown flag: " + a + "\n`--append-` builds up: " + APPENDABLE_FIELDS.map((f) => "--append-" + f).join(" ") };
    }
    if (!accepts("--" + field)) {
      return { argv, error: a + " has nothing to append to — this command takes no `--" + field + "`" };
    }
    const value = argv[++i];
    if (value === undefined) return { argv, error: a + " requires a value" };
    if (!appends.has(field)) appends.set(field, []);
    appends.get(field).push(value);
  }

  for (const [field, lines] of appends) {
    const at = base.get(field);
    if (at === undefined) rest.push("--" + field, lines.join("\n"));
    else rest[at] = [rest[at], ...lines].join("\n");
  }
  return { argv: rest, error: null };
}

/**
 * `--no-color` / `--color` handled ONCE, here (TL-52).
 *
 * The alternative was adding both flags to the allowed list in each of the
 * twelve commands — that is, twelve chances to forget one, and twelve places to
 * change for the next global flag. The dispatcher takes them off the arguments
 * and passes the decision to the child through the ENVIRONMENT, which `ui.mjs`
 * listens to anyway. That leaves flag validation in the commands untouched.
 */
export function takeColorFlags(argv) {
  const rest = [];
  let force = null;
  for (const a of argv) {
    if (a === "--no-color") { force = false; continue; }
    if (a === "--color") { force = true; continue; }
    rest.push(a);
  }
  return { argv: rest, force };
}

function childEnv(force) {
  if (force === null) return process.env;
  const env = { ...process.env };
  if (force === false) env.NO_COLOR = "1";
  else { delete env.NO_COLOR; env.FORCE_COLOR = "1"; }
  return env;
}

function runScript(script, args, colorForce = null) {
  const r = spawnSync(process.execPath, [join(HERE, script)].concat(args), {
    stdio: "inherit",
    env: childEnv(colorForce),
  });
  if (r.error) {
    console.error(failure(N, "could not start " + script, [r.error.message], []));
    return 1;
  }
  // Killed by a signal (Ctrl-C on the server) is not a usage error.
  if (r.signal) return 0;
  return r.status === null ? 1 : r.status;
}

/**
 * The same run, but with the guard's output CAPTURED instead of inherited (TL-57).
 *
 * WHY A SECOND FUNCTION RATHER THAN A FLAG ON THE FIRST. Capturing changes what
 * the user sees, and `check --json` has one hard constraint: stdout carries the
 * JSON document and nothing else. A `✓` from a guard, printed "just for a
 * moment", breaks parsing for every consumer at once — so the guards' own output
 * cannot reach stdout at all, and there is no invocation where it half does.
 *
 * COLOUR IS FORCED OFF. The text goes into a JSON string a program will read;
 * escape sequences there are noise the consumer has to strip, and a consumer
 * that forgot to would print them.
 */
function captureScript(script, args) {
  const r = spawnSync(process.execPath, [join(HERE, script)].concat(args), {
    encoding: "utf8",
    env: { ...childEnv(false), NO_COLOR: "1" },
  });
  if (r.error) {
    return { exit: 1, output: "could not start " + script + ": " + r.error.message };
  }
  const output = (String(r.stdout || "") + String(r.stderr || "")).trimEnd();
  return { exit: r.signal ? 0 : (r.status === null ? 1 : r.status), output };
}

/**
 * `check` calls the backlog guards and fails if ANY of them failed.
 *
 * WHY THE GUARDS CAN BE SELECTED SEPARATELY (BL-1450). Their scope differs on
 * purpose: an id collision is a property of the SET, so that guard reads the
 * whole tree; a board is a property of ONE file, so the pre-commit hook judges
 * the staged files — otherwise my commit would fail because of somebody else's
 * work in progress. Without the selectors a consumer would have to call both
 * files by path, which means knowing how the package is built inside.
 *
 * WHY AN UNKNOWN FLAG FAILS. Until BL-1450 `check` read only `--dir` and
 * IGNORED the rest, so `check --help` ran the guards, and `check --boards` on
 * the old code "passed" while doing both. A silent no-op looks like the tool
 * working — and on top of that it invalidates every test of those selectors.
 *
 * A separate function also because `check-backlog-boards.mjs` with no `--all`
 * and no files finishes green on "0 tasks checked" — a green result with zero
 * evidential force. The dispatcher supplies the mode so that nobody has to
 * remember it.
 */
const CHECK_FLAGS = ["--dir", "--json", "--id-collisions", "--boards", "--refs", "--criteria", "--reasons", "--log-status", "--history", "--docs", "--vocabulary", "--plan", "--language", "--product-name", "--proofs", "--since"];

/** PURE — resolves `check`'s arguments. Throws on a usage error. */
export function parseCheckArgs(args) {
  let dir = null;
  let wantIds = false;
  let wantBoards = false;
  let wantRefs = false;
  let wantCriteria = false;
  let wantReasons = false;
  let wantLogStatus = false;
  let wantHistory = false;
  let wantDocs = false;
  let wantVocabulary = false;
  let wantPlan = false;
  let wantLanguage = false;
  let wantProductName = false;
  let wantProofs = false;
  let since = null;
  let json = false;
  const files = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dir") {
      dir = args[++i] || null;
      if (!dir) throw new Error("`--dir` with no path");
      continue;
    }
    if (a === "--json") { json = true; continue; }
    if (a === "--id-collisions") { wantIds = true; continue; }
    if (a === "--boards") { wantBoards = true; continue; }
    if (a === "--refs") { wantRefs = true; continue; }
    if (a === "--criteria") { wantCriteria = true; continue; }
    if (a === "--reasons") { wantReasons = true; continue; }
    if (a === "--log-status") { wantLogStatus = true; continue; }
    if (a === "--history") { wantHistory = true; continue; }
    if (a === "--docs") { wantDocs = true; continue; }
    if (a === "--vocabulary") { wantVocabulary = true; continue; }
    if (a === "--plan") { wantPlan = true; continue; }
    if (a === "--language") { wantLanguage = true; continue; }
    if (a === "--product-name") { wantProductName = true; continue; }
    if (a === "--proofs") { wantProofs = true; continue; }
    if (a === "--since") {
      since = args[++i] || null;
      if (!since) throw new Error("`--since` with no commit");
      continue;
    }
    if (a.startsWith("-")) {
      // The full `usage` is NO LONGER repeated here (TL-52): since `check
      // --help` works (TL-51), the error's job is to name the flag and point
      // the way, not to reprint the whole help — a message longer than the help
      // stops being a message.
      throw new Error("unknown flag: " + a + "\nknown flags: " + CHECK_FLAGS.join(" "));
    }
    files.push(a);
  }

  if (files.length && !wantBoards) {
    throw new Error(
      "files as arguments only make sense with `--boards`\n" +
        "the collision guard judges the SET, not single files — narrowed to a " +
        "list of files it would detect nothing, because a collision by definition involves two."
    );
  }

  // No selector means all of them. A new guard joins the default run on purpose
  // (BL-1451): a dangling reference passed `check`, because `check` checked only
  // what somebody had once written into it.
  if (!wantIds && !wantBoards && !wantRefs && !wantCriteria && !wantReasons && !wantLogStatus &&
      !wantHistory && !wantDocs && !wantVocabulary && !wantPlan && !wantLanguage && !wantProductName &&
      !wantProofs) {
    wantIds = true; wantBoards = true; wantRefs = true; wantCriteria = true; wantReasons = true;
    wantLogStatus = true; wantHistory = true; wantDocs = true;
    wantVocabulary = true; wantPlan = true; wantLanguage = true; wantProductName = true;
  }
  // `--proofs` IS NOT IN THAT LIST, and it is the one guard that must never be
  // (TL-147). It re-runs other tasks' contracts, which are test suites: a bare
  // `check` would go from a second to minutes, and — since a contract in this
  // very backlog runs `check` — it would call itself for as long as the machine
  // let it. So it joins a run only when somebody asks for it by name, which is
  // the opposite of the rule every other guard follows and needs saying out loud.
  if (since !== null && !wantProofs) {
    throw new Error(
      "`--since` with no `--proofs`\n" +
        "It narrows which proven closings are re-run; on its own there is nothing for it to narrow."
    );
  }
  return { dir, json, wantIds, wantBoards, wantRefs, wantCriteria, wantReasons, wantLogStatus, wantHistory, wantDocs, wantVocabulary, wantPlan, wantLanguage, wantProductName, wantProofs, since, files };
}

/**
 * The guards, as data (TL-57).
 *
 * WHY A TABLE AND NOT ELEVEN `if` BLOCKS, which is what this was. `check --json`
 * has to run the same set the text mode runs, and two lists of eleven guards
 * would differ the first time somebody added a twelfth to one of them — silently,
 * because the JSON consumer has no way to notice a guard that is not there.
 *
 * `args` IS A FUNCTION BECAUSE THE INPUT CONVENTIONS GENUINELY DIFFER, and the
 * discrepancy stays on the dispatcher's side rather than being normalised into
 * eleven guards: one takes the tasks directory positionally, most take the
 * backlog directory through `--dir`, and two take nothing at all.
 */
export const CHECK_GUARDS = [
  // An id collision is a property of the SET, so this one reads the whole tree.
  { key: "ids", want: "wantIds", name: "id-collisions", script: "check-backlog-id-collisions.mjs",
    args: (root, tasksDir) => [tasksDir] },
  // A board is a property of ONE file, so a pre-commit hook can judge the staged
  // files — otherwise my commit would fail because of somebody else's task.
  { key: "boards", want: "wantBoards", name: "boards", script: "check-backlog-boards.mjs",
    args: (root, tasksDir, files) => (files.length ? files : ["--all", tasksDir]) },
  // A third input convention: the BACKLOG directory through --dir, not the tasks
  // directory positionally.
  { key: "refs", want: "wantRefs", name: "refs", script: "check-backlog-refs.mjs",
    args: (root) => ["--dir", root] },
  // Judges the SET, and needs the configuration to know which statuses are closed.
  { key: "criteria", want: "wantCriteria", name: "criteria", script: "check-backlog-criteria.mjs",
    args: (root) => ["--dir", root] },
  // Reads the whole history; the configuration says which statuses require a reason.
  { key: "reasons", want: "wantReasons", name: "reasons", script: "check-backlog-reasons.mjs",
    args: (root) => ["--dir", root] },
  // Compares each task against ITSELF — the only guard whose question is entirely
  // inside one file. It needs the configuration twice over: for the statuses that
  // make a log line a status claim at all, and for the archived ones that decide
  // which direction of drift is a defect rather than stale prose.
  { key: "log-status", want: "wantLogStatus", name: "log-status", script: "check-backlog-log-status.mjs",
    args: (root) => ["--dir", root] },
  // The only guard whose answer depends on something outside the backlog
  // directory — it asks git — which is why it says so when there is no git.
  { key: "history", want: "wantHistory", name: "history", script: "check-backlog-history-tracked.mjs",
    args: (root) => ["--dir", root] },
  // Judges the REPOSITORY holding the backlog, not this installation: a
  // `related_docs` entry resolves against the consumer's tree.
  { key: "docs", want: "wantDocs", name: "docs", script: "check-docs-links.mjs",
    args: (root) => ["--dir", root] },
  // The one guard whose question is entirely the configuration file.
  { key: "vocabulary", want: "wantVocabulary", name: "vocabulary", script: "check-backlog-vocabulary.mjs",
    args: (root) => ["--dir", root] },
  // The plan is judged against the WHOLE tree; a finished blocker outside the
  // plan is not a gap.
  { key: "plan", want: "wantPlan", name: "plan", script: "check-backlog-plan.mjs",
    args: (root) => ["--dir", root] },
  // NO `--dir`, and that is not an oversight: this judges the SOURCE of this
  // installation. Pointing it at a backlog would have it read somebody's tasks
  // and report their language as a defect of the tool.
  //
  // `installationOnly` draws the consequence that was left undrawn (TL-163): a
  // guard whose subject is this installation must not run when `check` was
  // pointed somewhere else, or it answers a question nobody asked and can fail a
  // run about a tree it never read. Measured: `doctor --dir <a fixture>` exited
  // 1 because of an unrelated file being edited in this repository's `scripts/`,
  // which is what made the suite intermittently red — a run during an edit and a
  // run after it saw two different trees.
  { key: "language", want: "wantLanguage", name: "language", script: "check-public-language.mjs",
    installationOnly: true, args: () => [] },
  // No `--dir` either, and for the same reason. A user's task files may name the
  // tool as often as they like — that is their prose, not our literal.
  { key: "product-name", want: "wantProductName", name: "product-name", script: "check-product-name.mjs",
    installationOnly: true, args: () => [] },
  // OPT-IN ONLY — see `parseCheckArgs`. It re-runs the contracts of tasks that
  // are already closed, so it costs what those test suites cost.
  { key: "proofs", want: "wantProofs", name: "proofs", script: "check-backlog-proofs.mjs",
    // The ONE guard outside the default run, and the flag says so in the table
    // rather than in a name a test would have to know — see `parseCheckArgs`.
    optIn: true,
    args: (root, tasksDir, files, plan) => ["--dir", root].concat(plan.since ? ["--since", plan.since] : []) },
];

/**
 * Is this backlog part of the checkout the tool is running FROM?
 *
 * The comparison is between resolved paths, and it accepts the installation
 * root itself — a co-located backlog IS the root (CLAUDE.md: the tool supports
 * both layouts, and a rule that only knew the nested one would switch the two
 * guards off for every co-located consumer of this repository).
 */
export function insideInstallation(root, moduleDir = HERE) {
  const installation = resolve(moduleDir, "..");
  const target = resolve(root);
  return target === installation || target.startsWith(installation + sep);
}

/** One line, so the plain output and the JSON say the same thing. */
function skippedGuardLine(name) {
  return "· " + name + ": not run — it judges this tool's own source, and `--dir` " +
    "points at another backlog";
}

function runCheck(args) {
  let plan;
  try {
    plan = parseCheckArgs(args);
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N + " check", head, rest, [N + " check --help"]));
    return 2;
  }

  // BL-1445: the same fix as in build-backlog.mjs — `join(HERE, "..")` is
  // co-location that says nothing about being an assumption. The resolver keeps
  // it as the last of four sources, so nothing changes where it used to work.
  const root = resolveBacklogDir({ dir: plan.dir || undefined, moduleDir: HERE }).root;
  const tasksDir = join(root, "tasks");

  // The configuration is checked ONCE, here (TL-60). Every guard is a separate
  // process and each validates it on its own — rightly so, because they are
  // sometimes called straight from a hook. But called together they would print
  // the same error three times, and three copies of one sentence read like three
  // different problems.
  try {
    loadConfig(root);
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    console.error(formatConfigError(e, N));
    // The guards do not run: their answers computed under a configuration that
    // could not be read would be answers to a different question.
    return 1;
  }

  const guards = CHECK_GUARDS.filter((g) => plan[g.want]);

  // WHOSE TREE IS BEING JUDGED (TL-163). Two guards read this installation's own
  // source and take no `--dir`; run against somebody else's backlog they answer
  // about the wrong subject, and their verdict then depends on whatever the
  // TOOL's checkout happens to contain at that moment. That is not a hypothetical
  // — it is the reproduced cause of an intermittently red suite: dozens of tests
  // spawn `check` or `doctor` against a temporary fixture, and every one of them
  // was re-reading the developer's working tree mid-edit.
  const ownBacklog = insideInstallation(root);

  // `--json` CAPTURES the guards instead of letting them print (TL-57). The
  // constraint is absolute: with `--json`, stdout carries the document and
  // nothing else, because a `✓` from one guard breaks parsing for every
  // consumer at once. The EXIT CODE is unchanged either way — JSON describes
  // the result, it does not replace it.
  if (plan.json) {
    const results = [];
    let worstJson = 0;
    for (const guard of guards) {
      if (guard.installationOnly && !ownBacklog) {
        // `skipped` rather than `ok: true`: a consumer counting green guards must
        // not be told a question was answered when it was never asked.
        results.push({ name: guard.name, ok: true, skipped: true, exit: 0, output: skippedGuardLine(guard.name) });
        continue;
      }
      const { exit, output } = captureScript(guard.script, guard.args(root, tasksDir, plan.files, plan));
      worstJson = Math.max(worstJson, exit);
      results.push({ name: guard.name, ok: exit === 0, exit, output });
    }
    printJson("check", {
      ok: worstJson === 0,
      root,
      // The name of the guard that failed is the field a consumer acts on; the
      // `output` beside it is text written for a person and may be reworded.
      failed: results.filter((g) => !g.ok).map((g) => g.name),
      guards: results,
    });
    return worstJson;
  }

  let worst = 0;
  for (const guard of guards) {
    if (guard.installationOnly && !ownBacklog) {
      // SAID OUT LOUD, not silently dropped. A guard that did not run and a
      // guard that passed look identical in a summary, and this project's whole
      // argument is that they must not.
      console.log(skippedGuardLine(guard.name));
      continue;
    }
    worst = Math.max(worst, runScript(guard.script, guard.args(root, tasksDir, plan.files, plan)));
  }
  return worst;
}

export function main(argv) {
  if (argv.length && HELP_FLAGS.includes(argv[0])) {
    console.log(helpText());
    return 0;
  }

  if (argv.length && VERSION_FLAGS.includes(argv[0])) {
    const text = versionText();
    if (text === null) {
      console.error(N + ": cannot read the version — no package.json next to scripts/ (broken install)");
      return 1;
    }
    console.log(text);
    return 0;
  }

  const tinted = takeColorFlags(argv);
  let resolved;
  try {
    resolved = resolveCommand(tinted.argv);
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N, head, rest.slice(0, 1), [N + " --help"]));
    return 2;
  }

  if (wantsHelp(resolved.args)) {
    // Help goes to stdout and exits zero: this is not a usage error.
    if (resolved.args.includes("--json")) {
      // Law 4's other half (TL-83): the reading commands answer in JSON, and so
      // does the description of how to CALL the writing ones. Without a
      // configuration the flags are still described — `--help` is what somebody
      // types before they have a backlog.
      let config = null;
      try {
        const dirFlag = resolved.args.indexOf("--dir");
        config = loadConfig(resolveBacklogDir({
          dir: dirFlag >= 0 ? resolved.args[dirFlag + 1] : undefined, moduleDir: HERE,
        }).root);
      } catch {
        // No backlog here, or one that will not load. Neither stops the answer.
      }
      printJson("command-help", commandHelpJson(resolved.name, resolved.spec, config));
      return 0;
    }
    console.log(commandHelpText(resolved.name, resolved.spec));
    return 0;
  }

  // BEFORE the command sees its arguments (TL-83), and after help: `--help
  // --append-reason x` is a question about the interface, not a use of it.
  const declared = new Set(describeFlags(resolved.spec.usage).map((f) => f.flag));
  const folded = foldAppendFlags(resolved.args, (flag) => declared.has(flag));
  if (folded.error) {
    const [head, ...detail] = folded.error.split("\n");
    console.error(failure(N + " " + resolved.name, head, detail, [N + " " + resolved.name + " --help"]));
    return 2;
  }

  if (resolved.name === "check") return runCheck(folded.argv);
  return runScript(resolved.spec.script, folded.argv, tinted.force);
}

if (process.argv[1] && process.argv[1].endsWith("cli.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
