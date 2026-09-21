/**
 * A task the tool just wrote passes the tool's own guards (TL-262).
 *
 * WHAT WAS BROKEN. `_template.md` ships a `verification:` example that carries
 * an `id:`, and `check --criteria` reported that id as proving no criterion the
 * moment the author wrote their own `## Acceptance criteria` — which is the
 * first thing anybody does with a fresh task. The advice the message gives
 * ("either link it or drop the `id:`") is the wrong repair twice over: the
 * entry was written by the template and not by anybody who thought about the
 * task, so what it needs is to be REPLACED, and `done` already refuses to close
 * on it. A guard that fires on a state the tool authored teaches its reader to
 * delete two of the three lines the tool just wrote.
 *
 * WHAT IS PROVED HERE. A placeholder announces itself by its COMMAND, so the
 * orphan rule skips it, and every entry somebody really wrote is still
 * reported — including one that kept the template's id but got a real command.
 * The last case is the positive control the whole decision rests on: if the
 * rule were "the template's id is exempt", that case would go quiet too and
 * `criteria_links` would be weaker than it was.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { TEMPLATE_PLACEHOLDER } from "../criteria.mjs";
import { TEMPLATE_PLACEHOLDER as PLACEHOLDER_DONE_REFUSES } from "../done-task.mjs";
import { isolateHome } from "./_repo.mjs";

isolateHome("new-task-passes-check");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

function run(args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1" },
  });
}

/** A backlog with nothing in it but the task this test creates. */
function freshBacklog(label) {
  const dir = mkdtempSync(join(tmpdir(), "branchling-" + label + "-"));
  const r = run(["init", "--dir", dir, "--no-example"]);
  assert.equal(r.status, 0, r.stderr);
  return dir;
}

function newTask(dir, title) {
  const r = run(["new", "--dir", dir, "--title", title]);
  assert.equal(r.status, 0, r.stderr);
  const files = readdirSync(join(dir, "tasks"));
  assert.equal(files.length, 1, "expecting exactly the task just created");
  return join(dir, "tasks", files[0]);
}

const criteriaCheck = (dir) => run(["check", "--criteria", "--dir", dir]);

test("a task straight out of `new` leaves `check` silent", () => {
  const dir = freshBacklog("fresh");
  const file = newTask(dir, "A task the tool just wrote");

  // The placeholder is what the template wrote, not something this test staged.
  assert.match(readFileSync(file, "utf8"), new RegExp(TEMPLATE_PLACEHOLDER));

  const criteria = criteriaCheck(dir);
  assert.equal(criteria.status, 0, criteria.stderr);
  assert.ok(
    !/proves no criterion/.test(criteria.stdout + criteria.stderr),
    "a fresh task must not be reported:\n" + criteria.stdout + criteria.stderr
  );

  const gate = run(["check", "--dir", dir]);
  assert.equal(gate.status, 0, gate.stdout + gate.stderr);
});

test("the placeholder survives the author writing their own criteria", () => {
  const dir = freshBacklog("authored");
  const file = newTask(dir, "A task whose body the author wrote");

  // WHAT AN AUTHOR ACTUALLY DOES, and the state five tasks in this backlog are
  // in: the prose and a real check are written, the template's example entry is
  // left standing underneath them. It proves nothing and it never claimed to.
  const raw = readFileSync(file, "utf8");
  const withOwnCheck = raw
    .replace(/^verification:.*$/m, "verification:\n  - id: mine\n    bash: \"true\"")
    .replace(/^- \[ \].*$/m, "- [ ] The command this author wrote passes. [proof: mine]");
  writeFileSync(file, withOwnCheck);

  const r = criteriaCheck(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(
    !/proves no criterion/.test(r.stdout + r.stderr),
    "the template's own entry must not be reported:\n" + r.stdout + r.stderr
  );
});

test("an entry somebody really wrote is still reported", () => {
  const dir = freshBacklog("authored-entry");
  const file = newTask(dir, "A task with a real check that proves nothing");

  // The template's ID, a command somebody chose. The id is not what makes an
  // entry a placeholder — the command is — so this one is still an orphan.
  const raw = readFileSync(file, "utf8");
  writeFileSync(file, raw
    .replace(new RegExp('bash: "' + TEMPLATE_PLACEHOLDER + '".*'), 'bash: "true"')
    .replace(/^- \[ \].*$/m, "- [ ] Something nobody proved."));

  const r = criteriaCheck(dir);
  assert.match(r.stdout + r.stderr, /`the-name` proves no criterion/);
});

test("the placeholder `check` skips is the one `done` refuses", () => {
  // Two copies of one string: `done` owns it and this guard may not import the
  // closing command to read it. The copy is only safe while a test fails on the
  // day they diverge.
  assert.equal(TEMPLATE_PLACEHOLDER, PLACEHOLDER_DONE_REFUSES);
});
