/**
 * An actor's record, computed from the log (TL-150).
 *
 * WHAT THE FEATURE IS. `history/<ID>.jsonl` already records who moved which
 * task where, so "how much of what this actor closed came back" is an
 * aggregation, not a number anybody has to keep. `actors` adds it up and
 * prints it; nothing new is written and nothing new is kept (law 2). The
 * optional half is a POLICY: a project may declare that work above a stated
 * priority is not handed to an actor whose record is below a stated threshold.
 *
 * WHAT THIS FILE HAS TO RULE OUT — the five ways a per-actor table is wrong
 * while every row still looks plausible:
 *
 *   1. A SECOND DEFINITION OF REWORK. `audit` (TL-90) already decides what a
 *      reopening is and whom it is charged to — the actor who CLOSED the task,
 *      not the one who noticed. A report that folds the log a second time will
 *      eventually disagree with `audit` about the same week, and a reader has
 *      nothing to tell them which of the two is lying. The agreement is
 *      asserted, entry by entry, over the fixture below.
 *   2. A NICKNAME TREATED AS AN IDENTITY. `local:anna` is a declaration and
 *      `user:anna` is an authentication; folding them is precisely the lie the
 *      namespace rule exists to prevent. Two rows, and no row keyed `anna`.
 *      Neither may `unknown` — a change the tool observed but did not make —
 *      be swept into the `legacy` row: "nobody had namespaces yet" and "we do
 *      not know who did this" are different claims.
 *   3. A RATE WITH NO STATED DENOMINATOR. Four out of five over five closings
 *      and over five hundred are different claims that print identically. Below
 *      `min_report_n` the row carries its count and NO rate — `null`, not `0`
 *      and not `1`, because "too few to say" is not an answer about quality.
 *   4. A ROUTING COUNTED AS A REFUSAL. `handoff` writes the same block whether
 *      an actor said "this does not fit a session of mine" or "this fits, and
 *      the next stage is another hand's" — the difference is whether the role
 *      changed (TL-271). Counting the second one as a refusal reports a working
 *      two-hand pipeline as an actor who keeps giving work back.
 *   5. A POLICY THAT REORDERS. Eligibility and ordering are different
 *      decisions; the order is `next`'s and is tested elsewhere. A filter that
 *      also promoted the survivors would silently replace the dispatcher's
 *      policy with this one. What is asserted is the strongest form of "it only
 *      removes": what comes back equals the full queue with the withheld
 *      entries filtered out, same objects, same order.
 *
 * THE VOCABULARY IS THE FIXTURE'S. `icebox`, `surveying`, `charted`, `urgent`,
 * `warm`, `quiet` are this fixture's own words. Asserting this project's
 * statuses or priorities would be asserting somebody else's data (CLAUDE.md,
 * "do not assert another project's values"), and a literal left in the code
 * would pass against them and fail here.
 *
 * Tests: node --test scripts/tests/actor-record.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LEGACY_ACTOR,
  actorRecords,
  applyActorPolicy,
  parseActorsArgs,
} from "../actors.mjs";
import { reopenedAfterClosing, reworkRates } from "../audit.mjs";
import { loadConfig } from "../config.mjs";
import { userConfigPath } from "../home.mjs";
import { lastHandoff } from "../next-task.mjs";
import { FIELD_COMMENT } from "../task-fields.mjs";

import { alignTemplate, isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("actor-record");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

// ──────────────────────────────────────────────────────────────────────────
// The fixture: a log written by hand, to be awkward on purpose
// ──────────────────────────────────────────────────────────────────────────
//
// Written out rather than produced by running the tool, so a change to the
// WRITING path cannot make the READING path pass by accident.
//
//   agent:bit   five closings, one of which came back; one refusal and one
//               handoff that changed the role — a routing, not a refusal.
//   user:anna   two closings, one of which came back. She also REOPENED one of
//               bit's, and must not be charged for it.
//   local:anna  the same nickname in another namespace: one closing.
//   anna        no namespace at all — the pre-TL-21 shape, folded into `legacy`.
//   unknown     the reserved actor: observed, not made by the tool. Its own row.
const OPEN = "surveying";
const CLOSED = "charted";
const CONFIG = { archivedStatuses: [CLOSED], minReportN: 4 };

const close = (actor, ts) => ({ ts, field: "status", from: OPEN, to: CLOSED, actor, source: "done" });
const reopen = (actor, ts) => ({ ts, field: "status", from: CLOSED, to: OPEN, actor, source: "manual" });
/** The block `handoff` actually writes: the field rows, then the comment. */
const handoff = (actor, ts, toRole) => [
  ...(toRole ? [{ ts, field: "role", from: "spec", to: toRole, actor, source: "handoff" }] : []),
  { ts, field: "owner", from: actor, to: "", actor, source: "handoff" },
  { ts, field: FIELD_COMMENT, from: "", to: "a sentence about why", actor, source: "handoff" },
];

const HISTORY = {
  "FX-1": [close("agent:bit", "2026-06-01T09:00:00.000Z")],
  "FX-2": [close("agent:bit", "2026-06-02T09:00:00.000Z")],
  "FX-3": [close("agent:bit", "2026-06-03T09:00:00.000Z")],
  "FX-4": [close("agent:bit", "2026-06-04T09:00:00.000Z")],
  // The interesting one: bit closes, anna reopens it — anna is charged nothing
  // for that — anna closes, and bit reopens that one.
  "FX-5": [
    close("agent:bit", "2026-06-05T09:00:00.000Z"),
    reopen("user:anna", "2026-06-06T09:00:00.000Z"),
    close("user:anna", "2026-06-07T09:00:00.000Z"),
    reopen("agent:bit", "2026-06-08T09:00:00.000Z"),
  ],
  "FX-6": [close("user:anna", "2026-06-09T09:00:00.000Z")],
  "FX-7": [close("local:anna", "2026-06-10T09:00:00.000Z")],
  "FX-8": [close("anna", "2026-06-11T09:00:00.000Z")],
  "FX-9": [close("unknown", "2026-06-11T12:00:00.000Z")],
  // A refusal, and a routing that must not be counted as one.
  "FX-10": handoff("agent:bit", "2026-06-12T09:00:00.000Z", null),
  "FX-11": handoff("agent:bit", "2026-06-13T09:00:00.000Z", "dev"),
};

const row = (rows, actor) => rows.find((r) => r.actor === actor) || null;

test("FIXTURE CONTROL: the log really carries the two shapes of handoff", () => {
  // Without this the claim below — "the routing is not counted" — could pass
  // over a fixture in which nothing is a routing at all.
  assert.equal(lastHandoff(HISTORY["FX-10"]).toRole, undefined, "FX-10 was meant to change no role");
  assert.equal(lastHandoff(HISTORY["FX-11"]).toRole, "dev", "FX-11 was meant to be a routing");
});

// ── The invocation ────────────────────────────────────────────────────────

test("--since takes a date, and anything else fails rather than being ignored", () => {
  assert.equal(parseActorsArgs([]).since, null);
  assert.equal(parseActorsArgs(["--since", "2026-06-05"]).since, "2026-06-05");
  assert.equal(parseActorsArgs(["--json"]).json, true);
  assert.throws(() => parseActorsArgs(["--since", "last week"]), /is not a date/);
  assert.throws(() => parseActorsArgs(["--worst"]), /unknown flag: --worst/);
});

// ── The record ────────────────────────────────────────────────────────────

test("FINDS: every actor in the log, with closings, first-pass, reopenings and handbacks", () => {
  const { rows } = actorRecords({ history: HISTORY, config: CONFIG });
  assert.deepEqual(
    rows.map((r) => ({ actor: r.actor, closings: r.closings, firstPass: r.firstPass, reopened: r.reopened, handbacks: r.handbacks })),
    [
      // Sorted by closings, then by actor — a table whose order depends on the
      // order of readdir() is a table two machines disagree about. The three
      // one-closing rows are therefore in the order the tie-break puts them:
      // `legacy` before `local:anna` before `unknown`.
      { actor: "agent:bit", closings: 5, firstPass: 4, reopened: 1, handbacks: 1 },
      { actor: "user:anna", closings: 2, firstPass: 1, reopened: 1, handbacks: 0 },
      { actor: LEGACY_ACTOR, closings: 1, firstPass: 1, reopened: 0, handbacks: 0 },
      { actor: "local:anna", closings: 1, firstPass: 1, reopened: 0, handbacks: 0 },
      { actor: "unknown", closings: 1, firstPass: 1, reopened: 0, handbacks: 0 },
    ]
  );
});

test("first-pass and reopened PARTITION the closings — there is no third bucket", () => {
  // Cheap, and it is what stops a later edit from inventing a definition of
  // "first pass" that quietly stops adding up.
  for (const r of actorRecords({ history: HISTORY, config: CONFIG }).rows) {
    assert.equal(r.firstPass + r.reopened, r.closings, r.actor + " does not add up");
  }
});

test("a reopening is charged to whoever CLOSED it, not to whoever noticed", () => {
  const { rows } = actorRecords({ history: HISTORY, config: CONFIG });
  // FX-5 was closed by bit and reopened by anna; then closed by anna and
  // reopened by bit. One reopening each, and each on the closer's row.
  assert.equal(row(rows, "agent:bit").reopened, 1);
  assert.equal(row(rows, "user:anna").reopened, 1);
  // POSITIVE CONTROL for the direction: anna reopened one of bit's closings and
  // that act appears nowhere in her own numbers — her two closings are FX-5's
  // second and FX-6, not the reopening.
  assert.equal(row(rows, "user:anna").closings, 2);
});

test("`local:` and `user:` of one nickname are two rows, and there is no third", () => {
  const { rows } = actorRecords({ history: HISTORY, config: CONFIG });
  assert.ok(row(rows, "user:anna"), "the authenticated actor lost her row");
  assert.ok(row(rows, "local:anna"), "the declared actor lost his row");
  assert.equal(row(rows, "anna"), null, "the two namespaces were folded into a nickname");
});

test("an actor with no namespace is `legacy`, and `unknown` is NOT swept into it", () => {
  const { rows } = actorRecords({ history: HISTORY, config: CONFIG });
  assert.equal(row(rows, LEGACY_ACTOR).closings, 1, "the pre-namespace entry lost its row");
  assert.equal(row(rows, "unknown").closings, 1,
    "`unknown` is a stated absence of attribution, not an old entry — it keeps its own row");
});

test("a handoff that CHANGED THE ROLE is a routing and is not counted among the handbacks", () => {
  const { rows } = actorRecords({ history: HISTORY, config: CONFIG });
  // Two handoffs by bit in the log, one of each shape; only the refusal counts.
  assert.equal(row(rows, "agent:bit").handbacks, 1);

  // POSITIVE CONTROL: with the role change removed from the same block, the
  // very same entries DO count — so the rule above narrows something real
  // rather than a counter that never fires.
  const routingRemoved = { ...HISTORY, "FX-11": handoff("agent:bit", "2026-06-13T09:00:00.000Z", null) };
  assert.equal(row(actorRecords({ history: routingRemoved, config: CONFIG }).rows, "agent:bit").handbacks, 2);
});

test("it does not re-derive rework: the numbers are `audit`'s, entry by entry", () => {
  // If `actors` and `audit` disagree about what a reopening is, one of them is
  // wrong and a reader cannot tell which (TL-150's Context). So this is not a
  // style rule — it is the report's only claim to be believed.
  const { byActor } = reopenedAfterClosing(HISTORY, { archived: CONFIG.archivedStatuses });
  const audited = reworkRates(byActor, CONFIG.minReportN);
  const { rows } = actorRecords({ history: HISTORY, config: CONFIG });
  assert.ok(audited.length > 0, "the fixture produced no rework rows to agree with");

  for (const a of audited) {
    const mine = row(rows, a.actor) || row(rows, LEGACY_ACTOR);
    assert.ok(mine, "no row for an actor `audit` reports: " + a.actor);
    assert.equal(mine.closings, a.closings, a.actor + ": the denominators disagree");
    assert.equal(mine.reopened, a.reopens, a.actor + ": the reopenings disagree");
    assert.equal(mine.enough, a.enough, a.actor + ": the two reports disagree about the sample");
    // The two rates ADD UP TO ONE: `audit` reports the share that came back,
    // this reports the share that stuck. Printing them the same way round would
    // be the easiest way there is to misread a table about people.
    if (a.enough) assert.equal(Math.round((mine.rate + a.rate) * 1000) / 1000, 1, a.actor + ": the two rates do not add up to one");
  }
});

// ── The stated denominator ────────────────────────────────────────────────

test("below `min_report_n` a row carries its count and NO rate", () => {
  const { rows } = actorRecords({ history: HISTORY, config: CONFIG });
  const anna = row(rows, "user:anna");
  assert.equal(anna.closings, 2, "the count is what a row below the minimum is FOR");
  assert.equal(anna.enough, false);
  assert.equal(anna.rate, null,
    "`null`, not a number: `0` reads as 'everything came back' and `1` as 'nothing did'");
});

test("POSITIVE CONTROL: above the minimum, the same row does carry a rate", () => {
  // Without this the assertion above would pass just as happily against a
  // report that never computes a rate at all.
  const bit = row(actorRecords({ history: HISTORY, config: CONFIG }).rows, "agent:bit");
  assert.equal(bit.enough, true);
  assert.equal(bit.rate, 0.8, "four of five closings stuck");

  // And the threshold is the PROJECT's: raise it past five and bit falls silent.
  const strict = row(actorRecords({ history: HISTORY, config: { ...CONFIG, minReportN: 6 } }).rows, "agent:bit");
  assert.equal(strict.rate, null, "the minimum sample is read from the configuration, not from a literal");
});

// ── The window ────────────────────────────────────────────────────────────

test("`since` narrows what is counted, and says so in the answer", () => {
  const all = actorRecords({ history: HISTORY, config: CONFIG });
  const window = actorRecords({ history: HISTORY, config: CONFIG, since: "2026-06-04" });
  assert.equal(window.since, "2026-06-04");
  assert.equal(all.since, null, "with no window the report covers everything the log has");

  // bit closed FX-1..FX-3 before the window; two closings are left, which is
  // below the minimum — so the window changed the denominator and the rate went
  // silent with it, rather than being computed over a number nobody stated.
  const bit = row(window.rows, "agent:bit");
  assert.equal(bit.closings, 2);
  assert.equal(bit.rate, null);
  // The refusal is inside the window; the routing is too, and still uncounted.
  assert.equal(bit.handbacks, 1);
});

test("an actor whose every event is outside the window has no row at all", () => {
  const window = actorRecords({ history: HISTORY, config: CONFIG, since: "2026-06-09" });
  assert.equal(row(window.rows, "local:anna").closings, 1, "FX-7 is inside this window");
  assert.equal(row(window.rows, "agent:bit"), null,
    "bit's closings are all older than the window — a row of zeroes states a record he does not have here");
});

// ── The policy: eligibility only, and opt-in ──────────────────────────────

const POLICY = { priorities: ["urgent"], minFirstPass: 0.8 };
const task = (id, priority) => ({ id, priority });
const QUEUE = [task("FX-21", "urgent"), task("FX-22", "warm"), task("FX-23", "quiet")];

test("with no policy declared nothing is withheld — `actors` is a report", () => {
  const weak = { actor: "agent:weak", closings: 5, firstPass: 2, reopened: 3, rate: 0.4, enough: true, handbacks: 0 };
  const off = applyActorPolicy(QUEUE, { row: weak, policy: { priorities: [], minFirstPass: 0 }, minReportN: 4 });
  assert.deepEqual(off.candidates, QUEUE);
  assert.deepEqual(off.withheld, []);
});

test("FINDS: a priority the project named is withheld from an actor below the threshold", () => {
  const weak = { actor: "agent:weak", closings: 5, firstPass: 2, reopened: 3, rate: 0.4, enough: true, handbacks: 0 };
  const { candidates, withheld } = applyActorPolicy(QUEUE, { row: weak, policy: POLICY, minReportN: 4 });
  assert.deepEqual(candidates.map((t) => t.id), ["FX-22", "FX-23"]);
  assert.deepEqual(withheld.map((w) => w.id), ["FX-21"]);
  // A withholding nobody can read the reason for is indistinguishable from an
  // empty queue, which is the one thing a dispatcher may never look like.
  assert.match(withheld[0].reason, /0\.4|40/, "the reason does not say what the actor's record is");
  assert.match(withheld[0].reason, /0\.8|80/, "the reason does not say what the threshold is");
});

test("SILENT: the same queue, the same policy, an actor above the threshold", () => {
  const strong = { actor: "agent:strong", closings: 5, firstPass: 5, reopened: 0, rate: 1, enough: true, handbacks: 0 };
  const { candidates, withheld } = applyActorPolicy(QUEUE, { row: strong, policy: POLICY, minReportN: 4 });
  assert.deepEqual(candidates, QUEUE);
  assert.deepEqual(withheld, []);
});

test("SILENT: a record too small to print a rate for is too small to act on", () => {
  // The rule that keeps the report and the policy from contradicting each
  // other: a rate the table refuses to state may not be the ground for taking
  // work away from somebody.
  const few = { actor: "agent:new", closings: 2, firstPass: 0, reopened: 2, rate: null, enough: false, handbacks: 0 };
  assert.deepEqual(applyActorPolicy(QUEUE, { row: few, policy: POLICY, minReportN: 4 }).withheld, []);
});

test("SILENT: an actor the log has never seen is not held back", () => {
  // Silence is not evidence of a bad record. Withholding here would make the
  // policy about how long an actor has been here rather than about its record,
  // and no first task above the priority would ever be handed out.
  assert.deepEqual(applyActorPolicy(QUEUE, { row: null, policy: POLICY, minReportN: 4 }).withheld, []);
});

test("the policy FILTERS and never reorders", () => {
  const weak = { actor: "agent:weak", closings: 5, firstPass: 2, reopened: 3, rate: 0.4, enough: true, handbacks: 0 };
  // A middle priority, so the removal is not a prefix: an implementation that
  // sorted its survivors would show here and nowhere else.
  const middle = { priorities: ["warm"], minFirstPass: 0.8 };
  const { candidates, withheld } = applyActorPolicy(QUEUE, { row: weak, policy: middle, minReportN: 4 });
  const gone = new Set(withheld.map((w) => w.id));
  assert.deepEqual(gone, new Set(["FX-22"]));
  assert.deepEqual(candidates, QUEUE.filter((t) => !gone.has(t.id)),
    "what came back is not the queue minus the withheld — the order or the objects changed");
});

// ── The configuration layers ──────────────────────────────────────────────

test("the policy is read from the project layer, and is off by default", () => {
  const plain = backlog();
  assert.deepEqual(loadConfig(plain).actorPolicy, { priorities: [], minFirstPass: 0 },
    "a project that declared nothing has a policy — the default must be no policy at all");

  const declared = backlog("actor_policy_priorities: [urgent]\nactor_policy_min_first_pass: 0.8\n");
  assert.deepEqual(loadConfig(declared).actorPolicy, { priorities: ["urgent"], minFirstPass: 0.8 });
});

test("the policy key in the USER layer is refused, and says which file it belongs in", () => {
  const dir = backlog();
  const home = mkdtempSync(join(tmpdir(), "branchling-actor-home-"));
  const env = { ...process.env, BRANCHLING_HOME: home };  // product-name: allow
  const path = userConfigPath(env);
  mkdirSync(dirname(path), { recursive: true });

  writeFileSync(path, "actor_policy_min_first_pass: 0.8\n", "utf8");
  assert.throws(() => loadConfig(dir, { env }), /PROJECT's vocabulary/,
    "a person could raise their own threshold and see a different queue in the same repository");

  // POSITIVE CONTROL: the refusal is about THAT key, not about the file. A
  // genuine preference in the same place loads.
  writeFileSync(path, "theme: dark\n", "utf8");
  assert.equal(loadConfig(dir, { env }).user.theme, "dark");
});

// ── The command ───────────────────────────────────────────────────────────

let counter = 0;
function run(args, env) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, env: env || { ...process.env, NO_COLOR: "1" },
  });
}

/** A backlog speaking the fixture's own vocabulary, with the log above in it. */
function backlog(extraConfig = "") {
  const dir = mkdtempSync(join(tmpdir(), "branchling-actor-" + (counter++) + "-"));
  assert.equal(run(["init", "--dir", dir, "--no-example"]).status, 0);
  const p = join(dir, "config.yaml");
  writeFileSync(p, readFileSync(p, "utf8")
    .replace(/^statuses:.*$/m, "statuses: [icebox, " + OPEN + ", " + CLOSED + "]")
    .replace(/^archived_statuses:.*$/m, "archived_statuses: [" + CLOSED + "]")
    .replace(/^dashboard_open_statuses:.*$/m, "dashboard_open_statuses: [icebox, " + OPEN + "]")
    .replace(/^reason_required_statuses:.*$/m, "reason_required_statuses: []")
    .replace(/^priorities:.*$/m, "priorities: [urgent, warm, quiet]")
    .replace(/^actors:.*$/m, "actors: [agent:weak, agent:strong]"), "utf8");
  // Assembled line by line rather than as one literal: a `\n` run into the word
  // after it reads as a word nobody wrote, and the language guard reports it.
  appendFileSync(p, ["", "in_progress_status: " + OPEN, "min_report_n: 4", extraConfig].join("\n"), "utf8");
  alignTemplate(dir);
  return dir;
}

/** Write one task's log by hand. The tasks themselves need not exist: a record
 *  is a fact about the LOG, and closed work is deleted, renamed and archived. */
function log(dir, id, entries) {
  const historyDir = join(dir, "history");
  mkdirSync(historyDir, { recursive: true });
  writeFileSync(join(historyDir, id + ".jsonl"),
    entries.map((e) => JSON.stringify({ task: id, ...e })).join("\n") + "\n", "utf8");
}

/** The two records the policy cases are about: one that holds, one that does not. */
function withRecords(dir) {
  for (let i = 0; i < 5; i++) {
    log(dir, "TASK-90" + i, [close("agent:strong", "2026-06-0" + (i + 1) + "T09:00:00.000Z")]);
    log(dir, "TASK-91" + i, i < 3
      ? [close("agent:weak", "2026-06-0" + (i + 1) + "T09:00:00.000Z"), reopen("agent:strong", "2026-06-0" + (i + 2) + "T09:00:00.000Z")]
      : [close("agent:weak", "2026-06-0" + (i + 1) + "T09:00:00.000Z")]);
  }
  return dir;
}

test("the report prints a row per actor and exits 0 — it is a report, not a gate", () => {
  const dir = withRecords(backlog());
  const r = run(["actors", "--dir", dir]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /agent:weak/);
  assert.match(r.stdout, /agent:strong/);
  // FIXTURE CONTROL, and deliberately NOT `audit`'s exit code. Rework is a
  // finding by TL-90's contract, so `audit` exits 1 over this fixture and is
  // meant to — that decision belongs to `audit`, and a task that aggregates its
  // findings may not re-take it from underneath it (TL-150's Context). What has
  // to hold instead is that the rework is the ONLY thing `audit` has to say
  // here: no closing without a trace, nothing parked, no premise missing. The
  // weak record the policy cases rest on is a record, not a malformed log.
  const audited = JSON.parse(run(["audit", "--dir", dir, "--json"]).stdout);
  assert.deepEqual(
    { trace: audited.closedWithoutTrace, parked: audited.parked, premise: audited.withoutPremise },
    { trace: [], parked: [], premise: [] },
    "the fixture is malformed in some other way, so nothing it proves is about a record"
  );
  assert.equal(audited.findings, audited.reopened.length, "`audit` found something here that is not the rework");
  assert.equal(audited.reopened.length, 3, "the three reopenings ARE the weak actor's record — the fixture lost them");
});

test("a row below the minimum sample shows its count and no percentage", () => {
  const dir = backlog();
  log(dir, "TASK-800", [close("agent:weak", "2026-06-01T09:00:00.000Z")]);
  log(dir, "TASK-801", [close("agent:weak", "2026-06-02T09:00:00.000Z")]);
  const out = run(["actors", "--dir", dir]).stdout;
  const line = out.split("\n").find((l) => l.includes("agent:weak"));
  assert.ok(line, "the actor is missing from the report entirely");
  assert.ok(!line.includes("%"), "a rate over two closings: " + line);
  assert.match(line, /\b2\b/, "the count is what a row below the minimum is for: " + line);

  // POSITIVE CONTROL: with enough closings the same row does print one.
  const enough = withRecords(backlog());
  const strong = run(["actors", "--dir", enough]).stdout.split("\n").find((l) => l.includes("agent:strong"));
  assert.match(strong, /%/, "no rate is ever printed: " + strong);
});

test("it says outright that it is not a judgement of anybody", () => {
  // A number about a named actor is read as a number about a person unless the
  // report says otherwise — the same sentence `audit` carries, for the same
  // reason, and this table is the one that most needs it.
  assert.match(run(["actors", "--dir", withRecords(backlog())]).stdout, /not a judgement of anybody's work/i);
});

test("--json answers in the envelope, and an unknown flag fails", () => {
  const dir = withRecords(backlog());
  const r = run(["actors", "--dir", dir, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.kind, "actors");
  const weak = doc.rows.find((x) => x.actor === "agent:weak");
  assert.deepEqual(
    { closings: weak.closings, firstPass: weak.firstPass, reopened: weak.reopened, rate: weak.rate },
    { closings: 5, firstPass: 2, reopened: 3, rate: 0.4 }
  );
  assert.equal(run(["actors", "--dir", dir, "--worst"]).status, 2, "an unknown flag must fail, not be ignored");
});

// ── The policy, where it is actually applied ──────────────────────────────

const POLICY_YAML = "actor_policy_priorities: [urgent]\nactor_policy_min_first_pass: 0.8\n";

/** Three tasks, one of each priority, in a tree that already knows both records. */
function queue(extraConfig) {
  const dir = withRecords(backlog(extraConfig));
  const env = { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(dir, ".state") };
  const ids = [["urgent", "The urgent one"], ["warm", "The middle one"], ["quiet", "The quiet one"]]
    .map(([priority, title]) => {
      const r = run(["new", "--dir", dir, "--title", title, "--priority", priority], env);
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.match(/[A-Z]+-\d+/)[0];
    });
  return { dir, env, ids };
}

/** Take until the queue is empty, and report the order it handed them out in. */
function drain(dir, env, actor) {
  const taken = [];
  for (let i = 0; i < 6; i++) {
    const r = run(["next", "--dir", dir, "--actor", actor, "--json"], env);
    if (r.status !== 0) break;
    taken.push(JSON.parse(r.stdout).id);
  }
  return taken;
}

test("POSITIVE CONTROL: the policy withholds the top priority from the weaker actor", () => {
  const on = queue(POLICY_YAML);
  const first = run(["next", "--dir", on.dir, "--actor", "agent:weak", "--json"], on.env);
  assert.equal(first.status, 0, first.stderr);
  assert.notEqual(JSON.parse(first.stdout).id, on.ids[0], "the weaker actor was handed the task the policy names");

  // ... and with the policy OFF the very same tree hands out the very same
  // task. Without this half, a green test above would be satisfied by a queue
  // that is simply broken.
  const off = queue("");
  const same = run(["next", "--dir", off.dir, "--actor", "agent:weak", "--json"], off.env);
  assert.equal(same.status, 0, same.stderr);
  assert.equal(JSON.parse(same.stdout).id, off.ids[0]);

  // ... and it is about the RECORD, not about the priority: with the policy on,
  // the stronger actor is handed it.
  const strong = queue(POLICY_YAML);
  const r = run(["next", "--dir", strong.dir, "--actor", "agent:strong", "--json"], strong.env);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).id, strong.ids[0]);
});

test("the policy removes candidates and leaves the dispatcher's order alone", () => {
  // A MIDDLE priority is withheld, so a survivor promoted over the top task
  // would be visible. The order comes out of `next` itself, which is the only
  // thing entitled to say what it is.
  const off = queue("");
  const unfiltered = drain(off.dir, off.env, "agent:weak");
  assert.deepEqual(unfiltered, off.ids, "the fixture's own order is not what `next` does — the case below proves nothing");

  const on = queue("actor_policy_priorities: [warm]\nactor_policy_min_first_pass: 0.8\n");
  const filtered = drain(on.dir, on.env, "agent:weak");
  assert.deepEqual(filtered, [on.ids[0], on.ids[2]],
    "eligibility became an ordering: the surviving tasks did not come back in the order `next` put them in");
});
