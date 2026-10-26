/**
 * Agent time per estimate bucket, computed from the task ledger (TL-480).
 *
 * Every expectation below is established by a FIXTURE: a history this file
 * writes, with timestamps whose differences are computed by hand. Nothing here
 * reads this repository's own `backlog/history/`, because an assertion about
 * real data changes its own verdict as more data arrives.
 *
 * The risk being guarded is a number that looks right and is not: a handoff
 * that erases the first half of the work, a claim left open overnight averaged
 * in as eleven hours of effort, a person's work timed as an agent's, a bucket of
 * three samples printed with the authority of a measurement.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { get } from "node:http";
import { createServer } from "node:net";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { agentEstimate, agentEstimateText, agentSegments, agentTime, agentTimeHint, measureTask } from "../agent-time.mjs";

import { isolateHome, isolateState } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166): without it a test reads the
// developer's user configuration and answers differently on another machine.
isolateHome("agent-time");
// The served page registers itself beside the locks; a test server must not
// land in the developer's registry.
isolateState("agent-time");

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");

const OPTS = { inProgressStatus: "in_progress", closedStatus: "done", minN: 3, capHours: 8 };

const T0 = Date.parse("2026-10-01T09:00:00.000Z");
const at = (minutes) => new Date(T0 + minutes * 60_000).toISOString();
const status = (minutes, from, to, actor) =>
  ({ ts: at(minutes), field: "status", from, to, actor: actor || "agent:claude" });

/** The ledger of one task claimed by an agent and closed `minutes` later. */
function straight(minutes, actor) {
  return [
    status(0, "pending", "in_progress", actor),
    status(minutes, "in_progress", "done", actor),
  ];
}

// ── Segments ──────────────────────────────────────────────────────────────

test("a handoff splits the work into two segments, and both are counted", () => {
  const records = [
    status(0, "pending", "in_progress"),
    status(10, "in_progress", "pending"),     // handed back
    status(60, "pending", "in_progress"),     // re-claimed
    status(75, "in_progress", "done"),
  ];
  const s = agentSegments(records, OPTS);
  assert.deepEqual(s.segments.map((x) => x.minutes), [10, 15]);
  const m = measureTask({ id: "X-1", status: "done", estimate: "2h" }, records, OPTS);
  assert.equal(m.kind, "measured");
  assert.equal(m.minutes, 25, "the hour spent back in the queue is not work");
});

test("time in blocked and awaiting_vouch is not counted", () => {
  const records = [
    status(0, "pending", "in_progress"),
    status(5, "in_progress", "blocked"),
    status(500, "blocked", "in_progress"),
    status(520, "in_progress", "awaiting_vouch"),
    status(2000, "awaiting_vouch", "done"),
  ];
  const m = measureTask({ id: "X-2", status: "done", estimate: "2h" }, records, OPTS);
  assert.equal(m.kind, "measured");
  assert.equal(m.minutes, 25);
});

test("a segment longer than the cap makes the task an outlier, kept out of every bucket", () => {
  const m = measureTask({ id: "X-3", status: "done", estimate: "2h" }, straight(11 * 60), OPTS);
  assert.equal(m.kind, "outlier");
  const report = agentTime(
    [{ id: "X-3", status: "done", estimate: "2h" }],
    { "X-3": straight(11 * 60) },
    OPTS
  );
  assert.deepEqual(report.outliers, ["X-3"]);
  assert.equal(report.buckets.length, 0);
});

test("a task claimed only by a person is unmeasured; one worked partly by a person is mixed", () => {
  const human = measureTask({ id: "X-4", status: "done", estimate: "2h" }, straight(30, "local:me"), OPTS);
  assert.equal(human.kind, "unmeasured");
  const both = [
    status(0, "pending", "in_progress", "local:me"),
    status(30, "in_progress", "pending", "local:me"),
    status(40, "pending", "in_progress", "agent:claude"),
    status(50, "in_progress", "done", "agent:claude"),
  ];
  const mixed = measureTask({ id: "X-5", status: "done", estimate: "2h" }, both, OPTS);
  assert.equal(mixed.kind, "mixed", "the agent half alone would understate the task");
});

test("a closed task with no claim at all is counted as unmeasured, not as zero", () => {
  const records = [status(0, "pending", "done", "unknown")];
  const report = agentTime([{ id: "X-6", status: "done", estimate: "2h" }], { "X-6": records }, OPTS);
  assert.equal(report.unmeasured, 1);
  assert.equal(report.measured, 0);
});

test("only the closing status is measured — a cancelled task says nothing about its estimate", () => {
  const report = agentTime(
    [{ id: "X-7", status: "cancelled", estimate: "2h" }],
    { "X-7": [status(0, "pending", "in_progress"), status(9, "in_progress", "cancelled")] },
    OPTS
  );
  assert.equal(report.measured + report.unmeasured + report.mixed + report.outliers.length, 0);
});

test("a task with no countable estimate is counted apart from one never measured", () => {
  const report = agentTime(
    [{ id: "X-8", status: "done", estimate: "soon" }],
    { "X-8": straight(10) },
    OPTS
  );
  assert.equal(report.unestimated, 1);
  assert.equal(report.unmeasured, 0);
});

// ── Buckets and the verdict ───────────────────────────────────────────────

function fleet(spec) {
  const tasks = [];
  const history = {};
  let n = 0;
  for (const [estimate, minutesList] of Object.entries(spec)) {
    for (const minutes of minutesList) {
      const id = "F-" + ++n;
      tasks.push({ id, status: "done", estimate });
      history[id] = straight(minutes);
    }
  }
  return { tasks, history };
}

test("below the threshold a bucket says insufficient and carries no number", () => {
  const { tasks, history } = fleet({ "2h": [5, 7] });
  const report = agentTime(tasks, history, OPTS);
  assert.equal(report.buckets.length, 1);
  const b = report.buckets[0];
  assert.equal(b.insufficient, true);
  assert.equal(b.n, 2);
  assert.equal(b.median, undefined);
  assert.equal(report.verdict.verdict, "insufficient");
});

test("a bucket over the threshold is a range with its median, keyed by hours", () => {
  // `120m` and `2h` are the same estimate written twice; splitting them would
  // halve the sample.
  const { tasks, history } = fleet({ "2h": [10, 20], "120m": [30, 40, 50] });
  const report = agentTime(tasks, history, OPTS);
  assert.equal(report.buckets.length, 1);
  const b = report.buckets[0];
  assert.equal(b.label, "2h");
  assert.equal(b.n, 5);
  assert.equal(b.insufficient, false);
  assert.equal(b.median, 30);
  assert.equal(b.p20, 18);
  assert.equal(b.p80, 42);
  assert.equal(report.measured, 5);
});

test("buckets that separate read as correlated; buckets that overlap read as uncorrelated", () => {
  const apart = agentTime(...Object.values(fleet({ "30m": [4, 5, 6], "1d": [40, 50, 60] })), OPTS);
  assert.equal(apart.verdict.verdict, "correlated");
  const overlap = agentTime(...Object.values(fleet({ "30m": [1, 10, 60], "1d": [2, 12, 58] })), OPTS);
  assert.equal(overlap.verdict.verdict, "uncorrelated");
});

// ── The hint ──────────────────────────────────────────────────────────────

test("the hint is absent below the threshold and present above it", () => {
  const thin = agentTime(...Object.values(fleet({ "2h": [5, 7] })), OPTS);
  assert.equal(agentTimeHint(thin, "2h"), null);
  const solid = agentTime(...Object.values(fleet({ "2h": [5, 7, 9] })), OPTS);
  const b = agentTimeHint(solid, "2h");
  assert.ok(b, "a bucket at the threshold speaks");
  assert.equal(agentTimeHint(solid, "1w"), null, "an estimate with no bucket has nothing to say");
  assert.equal(agentTimeHint(solid, "soon"), null);
});

// ── The computed field ────────────────────────────────────────────────────

test("agent_estimate is the bucket shaped as a field, null below the threshold", () => {
  assert.equal(agentEstimate(agentTime(...Object.values(fleet({ "2h": [5, 7] })), OPTS), "2h"), null);
  const field = agentEstimate(agentTime(...Object.values(fleet({ "2h": [5, 7, 9] })), OPTS), "2h");
  assert.deepEqual(field, { label: "6m–8m", median: 7, p20: 5.8, p80: 8.2, n: 3, verdict: "insufficient" });
  // The verdict is said beside the number whenever it does not support planning.
  assert.equal(agentEstimateText(field), "6m–8m, median 7m (n=3) — insufficient");
  assert.equal(agentEstimateText({ ...field, verdict: "correlated" }), "6m–8m, median 7m (n=3)");
  assert.equal(agentEstimateText(null), "");
});

// ── The commands, on a fixture backlog ────────────────────────────────────

function fixtureBacklog(minN, samples) {
  const dir = mkdtempSync(join(tmpdir(), "branchling-agent-time-"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  const init = spawnSync(process.execPath, [CLI, "init", "--dir", ".", "--no-example"], { cwd: dir, encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  const cfgPath = join(dir, "config.yaml");
  writeFileSync(cfgPath, readFileSync(cfgPath, "utf8") + "\nagent_time_min_n: " + minN + "\n");
  mkdirSync(join(dir, "history"), { recursive: true });
  samples.forEach((minutes, i) => {
    const id = "TASK-" + (i + 1);
    writeFileSync(join(dir, "tasks", id + "-fixture.md"), [
      "---", "id: " + id, "title: \"fixture " + (i + 1) + "\"", "type: task", "labels: []",
      "board: main", "priority: P2", "status: done", "owner: agent:claude", "estimate: 2h",
      "created: 2026-10-01", "updated: 2026-10-01", "blocked_by: []", "blocks: []", "---", "", "## Goal", "", "Fixture.", "",
    ].join("\n"));
    writeFileSync(join(dir, "history", id + ".jsonl"),
      straight(minutes).map((r, k) => JSON.stringify({ id: id + "-" + k, task: id, ...r })).join("\n") + "\n");
  });
  return dir;
}

function cli(dir, args) {
  return spawnSync(process.execPath, [CLI].concat(args), { cwd: dir, encoding: "utf8", timeout: 30_000 });
}

test("stats --agent-time --json reports the bucket and the verdict from the ledger", () => {
  const dir = fixtureBacklog(3, [5, 7, 9]);
  const r = cli(dir, ["stats", "--agent-time", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  const report = d.agentTime;
  assert.equal(report.measured, 3);
  assert.equal(report.buckets[0].median, 7);
  assert.equal(report.verdict.verdict, "insufficient", "one bucket cannot answer the correlation gate");
});

test("new --estimate prints the field only when the bucket meets the threshold", () => {
  const solid = fixtureBacklog(3, [5, 7, 9]);
  const yes = cli(solid, ["new", "--title", "Something to do", "--estimate", "2h"]);
  assert.equal(yes.status, 0, yes.stderr);
  assert.match(yes.stdout, /agent_estimate: 6m–8m, median 7m \(n=3\)/);

  const thin = fixtureBacklog(5, [5, 7, 9]);
  const no = cli(thin, ["new", "--title", "Something to do", "--estimate", "2h"]);
  assert.equal(no.status, 0, no.stderr);
  assert.doesNotMatch(no.stdout, /agent_estimate/);
});

test("an unparseable segment cap is refused by the configuration", () => {
  const dir = fixtureBacklog(3, [5]);
  const cfgPath = join(dir, "config.yaml");
  writeFileSync(cfgPath, readFileSync(cfgPath, "utf8") + "agent_time_segment_cap: overnight\n");
  const r = cli(dir, ["stats", "--agent-time"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /agent_time_segment_cap/);
});

/** A fixture backlog plus one OPEN task estimated `2h`, the one a reader asks about. */
function withOpenTask(minN, samples) {
  const dir = fixtureBacklog(minN, samples);
  writeFileSync(join(dir, "tasks", "TASK-100-open.md"), [
    "---", "id: TASK-100", "title: \"open work\"", "type: task", "labels: []", "board: main",
    "priority: P1", "status: pending", "owner: unassigned", "estimate: 2h",
    "created: 2026-10-01", "updated: 2026-10-01", "blocked_by: []", "blocks: []", "---", "", "## Goal", "", "Open.", "",
  ].join("\n"));
  return dir;
}

test("query --json carries agent_estimate on every row, null where the bucket is thin", () => {
  const solid = withOpenTask(3, [5, 7, 9]);
  const rows = JSON.parse(cli(solid, ["query", "--json"]).stdout).tasks;
  const open = rows.find((t) => t.id === "TASK-100");
  assert.equal(open.agent_estimate.median, 7);
  assert.equal(open.agent_estimate.n, 3);

  const thin = withOpenTask(5, [5, 7, 9]);
  const thinRows = JSON.parse(cli(thin, ["query", "--json"]).stdout).tasks;
  const row = thinRows.find((t) => t.id === "TASK-100");
  assert.ok("agent_estimate" in row, "the key is present even when it has no value");
  assert.equal(row.agent_estimate, null);
});

test("next --json hands the field over ON the task, not beside it", () => {
  const dir = withOpenTask(3, [5, 7, 9]);
  const r = cli(dir, ["next", "--actor", "agent:test", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.equal(d.id, "TASK-100");
  assert.equal(d.task.agent_estimate.median, 7);
  assert.equal("agentTime" in d, false, "the TL-480 top-level key is gone");
});

test("the built viewer embeds the field for a task whose bucket qualifies", () => {
  const dir = withOpenTask(3, [5, 7, 9]);
  const r = cli(dir, ["viewer"]);
  assert.equal(r.status, 0, r.stderr);
  const html = readFileSync(join(dir, "viewer.html"), "utf8");
  const tasks = JSON.parse(html.match(/let ALL_TASKS = (\[.*?\]);\n/s)[1]);
  const open = tasks.find((t) => t.id === "TASK-100");
  assert.equal(open.agent_estimate.text, "6m–8m, median 7m (n=3) — insufficient");
  assert.equal(open.agent_estimate.short, "7m");
});

/** A port nothing holds right now, from the kernel rather than a literal. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function fetchText(port, path) {
  return new Promise((resolve, reject) => {
    get({ host: "127.0.0.1", port, path, timeout: 10_000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve(body));
    }).on("error", reject);
  });
}

test("the SERVED page reads the field from the ledger, not from the plan", async () => {
  // Until TL-482 the server handed the plan to `buildHtml` in the history slot,
  // so the served page folded its history out of plan.yaml while the file://
  // page, which takes the defaults, read the ledger.
  const dir = withOpenTask(3, [5, 7, 9]);
  // The server script itself, not `cli.mjs serve`: the CLI runs it as a child,
  // and killing the parent would leave the child holding the pipe open.
  const proc = spawn(process.execPath, [join(dirname(CLI), "serve-backlog.mjs"), "--dir", dir,
    "--port", String(await freePort()), "--no-open"], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const port = await new Promise((resolve, reject) => {
      let out = "";
      const timer = setTimeout(() => reject(new Error("no port in 20s: " + out)), 20_000);
      proc.stdout.setEncoding("utf8");
      proc.stdout.on("data", (c) => {
        out += c;
        const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
        if (m) { clearTimeout(timer); resolve(Number(m[1])); }
      });
      proc.on("exit", (code) => { clearTimeout(timer); reject(new Error("server exited " + code + ": " + out)); });
    });
    const html = await fetchText(port, "/");
    const tasks = JSON.parse(html.match(/let ALL_TASKS = (\[.*?\]);\n/s)[1]);
    assert.equal(tasks.find((t) => t.id === "TASK-100").agent_estimate.median, 7);
    const history = JSON.parse(html.match(/let HISTORY = (.*?);\n/s)[1]);
    assert.ok(Array.isArray(history["TASK-1"]), "HISTORY is the ledger, keyed by task id");
  } finally {
    await new Promise((resolve) => {
      if (proc.exitCode !== null || proc.signalCode !== null) return resolve();
      proc.on("exit", () => resolve());
      proc.kill("SIGKILL");
    });
  }
});
