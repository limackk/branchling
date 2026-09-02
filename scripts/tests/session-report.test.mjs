/**
 * `sessions` and `session <id>` — the black box for agent work (TL-92).
 *
 * WHAT HAS TO BE PROVED, and TL-92 names four of the five:
 *
 *   1. TWO PARALLEL SESSIONS ON ONE TASK ARE SEPARATE ROWS. This is the case a
 *      fleet of worktrees produces every night, and the case a naive
 *      "group by task" gets wrong.
 *   2. A SESSION THAT MOVED NOTHING IS LISTED, marked. Dropping it would make
 *      the report one you cannot trust to be complete — "it worked and closed
 *      nothing" is the finding, not the absence of one.
 *   3. THE MINUTES COME FROM THE CLUSTERING, not from a second counter here.
 *      Proved against `clusterHeartbeats` directly, because the claim is that
 *      there is ONE implementation and this report inherits it.
 *   4. MISSING COST IS NOT ZERO, and a token count never appears without a
 *      model — a session using two models gets two rows, never one sum.
 *
 * The fifth is this report's own honesty: the join to the history log is by
 * time window, because no session id is recorded there (TL-164), and every
 * answer has to say so.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { activityDir } from "../activity.mjs";
import { clusterHeartbeats } from "../cluster.mjs";
import {
  UNSESSIONED, collectSessions, filterSessions, movedNothing,
  parseSessionArgs, parseSessionsArgs, tokensByModel,
} from "../session-report.mjs";
import { isolateHome } from "./_repo.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

isolateHome("sessions");

let counter = 0;
function run(args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1" },
  });
}

const at = (minutes) => new Date(Date.parse("2026-01-10T09:00:00.000Z") + minutes * 60000).toISOString();
const beat = (session, minutes, over = {}) => ({
  id: session + "-" + minutes, ts: at(minutes), kind: "tool",
  actor: "agent:one", source: "test", session, attribution: "focus", ...over,
});

// ── The invocation ────────────────────────────────────────────────────────

test("the filters are flags, and anything else fails", () => {
  assert.deepEqual(parseSessionsArgs(["--actor", "agent:x"]).actor, "agent:x");
  assert.throws(() => parseSessionsArgs(["--since", "yesterday"]), /is not a date/);
  assert.throws(() => parseSessionsArgs(["abc"]), /unexpected argument/);
  assert.throws(() => parseSessionsArgs(["--who", "x"]), /unknown flag: --who/);
});

test("`session` takes exactly one id", () => {
  assert.equal(parseSessionArgs(["s-1"]).id, "s-1");
  assert.throws(() => parseSessionArgs([]), /which session\?/);
  assert.throws(() => parseSessionArgs(["a", "b"]), /more than one session id/);
});

// ── Two parallel sessions on one task ─────────────────────────────────────

test("two sessions working the SAME task at the same time are separate rows", () => {
  const rowsByTask = {
    "T-1": [
      beat("s-a", 0), beat("s-a", 5), beat("s-a", 9),
      beat("s-b", 1, { actor: "agent:two" }), beat("s-b", 6, { actor: "agent:two" }),
    ],
  };
  const sessions = collectSessions(rowsByTask, {});
  assert.deepEqual(sessions.map((s) => s.session).sort(), ["s-a", "s-b"]);
  assert.deepEqual(sessions.find((s) => s.session === "s-a").actors, ["agent:one"]);
  assert.deepEqual(sessions.find((s) => s.session === "s-b").actors, ["agent:two"]);
});

test("one session across two tasks is ONE row, with both tasks under it", () => {
  const sessions = collectSessions({ "T-1": [beat("s-a", 0), beat("s-a", 5)], "T-2": [beat("s-a", 6), beat("s-a", 9)] }, {});
  assert.equal(sessions.length, 1);
  assert.deepEqual(sessions[0].tasks.map((t) => t.task), ["T-1", "T-2"]);
});

test("rows with no session id go to one named bucket, not into somebody else's", () => {
  const sessions = collectSessions({ "T-1": [beat("", 0), beat("", 3)] }, {});
  assert.deepEqual(sessions.map((s) => s.session), [UNSESSIONED]);
});

// ── The minutes are not counted here ──────────────────────────────────────

test("the minutes are the clustering's, to the digit — there is no second counter", () => {
  const rows = [beat("s-a", 0), beat("s-a", 4), beat("s-a", 40), beat("s-a", 44)];
  const clusters = clusterHeartbeats(rows);
  const expected = Math.round(clusters.reduce((n, c) => n + c.minutes, 0) * 10) / 10;

  const s = collectSessions({ "T-1": rows }, {})[0];
  assert.equal(s.minutes, expected);
  assert.equal(s.clusters, clusters.length, "the gap split two clusters and the report has to see both");
});

test("effort sums the clusters and calendar unions them, so parallel work is not double-counted", () => {
  // The same session on two tasks at the same moments: three heartbeats each,
  // overlapping in time.
  const rows = (task) => [beat("s-a", 0, { id: task + "0" }), beat("s-a", 10, { id: task + "10" })];
  const s = collectSessions({ "T-1": rows("a"), "T-2": rows("b") }, {})[0];
  assert.equal(s.minutes, 20, "effort adds both tasks up");
  assert.equal(s.calendarMinutes, 10, "calendar counts the wall clock once");
});

test("a cluster of one heartbeat measures zero, and the count is reported rather than hidden", () => {
  const s = collectSessions({ "T-1": [beat("s-a", 0)] }, {})[0];
  assert.equal(s.minutes, 0);
  assert.equal(s.singles, 1, "zero minutes and no work are different, and only the count separates them");
});

// ── A session that moved nothing ──────────────────────────────────────────

test("a session with heartbeats and no status change is marked, not dropped", () => {
  const sessions = collectSessions({ "T-1": [beat("s-a", 0), beat("s-a", 5)] }, {});
  assert.equal(sessions.length, 1, "an empty session is a finding, not an absence");
  assert.equal(movedNothing(sessions[0]), true);
});

test("a status change inside the window makes it not empty", () => {
  const history = { "T-1": [{ field: "status", from: "a", to: "b", actor: "agent:one", ts: at(3) }] };
  const s = collectSessions({ "T-1": [beat("s-a", 0), beat("s-a", 5)] }, history)[0];
  assert.equal(movedNothing(s), false);
  assert.equal(s.changes.length, 1);
});

test("a change to the same task OUTSIDE the window belongs to no session here", () => {
  const history = { "T-1": [{ field: "status", from: "a", to: "b", actor: "agent:one", ts: at(90) }] };
  const s = collectSessions({ "T-1": [beat("s-a", 0), beat("s-a", 5)] }, history)[0];
  assert.deepEqual(s.changes, []);
});

test("a change by ANOTHER actor inside the window is shown, with that actor", () => {
  // The known cost of a window join (TL-164): this row is not necessarily this
  // session's work, so the actor travels with it rather than being dropped.
  const history = { "T-1": [{ field: "status", from: "a", to: "b", actor: "local:someone-else", ts: at(3) }] };
  const s = collectSessions({ "T-1": [beat("s-a", 0), beat("s-a", 5)] }, history)[0];
  assert.equal(s.changes[0].actor, "local:someone-else");
});

// ── Tokens ────────────────────────────────────────────────────────────────

test("no tokens recorded is `null`, not zero", () => {
  assert.equal(tokensByModel([beat("s-a", 0)]), null);
  assert.equal(collectSessions({ "T-1": [beat("s-a", 0)] }, {})[0].tokens, null);
});

test("two models in one session are two rows, never one sum", () => {
  const rows = [
    beat("s-a", 0, { tokens: 100, model: "big" }),
    beat("s-a", 3, { tokens: 50, model: "small" }),
    beat("s-a", 6, { tokens: 20, model: "big" }),
  ];
  assert.deepEqual(tokensByModel(rows), [{ model: "big", tokens: 120 }, { model: "small", tokens: 50 }]);
});

test("a count with no model is bucketed as such rather than added to somebody else's", () => {
  const rows = [beat("s-a", 0, { tokens: 100 }), beat("s-a", 3, { tokens: 50, model: "big" })];
  const out = tokensByModel(rows);
  assert.deepEqual(out.map((r) => r.model).sort(), ["(model not recorded)", "big"]);
});

test("a zero or a nonsense token count is not counted at all", () => {
  assert.equal(tokensByModel([beat("s-a", 0, { tokens: 0, model: "big" }), beat("s-a", 1, { tokens: "lots" })]), null);
});

// ── Filters ───────────────────────────────────────────────────────────────

test("--since compares against the END of a session, so one that ran past midnight belongs to the morning", () => {
  const sessions = collectSessions({ "T-1": [beat("s-a", 0), beat("s-a", 5)] }, {});
  assert.equal(filterSessions(sessions, { since: "2026-01-10" }).length, 1);
  assert.equal(filterSessions(sessions, { since: "2026-01-11" }).length, 0);
});

test("--actor and --task narrow without changing what a session is", () => {
  const sessions = collectSessions({
    "T-1": [beat("s-a", 0), beat("s-a", 5)],
    "T-2": [beat("s-b", 0, { actor: "agent:two" }), beat("s-b", 5, { actor: "agent:two" })],
  }, {});
  assert.deepEqual(filterSessions(sessions, { actor: "agent:two" }).map((s) => s.session), ["s-b"]);
  assert.deepEqual(filterSessions(sessions, { task: "T-1" }).map((s) => s.session), ["s-a"]);
  assert.deepEqual(filterSessions(sessions, { actor: "nobody:here" }), []);
});

// ── The commands ──────────────────────────────────────────────────────────

/** A backlog with heartbeats written STRAIGHT INTO the log file: `appendActivity`
 *  validates against a closed row shape, and the token fields an adapter will
 *  one day write are not in it yet. Writing the file is how a test can exercise
 *  the reader before the writer exists.
 *
 *  The path comes from `activityDir()`, because raw heartbeats live in the
 *  user's DATA directory and not inside the backlog (TL-35). `isolateHome()`
 *  above points that at a throwaway directory for this whole process, spawned
 *  commands included — without it this fixture would write into the machine's
 *  real log. */
function backlog(rowsByTask) {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-sessions-" + counter++ + "-"));
  assert.equal(run(["init", "--dir", dir, "--no-example"]).status, 0);
  const activity = activityDir(dir);
  mkdirSync(activity, { recursive: true });
  for (const [task, rows] of Object.entries(rowsByTask)) {
    writeFileSync(join(activity, task + ".jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  }
  return dir;
}

test("`sessions` lists them, and an empty one carries its marker", () => {
  const dir = backlog({ "TASK-1": [beat("s-a", 0), beat("s-a", 5)] });
  const r = run(["sessions", "--dir", dir]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /s-a/);
  assert.match(r.stdout, /nothing moved/);
});

test("a backlog with no heartbeats says so rather than printing an empty table", () => {
  const dir = backlog({});
  const r = run(["sessions", "--dir", dir]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /nothing has measured a session yet/);
});

test("`session <id>` tells one story, and an unknown id is an error with a way on", () => {
  const dir = backlog({ "TASK-1": [beat("s-a", 0), beat("s-a", 5)] });
  const ok = run(["session", "s-a", "--dir", dir]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /TASK-1/);
  assert.match(ok.stdout, /nothing — this session recorded work and changed no field/);
  assert.doesNotMatch(ok.stdout, /tokens/, "an absent token section must not appear as a section");

  const missing = run(["session", "nope", "--dir", dir]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /no session `nope`/);

  // With `--json` the same "not found" is an envelope, not a message on stderr:
  // a consumer must not have to parse prose to learn it.
  const asJson = run(["session", "nope", "--dir", dir, "--json"]);
  assert.equal(asJson.status, 1, "the document describes the result, it does not replace the exit code");
  assert.equal(JSON.parse(asJson.stdout).session, null);
});

test("both commands say their answer is a window join, in text and in JSON", () => {
  const dir = backlog({ "TASK-1": [beat("s-a", 0), beat("s-a", 5)] });
  assert.match(run(["sessions", "--dir", dir]).stdout, /carries no session id/);
  assert.match(run(["session", "s-a", "--dir", dir]).stdout, /carries no session id/);

  const list = JSON.parse(run(["sessions", "--dir", dir, "--json"]).stdout);
  assert.equal(list.kind, "sessions");
  assert.equal(list.correlation, "window");
  assert.equal(list.sessions[0].movedNothing, true);

  const one = JSON.parse(run(["session", "s-a", "--dir", dir, "--json"]).stdout);
  assert.equal(one.kind, "session");
  assert.equal(one.correlation, "window");
  assert.equal(one.session.tokens, null, "missing cost is null, never 0");
});

test("tokens reach the report per model, once an adapter writes them", () => {
  const dir = backlog({
    "TASK-1": [beat("s-a", 0, { tokens: 900, model: "big" }), beat("s-a", 5, { tokens: 100, model: "small" })],
  });
  const r = run(["session", "s-a", "--dir", dir]);
  assert.match(r.stdout, /tokens, per model/);
  assert.match(r.stdout, /big\s+900/);
  assert.match(r.stdout, /small\s+100/);
  assert.doesNotMatch(r.stdout, /1000/, "a single total is exactly what must not be printed");
});
