/**
 * Every refusal of `new --json` answers in the `task-new` envelope (TL-568).
 *
 * WHAT IS AT RISK. TL-550 gave `new` a `--json` answer for the task it created,
 * and TL-548 one for a missing backlog; every other refusal stayed a sentence
 * on stderr with an empty stdout. A program calling `new --json` had to branch
 * on the exit code and parse prose to learn why nothing was created, and an
 * empty stdout cannot be told from a crash.
 *
 * WHAT IS ASKED, for each path end to end through the CLI: the answer parses,
 * is `task-new` with every declared key, says `ok: false` with the path's own
 * `refusalKind`, keeps the exit code the text form has, leaves stderr empty —
 * and, for every refusal before the write, leaves the tasks directory as it
 * was. The success envelope and the unchanged text form are the controls: an
 * assertion that every answer is a refusal would pass on a command that could
 * no longer succeed, and one that only reads `--json` would pass on a command
 * whose text form had moved into stdout.
 *
 * Every fixture is a throwaway backlog; no value of this repository's own
 * configuration is asserted. Values a refusal needs are ones no project
 * declares (`no-such-priority`, `no-such-wave`).
 *
 * Not reached here: `id-taken`, the exclusive write losing a race for a number
 * the scanner had just handed out. It cannot be produced from one process
 * without stubbing the scanner, and it goes through the same descriptor and
 * printer as every row below.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { KINDS } from "../json-envelope.mjs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("new-json-refusals");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const DECLARED = Object.keys(KINDS["task-new"]);

function run(cwd, args, input = "") {
  const env = { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(cwd, ".state") };
  delete env.BACKLOG_ACTOR;
  delete env.BACKLOG_DIR;
  return spawnSync(process.execPath, [CLI].concat(args), { cwd, encoding: "utf8", timeout: 60_000, env, input });
}

function git(dir, args) {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
}

/** A git repository holding a backlog at `<repo>/backlog`, with one task in it. */
function repo() {
  const dir = fixtureDir(join(tmpdir(), "branchling-new-json-refusals-"));
  git(dir, ["init", "-q", "-b", "main", "."]);
  const r = run(dir, ["init", "--dir", "backlog", "--no-example"]);
  assert.equal(r.status, 0, r.stderr);
  const first = run(dir, ["new", "--dir", "backlog", "--title", "The first task", "--actor", "agent:test"]);
  assert.equal(first.status, 0, first.stderr);
  return dir;
}

function taskFiles(dir) {
  return readdirSync(join(dir, "backlog", "tasks")).filter((f) => f.endsWith(".md")).sort();
}

/** `new --json` with the arguments given, held to the refusal contract. */
function refusedAs(dir, args, { refusalKind, exit, input = "", writes = false }) {
  const before = taskFiles(dir);
  const r = run(dir, ["new", "--dir", "backlog"].concat(args, ["--json"]), input);
  const where = refusalKind + " (" + args.join(" ") + ")";
  let doc;
  assert.doesNotThrow(() => { doc = JSON.parse(r.stdout); },
    where + ": stdout is not an envelope (exit " + r.status + "): " + r.stdout + r.stderr);
  assert.equal(doc.kind, "task-new", where);
  for (const key of DECLARED) assert.ok(key in doc, where + ": the key `" + key + "` is missing");
  assert.equal(doc.ok, false, where);
  assert.equal(doc.refusalKind, refusalKind, where + ": " + doc.refusal);
  assert.equal(typeof doc.refusal, "string", where);
  assert.ok(doc.refusal.length > 0, where + ": an empty refusal sentence");
  assert.ok(Array.isArray(doc.details), where);
  assert.equal(r.status, exit, where + ": the exit code moved");
  assert.equal(r.stderr, "", where + ": stderr under --json");
  if (!writes) assert.deepEqual(taskFiles(dir), before, where + ": a refusal before the write wrote a task");
  return doc;
}

test("control: a created task answers ok:true with every declared key, and no refusal", () => {
  const dir = repo();
  const r = run(dir, ["new", "--dir", "backlog", "--title", "Created", "--actor", "agent:test", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const doc = JSON.parse(r.stdout);
  for (const key of DECLARED) assert.ok(key in doc, "the key `" + key + "` is missing");
  assert.equal(doc.ok, true);
  assert.equal(doc.refusalKind, null);
  assert.equal(doc.refusal, null);
  assert.deepEqual(doc.details, []);
  assert.ok(taskFiles(dir).some((f) => f.startsWith(doc.id + "-")), "the reported task was not written");
});

test("control: without --json a refusal is still text on stderr and stdout stays empty", () => {
  const dir = repo();
  const r = run(dir, ["new", "--dir", "backlog", "--title", "Refused", "--priority", "no-such-priority"]);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /`no-such-priority` is not an allowed value for the field `priority`/);
  assert.throws(() => JSON.parse(r.stderr), "the text form became JSON");
});

test("a refusal of the invocation is a usage envelope, before and after the actor is resolved", () => {
  const dir = repo();
  const unknown = refusedAs(dir, ["--title", "x", "--frobnicate", "y"], { refusalKind: "usage", exit: 2 });
  assert.match(unknown.refusal, /unknown flag: --frobnicate/);
  assert.ok(unknown.details.some((d) => d.startsWith("available: ") && d.includes("--json")),
    "the accepted set is not in details: " + JSON.stringify(unknown.details));
  // Refused before the actor was resolved: no rung was consulted.
  assert.equal(unknown.actorSource, null);

  refusedAs(dir, ["--actor", "agent:test", "--title"], { refusalKind: "usage", exit: 2 });
  const untitled = refusedAs(dir, ["--actor", "agent:test"], { refusalKind: "usage", exit: 2 });
  assert.match(untitled.refusal, /give it a title/);
  refusedAs(dir, ["--title", "!!!", "--actor", "agent:test"], { refusalKind: "usage", exit: 2 });

  const actor = refusedAs(dir, ["--title", "x", "--actor", "nobody"], { refusalKind: "usage", exit: 2 });
  assert.equal(actor.actorSource, "flag", "the rung that named the refused actor is not reported");
});

test("`--json` past the separator is a title, not a request for an envelope", () => {
  const dir = repo();
  const r = run(dir, ["new", "--dir", "backlog", "--priority", "no-such-priority", "--actor", "agent:test", "--title", "--", "--json"]);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, "", "a literal title was read as the flag");
  assert.match(r.stderr, /no-such-priority/);
});

test("a value outside a vocabulary is a usage envelope naming what is allowed", () => {
  const dir = repo();
  const priority = refusedAs(dir, ["--title", "x", "--priority", "no-such-priority", "--actor", "agent:test"],
    { refusalKind: "usage", exit: 2 });
  assert.match(priority.refusal, /no-such-priority/);
  assert.ok(priority.details.some((d) => d.startsWith("allowed: ")), JSON.stringify(priority.details));
  refusedAs(dir, ["--title", "x", "--board", "no-such-board", "--actor", "agent:test"], { refusalKind: "usage", exit: 2 });
  refusedAs(dir, ["--title", "x", "--release", "no-such-release", "--actor", "agent:test"], { refusalKind: "usage", exit: 2 });
  refusedAs(dir, ["--title", "x", "--target", "no-such-target", "--actor", "agent:test"], { refusalKind: "usage", exit: 2 });
});

test("a refused task document, from stdin or --body-file, is invalid-document", () => {
  const dir = repo();
  const stdin = refusedAs(dir, ["--title", "x", "--actor", "agent:test"],
    { refusalKind: "invalid-document", exit: 2, input: "{ not json" });
  assert.ok(stdin.details.length > 0, "the document's problems are not in details");
  refusedAs(dir, ["--title", "x", "--actor", "agent:test", "--body-file", join(dir, "no-such-file.json")],
    { refusalKind: "invalid-document", exit: 2 });
  const empty = join(dir, "empty.json");
  writeFileSync(empty, "\n", "utf8");
  refusedAs(dir, ["--title", "x", "--actor", "agent:test", "--body-file", empty],
    { refusalKind: "invalid-document", exit: 2 });
});

test("a configuration that cannot be loaded is invalid-config", () => {
  const dir = repo();
  appendFileSync(join(dir, "backlog", "config.yaml"), "\nno_such_key: 1\n", "utf8");
  const doc = refusedAs(dir, ["--title", "x", "--actor", "agent:test"], { refusalKind: "invalid-config", exit: 1 });
  assert.ok(doc.details.some((d) => d.includes("no_such_key")), JSON.stringify(doc.details));
});

test("a prefix the tree does not use is prefix-mismatch, before a number is reserved", () => {
  const dir = repo();
  const config = join(dir, "backlog", "config.yaml");
  const text = readFileSync(config, "utf8");
  const moved = text.replace(/^task_id_prefix: .*$/m, "task_id_prefix: ELSEWHERE");
  assert.notEqual(moved, text, "the fixture's prefix line was not rewritten");
  writeFileSync(config, moved, "utf8");
  const doc = refusedAs(dir, ["--title", "x", "--actor", "agent:test"], { refusalKind: "prefix-mismatch", exit: 1 });
  assert.match(doc.refusal, /ELSEWHERE/);
});

test("a template outside the vocabulary is template-drift", () => {
  const dir = repo();
  const template = join(dir, "backlog", "_template.md");
  const text = readFileSync(template, "utf8");
  const drifted = text.replace(/^status: \S+/m, "status: no-such-status");
  assert.notEqual(drifted, text, "the fixture's template status line was not rewritten");
  writeFileSync(template, drifted, "utf8");
  const doc = refusedAs(dir, ["--title", "x", "--actor", "agent:test"], { refusalKind: "template-drift", exit: 1 });
  assert.ok(doc.details.some((d) => d.includes("no-such-status")), JSON.stringify(doc.details));
});

test("a wave the plan refuses is plan-refused — before the write, and after it with the task named", () => {
  const dir = repo();
  // No plan.yaml at all, then a plan without that wave.
  refusedAs(dir, ["--title", "x", "--wave", "no-such-wave", "--actor", "agent:test"], { refusalKind: "plan-refused", exit: 2 });

  // The next number is already scheduled in another wave: the task is written,
  // and the plan refuses to schedule one id twice.
  const files = taskFiles(dir);
  const first = files[0].match(/^([A-Za-z][A-Za-z0-9]*)-(\d+)-/);
  assert.ok(first, "the fixture's first task has no id: " + files[0]);
  const nextId = first[1] + "-" + (Number(first[2]) + 1);
  writeFileSync(join(dir, "backlog", "plan.yaml"), [
    "updated: 2026-01-01",
    'rationale: "a fixture"',
    "waves:",
    '  - name: "first"',
    "    tasks: [" + first[1] + "-" + first[2] + "]",
    '  - name: "second"',
    "    tasks: [" + nextId + "]",
    "",
  ].join("\n"), "utf8");
  refusedAs(dir, ["--title", "x", "--wave", "no-such-wave", "--actor", "agent:test"], { refusalKind: "plan-refused", exit: 2 });

  const after = refusedAs(dir, ["--title", "Written", "--wave", "first", "--actor", "agent:test"],
    { refusalKind: "plan-refused", exit: 1, writes: true });
  assert.equal(after.id, nextId, "the task that WAS written is not named");
  assert.ok(taskFiles(dir).some((f) => f.startsWith(nextId + "-")), "the named task is not on disk");
  assert.ok(after.file && after.file.includes(nextId), "the file that was written is not named");
  assert.equal(after.wave, null, "a wave is reported although the plan did not take the task");
});

test("a missing backlog is the shared no-backlog envelope", () => {
  const dir = fixtureDir(join(tmpdir(), "branchling-new-json-none-"));
  const r = run(dir, ["new", "--dir", join(dir, "nothing-here"), "--title", "x", "--actor", "agent:test", "--json"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(r.stderr, "");
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.kind, "task-new");
  assert.equal(doc.ok, false);
  assert.equal(doc.refusalKind, "no-backlog");
});
