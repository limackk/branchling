/**
 * The JSON envelope — one shape for every `--json` answer (TL-72).
 *
 * WHY. The fourth law makes `--json` the extension surface: there is no plugin
 * API, so the JSON contract is the only thing anybody can build against. Until
 * this file, `query --json` printed a bare array. A bare array has nowhere to put
 * metadata — the only way to add a warning, a directory, or a result count is to
 * change the root from an array into an object, which breaks every consumer at
 * once. The longer that stands, the more expensive the change gets.
 *
 * The shape is the one Backlog.md settled on for the same problem:
 *
 *   { "schemaVersion": 1, "kind": "task-list", "tasks": [ … ] }
 *
 * and with it the rules a consumer may rely on:
 *
 *   - `schemaVersion` and `kind` are ALWAYS present, and `kind` says which
 *     payload keys follow;
 *   - a key declared for that kind is always present: an absent scalar is
 *     `null`, an absent collection is `[]`. Never a missing key — a consumer
 *     must not have to tell "no value" from "old version of the tool";
 *   - ADDING a key is backwards compatible and does not move the version;
 *   - removing, renaming or redefining a key needs a new `schemaVersion`.
 *
 * WHY THE KINDS ARE DECLARED HERE AND NOT AT THE EMITTERS. The emptiness rule is
 * worth nothing as a promise; it holds because the key set lives beside the
 * version and every emitter is filled in from it. An emitter that forgets a key
 * still prints it, and an emitter that invents one FAILS instead of quietly
 * extending the contract from a typo.
 *
 * Tests: `node --test scripts/tests/json-envelope.test.mjs`
 */

import { printLine } from "./stdout.mjs";

/**
 * The version of the contract, in ONE place. It is not the package version:
 * releases happen for reasons that have nothing to do with the JSON shape, and a
 * consumer pinning behaviour wants the shape, not the release.
 */
export const SCHEMA_VERSION = 1;

/**
 * Every kind, with its keys and their EMPTY values. `null` marks a scalar, `[]`
 * a collection — that is the whole emptiness rule, expressed as data rather than
 * as a paragraph in the README.
 */
export const KINDS = {
  // `query --json`. `total` is the number of matches BEFORE `--limit` cut them;
  // without it the array is a slice that reads like a complete answer, which is
  // the defect the text output has warned about since it had a `--limit`.
  // `scan` says whether the branch and worktree scan ran (TL-73) — without
  // it, an empty `elsewhere` on every task is ambiguous between "the branches
  // agree" and "nobody looked", and those two call for opposite decisions.
  // `modifiedFile` is `null` unless `--modified-file` was asked for, and then it
  // says whether the git index could be computed at all (TL-75): zero matches
  // and an unscanned repository are otherwise the same empty `tasks`.
  "task-list": { tasks: [], total: null, limit: null, scan: null, modifiedFile: null, elsewhereOnly: [] },
  // `<command> --help --json` (TL-83). `flags` describes the input surface, and
  // a flag drawing on a vocabulary carries THIS project's values in `values` —
  // so an agent narrows its input instead of guessing and retrying. `configured`
  // says whether a backlog was found at all: `values: null` under
  // `configured: false` is "nobody looked", not "the vocabulary is empty".
  "command-help": { command: null, summary: null, usage: null, configured: null, flags: [] },
  // `pr-summary --json` (TL-89). `scanned` says whether the range could be read
  // at all: outside git, or with a base this clone does not have, `tasks: []` is
  // "nobody looked" rather than "nothing changed", and `reason` says which.
  "pr-summary": { base: null, scanned: null, reason: null, tasks: [], engaged: null, cost: null },
  // `audit --json` (TL-90). `since` and `dayZero` are what makes an empty
  // `closedWithoutTrace` readable: the log has a first day, and everything
  // before it left no trace for a reason that is nobody's fault.
  run: {
    ok: null, dryRun: null, agent: null, profile: null, agentFor: null, profileFor: null,
    delegation: null, allowUncontrolledDelegation: null, plan: null, order: [], considered: null,
    stoppedAt: null, stopped: null, agentNeverRan: null, waitingForRole: [],
    waitingForExecutor: [], waitingForSize: [], tally: null, sharedState: null, ms: null, tasks: [],
    // What `--dry-run` declined because THIS actor handed it back (TL-239),
    // under the name `next --json` already gives the same list: the two paths
    // answer about one queue, so a consumer reads one key for one fact.
    skippedHandedBack: [],
  },
  // `advisories` are the findings `check` stopped reporting when it became a
  // release gate (TL-383): each `{ name, output }`, where `name` is the same
  // registry string `check --json` puts in `failed` and `output` is text written
  // for a person.
  audit: {
    since: null, dayZero: null, tasks: null, findings: null,
    closedWithoutTrace: [], skippedBeforeSince: null, reopened: [],
    parked: [], withoutPremise: [], awaitingVouch: [], vouches: [],
    advisories: [],
  },
  // `stats --json`. The tallies stay nested under `stats` instead of being
  // spread across the root: a future tally called `kind` would otherwise
  // overwrite the envelope's own key and nobody would notice until a consumer
  // broke.
  // `divergent` is the list behind the `divergent` tally inside `stats`: the
  // tasks another branch disagrees with, each naming both statuses (TL-73).
  stats: { root: null, stats: null, scan: null, divergent: [], elsewhereOnly: [], context: null },
  // `check --json` (TL-57). `ok` is what CI reads, `failed` is what it acts on —
  // a consumer must not have to filter `guards` to learn which one to look at.
  // `output` beside each guard is text written for a PERSON and may be reworded;
  // `name`, `ok`, `exit` and `severity` are the contract. `severity` says what a
  // guard was allowed to do to `ok` — a consumer that treats an advisory finding
  // as a release blocker is the failure mode TL-383 removed from the terminal,
  // and it must not be reintroduced through the JSON.
  check: { ok: null, root: null, failed: [], guards: [] },
  // `doctor --json`. `ok` is the answer CI reads; `checks` is why.
  doctor: { ok: null, root: null, next: null, checks: [] },
  // `board --json`. `rule` and `matched` are null exactly when `isDefault` is
  // true — nothing matched, so there is no rule to name.
  board: { board: null, rule: null, matched: null, isDefault: null, reason: null },
  // `next-id --json`. Everything `--explain` prints, always — a machine that has
  // to ask a second question to learn where the number came from would have to
  // parse prose.
  // `instructions --json`. `topics` is always the full list, even when one topic
  // was asked for: a consumer that has to make a second call to learn what else
  // exists is one that will hard-code the list instead. `version` is the version
  // of the POINTER a repository carries, not of the guides.
  instructions: { topics: [], topic: null, role: null, text: null, version: null },
  "agent-profiles": { path: null, exists: null, profiles: [], profile: null },
  "profile-check": { ok: null, path: null, live: null, results: [] },
  // `conformance --json` proves an adapter against a disposable, offline
  // contract. Results name the requested scenario rather than exposing the
  // adapter's raw output, which may contain provider diagnostics or a secret.
  "adapter-conformance": { ok: null, version: null, adapter: null, results: [], failures: [] },
  "next-id": { nextId: null, id: null, prefix: null, max: null, source: null, trees: null, branches: null, known: null },
  // `seed --json`. The first WRITING command in the envelope, because it is the
  // first one written after the envelope existed — the older three answer with a
  // bare object and move separately.
  // `created` carries the mapping the caller cannot compute: `planId` is the key
  // it wrote, `id` is the number the tool allocated. `errors` is what the plan
  // was refused for, in full — an adapter retrying with the model (TL-95) needs
  // every complaint, not the first.
  seed: { ok: null, root: null, dryRun: null, created: [], errors: [] },
  // `plan --json`. `exists` is false for a backlog with no `plan.yaml`, and then
  // every other key carries its empty value — the execution order is optional,
  // so its absence is an answer and not an error to be told apart from one.
  // `unplanned` and `stale` are lists rather than counts on purpose: a plan rots
  // by accumulating work nobody scheduled, and a number cannot be acted on.
  plan: {
    root: null, exists: null, updated: null, rationale: null, waves: [],
    activeWave: null, nextUp: [], inProgress: [], unplanned: [], coverage: null, stale: [],
    inProgressStatus: null,
  },
  // ── The WRITING commands (TL-119) ──────────────────────────────────────
  //
  // A REFUSAL IS THE SAME KIND WITH `ok: false`, NOT A KIND OF ITS OWN. The
  // decision matters because `kind` is what a consumer switches on to know the
  // payload's shape, and it answers "which question was asked", never "did the
  // answer come out yes". A `refusal` kind would force every consumer into two
  // branches per command and would make `kind` stop identifying the command at
  // all — and the discriminator it would duplicate, `ok`, is already here.
  //
  // The refusal's own word for what went wrong is `refusalKind` and not `kind`:
  // `kind` belongs to the envelope, and a payload may not carry it.
  //
  // `take` and `next` share ONE kind, because they answer the same question and
  // return the same task. `next` fills in the keys that say how it CHOSE — what
  // it passed over and why, what it never considered — and for `take` those come
  // back empty, which is the emptiness rule doing its job rather than two kinds
  // doing it by hand.
  "task-take": {
    ok: null, taken: null, id: null, file: null, task: null, text: null,
    // Every question this task was asked, with its answer when it has one
    // (TL-270). `text` carries the same as a rendered block; this is the list.
    decisions: [],
    // The contract's live state at the handover, when `--probe` asked (TL-268).
    probe: null,
    // The status the take moved the task out of (TL-184). `task` is the state
    // after the write, so a caller that has to give a claim back — `run` when
    // its agent never started — has nowhere else to read it.
    from: null,
    warnings: [], reclaimed: null, lock: null,
    refusalKind: null, refusal: null, details: [],
    // `next` only, and the reason each is here rather than in prose on stderr:
    // a loop must be able to tell an empty queue from a queue it was not allowed
    // to draw from, and it cannot parse a sentence to do it.
    passedOver: [], considered: null, searchedStatuses: [], skippedBlocked: null,
    skippedElsewhere: [], closedElsewhere: [], skippedExecutor: [], skippedHandedBack: [], scan: null,
    // Open work an unattended run may not be handed for its SIZE (TL-211).
    // Declared for the kind, so it is present and empty when the project
    // stated no threshold: a consumer must not have to tell "no value" from
    // "a version that did not know the key".
    skippedSize: [],
    // Candidates this actor's RECORD withheld from them (TL-150), each with the
    // sentence that says why. Declared for the kind, so it is present and empty
    // where no project declared an `actor_policy_*`: a loop must be able to tell
    // an empty queue from a queue it was not allowed to draw from.
    skippedByRecord: [],
    // `--plan` only (TL-183): which wave was followed, and how many open tasks
    // were left alone because the plan does not schedule them. `null` when the
    // flag was not given — a wave number of 0 would say a plan was consulted.
    plan: null,
  },
  // `handoff --json` (TL-99). Three from/to pairs and the comment that carries
  // the reason: a handoff is not a task being performed, it is a task changing
  // hands, and a consumer wants both ends of every field that moved.
  "task-handoff": {
    ok: null, id: null, file: null, task: null,
    role: null, owner: null, status: null, comment: null, released: null,
    warnings: [],
    refusalKind: null, refusal: null, details: [],
  },
  "task-release": {
    ok: null, id: null, status: null, owner: null, released: null, comment: null,
    refusalKind: null, refusal: null, details: [],
  },
  // `ask --json` (TL-148). The question's EVENT ID is the payload that matters:
  // it is what a later `decide --resolves` has to name, and the reason the task
  // now carries names it too — so a consumer never has to parse a sentence.
  "task-ask": {
    ok: null, id: null, file: null, question: null, changes: [], blockedReason: null,
    refusalKind: null, refusal: null, details: [],
  },
  // `resume --json` (TL-151). The five parts are declared in the ORDER the
  // briefing fixes them, because the order IS the product: a consumer rendering
  // it would otherwise have to re-derive a sequence this tool already knows.
  // `verified` is what keeps an empty `verification` readable — under
  // `--no-verify` nothing ran, and "the contract was not re-run" must never be
  // mistaken for "the contract holds no entries".
  resume: {
    ok: null, id: null, file: null, actor: null, owner: null,
    base: null, mergeBase: null, verified: null,
    decisions: [], goal: null, history: [], diff: null, verification: [],
    refusalKind: null, refusal: null, details: [],
  },
  // `done --json`. `entries` carries one row per `verification:` entry with its
  // exit code — the evidence, which is the whole point of the command. `ticked`
  // is the criteria the run granted; `closed` says whether the file actually
  // moved, which `--dry-run` makes a different answer from `ok`.
  "verification-run": {
    ok: null, task: null, dryRun: null, closed: null, entries: [],
    status: null, wouldBe: null, ticked: [],
    refusalKind: null, refusal: null, details: [],
  },
  // `docs-drift --json` (TL-100). `flagged` and `tooLittle` are both LISTS of
  // documents carrying their SIGNALS, never counts: the whole rule this command
  // is built on is that a verdict with no evidence is not acted on, and a
  // consumer handed a number would be handed exactly that verdict. `seeded` is
  // absent unless `--seed-tasks` ran — an empty object would say a write
  // happened and found nothing to do.
  "docs-drift": { documents: null, minSignals: null, flagged: [], tooLittle: [], seeded: null },
  // `red --json` (TL-276). `ran` is what keeps an empty `files` readable: a
  // report nobody gave and a suite with nothing failing are the same empty list
  // and call for opposite decisions, and `reason` says which — including the
  // case where git could not be read, and every row is therefore unattributed
  // for a reason that is not "nobody owns it". `tally` is a convenience over
  // `files`, never a replacement: the whole point of the command is that a
  // count cannot be acted on and a filename can.
  "red-owners": {
    command: null, ran: null, reason: null, exitCode: null, files: [], mine: null, tally: null,
  },
  // `log --json` (TL-256). `records` is the number of RAW entries the log holds
  // and `total` the number of EXCHANGES they fold into; both are here because
  // the ratio between them IS the answer to "was this worth folding", and a
  // consumer counting the rows it was handed could not recover `records` at
  // all. `total` is also what keeps `--limit` readable — the list is then a
  // slice, and a slice that reads like a complete answer is the defect
  // `task-list` carries its own `total` for. `path` names the log this came
  // from, so a reader who does want the raw file is told where it is instead of
  // guessing the layout.
  "task-log": {
    ok: null, id: null, title: null, file: null, path: null,
    records: null, total: null, limit: null, exchanges: [],
    refusalKind: null, refusal: null, details: [],
  },
};

/**
 * WHERE A KIND IS REGISTERED (TL-285).
 *
 * A kind is not proved by being declared. The suite runs one invocation per
 * kind against two fixtures — an empty backlog and a populated one — and a kind
 * with no invocation to run is the whole gap between the envelope's contract and
 * a typo that ships. That rule stays. What moved is WHERE the invocation is
 * written down.
 *
 * It used to live in two tables inside `scripts/tests/json-envelope.test.mjs`,
 * which made every new `--json` command an edit under `scripts/tests/` — a
 * directory a hand allowed to write production code is deliberately kept out
 * of, so that it cannot weaken the proof. Naming the invocation is not a
 * weakening, it is a REGISTRATION, and registration belongs beside the thing
 * being registered. The declaration of a kind and the proof that something
 * exercises it are now one edit in one file.
 *
 * SO: A NEW COMMAND ANSWERING `--json` ADDS TWO ROWS HERE — its keys to `KINDS`
 * and the invocation that exercises it to `KIND_EXERCISE` — plus its row in the
 * `--json` contract table of `docs/manual.md`. Nothing under `scripts/tests/`.
 *
 * The cost accepted: this table ships in the tarball although only the suite
 * reads it. It is data about the tool — the canonical call behind each kind —
 * rather than data about the test, and it is worth less in a file the author of
 * an emitter cannot reach.
 *
 * Each row: `{ args, noDir?, refuses?, writes?, input? }`.
 *   - `args`   the command line, WITHOUT `--dir`, which the harness appends
 *   - `noDir`  the command answers about the machine, not about a backlog, so
 *              no project directory is given
 *   - `refuses` a non-zero exit is the point of the row — a refusal is an
 *              envelope too, and it is the path most easily left without one
 *   - `writes` the row CHANGES the tree, so it needs a fixture of its own:
 *              asked twice of one backlog, the second answer would be about
 *              what the first call wrote
 *   - `input`  stdin for a command that takes a callable input
 *
 * IDS ARE NAMED BY SENTINEL, NEVER TYPED (TL-273). A row that types an id has to
 * guess the prefix the fixture was built with, and an id from the wrong
 * vocabulary is not a failure but a "no such task" refusal in a complete
 * envelope — every shape assertion passes while the row measures the path its
 * own comment says it avoids. The fixture resolves these two.
 */
/** The first task the fixture really created; on an empty fixture, the absent id. */
export const FIRST_TASK = "<first-task>";
/** An id the fixture deliberately does NOT have — the refusal rows' subject. */
export const ABSENT_TASK = "<absent-task>";

export const KIND_EXERCISE = {
  "task-list": { args: ["query", "--json"] },
  stats: { args: ["stats", "--json"] },
  doctor: { args: ["doctor", "--json"] },
  // The guards, as one document (TL-57). A NARROW selector on purpose: the
  // default run reads this installation's whole source, which is a second of
  // wall clock per fixture and answers nothing the envelope suite asks.
  check: { args: ["check", "--json", "--refs"] },
  board: { args: ["board", "--json", "--paths", "docs/guide.md"] },
  "next-id": { args: ["next-id", "--json"] },
  // A topic is named on purpose: without one the payload carries the listing and
  // no `text`, and the key that matters most would go unexercised.
  instructions: { args: ["instructions", "overview", "--json"] },
  // Profiles are machine-local user data, not a question about the fixture
  // backlog. The generic harness normally appends `--dir`; this one must prove
  // the opposite boundary and therefore runs with no project directory.
  "agent-profiles": { args: ["profile", "list", "--json"], noDir: true },
  // Profile checks read only the isolated user configuration, never the fixture
  // backlog. The empty answer is still an envelope a setup tool can consume.
  "profile-check": { args: ["profile", "check", "--json"], noDir: true },
  // Conformance creates its own disposable repository. Giving it a Node
  // executable makes the adapter response malformed on purpose, which proves
  // the JSON refusal shape without needing a provider or fixture wrapper.
  "adapter-conformance": { args: ["conformance", "--adapter", process.execPath, "--json"], noDir: true, refuses: true },
  // The fixtures carry no `plan.yaml`, so this exercises the answer a backlog
  // without an execution order gives — which is the one that has to stay a
  // complete envelope rather than an error.
  plan: { args: ["plan", "--json"] },
  // The input surface of ONE command, for a program to read before it calls it
  // (TL-83). `new` is the one whose flags draw on the most vocabularies, so a
  // fixture answering it exercises the part that varies per project.
  "command-help": { args: ["new", "--help", "--json"] },
  // The fixtures are not git repositories, so this exercises the answer a
  // command with no range to read gives (TL-89) — which has to stay a complete
  // envelope saying `scanned: false`, not an error and not an empty list.
  "pr-summary": { args: ["pr-summary", "--json"] },
  // A backlog with no history at all (TL-90): every detector has nothing to
  // find, and the envelope still has to carry every key rather than dropping
  // the sections that came back empty.
  audit: { args: ["audit", "--json"] },
  // A repository with no `docs/` at all (TL-100): zero documents still has to be
  // a complete envelope. `flagged` and `tooLittle` come back as empty LISTS, and
  // `seeded` as null — the command wrote nothing, which is a different answer
  // from having written nothing useful.
  "docs-drift": { args: ["docs-drift", "--json"] },
  // `red` with no report is a complete answer, not a usage error (TL-276): an
  // empty `files` means "nothing failed in what I was shown", and `ran` with
  // `reason` is what tells a consumer whether it was shown anything at all. No
  // `--command` is given, so no suite runs inside the suite.
  "red-owners": { args: ["red", "--json"] },
  // A task's own log, read back (TL-256). It writes nothing, so one fixture
  // answers it twice over: on the populated fixture the task EXISTS and the row
  // exercises a real fold, and on the empty one the same call is the "no such
  // task" refusal — each a complete envelope, and neither a usage error. The id
  // is the sentinel, never typed.
  "task-log": { args: ["log", FIRST_TASK, "--json"] },
  // `resume` composes reads and writes nothing (TL-151), so it is NOT a
  // `writes` row: asking it twice of one tree is safe, and
  // `scripts/tests/resume-briefing.test.mjs` proves the tree is byte-identical
  // afterwards. The id EXISTS on the populated fixture and not on the empty
  // one, so the row exercises a briefing on one and the "no such task" refusal
  // on the other — each a complete envelope, and neither a usage error.
  // `--no-verify` because this row asks about the ENVELOPE. Left out, it would
  // run the fixture task's `verification:` command, and the shape of the answer
  // would start depending on the observer's shell.
  resume: { args: ["resume", FIRST_TASK, "--actor", "agent:test", "--no-verify", "--json"] },
  run: { args: ["run", "--dry-run", "--json"] },
  // ── The rows that WRITE (TL-119) ─────────────────────────────────────────
  //
  // `take` and `next` share ONE kind, because they answer the same question.
  // The registry names it once and exercises it with `next`; the refusal case
  // in the suite covers `take`.
  "task-take": { args: ["next", "--actor", "agent:test", "--json"], writes: true },
  // A handoff of a task nobody holds: a REFUSAL, and refusals are the path most
  // easily left without an envelope. `--reason` is required before the refusal
  // is even reached, so it is given.
  "task-handoff": {
    args: ["handoff", ABSENT_TASK, "--to-owner", "unassigned", "--reason", "a fixture", "--actor", "agent:test", "--json"],
    refuses: true, writes: true,
  },
  "task-release": {
    args: ["release", ABSENT_TASK, "--actor", "agent:test", "--reason", "a fixture", "--json"],
    refuses: true, writes: true,
  },
  // A task that is not there: same reason as above — the refusal path.
  "verification-run": { args: ["done", ABSENT_TASK, "--json"], refuses: true, writes: true },
  // A question about a task that is not there (TL-148): the refusal path again,
  // and `--question` is required before the refusal is reached, so it is given.
  "task-ask": {
    args: ["ask", ABSENT_TASK, "--question", "which of the two?", "--actor", "agent:test", "--json"],
    refuses: true, writes: true,
  },
  seed: {
    args: ["seed", "--json"],
    writes: true,
    input: JSON.stringify({
      tasks: [{
        plan_id: "first", title: "A seeded task", goal: "Something is true afterwards.",
        verification: [{ id: "it-runs", bash: "true", proves: "The check runs." }],
      }],
    }),
  },
};

/**
 * The kinds nothing exercises, and the rows naming a kind that does not exist.
 * PURE, so the suite can run it against a deliberately broken pair and prove the
 * check really detects the gap rather than reporting an empty list.
 *
 * @param {object} kinds  a KINDS-shaped map
 * @param {object} exercise  a KIND_EXERCISE-shaped map
 */
export function registrationGaps(kinds = KINDS, exercise = KIND_EXERCISE) {
  const gaps = [];
  for (const kind of Object.keys(kinds)) {
    if (!exercise[kind]) gaps.push("the kind `" + kind + "` is declared but nothing exercises it");
  }
  for (const kind of Object.keys(exercise)) {
    if (!kinds[kind]) gaps.push("`" + kind + "` is exercised but is not a declared kind");
    else if (!Array.isArray(exercise[kind].args) || !exercise[kind].args.length) {
      gaps.push("the kind `" + kind + "` is registered with no command line");
    }
  }
  return gaps;
}

/** The envelope's own keys — a payload may never carry them. */
const RESERVED = ["schemaVersion", "kind"];

/**
 * Build the answer for one kind.
 *
 * Both refusals are programmer errors and throw rather than print: an unknown
 * kind or an unknown key means the contract and the code have parted company,
 * and a machine-readable answer that quietly invents a field is worse than none.
 *
 * @param {string} kind  a key of KINDS
 * @param {object} payload  the declared keys; anything missing takes its empty value
 */
export function envelope(kind, payload) {
  const shape = KINDS[kind];
  if (!shape) {
    throw new Error("unknown JSON kind: " + kind + " (declare it in json-envelope.mjs; known: " + Object.keys(KINDS).join(", ") + ")");
  }
  const given = payload || {};
  for (const key of Object.keys(given)) {
    if (RESERVED.indexOf(key) !== -1) {
      throw new Error("`" + key + "` belongs to the envelope and cannot be a payload key of " + kind);
    }
    if (!(key in shape)) {
      throw new Error("unknown key `" + key + "` for kind " + kind + " (declared: " + Object.keys(shape).join(", ") + ")");
    }
  }
  const out = { schemaVersion: SCHEMA_VERSION, kind };
  for (const key of Object.keys(shape)) {
    const value = given[key];
    // `undefined` is the same as absent — JSON.stringify would DROP the key, and
    // a dropped key is the one thing the contract promises never to do.
    out[key] = value === undefined ? shape[key] : value;
  }
  return out;
}

/** Print one answer on stdout. No colour, no ornament: this is for a program. */
export function printJson(kind, payload) {
  // SYNCHRONOUSLY (TL-175), not `console.log`. Every caller exits on the next
  // line, and on a pipe `process.exit` does not wait for stdout to drain — so a
  // payload above one pipe buffer arrived truncated, and the consumer saw a
  // parse error instead of an answer. One line here rather than an audit of
  // every `process.exit()` in the tool.
  printLine(JSON.stringify(envelope(kind, payload), null, 2));
}
