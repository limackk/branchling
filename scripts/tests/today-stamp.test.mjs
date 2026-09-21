/**
 * One shape of "today", written in one place (TL-246).
 *
 * WHY THE TIMEZONE IS DRIVEN AND NOT OBSERVED. Three commands used to compute
 * the day themselves and gave two answers: `take` and `done` the UTC day, `new`
 * the local one. A test run on the machine that wrote the code sees ONE
 * timezone, and in most of them the two answers agree for most of the day — so
 * a green result would say nothing at all. Every assertion below therefore names
 * its timezone: `TZ` is read per process, so a child process can be stood in
 * Kiritimati (UTC+14) and another in Midway (UTC-11) on the same machine, at the
 * same instant, 25 hours apart. Two zones that far apart never share a local
 * date, which is what makes the disagreement deterministic rather than a
 * question of when the suite happens to run.
 *
 * THE POSITIVE CONTROL. Both end-to-end tests below would also pass if `TZ` were
 * ignored — a machine without a timezone database, a runtime that resolved both
 * names to UTC. The first test therefore has each child report the LOCAL day as
 * well, and fails if the two zones agree on it: at that point the measurement is
 * broken, and a broken measurement is not evidence.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { REPO_ROOT, SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

// The suite must not read the DEVELOPER's preferences: `new` and `done` are
// driven as child processes below, and they inherit this process's home.
isolateHome("today-stamp");

const CLI = join(SCRIPTS_DIR, "cli.mjs");

/** UTC+14 and UTC-11: the two ends of the inhabited day, 25 hours apart. */
const AHEAD = "Pacific/Kiritimati";
const BEHIND = "Pacific/Midway";

/** A fixed instant, so the answer is a constant and not "whatever today is".
 *  11:30 UTC falls on three different local dates in the two zones and in UTC. */
const INSTANT = Date.parse("2026-03-01T11:30:00.000Z");

function inZone(tz, script) {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    env: Object.assign({}, process.env, { TZ: tz }),
  });
  assert.equal(r.status, 0, tz + ": " + r.stderr);
  return JSON.parse(r.stdout);
}

test("one instant is one day, whatever timezone the writer stands in", () => {
  const script = [
    "import { todayStamp } from './scripts/today.mjs';",
    "const d = new Date(" + INSTANT + ");",
    "const p = (n) => String(n).padStart(2, '0');",
    "process.stdout.write(JSON.stringify({",
    "  stamp: todayStamp(" + INSTANT + "),",
    "  local: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()),",
    "}));",
  ].join("\n");
  const ahead = inZone(AHEAD, script);
  const behind = inZone(BEHIND, script);

  // The measurement first: if `TZ` did nothing, everything below is vacuous.
  assert.notEqual(
    ahead.local,
    behind.local,
    "the two timezones agree on the local day, so this machine is not applying TZ and the test proves nothing"
  );

  assert.equal(ahead.stamp, "2026-03-01");
  assert.equal(behind.stamp, "2026-03-01");
});

// ── The commands that write a date ────────────────────────────────────────

/** A real backlog, created by the tool, so nothing here asserts a vocabulary
 *  this test invented. */
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "today-stamp-"));
  const r = spawnSync(process.execPath, [CLI, "init", "--dir", dir], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return dir;
}

function cli(args, dir, tz) {
  return spawnSync(process.execPath, [CLI, ...args, "--dir", dir], {
    encoding: "utf8",
    env: Object.assign({}, process.env, { TZ: tz }),
  });
}

/** The value of one frontmatter field in the one task whose file name starts
 *  with `prefix`. */
function field(dir, prefix, key) {
  const file = readdirSync(join(dir, "tasks")).find((f) => f.startsWith(prefix));
  assert.ok(file, "no task file starting with " + prefix);
  const text = readFileSync(join(dir, "tasks", file), "utf8");
  const m = text.match(new RegExp("^" + key + ": (\\S+)", "m"));
  assert.ok(m, key + " is not in " + file);
  return { value: m[1], file: join(dir, "tasks", file) };
}

test("`new` stamps the same `created:` in timezones 25 hours apart", () => {
  const ahead = sandbox();
  const behind = sandbox();
  try {
    for (const [dir, tz] of [[ahead, AHEAD], [behind, BEHIND]]) {
      const r = cli(["new", "--title", "A task written somewhere"], dir, tz);
      assert.equal(r.status, 0, tz + ": " + r.stderr);
    }
    const a = field(ahead, "TASK-2", "created");
    const b = field(behind, "TASK-2", "created");
    assert.match(a.value, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(
      a.value,
      b.value,
      "`new` wrote " + a.value + " in " + AHEAD + " and " + b.value + " in " + BEHIND +
        ": the date a task travels with depends on where the person who created it was sitting"
    );
  } finally {
    for (const dir of [ahead, behind]) rmSync(dir, { recursive: true, force: true });
  }
});

test("`done` stamps the same `updated:` in timezones 25 hours apart", () => {
  const ahead = sandbox();
  const behind = sandbox();
  try {
    const stamps = [];
    for (const [dir, tz] of [[ahead, AHEAD], [behind, BEHIND]]) {
      const created = cli(["new", "--title", "A task closed somewhere"], dir, tz);
      assert.equal(created.status, 0, tz + ": " + created.stderr);
      // The template's placeholder contract is refused on purpose, and this
      // test is not about that refusal: give the task something that passes.
      const task = field(dir, "TASK-2", "created");
      writeFileSync(
        task.file,
        readFileSync(task.file, "utf8").replace('bash: "command to run"', 'bash: "true"'),
        "utf8"
      );
      const closed = cli(["done", "TASK-2", "--actor", "local:me"], dir, tz);
      assert.equal(closed.status, 0, tz + ": " + closed.stderr + closed.stdout);
      stamps.push(field(dir, "TASK-2", "updated").value);
    }
    assert.match(stamps[0], /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(
      stamps[0],
      stamps[1],
      "`done` wrote " + stamps[0] + " in " + AHEAD + " and " + stamps[1] + " in " + BEHIND
    );
  } finally {
    for (const dir of [ahead, behind]) rmSync(dir, { recursive: true, force: true });
  }
});

// ── And only one implementation of it ─────────────────────────────────────

/** `new Date(…).toISOString().slice(0, 10)` — the UTC day as a string. */
const UTC_STAMP = /toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/;

/** `d.getMonth() + 1` — nobody adds one to a month except to write it into a
 *  `YYYY-MM-DD` string built from the LOCAL day. */
const LOCAL_STAMP = /getMonth\(\)\s*\+\s*1/;

/** The one file allowed to hold the answer. */
const HOME = "today.mjs";

test("the shape of a date stamp is written once, in one file", () => {
  // The controls: both patterns must be able to match, or a clean scan below
  // would only mean the regular expressions are broken.
  assert.match(readFileSync(join(SCRIPTS_DIR, HOME), "utf8"), UTC_STAMP);
  assert.match(
    "return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());",
    LOCAL_STAMP,
    "the local-day pattern no longer matches the copy this task deleted"
  );

  const offenders = [];
  let scanned = 0;
  for (const name of readdirSync(SCRIPTS_DIR)) {
    if (!name.endsWith(".mjs") || name === HOME) continue;
    scanned += 1;
    const text = readFileSync(join(SCRIPTS_DIR, name), "utf8");
    if (UTC_STAMP.test(text)) offenders.push(name + ": builds the UTC day itself");
    if (LOCAL_STAMP.test(text)) offenders.push(name + ": builds the LOCAL day itself");
  }

  // A guard that scanned nothing is green and proves nothing.
  assert.ok(scanned > 20, "only " + scanned + " source file(s) were scanned");
  assert.deepEqual(
    offenders,
    [],
    "a date stamp is computed outside " + HOME + ", so there are two answers again:\n  " +
      offenders.join("\n  ") + "\nImport `todayStamp` instead."
  );
});

/** Deleting a private copy and forgetting the import is a ReferenceError at the
 *  moment somebody claims a task, which no unit test of the function itself
 *  would see — it happened once while TL-246 was being written, and `take`
 *  refused with `todayStamp is not defined`. */
test("every file that calls the function also imports it", () => {
  const callers = [];
  const missing = [];
  for (const name of readdirSync(SCRIPTS_DIR)) {
    if (!name.endsWith(".mjs") || name === HOME) continue;
    const text = readFileSync(join(SCRIPTS_DIR, name), "utf8");
    if (!/\btodayStamp\s*\(/.test(text)) continue;
    callers.push(name);
    if (!/from "\.\/today\.mjs"/.test(text)) missing.push(name);
  }
  assert.ok(callers.length >= 4, "only " + callers.length + " caller(s) found, so this guard is reading the wrong tree");
  assert.deepEqual(missing, [], "these files call `todayStamp` without importing it:\n  " + missing.join("\n  "));
});
