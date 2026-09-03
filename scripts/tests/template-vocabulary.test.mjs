/**
 * The template smuggling a value past the vocabulary (TL-69).
 *
 * THE DEFECT, measured on a fresh backlog after the most ordinary onboarding
 * step there is — adjusting statuses to your own process:
 *
 *   $ sed -i 's/^statuses: .*!/statuses: [todo, doing, shipped]/' config.yaml
 *   $ branchling new --title "First"
 *   branchling new: …/tasks/TASK-1-first.md      # not a word of protest
 *   $ grep '^status:' tasks/TASK-1-first.md
 *   status: pending                             # not in the vocabulary
 *
 * The command validated the values it received through FLAGS and never the ones
 * that arrived from `_template.md`. So `new --status pending` was refused while
 * `new` with no flags wrote the same value silently — the refusal was exactly
 * backwards.
 *
 * WHAT NEEDS PROVING, and why each half is here:
 *
 *   1. The write is REFUSED, and the message names `_template.md`. A refusal
 *      whose message points at the command sends the user looking for a mistake
 *      they did not make.
 *   2. Nothing is written. A guard that refuses after the file exists has not
 *      guarded anything.
 *   3. On an UNCHANGED configuration `new` still works. Without this control the
 *      whole file would also pass for a command that has stopped writing tasks.
 *   4. `init`, `seed` and `import` reach the same refusal, because they create
 *      tasks through the same function. A rule enforced in one of four writers
 *      is a rule with three ways round it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../config.mjs";
import { driftMessage, templateDrift } from "../new-task.mjs";
import { alignTemplate, isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("template-vocabulary");


const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

let counter = 0;
function run(args, input) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, input: input || "",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

/** A backlog whose statuses are the project's own — and whose template still
 *  carries the defaults, which is the state `init` plus one edit leaves behind. */
function drifted({ align = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "branchling-template-" + counter++ + "-"));
  assert.equal(run(["init", "--dir", dir, "--no-example"]).status, 0);
  const p = join(dir, "config.yaml");
  writeFileSync(p, readFileSync(p, "utf8")
    .replace(/^statuses:.*$/m, "statuses: [todo, doing, shipped]")
    .replace(/^archived_statuses:.*$/m, "archived_statuses: [shipped]")
    .replace(/^dashboard_open_statuses:.*$/m, "dashboard_open_statuses: [todo, doing]")
    .replace(/^in_progress_status:.*$/m, "in_progress_status: doing")
    .replace(/^reason_required_statuses:.*$/m, "reason_required_statuses: [shipped]"), "utf8");
  if (align) alignTemplate(dir);
  return dir;
}

const taskCount = (dir) => readdirSync(join(dir, "tasks")).filter((f) => f.endsWith(".md")).length;

// ── The measurement ───────────────────────────────────────────────────────

test("the drift is found in the ASSEMBLED frontmatter, not in the flags", () => {
  const config = { statuses: ["todo", "doing"], archivedStatuses: ["doing"], priorities: ["P1"], types: ["task"] };
  const text = "---\nid: T-1\nstatus: pending\npriority: P1\ntype: task\n---\n\nbody\n";
  const drift = templateDrift(text, config);
  assert.equal(drift.length, 1);
  assert.equal(drift[0].field, "status");
  assert.deepEqual(drift[0].found.map((f) => f.value), ["pending"]);
});

test("a frontmatter inside the vocabulary is no drift at all", () => {
  const config = { statuses: ["todo", "doing"], archivedStatuses: ["doing"], priorities: ["P1"], types: ["task"] };
  assert.deepEqual(templateDrift("---\nid: T-1\nstatus: todo\npriority: P1\ntype: task\n---\n", config), []);
});

test("the message blames the template — unless the caller passed the value", () => {
  const drift = [{ field: "status", allowed: ["todo", "doing"], found: [{ value: "pending", count: 1 }] }];
  const fromTemplate = driftMessage(drift, { templatePath: "/b/_template.md", fields: {}, command: "x new" });
  assert.match(fromTemplate, /it came from the template, not from your command — \/b\/_template\.md/);

  // A message blaming a file somebody never edited is worse than no message.
  const fromCaller = driftMessage(drift, { templatePath: "/b/_template.md", fields: { status: "pending" }, command: "x new" });
  assert.match(fromCaller, /it came from the arguments of this call/);
});

// ── `new` ─────────────────────────────────────────────────────────────────

test("after a vocabulary change `new` with NO flags refuses, and writes nothing", () => {
  const dir = drifted();
  const r = run(["new", "--dir", dir, "--title", "First"]);
  assert.equal(r.status, 1, "the task was written with a status outside the vocabulary");
  assert.equal(taskCount(dir), 0, "a guard that refuses after the write has guarded nothing");
  assert.match(r.stderr, /`status: pending` is not a value this project uses \(todo \| doing \| shipped\)/);
  assert.match(r.stderr, /_template\.md/, "the message does not name the file to fix");
});

test("the SAME backlog writes once the template is corrected", () => {
  // The positive control, and the fix the message actually asks for.
  const dir = drifted({ align: true });
  const r = run(["new", "--dir", dir, "--title", "First"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(taskCount(dir), 1);
  const file = join(dir, "tasks", readdirSync(join(dir, "tasks"))[0]);
  assert.match(readFileSync(file, "utf8"), /^status: todo$/m);
});

test("on an untouched configuration `new` is unaffected", () => {
  const dir = mkdtempSync(join(tmpdir(), "branchling-template-plain-" + counter++ + "-"));
  assert.equal(run(["init", "--dir", dir, "--no-example"]).status, 0);
  const r = run(["new", "--dir", dir, "--title", "Ordinary"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(taskCount(dir), 1);
});

test("an explicit flag inside the vocabulary still passes — the flag replaces the template's value", () => {
  const dir = drifted();
  const r = run(["new", "--dir", dir, "--title", "First", "--status", "todo"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(taskCount(dir), 1);
});

// ── The other writers ─────────────────────────────────────────────────────

test("`seed` reaches the same refusal, and names the template rather than a rollback", () => {
  const dir = drifted();
  const plan = JSON.stringify({
    planVersion: 1,
    tasks: [{ plan_id: "a", title: "A task", goal: "g", verification: ["true"] }],
  });
  const r = run(["seed", "--dir", dir], plan);
  assert.equal(r.status, 1);
  assert.equal(taskCount(dir), 0);
  assert.match(r.stderr, /_template\.md/);
  assert.doesNotMatch(r.stderr, /part-way through/, "a drifted template is not a partial failure");
});

test("`import` reaches it too — on a field it does not set itself", () => {
  // `import` maps the STATUS from the configuration, so a drifted `statuses:`
  // never reaches it. Every other template value does, and `priorities:` is the
  // one a project is as likely to rename.
  const dir = mkdtempSync(join(tmpdir(), "branchling-template-import-" + counter++ + "-"));
  assert.equal(run(["init", "--dir", dir, "--no-example"]).status, 0);
  const p = join(dir, "config.yaml");
  writeFileSync(p, readFileSync(p, "utf8").replace(/^priorities:.*$/m, "priorities: [urgent, ordinary, someday]"), "utf8");

  const issues = JSON.stringify([{ number: 1, title: "An issue", body: "b", state: "OPEN", labels: [], url: "https://example.test/1" }]);
  const r = run(["import", "--from", "github", "--dir", dir], issues);
  assert.equal(r.status, 1);
  assert.equal(taskCount(dir), 0);
  assert.match(r.stderr, /`priority: P1` is not a value this project uses/);
  assert.match(r.stderr, /_template\.md/);

  // The control: the same input lands once the template agrees with the config.
  alignTemplate(dir);
  const ok = run(["import", "--from", "github", "--dir", dir], issues);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(taskCount(dir), 1);
});

test("`init` re-run over an adjusted config.yaml says why there is no example, and does not crash", () => {
  const dir = drifted();
  const r = run(["init", "--dir", dir]);
  assert.equal(r.status, 0, "the backlog itself is written and correct — only the example could not be");
  assert.equal(taskCount(dir), 0);
  assert.match(r.stdout, /no example task/);
  assert.match(r.stdout, /_template\.md/);
  assert.doesNotMatch(r.stdout + r.stderr, /at createTask/, "a stack trace reached the user");
});

test("`init`'s example takes its priority from the vocabulary, not from a literal", () => {
  // The example used to pass `priority: P2` whatever the project's priorities
  // were — the same defect as the template's, one layer up.
  const dir = mkdtempSync(join(tmpdir(), "branchling-template-prio-" + counter++ + "-"));
  assert.equal(run(["init", "--dir", dir, "--no-example"]).status, 0);
  const p = join(dir, "config.yaml");
  writeFileSync(p, readFileSync(p, "utf8").replace(/^priorities:.*$/m, "priorities: [urgent, ordinary, someday]"), "utf8");
  alignTemplate(dir);

  const r = run(["init", "--dir", dir]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(taskCount(dir), 1, "no example was created");
  const file = join(dir, "tasks", readdirSync(join(dir, "tasks"))[0]);
  const priority = readFileSync(file, "utf8").match(/^priority: (\S+)/m)[1];
  assert.ok(loadConfig(dir).priorities.includes(priority), "the example carries `" + priority + "`, which is not in the vocabulary");
});
