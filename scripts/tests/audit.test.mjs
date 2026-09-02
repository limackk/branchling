/**
 * `audit` — the declarations, against the traces they left (TL-90).
 *
 * WHAT HAS TO BE PROVED, and TL-90 names the shape itself: **each detector has
 * a test where it finds SOMETHING and a test where it rightly stays silent.**
 * Only the first half has evidential force — a detector that never fires passes
 * every "no findings" assertion — and only the second says it is not simply
 * flagging everything.
 *
 * Beyond that, three properties this report needs or it is itself a lie:
 *
 *   - a task closed BEFORE the log first recorded a status transition is not
 *     accused, and the number dropped is stated rather than hidden;
 *   - a rework bucket below `min_report_n` reports how many it has and NO rate,
 *     because a percentage over three closings reads like one over three
 *     hundred;
 *   - every status comes from the configuration. The fixtures use a vocabulary
 *     sharing nothing with the defaults, so a literal in the code fails here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  auditBacklog, closedWithoutTrace, historyDayZero, parked, parseAuditArgs,
  reopenedAfterClosing, reworkRates, withoutPremise,
} from "../audit.mjs";
import { alignTemplate, isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("audit");


const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

let counter = 0;
function run(args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1" },
  });
}

// A vocabulary of the fixture's own — see the header.
const CONFIG = {
  statuses: ["icebox", "surveying", "stuck", "charted"],
  archivedStatuses: ["charted"],
  reasonRequiredStatuses: ["stuck", "charted"],
  inProgressStatus: "surveying",
  auditStaleDays: 7,
  minReportN: 8,
};

const task = (id, over = {}) => ({
  id, title: "T " + id, status: "icebox", blocked_by: [], owner: "",
  created: "2026-01-01", updated: "2026-01-10", ...over,
});
const entry = (task_, over = {}) => ({
  task: task_, field: "status", from: "surveying", to: "charted",
  actor: "agent:x", ts: "2026-01-10T00:00:00.000Z", ...over,
});

// ── The invocation ────────────────────────────────────────────────────────

test("--since takes a date, and anything else fails rather than being ignored", () => {
  assert.equal(parseAuditArgs([]).since, null);
  assert.equal(parseAuditArgs(["--since", "2026-01-01"]).since, "2026-01-01");
  assert.throws(() => parseAuditArgs(["--since", "last week"]), /is not a date/);
  assert.throws(() => parseAuditArgs(["--stale"]), /unknown flag: --stale/);
});

// ── Day zero ──────────────────────────────────────────────────────────────

test("day zero is the first STATUS transition, not the first entry of any kind", () => {
  // The difference is not academic: in this repository the log begins a day
  // before the first transition, and the wrong definition accuses every task
  // closed in between.
  const history = {
    "T-1": [
      { field: "__created__", ts: "2026-01-01T00:00:00.000Z" },
      { field: "status", ts: "2026-01-05T00:00:00.000Z", to: "charted" },
    ],
  };
  assert.equal(historyDayZero(history), "2026-01-05");
});

test("a log with no status transition at all has no day zero", () => {
  assert.equal(historyDayZero({ "T-1": [{ field: "title", ts: "2026-01-01T00:00:00.000Z" }] }), null);
});

// ── Closed with no trace ──────────────────────────────────────────────────

test("FINDS: a task standing in a closed status that nothing recorded", () => {
  const r = closedWithoutTrace([task("T-1", { status: "charted" })], {}, { archived: CONFIG.archivedStatuses, since: "2026-01-01" });
  assert.deepEqual(r.found.map((f) => f.task), ["T-1"]);
  assert.equal(r.skipped, 0);
});

test("SILENT: the same task, once the transition is in the log", () => {
  const r = closedWithoutTrace(
    [task("T-1", { status: "charted" })],
    { "T-1": [entry("T-1")] },
    { archived: CONFIG.archivedStatuses, since: "2026-01-01" }
  );
  assert.deepEqual(r.found, []);
});

test("SILENT: an OPEN task is not asked for a closing trace", () => {
  const r = closedWithoutTrace([task("T-1", { status: "surveying" })], {}, { archived: CONFIG.archivedStatuses, since: "2026-01-01" });
  assert.deepEqual(r.found, []);
});

test("a task closed before day zero is dropped, and the number dropped is stated", () => {
  const r = closedWithoutTrace(
    [task("T-1", { status: "charted", updated: "2025-12-31" }), task("T-2", { status: "charted", updated: "2026-01-09" })],
    {}, { archived: CONFIG.archivedStatuses, since: "2026-01-01" }
  );
  assert.deepEqual(r.found.map((f) => f.task), ["T-2"]);
  assert.equal(r.skipped, 1, "a silently dropped task is as misleading as an accused one");
});

// ── Reopened after closing ────────────────────────────────────────────────

test("FINDS: a transition out of a closed status, blamed on whoever CLOSED it", () => {
  const history = {
    "T-1": [
      entry("T-1", { from: "surveying", to: "charted", actor: "agent:closer", ts: "2026-01-05T00:00:00.000Z" }),
      entry("T-1", { from: "charted", to: "surveying", actor: "local:noticer", ts: "2026-01-07T00:00:00.000Z" }),
    ],
  };
  const r = reopenedAfterClosing(history, { archived: CONFIG.archivedStatuses });
  assert.equal(r.found.length, 1);
  // The reopener is the person who NOTICED, not the one who caused it.
  assert.equal(r.found[0].closedBy, "agent:closer");
  assert.equal(r.found[0].reopenedBy, "local:noticer");
});

test("SILENT: a task closed once and left alone", () => {
  const r = reopenedAfterClosing({ "T-1": [entry("T-1")] }, { archived: CONFIG.archivedStatuses });
  assert.deepEqual(r.found, []);
  assert.equal(r.byActor.get("agent:x").closings, 1);
});

test("SILENT: moving between two OPEN statuses is not a reopening", () => {
  const history = { "T-1": [entry("T-1", { from: "icebox", to: "surveying" })] };
  assert.deepEqual(reopenedAfterClosing(history, { archived: CONFIG.archivedStatuses }).found, []);
});

test("a bucket below min_report_n reports its count and NO rate", () => {
  const byActor = new Map([
    ["agent:busy", { actor: "agent:busy", closings: 10, reopens: 2 }],
    ["local:rare", { actor: "local:rare", closings: 3, reopens: 3 }],
  ]);
  const rows = reworkRates(byActor, 8);
  assert.equal(rows[0].rate, 0.2);
  assert.equal(rows[0].enough, true);
  // `null`, not `0`: "too few to say" and "never comes back" are different
  // answers, and a zero would be read as the second — here it would libel
  // somebody with a 100% rate as if they had none.
  assert.equal(rows[1].rate, null);
  assert.equal(rows[1].enough, false);
});

// ── Parked ────────────────────────────────────────────────────────────────

test("FINDS: in progress, with nothing recorded for longer than the threshold", () => {
  const r = parked([task("T-1", { status: "surveying", updated: "2026-01-01" })], {},
    { inProgressStatus: "surveying", staleDays: 7, today: "2026-01-20" });
  assert.deepEqual(r.found.map((f) => f.task), ["T-1"]);
  assert.equal(r.found[0].days, 19);
});

test("SILENT: the same task, touched yesterday", () => {
  const r = parked([task("T-1", { status: "surveying", updated: "2026-01-19" })], {},
    { inProgressStatus: "surveying", staleDays: 7, today: "2026-01-20" });
  assert.deepEqual(r.found, []);
});

test("a history entry counts as a touch even when `updated:` is stale", () => {
  const r = parked([task("T-1", { status: "surveying", updated: "2026-01-01" })],
    { "T-1": [entry("T-1", { ts: "2026-01-19T00:00:00.000Z" })] },
    { inProgressStatus: "surveying", staleDays: 7, today: "2026-01-20" });
  assert.deepEqual(r.found, []);
});

test("a backlog that never said which status means `in progress` gets a reason, not a guess", () => {
  const r = parked([task("T-1", { status: "surveying" })], {}, { inProgressStatus: null, staleDays: 7, today: "2026-01-20" });
  assert.deepEqual(r.found, []);
  assert.match(r.reason, /does not say which status means/);
});

// ── No premise ────────────────────────────────────────────────────────────

test("FINDS: a status that needs a reason, standing with an empty blocked_by", () => {
  const r = withoutPremise([task("T-1", { status: "stuck" })],
    { reasonRequired: CONFIG.reasonRequiredStatuses, archived: CONFIG.archivedStatuses });
  assert.deepEqual(r.found.map((f) => f.task), ["T-1"]);
});

test("SILENT: the same status, with a blocker named", () => {
  const r = withoutPremise([task("T-1", { status: "stuck", blocked_by: ["T-2"] })],
    { reasonRequired: CONFIG.reasonRequiredStatuses, archived: CONFIG.archivedStatuses });
  assert.deepEqual(r.found, []);
});

test("an ARCHIVED status in that list is not asked for a premise", () => {
  // `charted` requires a reason and is closed; a closed task is not waiting on
  // anything, so an empty `blocked_by` there says nothing.
  const r = withoutPremise([task("T-1", { status: "charted" })],
    { reasonRequired: CONFIG.reasonRequiredStatuses, archived: CONFIG.archivedStatuses });
  assert.deepEqual(r.found, []);
});

test("a backlog with no ACTIVE reason-required status gets a reason, not silence", () => {
  const r = withoutPremise([task("T-1", { status: "icebox" })], { reasonRequired: ["charted"], archived: ["charted"] });
  assert.match(r.reason, /no ACTIVE status/);
});

// ── The whole report ──────────────────────────────────────────────────────

test("a clean backlog reports nothing — and one edit makes it report something", () => {
  const tasks = [task("T-1", { status: "charted" })];
  const history = { "T-1": [entry("T-1")] };
  const clean = auditBacklog({ tasks, history, config: CONFIG, since: null, today: "2026-01-20" });
  assert.equal(clean.findings, 0);

  // The positive control for the whole report: same input, one status changed.
  const dirty = auditBacklog({
    tasks: [task("T-1", { status: "stuck" })], history, config: CONFIG, since: null, today: "2026-01-20",
  });
  assert.equal(dirty.findings, 1);
  assert.deepEqual(dirty.withoutPremise.found.map((f) => f.task), ["T-1"]);
});

// ── The command ───────────────────────────────────────────────────────────

function backlog() {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-audit-" + counter++ + "-"));
  assert.equal(run(["init", "--dir", dir, "--no-example"]).status, 0);
  const p = join(dir, "config.yaml");
  writeFileSync(p, readFileSync(p, "utf8")
    .replace(/^statuses:.*$/m, "statuses: [" + CONFIG.statuses.join(", ") + "]")
    .replace(/^archived_statuses:.*$/m, "archived_statuses: [charted]")
    .replace(/^dashboard_open_statuses:.*$/m, "dashboard_open_statuses: [icebox, surveying, stuck]")
    .replace(/^reason_required_statuses:.*$/m, "reason_required_statuses: [stuck, charted]"), "utf8");
  appendFileSync(p, "\nin_progress_status: surveying\n", "utf8");
  alignTemplate(dir);
  return dir;
}

function newTask(dir, title) {
  const r = run(["new", "--dir", dir, "--title", title]);
  assert.equal(r.status, 0, r.stderr);
  return { id: r.stdout.match(/[A-Z]+-\d+/)[0], file: r.stdout.match(/(\S+\.md)/)[1] };
}

test("a backlog with nothing to report exits 0, and one with a finding exits 1", () => {
  const dir = backlog();
  const t = newTask(dir, "A task with a premise problem");

  const clean = run(["audit", "--dir", dir]);
  assert.equal(clean.status, 0, clean.stdout);
  assert.match(clean.stdout, /nothing to report/);

  // One hand edit into the status that carries a premise, with none named.
  writeFileSync(t.file, readFileSync(t.file, "utf8").replace(/^status: .*$/m, "status: stuck"), "utf8");
  const dirty = run(["audit", "--dir", dir]);
  assert.equal(dirty.status, 1, "a finding must be visible in the exit code");
  assert.match(dirty.stdout, /no premise/);
  assert.match(dirty.stdout, new RegExp(t.id));
});

test("the statuses come from config.yaml — no default word appears in the report", () => {
  const dir = backlog();
  const t = newTask(dir, "Judged by this project's own words");
  writeFileSync(t.file, readFileSync(t.file, "utf8").replace(/^status: .*$/m, "status: stuck"), "utf8");
  // `blocked_by` is a FIELD, fixed in the schema, and naming it is not naming a
  // status — so it is removed before the scan rather than the word `blocked`
  // being dropped from the list, which would have hidden a real leak.
  const text = run(["audit", "--dir", dir]).stdout.split("blocked_by").join("<field>");
  for (const word of ["pending", "in_progress", "blocked", "done"]) {
    assert.ok(!text.includes(word), "a default status leaked into the report: " + word);
  }
});

test("it says outright that it is not a judgement of anybody", () => {
  const dir = backlog();
  assert.match(run(["audit", "--dir", dir]).stdout, /not a judgement of anybody's work/i);
});

test("--json answers in the envelope and keeps the exit code", () => {
  const dir = backlog();
  const t = newTask(dir, "A program reads this");
  writeFileSync(t.file, readFileSync(t.file, "utf8").replace(/^status: .*$/m, "status: stuck"), "utf8");

  const r = run(["audit", "--dir", dir, "--json"]);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.kind, "audit");
  assert.equal(doc.findings, 1);
  assert.deepEqual(doc.withoutPremise.map((f) => f.task), [t.id]);
  assert.equal(r.status, 1, "the JSON describes the result, it does not replace the exit code");
});

test("audit is not check — a backlog audit finds says nothing about `check`", () => {
  const dir = backlog();
  const t = newTask(dir, "Structurally fine, declaratively not");
  writeFileSync(t.file, readFileSync(t.file, "utf8").replace(/^status: .*$/m, "status: stuck"), "utf8");
  assert.equal(run(["audit", "--dir", dir]).status, 1);
  assert.equal(run(["check", "--dir", dir, "--refs", "--vocabulary"]).status, 0,
    "the two commands must be able to disagree — different question, different moment");
});
