/**
 * `body` on a closed task names the command that withdraws the closing
 * (TL-742).
 *
 * WHY. The refusal said "reopen it deliberately" in prose and named no
 * command, while the closed refusals of `take` (TL-714, TL-737) and `handoff`
 * (TL-737) print `take <ID> --reopen --reason "…" --actor <actor>` as a route.
 * A caller reading `body`'s refusal had to know that route from somewhere else.
 *
 * WHAT IS AT RISK, and the control for each:
 *   - A ROUTE THAT DOES NOT WORK: it is taken from stderr and run as printed,
 *     with only the placeholder reason supplied, and the task must be reopened;
 *     the body rewrite the refusal blocked then goes through.
 *   - A ROUTE MISSING FROM THE ENVELOPE: `--json` must carry the same command
 *     as the last of its details.
 *   - A REFUSAL THAT ALREADY WROTE: the task file and its history are compared
 *     byte for byte before and after.
 *   - A ROUTE ON EVERY REFUSAL: a stale-base refusal of the same command prints
 *     none, so the route belongs to the closed refusal and not to `body`; an
 *     unknown id, a refusal with no details at all, prints one line and an
 *     empty `details`.
 *
 * EVERY VOCABULARY IS THE FIXTURE'S OWN — never this repository's statuses.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { splitFrontmatter } from "../task-fields.mjs";
import { alignTemplate, isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("body-task");

const CLI = join(SCRIPTS_DIR, "cli.mjs");

const OWN_VOCABULARY = [
  "statuses: [open, working, review, shipped, dropped]",
  "archived_statuses: [shipped, dropped]",
  "dashboard_open_statuses: [open, working, review]",
  "reason_required_statuses: [shipped, dropped]",
  "in_progress_status: working",
].join("\n");

const ACTOR = "agent:scribe";

function run(cwd, args, input) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    cwd, encoding: "utf8", timeout: 60_000, input: input === undefined ? "" : input,
    // NODE_NO_WARNINGS: under FORCE_COLOR, Node itself warns on stderr that
    // NO_COLOR is ignored, and the control counts the lines of a refusal.
    env: { ...process.env, NO_COLOR: "1", NODE_NO_WARNINGS: "1", BACKLOG_STATE_DIR: join(cwd, ".state") },
  });
}

function closedRepo() {
  const dir = fixtureDir(join(tmpdir(), "branchling-body-task-"));
  assert.equal(spawnSync("git", ["init", "-q", "."], { cwd: dir }).status, 0);
  assert.equal(run(dir, ["init", "--dir", ".", "--no-example"]).status, 0);
  const p = join(dir, "config.yaml");
  writeFileSync(p, readFileSync(p, "utf8") + "\n" + OWN_VOCABULARY + "\n", "utf8");
  alignTemplate(dir);
  const r = run(dir, ["new", "--dir", ".", "--title", "Copy the charter"]);
  assert.equal(r.status, 0, r.stderr);
  const id = r.stdout.match(/[A-Z]+-\d+/)[0];
  const file = join(dir, "tasks", readdirSync(join(dir, "tasks")).find((f) => f.startsWith(id + "-")));
  writeFileSync(file, readFileSync(file, "utf8").replace(/^status: .*$/m, "status: shipped"), "utf8");
  return { dir, id, file };
}

const statusOf = (text) => (text.match(/^status: *(\S+)/m) || [])[1];

/** The task's own body with one sentence added, so it stays a valid body. */
function amended(file) {
  const { body } = splitFrontmatter(readFileSync(file, "utf8"));
  return body.replace(/## Goal\n+/, (m) => m + "The charter is copied by hand.\n\n");
}

test("the closed refusal of body names take --reopen, and that route run as printed reopens the task", () => {
  const { dir, id, file } = closedRepo();
  const history = join(dir, "history", id + ".jsonl");
  const state = () => [readFileSync(file, "utf8"), existsSync(history) ? readFileSync(history, "utf8") : null];
  const before = state();
  const newBody = amended(file);
  assert.notEqual(newBody, splitFrontmatter(before[0]).body, "the fixture's edit changes nothing");

  const r = run(dir, ["body", id, "--dir", ".", "--actor", ACTOR, "--reason", "Too late."], newBody);
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, new RegExp("body: " + id + " is closed \\(status: shipped\\)"));
  assert.match(r.stderr, /A closed task is a record of what was decided; reopen it deliberately before rewriting it\./);
  const printed = r.stderr.match(/→ \S+ (take .+)$/m);
  assert.ok(printed, "the refusal names no command: " + r.stderr);
  assert.equal(printed[1], "take " + id + " --reopen --reason \"…\" --actor " + ACTOR);
  assert.deepEqual(state(), before, "a refused body wrote to the task or its history");

  const json = run(dir, ["body", id, "--dir", ".", "--actor", ACTOR, "--reason", "Too late.", "--json"], newBody);
  assert.equal(json.status, 1, json.stderr);
  const env = JSON.parse(json.stdout);
  assert.equal(env.ok, false);
  assert.equal(env.refusalKind, "closed");
  assert.equal(env.details.length, 2, JSON.stringify(env.details));
  assert.match(env.details[0], /^A closed task is a record of what was decided/);
  assert.ok(env.details[1].endsWith(" " + printed[1]), "the envelope's route differs from the printed one: " + env.details[1]);
  assert.deepEqual(state(), before, "a refused body --json wrote to the task or its history");

  // Run as printed, with only the placeholder reason supplied.
  const args = printed[1].replace('"…"', "REASON").split(" ")
    .map((a) => (a === "REASON" ? "The charter needs another sentence." : a));
  const reopened = run(dir, args.concat(["--dir", "."]));
  assert.equal(reopened.status, 0, reopened.stdout + reopened.stderr);
  assert.equal(statusOf(readFileSync(file, "utf8")), "working");

  const written = run(dir, ["body", id, "--dir", ".", "--actor", ACTOR, "--reason", "The charter is copied by hand."], newBody);
  assert.equal(written.status, 0, written.stderr);
  assert.equal(splitFrontmatter(readFileSync(file, "utf8")).body, newBody);
});

test("CONTROL: a refusal of body that has no route prints none and adds none to the envelope", () => {
  const { dir, id, file } = closedRepo();
  writeFileSync(file, readFileSync(file, "utf8").replace(/^status: .*$/m, "status: working"), "utf8");
  const newBody = amended(file);
  const stale = "sha256:" + "0".repeat(64);

  const text = run(dir, ["body", id, "--dir", ".", "--actor", ACTOR, "--reason", "Stale.", "--base", stale], newBody);
  assert.equal(text.status, 1, text.stderr);
  assert.match(text.stderr, /the body changed since/);
  assert.doesNotMatch(text.stderr, /→/, "a refusal without a route printed one: " + text.stderr);

  const json = run(dir, ["body", id, "--dir", ".", "--actor", ACTOR, "--reason", "Stale.", "--base", stale, "--json"], newBody);
  assert.equal(json.status, 1, json.stderr);
  const env = JSON.parse(json.stdout);
  assert.equal(env.refusalKind, "stale-base");
  assert.equal(env.details.length, 2, JSON.stringify(env.details));
  assert.ok(env.details.every((d) => !/--reopen/.test(d)), JSON.stringify(env.details));

  // A refusal with neither details nor a route: one line on stderr, an empty
  // `details` in the envelope.
  const missing = "ZZ-9";
  const none = run(dir, ["body", missing, "--dir", ".", "--actor", ACTOR, "--reason", "Absent."], newBody);
  assert.equal(none.status, 2, none.stderr);
  assert.equal(none.stderr.trimEnd().split("\n").length, 1, none.stderr);
  const noneJson = run(dir, ["body", missing, "--dir", ".", "--actor", ACTOR, "--reason", "Absent.", "--json"], newBody);
  assert.equal(noneJson.status, 2, noneJson.stderr);
  const noneEnv = JSON.parse(noneJson.stdout);
  assert.equal(noneEnv.refusalKind, "not-found");
  assert.deepEqual(noneEnv.details, []);
});
