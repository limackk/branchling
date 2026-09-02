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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PRODUCT_NAME as N, PRODUCT_VERSION } from "./product.mjs";
import { ConfigError, formatConfigError, loadConfig } from "./config.mjs";
import { printJson } from "./json-envelope.mjs";
import { failure } from "./ui.mjs";
import { resolveBacklogDir } from "./paths.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const CHECK_USAGE = [
  `${N} check [--dir <path>] [--id-collisions] [--boards] [--refs] [--criteria] [--reasons] [--vocabulary] [--plan] [--language] [--product-name] [task-file.md …]`,
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
  "  --plan               only whether plan.yaml can be executed — that no wave stands before",
  "                       a task it is blocked by. A backlog with no plan.yaml passes: the",
  "                       execution order is an optional decision, not a required file",
  "  --language           only whether the public surface is English — a property of the CODE,",
  "                       so it reads this installation, not the backlog named by --dir",
  "  --product-name       only whether the name is written out in scripts/ or bin/ instead of",
  "                       imported from product.mjs — also a property of the CODE, not the data",
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
    usage: `${N} query [--status s] [--priority p] [--board b] [--label l] [--epic e] [--json|--files|--count]`,
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
    summary: "record changes made while the server was down",
    usage: `${N} history [--file <task.md>] --actor <local:|agent:|user:><name> [--source s] [--reason "…"]`,
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
      `${N} time [--engaged] [--json] [--dir <path>]`,
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
      "  `--json` carries the engaged figures and `unknown_ratio` whether or not",
      "  `--engaged` was passed: a key that appears only with a flag is a contract",
      "  nobody can build against.",
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
      "  --kind <k>      tool (default), prompt, commit, edit, reassign",
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
    usage: `${N} new --title "…" [--board b] [--priority P1] [--epic e] [--estimate 2h]`,
  },
  seed: {
    script: "seed-backlog.mjs",
    summary: "create a whole backlog from a structured plan on stdin — no model involved",
    usage: [
      `${N} seed [--dir <path>] [--dry-run] [--json] [--actor <ns:name>] [--reason "…"] < plan.json`,
      "",
      "  The plan is JSON on STANDARD INPUT — that is the callable input, so whatever",
      "  produced the plan (a script, an LLM adapter, another tool) pipes straight in.",
      "",
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
    usage: `${N} stats [--dir <path>] [--json]`,
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
      "  Commit messages are out of reach and stay as written.",
      "",
      "  exit: 0 renumbered (or nothing to do) · 1 refused · 2 usage error",
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
const CHECK_FLAGS = ["--dir", "--json", "--id-collisions", "--boards", "--refs", "--criteria", "--reasons", "--history", "--docs", "--vocabulary", "--plan", "--language", "--product-name"];

/** PURE — resolves `check`'s arguments. Throws on a usage error. */
export function parseCheckArgs(args) {
  let dir = null;
  let wantIds = false;
  let wantBoards = false;
  let wantRefs = false;
  let wantCriteria = false;
  let wantReasons = false;
  let wantHistory = false;
  let wantDocs = false;
  let wantVocabulary = false;
  let wantPlan = false;
  let wantLanguage = false;
  let wantProductName = false;
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
    if (a === "--history") { wantHistory = true; continue; }
    if (a === "--docs") { wantDocs = true; continue; }
    if (a === "--vocabulary") { wantVocabulary = true; continue; }
    if (a === "--plan") { wantPlan = true; continue; }
    if (a === "--language") { wantLanguage = true; continue; }
    if (a === "--product-name") { wantProductName = true; continue; }
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
  if (!wantIds && !wantBoards && !wantRefs && !wantCriteria && !wantReasons && !wantHistory &&
      !wantDocs && !wantVocabulary && !wantPlan && !wantLanguage && !wantProductName) {
    wantIds = true; wantBoards = true; wantRefs = true; wantCriteria = true; wantReasons = true;
    wantHistory = true; wantDocs = true;
    wantVocabulary = true; wantPlan = true; wantLanguage = true; wantProductName = true;
  }
  return { dir, json, wantIds, wantBoards, wantRefs, wantCriteria, wantReasons, wantHistory, wantDocs, wantVocabulary, wantPlan, wantLanguage, wantProductName, files };
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
  { key: "language", want: "wantLanguage", name: "language", script: "check-public-language.mjs",
    args: () => [] },
  // No `--dir` either, and for the same reason. A user's task files may name the
  // tool as often as they like — that is their prose, not our literal.
  { key: "product-name", want: "wantProductName", name: "product-name", script: "check-product-name.mjs",
    args: () => [] },
];

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

  // `--json` CAPTURES the guards instead of letting them print (TL-57). The
  // constraint is absolute: with `--json`, stdout carries the document and
  // nothing else, because a `✓` from one guard breaks parsing for every
  // consumer at once. The EXIT CODE is unchanged either way — JSON describes
  // the result, it does not replace it.
  if (plan.json) {
    const results = [];
    let worstJson = 0;
    for (const guard of guards) {
      const { exit, output } = captureScript(guard.script, guard.args(root, tasksDir, plan.files));
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
    worst = Math.max(worst, runScript(guard.script, guard.args(root, tasksDir, plan.files)));
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
    console.log(commandHelpText(resolved.name, resolved.spec));
    return 0;
  }

  if (resolved.name === "check") return runCheck(resolved.args);
  return runScript(resolved.spec.script, resolved.args, tinted.force);
}

if (process.argv[1] && process.argv[1].endsWith("cli.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
