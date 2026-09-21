/**
 * The boundary between two hands has an exit (TL-277).
 *
 * WHAT WAS MEASURED. TL-151 crossed `spec`↔`dev` three times in eleven hours,
 * four agent runs and 5624 seconds, with every hand correct at every step: the
 * change needed one edit on each side of a charter, and no single hand was
 * allowed to make both. The tool said nothing. The queue reported the task as
 * held elsewhere, which is also what it says about a task waiting for a role
 * nobody serves — so a deadlock and an empty seat read the same.
 *
 * WHAT IS PROVED HERE. `audit` names such a task: the pair of roles, how many
 * times it crossed, and what each hand said when it let go. Both halves matter
 * and both are tested — it FINDS the hand-back, and it stays SILENT on a task
 * that only ever moved forward, because a detector that flags every handoff
 * would make a pipeline unusable rather than measurable.
 *
 * The end-to-end case drives the real `take` and `handoff` commands rather than
 * writing history rows by hand: the finding is computed from what those
 * commands record, and a fixture that writes the rows itself would prove the
 * detector against a shape nothing produces.
 *
 * The roles here are this file's own invention. A role vocabulary is a project's
 * DATA, so asserting `spec` or `dev` would be asserting another project's values.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { auditBacklog, handedBackAcross } from "../audit.mjs";
import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each file
// in its own process, so one call covers every case in it.
isolateHome("pipeline-deadlock");

const CLI = join(SCRIPTS_DIR, "cli.mjs");

let counter = 0;
function run(args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1" },
  });
}

// A vocabulary of this fixture's own — see the header.
const ROLES = ["cartographer", "surveyor"];
const CONFIG = {
  statuses: ["icebox", "surveying", "charted"],
  archivedStatuses: ["charted"],
  reasonRequiredStatuses: ["charted"],
  inProgressStatus: "surveying",
  auditStaleDays: 7,
};

const task = (id, over = {}) => ({
  id, title: "T " + id, status: "icebox", blocked_by: [], owner: "",
  created: "2026-01-01", updated: "2026-01-10", ...over,
});
const cross = (from, to, over = {}) => ({
  field: "role", from, to, source: "handoff", actor: "agent:" + from,
  ts: "2026-01-10T00:00:00.000Z", reason: "because " + from + " may not", ...over,
});

// ── The detector, both halves ─────────────────────────────────────────────

test("FINDS: an open task handed over and then handed straight back", () => {
  const r = handedBackAcross(
    [task("T-1", { status: "icebox" })],
    {
      "T-1": [
        cross(ROLES[0], ROLES[1], { ts: "2026-01-10T01:00:00.000Z", reason: "the contract is written" }),
        cross(ROLES[1], ROLES[0], { ts: "2026-01-10T02:00:00.000Z", reason: "the last line is on your side of the charter" }),
      ],
    },
    { archived: CONFIG.archivedStatuses }
  );
  assert.equal(r.found.length, 1);
  const [f] = r.found;
  assert.equal(f.task, "T-1");
  assert.deepEqual(f.roles, ROLES.slice().sort());
  assert.equal(f.crossings, 2);
  // BOTH hands' reasons, because the evidence for whose charter is wrong is the
  // pair of sentences and not either one of them.
  assert.deepEqual(f.legs.map((l) => l.reason), [
    "the contract is written",
    "the last line is on your side of the charter",
  ]);
});

test("SILENT: a task that only ever moved forward, however many times", () => {
  const r = handedBackAcross(
    [task("T-1")],
    {
      "T-1": [
        cross(ROLES[0], ROLES[1], { ts: "2026-01-10T01:00:00.000Z" }),
        cross(ROLES[0], ROLES[1], { ts: "2026-01-11T01:00:00.000Z" }),
      ],
    },
    { archived: CONFIG.archivedStatuses }
  );
  assert.deepEqual(r.found, []);
});

test("SILENT: a task that crossed both ways and then SHIPPED", () => {
  // A closed task is history, not work to act on. A report that keeps naming it
  // is a report people stop reading.
  const history = {
    "T-1": [
      cross(ROLES[0], ROLES[1], { ts: "2026-01-10T01:00:00.000Z" }),
      cross(ROLES[1], ROLES[0], { ts: "2026-01-10T02:00:00.000Z" }),
    ],
  };
  assert.equal(handedBackAcross([task("T-1", { status: "charted" })], history, { archived: CONFIG.archivedStatuses }).found.length, 0);
  assert.equal(handedBackAcross([task("T-1", { status: "icebox" })], history, { archived: CONFIG.archivedStatuses }).found.length, 1,
    "positive control: the same history on an OPEN task IS a finding — otherwise the assertion above proves nothing");
});

test("SILENT: a task with no role in its history at all", () => {
  const history = { "T-1": [{ field: "status", from: "icebox", to: "surveying", ts: "2026-01-10T00:00:00.000Z" }] };
  assert.deepEqual(handedBackAcross([task("T-1")], history, { archived: CONFIG.archivedStatuses }).found, []);
});

test("two roles are ONE boundary, seen from two sides", () => {
  // `a`→`b` and `b`→`a` must not be reported as two separate findings: the
  // question is which charter pair the task cannot escape, and it is one pair.
  const r = handedBackAcross(
    [task("T-1")],
    {
      "T-1": [
        cross(ROLES[0], ROLES[1], { ts: "2026-01-10T01:00:00.000Z" }),
        cross(ROLES[1], ROLES[0], { ts: "2026-01-10T02:00:00.000Z" }),
        cross(ROLES[0], ROLES[1], { ts: "2026-01-10T03:00:00.000Z" }),
      ],
    },
    { archived: CONFIG.archivedStatuses }
  );
  assert.equal(r.found.length, 1, "one boundary, one finding");
  assert.equal(r.found[0].crossings, 3);
});

test("the hand-back counts as a finding of the report as a whole", () => {
  const report = auditBacklog({
    tasks: [task("T-1")],
    history: {
      "T-1": [
        cross(ROLES[0], ROLES[1], { ts: "2026-01-10T01:00:00.000Z" }),
        cross(ROLES[1], ROLES[0], { ts: "2026-01-10T02:00:00.000Z" }),
      ],
    },
    config: CONFIG,
    since: "2026-01-01",
    today: "2026-01-10",
  });
  assert.equal(report.findings, 1, "a deadlock that does not count is a deadlock nobody is told about");
  assert.deepEqual(report.handedBack.found.map((f) => f.task), ["T-1"]);
});

// ── End to end, through the commands that write the record ────────────────

function backlog() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-deadlock-" + counter++ + "-"));
  assert.equal(run(["init", "--dir", dir, "--no-example"]).status, 0);
  appendFileSync(join(dir, "config.yaml"), "\nroles: [" + ROLES.join(", ") + "]\n", "utf8");
  return dir;
}

function newTask(dir, title, role) {
  const r = run(["new", "--dir", dir, "--title", title]);
  assert.equal(r.status, 0, r.stderr);
  const file = r.stdout.match(/(\S+\.md)/)[1];
  // The first role is set by hand because this fixture needs a STARTING side of
  // the boundary; every crossing after it is written by `handoff` itself, which
  // is what the finding is computed from.
  writeFileSync(file, readFileSync(file, "utf8").replace(/^role: .*$/m, "role: " + role), "utf8");
  return { id: r.stdout.match(/[A-Z]+-\d+/)[0], file };
}

function hand(dir, id, actor, toRole, reason) {
  const taken = run(["take", id, "--dir", dir, "--actor", actor]);
  assert.equal(taken.status, 0, taken.stderr);
  const handed = run(["handoff", id, "--dir", dir, "--actor", actor, "--to-role", toRole, "--reason", reason]);
  assert.equal(handed.status, 0, handed.stderr);
}

const OVER = "the contract is written; the code is another hand's";
const BACK = "the code is written, and the last line needed is on your side";

test("a task passed back across the same boundary is named, with both reasons", () => {
  const dir = backlog();
  const t = newTask(dir, "A change that needs both charters", ROLES[0]);

  hand(dir, t.id, "agent:one", ROLES[1], OVER);
  hand(dir, t.id, "agent:two", ROLES[0], BACK);

  const r = run(["audit", "--dir", dir, "--json"]);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.kind, "audit");
  assert.deepEqual(doc.handedBack.map((f) => f.task), [t.id]);
  assert.deepEqual(doc.handedBack[0].roles, ROLES.slice().sort());
  assert.equal(doc.handedBack[0].crossings, 2);
  assert.deepEqual(doc.handedBack[0].legs.map((l) => l.reason), [OVER, BACK]);
  assert.equal(r.status, 1, "a finding is visible in the exit code");

  const text = run(["audit", "--dir", dir]).stdout;
  assert.match(text, new RegExp(t.id), "the report does not name the task");
  assert.match(text, new RegExp(ROLES[0] + ".{0,5}" + ROLES[1]), "the report does not name the boundary");
  assert.ok(text.includes(BACK), "the report does not carry what the hand said when it let go");
});

test("a one-way handoff is not a finding", () => {
  const dir = backlog();
  const t = newTask(dir, "A task that moves forward", ROLES[0]);
  hand(dir, t.id, "agent:one", ROLES[1], OVER);

  const r = run(["audit", "--dir", dir, "--json"]);
  const doc = JSON.parse(r.stdout);
  assert.deepEqual(doc.handedBack, [], "an ordinary stage change was reported as a deadlock");
  assert.equal(doc.findings, 0, doc.findings + " finding(s) on a backlog whose only event is one handoff");
  assert.equal(r.status, 0);
});
