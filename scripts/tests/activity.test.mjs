/**
 * The data layer under time measurement (TL-27).
 *
 * WHAT EACH CASE HAS TO RULE OUT:
 *
 *   1. A LOG THAT ACCEPTS ANYTHING. It is append-only, so a row written wrong
 *      cannot be edited out later — only explained. Every field is therefore
 *      checked BEFORE the write, and each refusal is asserted against the file
 *      afterwards.
 *   2. A BACKFILL THAT DOUBLES ITS OWN WORK. A ULID is fresh on every run, so
 *      dedup by `id` cannot make a second pass idempotent. The test runs it
 *      twice and compares the file byte for byte.
 *   3. A REPORT THAT LOOKS COMPLETE. A median over the tasks that happen to have
 *      a stamp, with no count of the ones that do not, is a sum pretending to be
 *      whole. The positive control is a fixture where one closed task has no
 *      stamp and the report has to say so.
 *
 * The statuses and the git history are the FIXTURE's own — a real repository is
 * created per case, because the whole claim about the backfill is that it reads
 * git rather than the frontmatter.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ACTIVITY_KINDS, activityDir, activityEntry, activityPath, appendActivity, hasStamp,
  listActivityTasks, readActivity, readRollup, writeRollup,
} from "../activity.mjs";
import { backfill, completionStamp, parseBackfillArgs } from "../backfill-completions.mjs";
import { isoWeek, percentile, renderTime, timeStats } from "../time-report.mjs";
import { loadConfig } from "../config.mjs";
import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

// Every row this file writes goes to a throwaway home directory, never to
// the machine's real activity log (TL-35).
isolateHome("activity");

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function cli(args, cwd) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    cwd, encoding: "utf8", timeout: 60_000,
    env: { ...process.env, NO_COLOR: "1" },
  });
}

/** Commit dates are FIXED per call: two commits a fraction of a second apart
 *  would carry the same second, and then "the stamp is the closing commit, not
 *  the one that added the file" would be true by coincidence. */
function git(cwd, args, when) {
  return spawnSync("git", args, {
    cwd, encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.com",
      ...(when ? { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } : {}),
    },
  });
}

/**
 * Assert a git call in a FIXTURE BUILDER, with a message naming what git said
 * (TL-174).
 *
 * `assert.equal(git(...).status, 0)` reports `128 !== 0` at a line that has
 * nothing to do with what is being tested — which is how a global
 * `commit.gpgsign=true` cost twelve tests in this file an afternoon. The
 * environment is isolated now, so this should never fire; when the next
 * environmental difference turns up, it will say what it was.
 */
function ranGit(result, what) {
  assert.equal(result.status, 0,
    "git could not " + what + " (exit " + result.status + "):\n" + (result.stderr || "").trim());
  return result;
}

const ADDED_AT = "2026-02-01T09:00:00+00:00";
const CLOSED_AT = "2026-02-05T15:30:00+00:00";

/** A real repository with a real history: two tasks created, then closed in two
 *  separate commits, so the pickaxe has something true to find. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-activity-"));
  assert.equal(git(dir, ["init", "-q", "."]).status, 0);
  assert.equal(cli(["init", "--dir", ".", "--no-example"], dir).status, 0);
  const ids = [];
  for (const title of ["First", "Second"]) {
    const r = cli(["new", "--dir", ".", "--title", title], dir);
    assert.equal(r.status, 0, r.stderr);
    ids.push((r.stdout.match(/([A-Z]+-\d+)/) || [])[1]);
  }
  git(dir, ["add", "-A"]);
  ranGit(git(dir, ["commit", "-qm", "two open tasks"], ADDED_AT), "commit the two open tasks");
  return { dir, ids };
}

function taskFile(dir, id) {
  return join(dir, "tasks", readdirSync(join(dir, "tasks")).find((f) => f.startsWith(id + "-")));
}

function close(dir, id) {
  const file = taskFile(dir, id);
  writeFileSync(file, readFileSync(file, "utf8").replace(/^status: .*$/m, "status: done"), "utf8");
  git(dir, ["add", "-A"]);
  ranGit(git(dir, ["commit", "-qm", "close " + id], CLOSED_AT), "commit the closing of " + id);
}

const cleanup = (dir) => rmSync(dir, { recursive: true, force: true });

// ── The row, and what it refuses ──────────────────────────────────────────

test("a row carries the shape the model states, and fills in what it may", () => {
  const e = activityEntry({ task: "FX-1", kind: "tool", actor: "agent:claude", ts: "2026-02-01T10:00:00.000Z" });
  assert.equal(e.task, "FX-1");
  assert.equal(e.kind, "tool");
  assert.match(e.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  // An unstated attribution is `unknown` and says so, rather than claiming a leg
  // of the chain nobody walked.
  assert.equal(e.attribution, "unknown");
  assert.equal(e.source, "unknown");
});

test("an unknown `kind` is refused and nothing is written", () => {
  const { dir, ids } = repo();
  try {
    assert.throws(() => activityEntry({ task: ids[0], kind: "vibes", actor: "agent:a" }),
      /unknown activity kind/);
    assert.throws(() => appendActivity(dir, ids[0], [{ kind: "vibes", actor: "agent:a" }]),
      /unknown activity kind/);
    assert.deepEqual(readActivity(dir, ids[0]), []);
    // POSITIVE CONTROL: every declared kind IS accepted, so the guard is not
    // simply refusing everything. `reassign` carries two fields of its own
    // (TL-31) — a correction with no destination and no session corrects
    // nothing — so the control supplies them rather than skipping the kind,
    // which would leave one sixth of the set unproven.
    for (const kind of ACTIVITY_KINDS) {
      const extra = kind === "reassign" ? { to: ids[0] + "0", session: "s1" } : {};
      assert.equal(activityEntry({ task: ids[0], kind, actor: "agent:a", ...extra }).kind, kind);
    }
    assert.throws(() => activityEntry({ task: ids[0], kind: "reassign", actor: "agent:a", session: "s1" }),
      /no `to`/, "a correction with no destination is not a correction");
    assert.throws(() => activityEntry({ task: ids[0], kind: "reassign", actor: "agent:a", to: "FX-9" }),
      /no session/, "a correction with no session is a merge, not a correction");
    assert.throws(() => activityEntry({ task: ids[0], kind: "tool", actor: "agent:a", to: "FX-9" }),
      /belong to a `reassign`/, "only a correction may name a destination");
  } finally {
    cleanup(dir);
  }
});

test("an actor with no namespace, and a row with no task, are both refused", () => {
  assert.throws(() => activityEntry({ task: "FX-1", kind: "tool", actor: "claude" }), /namespace/);
  assert.throws(() => activityEntry({ task: "", kind: "tool", actor: "agent:a" }), /no task/);
  assert.throws(() => activityEntry({ task: "FX-1", kind: "tool", actor: "agent:a", attribution: "vibes" }),
    /unknown attribution/);
});

test("a corrupt line does not lose the rest of a task's measurement", () => {
  const { dir, ids } = repo();
  try {
    appendActivity(dir, ids[0], [{ kind: "tool", actor: "agent:a", ts: "2026-02-01T10:00:00.000Z" }]);
    appendFileSync(activityPath(dir, ids[0]), "{not json at all\n", "utf8");
    appendActivity(dir, ids[0], [{ kind: "tool", actor: "agent:a", ts: "2026-02-01T10:01:00.000Z" }]);
    const rows = readActivity(dir, ids[0]);
    assert.equal(rows.length, 2, "a torn line took the readable rows with it");
  } finally {
    cleanup(dir);
  }
});

test("the same row twice is one row: dedup by id, as in the change log", () => {
  const { dir, ids } = repo();
  try {
    const [written] = appendActivity(dir, ids[0], [{ kind: "tool", actor: "agent:a" }]);
    appendFileSync(activityPath(dir, ids[0]), JSON.stringify(written) + "\n", "utf8");
    assert.equal(readActivity(dir, ids[0]).length, 1);
    assert.deepEqual(listActivityTasks(dir), [ids[0]]);
  } finally {
    cleanup(dir);
  }
});

test("the rollup is per task, and reads back what it was given", () => {
  const { dir, ids } = repo();
  try {
    writeRollup(dir, ids[0], { minutes: 42 });
    assert.deepEqual(readRollup(dir, ids[0]), { minutes: 42 });
    assert.equal(readRollup(dir, ids[1]), null);
  } finally {
    cleanup(dir);
  }
});

// ── The backfill ──────────────────────────────────────────────────────────

test("the completion stamp comes from git, at second resolution", () => {
  const { dir, ids } = repo();
  try {
    close(dir, ids[0]);
    const config = loadConfig(dir);
    const rel = "tasks/" + readdirSync(join(dir, "tasks")).find((f) => f.startsWith(ids[0] + "-"));
    const ts = completionStamp(dir, rel, config.archivedStatuses);
    assert.ok(ts, "git found no closing commit");
    assert.equal(Date.parse(ts), Date.parse(CLOSED_AT));
    // It is the CLOSING commit, not the one that added the file: the task was
    // added open, and an addition-based rule would have reported that instead.
    const added = git(dir, ["log", "--reverse", "--format=%cI", "--", rel]).stdout.split("\n")[0].trim();
    assert.equal(Date.parse(added), Date.parse(ADDED_AT));
    assert.notEqual(Date.parse(ts), Date.parse(added));
  } finally {
    cleanup(dir);
  }
});

test("the backfill stamps closed tasks, counts the ones git cannot see, and touches no open task", () => {
  const { dir, ids } = repo();
  try {
    close(dir, ids[0]);
    // Closed in the working tree but never committed: git has nothing to find,
    // and the honest answer is to COUNT it, not to guess a date.
    const file = taskFile(dir, ids[1]);
    writeFileSync(file, readFileSync(file, "utf8").replace(/^status: .*$/m, "status: done"), "utf8");

    const config = loadConfig(dir);
    const out = backfill(dir, config, { repoRoot: dir });
    assert.equal(out.closed, 2);
    assert.equal(out.written, 1);
    assert.deepEqual(out.unstamped, [ids[1]]);
    assert.equal(readActivity(dir, ids[0]).length, 1);
    assert.equal(readActivity(dir, ids[1]).length, 0);
  } finally {
    cleanup(dir);
  }
});

test("run twice, and the second run writes nothing — idempotent by EVENT, not by id", () => {
  const { dir, ids } = repo();
  try {
    close(dir, ids[0]);
    const config = loadConfig(dir);
    backfill(dir, config, { repoRoot: dir });
    const after = readFileSync(activityPath(dir, ids[0]), "utf8");
    const second = backfill(dir, config, { repoRoot: dir });
    assert.equal(second.written, 0);
    assert.equal(second.already, 1);
    assert.equal(readFileSync(activityPath(dir, ids[0]), "utf8"), after,
      "a second pass wrote a second stamp for the same commit");
  } finally {
    cleanup(dir);
  }
});

test("`--dry-run` says what it WOULD write and creates no file at all", () => {
  const { dir, ids } = repo();
  try {
    close(dir, ids[0]);
    const r = cli(["backfill-completions", "--dry-run", "--dir", "."], dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /would stamp 1 of/);
    assert.equal(existsSync(activityDir(dir)), false, "a dry run created the directory");
  } finally {
    cleanup(dir);
  }
});

test("the backfill records no duration — only the stamp", () => {
  const { dir, ids } = repo();
  try {
    close(dir, ids[0]);
    backfill(dir, loadConfig(dir), { repoRoot: dir });
    const row = readActivity(dir, ids[0])[0];
    assert.equal(row.kind, "commit");
    assert.equal(row.source, "git-backfill");
    assert.equal(row.attribution, "path");
    for (const forbidden of ["duration", "minutes", "seconds", "started"]) {
      assert.equal(forbidden in row, false, "the backfill invented `" + forbidden + "`");
    }
  } finally {
    cleanup(dir);
  }
});

test("an unknown flag is a usage error", () => {
  assert.throws(() => parseBackfillArgs(["--parallel"]), /unknown flag/);
  assert.throws(() => parseBackfillArgs(["TL-1"]), /unexpected argument/);
});

// ── The report ────────────────────────────────────────────────────────────

const CONFIG = { archivedStatuses: ["done"], projectName: "Fixture" };

test("lead time and throughput, and the unstamped count is never dropped", () => {
  const tasks = [
    { id: "FX-1", status: "done", created: "2026-02-01" },
    { id: "FX-2", status: "done", created: "2026-02-01" },
    { id: "FX-3", status: "done", created: "2026-02-01" },   // no stamp
    { id: "FX-4", status: "pending", created: "2026-02-01" },
  ];
  const stamps = {
    "FX-1": "2026-02-03T00:00:00.000Z",
    "FX-2": "2026-02-11T00:00:00.000Z",
  };
  const stats = timeStats(tasks, (id) => stamps[id] || null, CONFIG);
  assert.equal(stats.closed, 3);
  assert.equal(stats.completed, 2);
  assert.deepEqual(stats.unstamped, ["FX-3"]);
  assert.equal(stats.leadTimeDays.n, 2);
  assert.equal(stats.leadTimeDays.median, 2);
  assert.equal(stats.leadTimeDays.p95, 10);
  assert.deepEqual(stats.throughput, [{ week: "2026-W06", count: 1 }, { week: "2026-W07", count: 1 }]);

  // POSITIVE CONTROL: the hole is on the report in words, not only in the data.
  const text = renderTime(stats, CONFIG);
  assert.match(text, /without one\s+1/);
  assert.match(text, /outside every number above/);
});

test("with no stamps at all the report says what would create one", () => {
  const stats = timeStats([{ id: "FX-1", status: "done", created: "2026-02-01" }], () => null, CONFIG);
  assert.equal(stats.completed, 0);
  assert.match(renderTime(stats, CONFIG), /backfill-completions/);
});

test("percentiles are nearest-rank: every number printed is a number some task took", () => {
  const xs = [1, 2, 3, 4, 10];
  assert.equal(percentile(xs, 50), 3);
  assert.equal(percentile(xs, 80), 4);
  assert.equal(percentile(xs, 95), 10);
  assert.equal(percentile([], 50), null);
});

test("the week of a date is the ISO week, so a new year does not split one", () => {
  assert.equal(isoWeek(new Date("2026-01-01T00:00:00Z")), "2026-W01");
  assert.equal(isoWeek(new Date("2027-01-01T00:00:00Z")), "2026-W53");
});

test("`time` reads the real files end to end", () => {
  const { dir, ids } = repo();
  try {
    close(dir, ids[0]);
    assert.equal(cli(["backfill-completions", "--dir", "."], dir).status, 0);
    const r = cli(["time", "--dir", ".", "--json"], dir);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.completed, 1);
    assert.equal(out.closed, 1);
    assert.deepEqual(out.unstamped, []);
  } finally {
    cleanup(dir);
  }
});

// ── The gitignore contract, in both directions ────────────────────────────

test("the raw log is out of git and the rollup is IN it — both checked", () => {
  const { dir, ids } = repo();
  try {
    const ignored = (p) => git(dir, ["check-ignore", "-q", p]).status === 0;
    assert.equal(ignored("activity/" + ids[0] + ".jsonl"), true, "somebody's working calendar is committable");
    assert.equal(ignored("activity/rollup/" + ids[0] + ".json"), false, "the aggregate is not versioned");
  } finally {
    cleanup(dir);
  }
});

test("the new configuration keys are accepted, and a typo among them still fails", () => {
  const { dir } = repo();
  try {
    const config = loadConfig(dir);
    assert.equal(config.activityPrivacy, "local");
    assert.equal(typeof config.idleGapMinutes, "number");
    assert.equal(typeof config.minReportN, "number");
    const path = join(dir, "config.yaml");
    writeFileSync(path, readFileSync(path, "utf8") + "\nidle_gap_minutez: 10\n", "utf8");
    // An unknown key FAILS rather than being ignored — a typo in a vocabulary is
    // indistinguishable from "that is how this project does it".
    assert.throws(() => loadConfig(dir), /idle_gap_minutez/);
  } finally {
    cleanup(dir);
  }
});

// ── the other name a session answers to (TL-168) ──────────────────────────

test("`derived` is written only when it says something the row does not already", () => {
  // It earns its place the way `to` and `since` do: a field on every row would
  // bloat a log that grows in the thousands and invite a reader to look for a
  // second name on rows that have none.
  const base = { task: "T-1", kind: "tool", actor: "agent:one", attribution: "focus" };

  const differing = activityEntry({ ...base, session: "host-1", derived: "tree-abc" });
  assert.equal(differing.derived, "tree-abc");

  const same = activityEntry({ ...base, session: "tree-abc", derived: "tree-abc" });
  assert.equal("derived" in same, false, "a name identical to the key says nothing");

  const none = activityEntry({ ...base, session: "host-1" });
  assert.equal("derived" in none, false);
});

test("the pair is what lets the two logs be joined at all", () => {
  // The row's writer is the ONE place that sees the host's id and the key every
  // other process derives at the same moment. If this field went, the history
  // log and this one would name one session twice and never meet.
  const e = activityEntry({
    task: "T-1", kind: "tool", actor: "agent:one", attribution: "focus",
    session: "3d71196b", derived: "tree-cb84986431a6",
  });
  assert.deepEqual([e.session, e.derived], ["3d71196b", "tree-cb84986431a6"]);
});
