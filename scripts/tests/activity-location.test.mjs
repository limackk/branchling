/**
 * Where the raw activity log lives, and why it is not a matter of taste (TL-35).
 *
 * THE FAILURE THIS FILE GUARDS AGAINST is not a bug in this tool. It is one
 * `git add -A` in somebody else's repository — after which a record of what hour
 * a particular person worked, day after day, is in a public history and cannot
 * be taken out of it without rewriting a history that is not yours to rewrite.
 * A `.gitignore` rule reduces the chance of that; it does not remove it, because
 * it is a promise every future user in every future repository has to keep.
 * Moving the file OUT of every repository removes it, and the difference is
 * qualitative rather than gradual.
 *
 * SO EVERY CASE HERE IS ABOUT ONE OF FOUR THINGS:
 *
 *   1. A WRITE THAT LANDS IN THE REPOSITORY. The positive assertion (it is in
 *      the data directory) is paired with the negative one (it is NOT in the
 *      repository), because a tool writing to both would satisfy the first.
 *   2. TWO PROJECTS SHARING A DIRECTORY. "default" for anything unregistered
 *      would sum two people's projects into one set of minutes, and nothing
 *      downstream could tell. The segment is derived from the backlog PATH.
 *   3. A SEGMENT THAT MOVES. It is keyed by the path and never by the registry
 *      label, because a label is the user's own and mutable — renaming a
 *      project must not orphan its log.
 *   4. A MIGRATION THAT DOUBLES. Run twice it must produce the same state, or
 *      the fix for a lost measurement is a doubled one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  activityDir, activityPath, appendActivity, legacyActivityDir, projectSegment, readActivity,
  rollupPath, writeRollup,
} from "../activity.mjs";
import { migrate } from "../activity-retention.mjs";
import { HOME_ENV } from "../home.mjs";
import { addProject } from "../registry.mjs";
import { REPO_ROOT, isolateHome } from "./_repo.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

// Every row this file writes goes to a throwaway home directory, never to the
// machine's real activity log.
isolateHome("location");

let counter = 0;
function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), "worktrail-" + prefix + "-" + (counter++) + "-"));
}

function run(args, env) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 30_000, input: "",
    env: env || { ...process.env, NO_COLOR: "1" },
  });
}

/** A backlog with one task, plus a home directory of its own. */
function fixture() {
  const dir = tmp("location");
  const backlog = join(dir, "repo", "backlog");
  const home = join(dir, "home");
  const env = {
    ...process.env, NO_COLOR: "1",
    [HOME_ENV]: home,
    BACKLOG_STATE_DIR: join(dir, "state"),
  };
  delete env.XDG_CONFIG_HOME;
  delete env.XDG_DATA_HOME;
  assert.equal(run(["init", "--dir", backlog, "--no-example"], env).status, 0);
  const r = run(["new", "--dir", backlog, "--title", "A task to measure"], env);
  assert.equal(r.status, 0, r.stderr);
  return { dir, backlog, home, env, id: (r.stdout.match(/([A-Z]+-\d+)/) || [])[1] };
}

/** Every `.jsonl` under a directory tree — used to prove a repository holds
 *  none, which a single `existsSync` could not. */
function jsonlUnder(root) {
  const out = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".jsonl")) out.push(path);
    }
  };
  walk(root);
  return out;
}

// ── the raw log is outside every repository ───────────────────────────────

test("a heartbeat lands in the data directory and NOT in the repository", () => {
  const { backlog, home, env, id } = fixture();
  const r = run(["activity", "record", "--dir", backlog, "--task", id, "--actor", "local:me"], env);
  assert.equal(r.status, 0, r.stderr);

  const written = join(home, "data", "activity");
  const found = jsonlUnder(written);
  assert.equal(found.length, 1, "the row did not reach the data directory: " + written);
  assert.ok(found[0].endsWith(id + ".jsonl"));

  // The paired negative. A tool writing to BOTH places would satisfy the
  // assertion above and still leak.
  const repoActivity = join(backlog, "activity");
  assert.deepEqual(jsonlUnder(repoActivity), [],
    "a raw row is in the repository, where one `git add -A` puts it in public history");
});

test("the aggregate stays in the repository, and stays versioned", () => {
  const { backlog, id } = fixture();
  writeRollup(backlog, id, { minutes: 12, sessions: 1, first: null, last: null, unknown_ratio: 0 });
  const path = rollupPath(backlog, id);
  assert.ok(path.startsWith(backlog), "the aggregate must travel with the project: " + path);
  assert.ok(existsSync(path));

  // The boundary in one assertion: raw outside, aggregate inside.
  assert.equal(activityPath(backlog, id).startsWith(backlog), false);
});

test("the repository's gitignore still covers the old location", () => {
  // The rule stays as a safety net: logs written before this change are still
  // there until somebody runs `activity migrate`, and a `full` privacy mode
  // would put them back.
  const { backlog } = fixture();
  const text = readFileSync(join(backlog, ".gitignore"), "utf8");
  assert.match(text, /activity\/\*\.jsonl/);
});

test("git tracks no raw log in THIS repository — only the aggregate", () => {
  // The gate the acceptance criteria ask for, run against the real checkout
  // rather than a fixture: a fixture cannot have the accident this prevents.
  const tracked = spawnSync("git", ["ls-files", "backlog/activity"], {
    cwd: REPO_ROOT, encoding: "utf8",
  });
  assert.equal(tracked.status, 0, tracked.stderr);
  const raw = tracked.stdout.split("\n").filter(Boolean)
    .filter((f) => !f.startsWith("backlog/activity/rollup/"));
  assert.deepEqual(raw, [], "a raw activity log is committed in this repository");
});

// ── two projects never share a directory ──────────────────────────────────

test("two unregistered backlogs get different directories", () => {
  const a = join(tmp("seg"), "alpha", "backlog");
  const b = join(tmp("seg"), "alpha", "backlog");
  assert.notEqual(projectSegment(a), projectSegment(b),
    "two projects sharing a directory would sum their minutes with nobody able to tell");
  // …and the same path always gives the same answer, or a log would scatter.
  assert.equal(projectSegment(a), projectSegment(a));
});

test("the directory is legible AND keyed by the path", () => {
  const segment = projectSegment("/home/x/acme-api/backlog");
  assert.match(segment, /^acme-api-[0-9a-f]{8}$/,
    "the slug is what makes the directory findable by the person whose data it is");
  // `backlog` on its own would name every project on a machine the same thing.
  assert.equal(segment.startsWith("backlog-"), false);
});

test("renaming a project in the registry does not move its log", () => {
  // The registry label is the USER'S OWN and mutable (TL-34); the path is the
  // identity. Keying the data directory by the label would orphan somebody's
  // measurement the first time they relabelled a project — silently, into a
  // directory the tool then reports as empty.
  const { backlog, env, id } = fixture();
  appendActivity(backlog, id, [{
    task: id, kind: "tool", actor: "local:me", session: "s1", attribution: "focus",
  }], env);
  const before = activityDir(backlog, env);

  assert.equal(addProject(backlog, { name: "before", env }).ok, true);
  assert.equal(activityDir(backlog, env), before);
  assert.equal(addProject(backlog, { name: "after", env }).ok, true);
  assert.equal(activityDir(backlog, env), before, "the log followed a label instead of a path");
  assert.equal(readActivity(backlog, id, env).length, 1);
});

// ── migration ─────────────────────────────────────────────────────────────

/** A log at the OLD location, as a repository written before TL-35 would have. */
function legacyRows(backlog, id, n) {
  const dir = legacyActivityDir(backlog);
  mkdirSync(dir, { recursive: true });
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push(JSON.stringify({
      id: "01LEGACY" + i, ts: "2026-08-3" + i + "T09:00:00.000Z", task: id,
      kind: "tool", actor: "local:me", source: "hook", session: "old", attribution: "focus",
    }));
  }
  writeFileSync(join(dir, id + ".jsonl"), rows.join("\n") + "\n", "utf8");
  return rows.length;
}

test("migrate moves an old log out of the repository", () => {
  const { backlog, env, id } = fixture();
  legacyRows(backlog, id, 3);
  assert.equal(readActivity(backlog, id, env).length, 0, "the control: nothing is at the new location yet");

  const result = migrate(backlog, { env });
  assert.equal(result.rows, 3);
  assert.equal(readActivity(backlog, id, env).length, 3);
  assert.deepEqual(jsonlUnder(legacyActivityDir(backlog)), [],
    "the old file has to GO, not merely be copied — otherwise the leak is still there");
});

test("migrate --dry-run touches nothing", () => {
  const { backlog, env, id } = fixture();
  legacyRows(backlog, id, 3);
  const before = readFileSync(join(legacyActivityDir(backlog), id + ".jsonl"), "utf8");

  const result = migrate(backlog, { env, dryRun: true });
  assert.equal(result.rows, 3, "it still says what would move");
  assert.equal(readFileSync(join(legacyActivityDir(backlog), id + ".jsonl"), "utf8"), before);
  assert.equal(readActivity(backlog, id, env).length, 0);
});

test("migrate run twice leaves the same state — it merges by row id", () => {
  const { backlog, env, id } = fixture();
  legacyRows(backlog, id, 3);

  migrate(backlog, { env });
  const once = readFileSync(activityPath(backlog, id, env), "utf8");
  const second = migrate(backlog, { env });

  assert.equal(second.rows, 0);
  assert.equal(readFileSync(activityPath(backlog, id, env), "utf8"), once,
    "the fix for a lost measurement must not be a doubled one");
});

test("migrate merges rather than overwriting rows already at the new location", () => {
  const { backlog, env, id } = fixture();
  appendActivity(backlog, id, [{
    id: "01NEW", ts: "2026-09-01T09:00:00.000Z", task: id, kind: "tool",
    actor: "local:me", session: "new", attribution: "focus",
  }], env);
  legacyRows(backlog, id, 2);

  migrate(backlog, { env });
  const ids = readActivity(backlog, id, env).map((r) => r.id).sort();
  assert.deepEqual(ids, ["01LEGACY0", "01LEGACY1", "01NEW"],
    "an overwrite in either direction loses somebody's measurement");
});

test("migrate with nothing to move says so and writes nothing", () => {
  const { backlog, env } = fixture();
  const result = migrate(backlog, { env });
  assert.equal(result.rows, 0);
  assert.equal(result.files.length, 0);
  assert.equal(existsSync(activityDir(backlog, env)), false, "and it did not create the target either");
});

test("migrate does not touch the rollup", () => {
  const { backlog, env, id } = fixture();
  writeRollup(backlog, id, { minutes: 99, sessions: 1, first: null, last: null, unknown_ratio: 0 });
  legacyRows(backlog, id, 2);
  const before = readFileSync(rollupPath(backlog, id), "utf8");

  migrate(backlog, { env });
  assert.equal(readFileSync(rollupPath(backlog, id), "utf8"), before,
    "the aggregate travels with the project and is not this command's business");
});

// ── the user can find it ──────────────────────────────────────────────────

test("`where` names the raw activity directory", () => {
  // §9 requires ONE place a person can check what the tool holds about them,
  // and a path they cannot find is a guarantee they cannot verify.
  const { backlog, env } = fixture();
  const report = JSON.parse(run(["where", "--json", "--dir", backlog], env).stdout);
  assert.equal(report.backlog.activity, activityDir(backlog, env));
  assert.equal(report.backlog.activity.startsWith(backlog), false);
});

test("the privacy report names the new location, not the old one", () => {
  const { backlog, env, id } = fixture();
  appendActivity(backlog, id, [{
    task: id, kind: "tool", actor: "local:me", session: "s1", attribution: "focus",
  }], env);
  const report = JSON.parse(run(["activity", "report", "--privacy", "--json", "--dir", backlog], env).stdout);
  assert.ok(report.notVersioned.some((p) => !p.startsWith(backlog)),
    "the report still points inside the repository: " + report.notVersioned.join(", "));
});
