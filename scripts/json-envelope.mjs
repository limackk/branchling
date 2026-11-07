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
  // `deploy` is `null` unless deployment state was computed (TL-501), and then
  // names the trunk and every ref read, with its SHA, so the answer can be dated.
  // `scope` (TL-540) is `active`, `archived` or `all` — which tasks were
  // searched — and null when `--status` chose the statuses itself.
  // A filter value outside the project's vocabulary (TL-559) is `ok: false`
  // with `refusalKind: "unknown-value"`, `rejected` `{ field, value }` and
  // `declared`, the values that field accepts — the shape `set` refuses with
  // since TL-543. `details` names every rejected value when more than one was.
  // A query that answered carries `ok: true`.
  "task-list": {
    ok: null, tasks: [], total: null, limit: null, scope: null, scan: null, modifiedFile: null, deploy: null, elsewhereOnly: [],
    refusalKind: null, refusal: null, details: [], rejected: null, declared: [],
  },
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
    // Open tasks the dispatcher refused after `handedBackAcross` found both
    // directions over one role boundary (TL-417). The full finding travels so
    // a consumer gets the pair and both hands' reasons without parsing prose.
    skippedDeadlocked: [],
    // The conflict-group skips of the run's LAST `next` answer (TL-492), under
    // the name `next --json` gives them. The last, not every one: a group is
    // held only while its task is in progress, so an earlier skip may since
    // have been handed out by this very run.
    skippedConflict: [],
    // `{id, role, eligible}` when the spin guard ended the run (TL-484): the
    // stop is a fact about one task, and `eligible` counts the OTHER tasks the
    // dispatcher would still hand out, so it never reads as an empty queue.
    spinGuard: null,
    // `{requestedAt, by, after}` when `run --stop` ended the run (TL-485).
    stopRequested: null,
    // `{command, exit, timedOut, output}` when `--before-next` refused before
    // a claim (TL-489).
    beforeNextRefused: null,
    // `{id, message}` when `--commit-state` ended the run; `id` is null when
    // it refused to claim over paths somebody else staged (TL-489).
    stateCommitRefused: null,
    // `{count, ids}` of the tasks another tree of this clone holds open, read
    // from the last "nothing to take" answer (TL-491).
    heldInOtherTrees: null,
    // `{polls, seconds, gaveUp}` under `--wait` (TL-491).
    waited: null,
    // Which rung named the run's actor (TL-550): `flag`, `env`, `config`,
    // `profile` — the identity of the one local profile the run starts, or
    // `agent:fleet` for several — or `default`. Every task the run claims is
    // claimed under that actor with an explicit `--actor`, so the claim's own
    // `actorSource` always says `flag`; this is the only place the real rung
    // is visible.
    actorSource: null,
  },
  // `run --stop --json` (TL-485): the request as written, and where. `origin`
  // is the clone it reaches — every run of it, from any of its worktrees.
  "run-stop": { ok: null, requestedAt: null, by: null, origin: null, path: null },
  // `advisories` are the findings `check` stopped reporting when it became a
  // release gate (TL-383): each `{ name, output }`, where `name` is the same
  // registry string `check --json` puts in `failed` and `output` is text written
  // for a person.
  audit: {
    since: null, dayZero: null, tasks: null, findings: null,
    closedWithoutTrace: [], skippedBeforeSince: null, reopened: [],
    parked: [], withoutPremise: [], awaitingVouch: [], handedBack: [], vouches: [],
    contractCapability: null,
    advisories: [],
  },
  // `stats --json`. The tallies stay nested under `stats` instead of being
  // spread across the root: a future tally called `kind` would otherwise
  // overwrite the envelope's own key and nobody would notice until a consumer
  // broke.
  // `divergent` is the list behind the `divergent` tally inside `stats`: the
  // tasks another branch disagrees with, each naming both statuses (TL-73).
  // `agentTime` is `stats --agent-time` (TL-480): the per-estimate buckets
  // computed from the ledger, with their verdict and what could not be measured.
  stats: { root: null, stats: null, scan: null, divergent: [], elsewhereOnly: [], context: null, agentTime: null },
  // `check --json` (TL-57). `ok` is what CI reads, `failed` is what it acts on —
  // a consumer must not have to filter `guards` to learn which one to look at.
  // `output` beside each guard is text written for a PERSON and may be reworded;
  // `name`, `ok`, `exit` and `severity` are the contract. `severity` says what a
  // guard was allowed to do to `ok` — a consumer that treats an advisory finding
  // as a release blocker is the failure mode TL-383 removed from the terminal,
  // and it must not be reintroduced through the JSON.
  check: { ok: null, root: null, failed: [], guards: [] },
  // `follow --json` (TL-524): ONE envelope per line, a stream rather than an
  // answer. `event` says which keys carry a value: `ready` (the watch is armed;
  // changes after this line are reported), `change` (`id`, `file`, `change` —
  // created / modified / deleted — and the `fields` that moved, `__body__` for
  // the markdown body), `heartbeat` (nothing changed; the stream is alive).
  // `root` is on every line so a consumer reading several streams knows which
  // backlog each came from.
  "change-stream": { event: null, at: null, root: null, id: null, file: null, change: null, fields: [] },
  // `doctor --json`. `ok` is the answer CI reads; `checks` is why.
  doctor: { ok: null, root: null, next: null, checks: [] },
  // `template refresh --json` (TL-595). `added` lists each inserted field with
  // its comment, the key it follows (null: at the end of the frontmatter) and
  // its lines; `changed` says whether the file was, or under `dryRun` would be,
  // written. `path` and `shipped` name the two templates compared.
  "template-refresh": { ok: null, path: null, shipped: null, dryRun: null, changed: null, added: [] },
  // `serve --list --json` and `serve --stop --json` (TL-266). Each entry in
  // `servers` carries its own `state`, and that word is the whole point: a
  // register cannot know that a process SIGKILLed behind its back is gone until
  // somebody reads it, so `stale` has to be a value a consumer receives rather
  // than an entry quietly missing from the list. `stateDir` and `host` are the
  // two facts that say WHOSE register was read — a consumer comparing two
  // machines' answers has no other way to tell them apart.
  "serve-list": { servers: [], stateDir: null, host: null },
  // `stopped` is one result per port asked about, each naming an `outcome`:
  // `stopped`, `already-gone`, `not-registered`, `not-ours`, `elsewhere` or
  // `would-not-stop`. A boolean here would merge "it is gone" with "it was
  // never there" and with "I refused to kill a stranger's process", which are
  // three different things to do next.
  "serve-stop": { stopped: [], requested: null },
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
  // `actorSource` (TL-550) on seed, import, new, deploy record and run: which
  // rung of the actor chain named the actor the write was recorded under —
  // `flag`, `env`, `config` or `default`, as for the kinds TL-544 covered. It
  // is null where the actor was never resolved: a refusal before it, or a
  // refusal of the invocation itself.
  seed: { ok: null, root: null, dryRun: null, created: [], errors: [], actorSource: null },
  // `import --json`. A dry run reports `wouldCreate`; a real import reports
  // `created` and `withoutVerification`. Both paths share one kind, so the
  // other path's keys stay present with their declared empty values. Each
  // `created` entry carries `id`, `file`, `title`, `source` and `sourceState`
  // (TL-580), the issue's own `open` or `closed`, which says what is still to
  // retire in GitHub; entry shapes are documented, not declared here.
  import: {
    ok: null, root: null, dryRun: null, created: [], wouldCreate: [],
    skipped: [], droppedLabels: [], withoutVerification: null, errors: [], actorSource: null,
  },
  // `new --json` (TL-550). `idSource` is where the number came from — `repo`,
  // a scan of every branch and worktree, or `local`, this directory alone, the
  // known risk the text output says out loud. `wave` is null unless `--wave`
  // scheduled the task. EVERY refusal answers in this kind with `ok: false`
  // (TL-568): `refusalKind` is `usage`, `invalid-document`, `invalid-config`,
  // `prefix-mismatch`, `template-drift`, `plan-refused`, `id-taken` or the
  // shared `no-backlog` (TL-548), `refusal` the sentence and `details` the
  // findings and remedies. Only `plan-refused` after the write carries `id`
  // and `file`: the task exists, and the plan did not take it.
  "task-new": {
    ok: null, id: null, file: null, board: null, wave: null, idSource: null, actorSource: null,
    refusalKind: null, refusal: null, details: [],
  },
  // `plan --json`. `exists` is false for a backlog with no `plan.yaml`, and then
  // every other key carries its empty value — the execution order is optional,
  // so its absence is an answer and not an error to be told apart from one.
  // `unplanned` and `stale` are lists rather than counts on purpose: a plan rots
  // by accumulating work nobody scheduled, and a number cannot be acted on.
  // A plan that cannot be read or executed is `ok: false` (TL-534) with
  // `refusalKind` `plan-unparsable` or `plan-contradicts-blocked-by` (or
  // `plan-contradicts-tree` for an unknown, duplicated or misgrouped id) and
  // every problem in `problems`. Each wave task is `{ id, title, status,
  // blocked_by, known, open, executor }`, closed tasks included.
  plan: {
    ok: null, root: null, exists: null, updated: null, rationale: null, waves: [],
    activeWave: null, nextUp: [], inProgress: [], unplanned: [], coverage: null, stale: [],
    inProgressStatus: null,
    refusalKind: null, refusal: null, problems: [],
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
    warnings: [], reclaimed: null,
    // The claims a deliberate takeover crossed, as `{actor, crossed}` rows
    // (TL-284) — empty when it crossed none. A loop that takes work over has to
    // report whose reservation it took without parsing a warning.
    tookOver: [],
    lock: null,
    // Which source named the actor (TL-544), as `task-decide` reports it: flag,
    // env, config or default. `--require-actor` on `take` refuses the default
    // as `refusalKind: "actor-required"`.
    actorSource: null,
    refusalKind: null, refusal: null, details: [],
    // `next` only, and the reason each is here rather than in prose on stderr:
    // a loop must be able to tell an empty queue from a queue it was not allowed
    // to draw from, and it cannot parse a sentence to do it.
    passedOver: [], considered: null, searchedStatuses: [], skippedBlocked: null,
    skippedElsewhere: [], closedElsewhere: [], skippedExecutor: [], skippedHandedBack: [],
    // The audit finding reused as a queue gate (TL-417), including its role
    // pair and handoff legs. Empty is materially different from an older shape
    // that could silently hand the task out again.
    skippedDeadlocked: [], scan: null,
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
    // Candidates held back because a task of the same conflict group is in
    // progress here or in another tree (TL-492), each `{id, group, heldBy}`.
    skippedConflict: [],
    // `--plan` only (TL-183): which wave was followed, and how many open tasks
    // were left alone because the plan does not schedule them. `null` when the
    // flag was not given — a wave number of 0 would say a plan was consulted.
    plan: null,
  },
  // Every writing kind below carries `actorSource` (TL-544): which rung of the
  // actor chain named the actor — `flag`, `env`, `config` or `default` — and
  // null on a refusal given before the actor was resolved. Where a person's act
  // is recorded (`take`, `handoff`, `release`, `set`, `body`, `decide`),
  // `--require-actor` refuses the default as `refusalKind: "actor-required"`.
  // `handoff --json` (TL-99). Three from/to pairs and the comment that carries
  // the reason: a handoff is not a task being performed, it is a task changing
  // hands, and a consumer wants both ends of every field that moved.
  // A `--to-role` outside `roles:` (TL-559) is `refusalKind: "unknown-value"`
  // with `rejected` `{ field: "role", value }` and `declared`, the roles this
  // backlog declares — `[]` when it declares none.
  "task-handoff": {
    ok: null, id: null, file: null, task: null,
    role: null, owner: null, status: null, comment: null, released: null,
    warnings: [], actorSource: null,
    refusalKind: null, refusal: null, details: [], rejected: null, declared: [],
  },
  // `body --json` (TL-523). `body` is the pair of base-version hashes, so a
  // caller can pass `body.to` as the next write's `--base`.
  "task-body": {
    ok: null, id: null, file: null, changed: null, body: null, lines: null, entry: null, actorSource: null,
    refusalKind: null, refusal: null, details: [],
  },
  "task-release": {
    ok: null, id: null, status: null, owner: null, released: null, comment: null, actorSource: null,
    refusalKind: null, refusal: null, details: [],
  },
  // `set --json` (TL-521). `changes` are the history entries the write
  // appended, so a consumer reads the attribution without opening the log; an
  // unchanged value appends none beyond `updated`.
  // A value outside the field's vocabulary is `refusalKind: "unknown-value"`
  // (TL-543) with `rejected` `{ field, value }` and `declared`, the values the
  // field accepts; `usage` stays for an unknown field or a malformed value.
  "task-set": {
    ok: null, id: null, file: null, field: null, value: null, actor: null, actorSource: null, changes: [],
    refusalKind: null, refusal: null, details: [], rejected: null, declared: [],
  },
  // `set --fields --json` (TL-543): the fields `set` edits, each with whether
  // it is a list, whether it may be cleared, the config.yaml key its value must
  // come from (`vocabulary`, as `vocabulary --json` names it), the key its
  // values are only suggested from, and a vocabulary the tool fixes itself.
  "task-set-fields": { root: null, fields: [] },
  // `deploy status --json` (TL-502). `trunk` names the ref whose commits count
  // and where that choice came from; `scan` every ref read with its SHA, so the
  // answer can be dated; `explanation` why an empty answer is empty. Each
  // target carries its buckets in pipeline order, a bucket whose stage could
  // not be read is `unknown` rather than zero, and `listed: false` marks the
  // last stage, which is counted and never listed. `release` is the planned
  // scope of `--release <name>` (TL-505), null without the flag. `records`
  // names who recorded each recorded stage, when and why (TL-506).
  // A `--release`, `--target` or `--env` naming nothing declared (TL-533) is
  // `ok: false` with `refusalKind: "unknown-name"`, `rejected` the flag and the
  // value, and `declared` what the flag accepts — empty when nothing is.
  "release-status": {
    ok: null, trunk: null, scan: null, explanation: null, filter: null, targets: [], unplaced: null, release: null, records: [],
    refusalKind: null, refusal: null, rejected: null, declared: [],
  },
  // `deploy record --json` (TL-506). `tag` is the annotated tag object the
  // ref now points at; `previous` the commit it stood at before, null on the
  // first record; `direction` one of first, unchanged, forward, backward,
  // diverged. `push` is the command that shares the record — it is printed,
  // never run — and `fetchFix` the refspec other clones need, null when the
  // remote already fetches the ref.
  "release-record": {
    ok: null, target: null, stage: null, ref: null, commit: null, tag: null, previous: null, direction: null,
    actor: null, reason: null, recordedAt: null, remote: null, push: null, fetchFix: null, actorSource: null,
    refusalKind: null, refusal: null, details: [],
  },
  // `declare --json` (TL-522): the entry appended to `releases:` or
  // `deploy_targets:`, or the refusal. `refusalKind` names which refusal —
  // `undeclared-key` for a key no command writes, `duplicate`, `malformed`,
  // `form` for a list written in a shape the writer does not edit — so a
  // consumer branches on a word rather than parsing the sentence.
  // `requiresVersion` (TL-586) is `{from, to}` when the write raised the
  // file's floor, null when the floor stayed as it was.
  "vocabulary-declare": {
    ok: null, key: null, name: null, entry: null, reason: null, file: null, requiresVersion: null,
    refusalKind: null, refusal: null, details: [],
  },
  // `ask --json` (TL-148). The question's EVENT ID is the payload that matters:
  // it is what a later `decide --resolves` has to name, and the reason the task
  // now carries names it too — so a consumer never has to parse a sentence.
  "task-ask": {
    ok: null, id: null, file: null, question: null, changes: [], blockedReason: null, actorSource: null,
    refusalKind: null, refusal: null, details: [],
  },
  // `decide --json` (TL-528) — the other half of `task-ask`. Until TL-528 it
  // printed a bare object whose refusal carried the refusal's name under
  // `kind` and its sentence under `message`; inside the envelope `kind` is
  // the envelope's, so the refusal moved to `refusalKind` and `refusal`, the
  // names every other writing kind already uses. `chosen` is null when the
  // answer was typed, `lifted` null when nothing was blocked on it.
  // `actorSource` (TL-537) says which rung named the actor: `flag`, `env`,
  // `config` (the user configuration's `actor:`) or `default` — the agent
  // fallback nobody stated.
  "task-decide": {
    ok: null, id: null, decision: null, chosen: null, openQuestions: [], lifted: null, actorSource: null,
    refusalKind: null, refusal: null, details: [],
  },
  // `vocabulary --json` (TL-532): what config.yaml declares, in declared order.
  // Every key is named after the config.yaml key it comes from — `set --fields
  // --json` names those keys, and a consumer reads this envelope at them. Each
  // status carries its `role` and the `roleSource` that gave it, so a role the
  // tool derived is never mistaken for one the project declared.
  vocabulary: {
    root: null, statuses: [], priorities: [], types: [], confidence: [], estimates: [],
    labels: [], labels_closed: null, boards: [], roles: [], releases: [], deploy_targets: [],
  },
  // `where --json` (TL-34, in the envelope since TL-528). `backlog` is null
  // and `error` says why when no backlog was found — outside a repository that
  // is an answer, not a failure, so the keys stay rather than the answer
  // turning into a refusal.
  where: {
    home: null, homeSource: null, config: null, data: null,
    preferences: null, agentProfiles: null, backlog: null, error: null,
  },
  // `resume --json` (TL-151). The parts are declared in the ORDER the
  // briefing fixes them, because the order IS the product: a consumer rendering
  // it would otherwise have to re-derive a sequence this tool already knows.
  // `verified` is what keeps an empty `verification` readable — under
  // `--no-verify` nothing ran, and "the contract was not re-run" must never be
  // mistaken for "the contract holds no entries".
  // `uncommitted` is the SECOND half of the branch's work (TL-272): what the
  // killed session left on disk and in no commit. It is a key of its own rather
  // than lines appended to `diff`, because a consumer that could not tell a
  // committed hunk from an uncommitted one would be wrong in the expensive
  // direction — a `git checkout` destroys one and not the other.
  resume: {
    ok: null, id: null, file: null, actor: null, owner: null,
    base: null, mergeBase: null, verified: null,
    decisions: [], goal: null, history: [], diff: null, uncommitted: null, verification: [],
    refusalKind: null, refusal: null, details: [],
  },
  // `done --json`. `entries` carries one row per `verification:` entry with its
  // exit code — the evidence, which is the whole point of the command. `ticked`
  // is the criteria the run granted; `closed` says whether the file actually
  // moved, which `--dry-run` makes a different answer from `ok`.
  "verification-run": {
    ok: null, task: null, dryRun: null, closed: null, entries: [],
    status: null, wouldBe: null, ticked: [], capability: null, actorSource: null,
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
    // Null means the caller kept the cheap, current-tree answer. When present,
    // this says whether the explicitly requested sibling-branch repair scan
    // actually ran; an empty repairs list without it would conflate "none"
    // with "could not look".
    repairScan: null,
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
  // `decisions` and `matched` say WHICH question was asked and how much of the
  // log answered it (TL-396): `total` is every exchange, `matched` the ones the
  // filter kept, and without both a consumer cannot tell a filtered answer from
  // a short log.
  // `show --json` (TL-509): what is COMPUTED about one task, never its body.
  // `deploy` is `null` when the project declares no `deploy_targets` — nobody
  // computed it, which is not "deployed nowhere" — and otherwise names the
  // trunk and every ref read with its SHA beside the task's own answer per
  // target and stage. `scan` keeps an empty `elsewhere` readable, as it does in
  // `task-list`. `blocked` is the verdict over `blockers`, by the rule `next`
  // dispatches on, so a consumer does not re-derive which statuses count.
  "task-show": {
    ok: null, id: null, title: null, status: null, priority: null, confidence: null, blocks: [], file: null,
    deploy: null, elsewhere: [], scan: null, blockers: [], blocked: null,
    // The markdown after the frontmatter, verbatim, under `--body` (TL-542);
    // null without the flag — the key stays, as every declared key does.
    body: null,
    // The task's own `verification:` entries (TL-561), each `{ id, bash,
    // manual, criteria }` — `bash` or `manual` null when the entry has the
    // other, `criteria` the acceptance criteria naming it by `[proof: <id>]`
    // — and what the parser could not read, so a contract `done` would refuse
    // does not read like one it would run.
    verification: [], verificationProblems: [],
    refusalKind: null, refusal: null, details: [],
  },
  // `log --open-questions --json` (TL-536): every unanswered question on an
  // active task, oldest first, each with what a person needs to answer it —
  // the question, who asked and when, the options and the recommendation —
  // and the `event` id `decide --resolves` takes.
  "open-questions": { root: null, total: null, questions: [] },
  "task-log": {
    ok: null, id: null, title: null, file: null, path: null,
    records: null, total: null, matched: null, decisions: null, limit: null, exchanges: [],
    modifiedFile: null, tasks: [],
    refusalKind: null, refusal: null, details: [],
  },
  // `log <ID> --records --json` (TL-562): the ledger unfolded — every record in
  // recorded order with every key it carries, so a program reading a closing's
  // `reason`, its `contractCapability`, a vouch or a refusal never parses
  // `history/<ID>.jsonl` itself. `total` is the ledger's size BEFORE `--limit`,
  // and `omitted` how many older records the slice left out.
  "task-ledger": {
    ok: null, id: null, title: null, file: null, path: null,
    total: null, limit: null, omitted: null, records: [],
    refusalKind: null, refusal: null, details: [],
  },
};

/**
 * The keys of a refusal, carried by EVERY kind (TL-548).
 *
 * A reading command used to have one shape, its success, and so nowhere to say
 * "there is no backlog here": it printed the refusal on stderr and left stdout
 * empty, which a consumer cannot tell from a crash. A refusal is the same kind
 * with `ok: false` — the rule the writing commands already follow — so the four
 * keys are declared once and merged into every kind that does not declare them
 * itself, rather than copied into every row, where one would be forgotten.
 */
export const REFUSAL_KEYS = Object.freeze({ ok: null, refusalKind: null, refusal: null, details: [] });

/**
 * The kinds that gained `ok` from the merge above. Their emitters were written
 * when the only answer was a success and never name it, so an answer that is
 * not a refusal is `ok: true` — `null` would read as "nobody decided", and a
 * consumer branching on `ok` would have to special-case each of these kinds. A
 * kind that declared `ok` itself keeps whatever its emitter says.
 *
 * The default holds only for a command whose success always exits 0. One whose
 * exit code is a VERDICT — `audit` exits 1 on a finding, `docs-drift` on a
 * flagged document — states `ok` itself, because a derived `ok: true` beside
 * exit 1 tells a consumer that branches on `ok` the opposite of the exit code.
 * `scripts/tests/json-envelope.test.mjs` holds every one of these kinds to
 * `ok === (exit === 0)`.
 */
export const OK_BY_DEFAULT = new Set();
for (const [kind, shape] of Object.entries(KINDS)) {
  if (!("ok" in shape)) OK_BY_DEFAULT.add(kind);
  for (const [key, empty] of Object.entries(REFUSAL_KEYS)) {
    if (!(key in shape)) shape[key] = empty;
  }
}

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
  vocabulary: { args: ["vocabulary", "--json"] },
  // Which directories the run uses. It writes nothing; the harness's `--dir`
  // makes the backlog half non-null, the case with the most keys filled in.
  where: { args: ["where", "--json"] },
  // The register is machine-local state beside the locks, not a question about
  // the fixture backlog (TL-266) — hence `noDir`, the same boundary the profile
  // rows prove. It writes nothing and starts nothing: an empty `servers` on an
  // isolated state directory is still a complete envelope.
  "serve-list": { args: ["serve", "--list", "--json"], noDir: true },
  // A port nothing was ever registered for: the `not-registered` outcome, which
  // is the path most easily left without an envelope. It signals nothing, so it
  // is not a `writes` row.
  "serve-stop": { args: ["serve", "--stop", "1", "--json"], noDir: true },
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
  "task-ledger": { args: ["log", FIRST_TASK, "--records", "--json"] },
  "open-questions": { args: ["log", "--open-questions", "--json"] },
  // `resume` composes reads and writes nothing (TL-151), so it is NOT a
  // `writes` row: asking it twice of one tree is safe, and
  // `scripts/tests/resume-briefing.test.mjs` proves the tree is byte-identical
  // afterwards. The id EXISTS on the populated fixture and not on the empty
  // one, so the row exercises a briefing on one and the "no such task" refusal
  // on the other — each a complete envelope, and neither a usage error.
  // `--no-verify` because this row asks about the ENVELOPE. Left out, it would
  // run the fixture task's `verification:` command, and the shape of the answer
  // would start depending on the observer's shell.
  // One task's computed facts (TL-509). It writes nothing, so like `log` one
  // row answers twice: the populated fixture shows a real task, and on the
  // empty one the same call is the "no such task" refusal in a full envelope.
  // A stream, bounded: `--max-events 0` arms the watch, prints the `ready`
  // envelope and exits, so one row exercises the shape without a process that
  // waits forever. The stream itself is `scripts/tests/watch-stream.test.mjs`.
  "change-stream": { args: ["follow", "--json", "--max-events", "0"] },
  "task-show": { args: ["show", FIRST_TASK, "--json"] },
  resume: { args: ["resume", FIRST_TASK, "--actor", "agent:test", "--no-verify", "--json"] },
  run: { args: ["run", "--dry-run", "--json"] },
  // ── The rows that WRITE (TL-119) ─────────────────────────────────────────
  //
  // A stop request is written to the state directory, never to the tree, and
  // reaches only a run started before it — none is running here.
  "run-stop": { args: ["run", "--stop", "--json"], writes: true },
  // A fresh `init` writes a current template, so the fixture exercises the
  // "nothing to add" answer; it is a `writes` row because the command writes
  // whenever something is missing.
  "template-refresh": { args: ["template", "refresh", "--json"], writes: true },
  //
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
  "release-status": { args: ["deploy", "status", "--json"] },
  // The fixture declares no `deploy_targets`, so this is the refusal path: an
  // undeclared target. It is reached only after the reason and the actor pass,
  // so both are given; nothing is written.
  "release-record": {
    args: ["deploy", "record", "--target", "web", "--stage", "production", "HEAD", "--actor", "agent:test", "--reason", "a fixture", "--json"],
    refuses: true, writes: true,
  },
  // A body for a task that is not there: the refusal path, reached only after
  // the reason passes and the body has been read from stdin.
  "task-body": {
    args: ["body", ABSENT_TASK, "--reason", "a fixture", "--actor", "agent:test", "--json"],
    refuses: true, writes: true, input: "## Goal\n\nA fixture.\n",
  },
  // The success path: the fixture's config.yaml gains one release, which is
  // the write a release-management interface needs.
  "vocabulary-declare": {
    args: ["declare", "releases", "9.9", "--reason", "a fixture", "--json"],
    writes: true,
  },
  "task-release": {
    args: ["release", ABSENT_TASK, "--actor", "agent:test", "--reason", "a fixture", "--json"],
    refuses: true, writes: true,
  },
  // A task that is not there: the refusal path, reached only after the field
  // and its value are judged valid, so a real field and value are given.
  "task-set": {
    args: ["set", ABSENT_TASK, "title", "A title", "--actor", "agent:test", "--json"],
    refuses: true, writes: true,
  },
  "task-set-fields": { args: ["set", "--fields", "--json"] },
  // A task that is not there: same reason as above — the refusal path.
  "verification-run": { args: ["done", ABSENT_TASK, "--json"], refuses: true, writes: true },
  // A question about a task that is not there (TL-148): the refusal path again,
  // and `--question` is required before the refusal is reached, so it is given.
  "task-ask": {
    args: ["ask", ABSENT_TASK, "--question", "which of the two?", "--actor", "agent:test", "--json"],
    refuses: true, writes: true,
  },
  // A decision about a task that is not there: the refusal path, reached only
  // after the reason and the actor pass, so both are given.
  "task-decide": {
    args: ["decide", ABSENT_TASK, "--reason", "a fixture", "--actor", "agent:test", "--json"],
    refuses: true, writes: true,
  },
  // A wave the fixture does not have: the refusal path (TL-568), reached only
  // after the title, the actor and the backlog pass, and settled before a
  // number is reserved, so nothing is written. The success envelope is held by
  // `scripts/tests/new-json-refusals.test.mjs` beside every refusal.
  "task-new": {
    args: ["new", "--title", "A fixture task", "--wave", "no-such-wave", "--actor", "agent:test", "--json"],
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
  // A real issue rather than `[]`: the dry run must traverse the import plan
  // and expose a non-empty `wouldCreate`, so the registry cannot go green on a
  // command that only handles an empty sample.
  import: {
    args: ["import", "--from", "github", "--dry-run", "--json"],
    input: JSON.stringify([{
      number: 1,
      title: "An imported issue",
      body: "The fixture issue body.",
      state: "OPEN",
      labels: [],
      url: "https://example.test/issues/1",
    }]),
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
  if (OK_BY_DEFAULT.has(kind) && given.ok === undefined) out.ok = out.refusalKind === null;
  return out;
}

/**
 * Print one envelope as ONE line — newline-delimited JSON, for a stream (TL-524).
 * A pretty-printed envelope spans lines, and a consumer splitting on newlines
 * would read a fragment. Returns false when the reader went away.
 */
export function printJsonLine(kind, payload) {
  return printLine(JSON.stringify(envelope(kind, payload)));
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
