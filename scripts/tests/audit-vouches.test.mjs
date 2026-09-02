/**
 * `audit` counts the vouches somebody gave for `manual:` entries (TL-171).
 *
 * WHAT IS BEING MEASURED, and why it is a table rather than a gate. A `manual:`
 * entry is the one part of a contract no command can run, so its whole value is
 * that a named actor stood behind it. `--confirm-manual` is a legitimate way to
 * do that and is all an unattended run has — but it is also the path of least
 * resistance, and a backlog where every human check is answered by the flag has
 * manual entries in name only. Nothing here refuses anything; it makes the
 * difference visible, which it was not.
 *
 * THE HARD CASE THIS FILE EXISTS FOR is the third bucket. Vouches written
 * before the distinction was recorded carry no `vouch` field, the log is
 * append-only, and nothing may decide after the fact which they were. They must
 * be counted apart and must never reach a rate — a denominator that swallowed
 * them would report a backlog as more careful than anything can know it to be.
 *
 * The interactive `typed` path is proved through the pure function rather than
 * end to end: the prompt reads `/dev/tty`, and a spawned test has none. The
 * end-to-end case therefore covers the flag, which is the path an unattended
 * queue actually takes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { auditBacklog, vouches } from "../audit.mjs";
import { FIELD_VERIFIED, VOUCH_SOURCES } from "../history.mjs";
import { alignTemplate, isolateHome } from "./_repo.mjs";

isolateHome("audit-vouches");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

let counter = 0;

function run(args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1" },
  });
}

const MANUAL = "Somebody opened it and the columns were there";

/** A `__verified__` entry, the shape `done` writes. */
const vouch = (actor, how, over = {}) => ({
  field: FIELD_VERIFIED, from: "", to: MANUAL, actor, source: "done",
  ts: "2026-01-01T00:00:00.000Z", ...(how ? { vouch: how } : {}), ...over,
});

// ── Counting ──────────────────────────────────────────────────────────────

test("FINDS: a vouch is listed with the actor and the entry they stood behind", () => {
  const r = vouches({ "T-1": [vouch("user:kim", "typed")] }, { minN: 8 });
  assert.equal(r.found.length, 1);
  assert.deepEqual(
    { ...r.found[0] },
    { task: "T-1", actor: "user:kim", how: "typed", when: "2026-01-01", manual: MANUAL }
  );
});

test("typed and flag are counted apart — that difference is the whole question", () => {
  const r = vouches({
    "T-1": [vouch("user:kim", "typed"), vouch("agent:bot", "flag"), vouch("agent:bot", "flag")],
  }, { minN: 1 });
  const bot = r.table.find((x) => x.actor === "agent:bot");
  const kim = r.table.find((x) => x.actor === "user:kim");
  assert.deepEqual([bot.vouches, bot.typed, bot.flag], [2, 0, 2]);
  assert.deepEqual([kim.vouches, kim.typed, kim.flag], [1, 1, 0]);
  assert.equal(bot.rate, 1, "every vouch this actor gave came from the flag");
  assert.equal(kim.rate, 0);
});

test("an entry that does not say how is `unrecorded`, and is assigned to NEITHER", () => {
  const r = vouches({ "T-1": [vouch("agent:bot", null)] }, { minN: 1 });
  const row = r.table[0];
  assert.deepEqual([row.vouches, row.typed, row.flag, row.unrecorded], [1, 0, 0, 1]);
  assert.equal(r.found[0].how, "unrecorded");
});

test("the unrecorded ones stay OUT of the denominator, so no rate is invented", () => {
  // One flag and nine that never said. A denominator of ten would report 10%
  // "by flag" — a number about a backlog nobody measured.
  const history = { "T-1": [vouch("agent:bot", "flag"), ...Array.from({ length: 9 }, () => vouch("agent:bot", null))] };
  const row = vouches(history, { minN: 8 }).table[0];
  assert.equal(row.vouches, 10);
  assert.equal(row.unrecorded, 9);
  assert.equal(row.enough, false, "one known vouch is not eight, whatever the total says");
  assert.equal(row.rate, null);
});

test("below min_report_n there is a count and NO rate", () => {
  const row = vouches({ "T-1": [vouch("agent:bot", "flag")] }, { minN: 8 }).table[0];
  assert.equal(row.rate, null, "`null`, not 0 — `too few to say` and `never` are different answers");
  assert.equal(row.enough, false);
});

test("an actor nobody recorded is counted, not dropped", () => {
  const r = vouches({ "T-1": [vouch("", "flag")] }, { minN: 1 });
  assert.equal(r.table[0].actor, "unknown");
});

test("SILENT: a history with no vouch at all produces an empty table, not a crash", () => {
  const r = vouches({ "T-1": [{ field: "status", from: "a", to: "b", ts: "2026-01-01T00:00:00.000Z" }] }, { minN: 8 });
  assert.deepEqual(r.found, []);
  assert.deepEqual(r.table, []);
});

test("a vouch is never counted as a FINDING — this reports, it does not gate", () => {
  const report = auditBacklog({
    tasks: [{ id: "T-1", title: "T", status: "charted", blocked_by: [], updated: "2026-01-10" }],
    history: { "T-1": [{ field: "status", from: "surveying", to: "charted", actor: "agent:bot", ts: "2026-01-10T00:00:00.000Z" },
                       vouch("agent:bot", "flag")] },
    config: { archivedStatuses: ["charted"], reasonRequiredStatuses: [], inProgressStatus: "surveying",
              auditStaleDays: 7, minReportN: 8 },
    since: "2026-01-01", today: "2026-01-11",
  });
  assert.equal(report.vouches.found.length, 1);
  assert.equal(report.findings, 0, "a vouch is a fact about how work closed, not a disagreement to report");
});

// ── The command ───────────────────────────────────────────────────────────

function backlog() {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-vouches-" + counter++ + "-"));
  assert.equal(run(["init", "--dir", dir, "--no-example"]).status, 0);
  alignTemplate(dir);
  return dir;
}

function taskWithManual(dir) {
  const r = run(["new", "--dir", dir, "--title", "A check only a person can make"]);
  assert.equal(r.status, 0, r.stderr);
  const id = r.stdout.match(/[A-Z]+-\d+/)[0];
  const file = r.stdout.match(/(\S+\.md)/)[1];
  writeFileSync(file, readFileSync(file, "utf8")
    .replace(/^verification:[\s\S]*?(?=^---$)/m,
      'verification:\n  - id: automatic\n    bash: "true"\n  - id: looked-at\n    manual: "' + MANUAL + '"\n')
    .replace("[proof: the-name]", "[proof: automatic]"), "utf8");
  assert.equal(run(["take", id, "--dir", dir, "--actor", "agent:test"]).status, 0);
  return { id, file };
}

test("SILENT: a backlog with no vouches SAYS so — an empty section is not a missing one", () => {
  const dir = backlog();
  const r = run(["audit", "--dir", dir]);
  assert.match(r.stdout, /vouched `manual:` entries {2}\(0\)/);
  assert.match(r.stdout, /nothing to report, not nothing to see/);
  assert.deepEqual(JSON.parse(run(["audit", "--dir", dir, "--json"]).stdout).vouches, []);
});

test("END TO END: `--confirm-manual` is recorded as the flag, and audit says who", () => {
  const dir = backlog();
  const t = taskWithManual(dir);

  assert.equal(run(["done", t.id, "--dir", dir, "--actor", "agent:test", "--confirm-manual"]).status, 0);

  const log = readFileSync(join(dir, "history", t.id + ".jsonl"), "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const written = log.filter((e) => e.field === FIELD_VERIFIED);
  assert.equal(written.length, 1);
  assert.equal(written[0].vouch, "flag", "the path has to be recorded at the moment it is taken");

  const json = JSON.parse(run(["audit", "--dir", dir, "--json"]).stdout);
  assert.deepEqual(json.vouches.map((v) => [v.task, v.actor, v.how]), [[t.id, "agent:test", "flag"]]);
  assert.deepEqual(
    json.vouchesByActor.map((r) => [r.actor, r.vouches, r.typed, r.flag, r.unrecorded]),
    [["agent:test", 1, 0, 1, 0]]
  );

  const text = run(["audit", "--dir", dir]).stdout;
  assert.match(text, /agent:test/);
  assert.match(text, /1 by flag/);
});

test("every value the writer can produce is one the constant lists", () => {
  const dir = backlog();
  const t = taskWithManual(dir);
  run(["done", t.id, "--dir", dir, "--actor", "agent:test", "--confirm-manual"]);
  const log = readFileSync(join(dir, "history", t.id + ".jsonl"), "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const seen = log.filter((e) => e.field === FIELD_VERIFIED).map((e) => e.vouch);
  assert.ok(seen.length > 0, "a zero sample would pass this vacuously");
  for (const how of seen) assert.ok(VOUCH_SOURCES.includes(how), "unlisted vouch source: " + how);
});

test("the findings that existed before this task are untouched, and so is the exit code", () => {
  const dir = backlog();
  const t = taskWithManual(dir);
  const before = JSON.parse(run(["audit", "--dir", dir, "--json"]).stdout);
  assert.equal(before.findings, 0);

  run(["done", t.id, "--dir", dir, "--actor", "agent:test", "--confirm-manual"]);

  const after = run(["audit", "--dir", dir, "--json"]);
  const report = JSON.parse(after.stdout);
  assert.equal(report.vouches.length, 1, "a positive control: the vouch really is there");
  assert.equal(report.findings, 0, "and it changed no finding");
  assert.equal(after.status, 0, "nor the exit code — this table is a report, not a gate");
  for (const key of ["closedWithoutTrace", "reopened", "parked", "withoutPremise", "awaitingVouch"]) {
    assert.deepEqual(report[key], [], "a pre-existing finding changed: " + key);
  }
});

test("it stays a report, and says so where the table is", () => {
  const dir = backlog();
  const t = taskWithManual(dir);
  run(["done", t.id, "--dir", dir, "--actor", "agent:test", "--confirm-manual"]);
  const text = run(["audit", "--dir", dir]).stdout;
  assert.match(text, /legitimate and is what an unattended run has/);
  assert.match(text, /worth seeing, not punishing/);
});

test("a vouch that never existed is not conjured for a task that has none", () => {
  const dir = backlog();
  taskWithManual(dir);
  assert.deepEqual(JSON.parse(run(["audit", "--dir", dir, "--json"]).stdout).vouches, []);
});
