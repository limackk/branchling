/**
 * Each open question carries the priority of its task (TL-560).
 *
 * `log --open-questions --json` is the one call a decisions screen reads
 * (TL-536). Without the priority on each entry, that screen has to read every
 * task again to rank the questions, which is the per-task cost the one call
 * exists to remove.
 *
 * WHAT HAS TO BE PROVED:
 *
 *   1. EACH ENTRY CARRIES ITS OWN TASK'S PRIORITY. Two tasks with DIFFERENT
 *      priorities, so an entry that copied one value onto every question, or
 *      took a constant, cannot pass.
 *   2. THE PRIORITY IS READ FROM THE TASK FILE AT THE TIME OF THE CALL, not
 *      remembered from the moment the question was asked: the priority is
 *      changed after the question exists, and the answer must follow it.
 *
 * The priorities are taken from the fixture's own `config.yaml`, never written
 * into this file: they are the vocabulary of a backlog, not the tool's contract.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../config.mjs";
import { SCRIPTS_DIR, isolateHome, plainOutput } from "./_repo.mjs";

isolateHome("open-questions");
plainOutput();

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1" },
  });
}

/** A fresh backlog inside a real repository, and the priorities it declares. */
function fixture() {
  const repo = mkdtempSync(join(tmpdir(), "branchling-open-questions-"));
  execFileSync("git", ["init", "-q", "-b", "main", "."], { cwd: repo, stdio: "ignore" });
  const dir = join(repo, "backlog");
  assert.equal(run(["init", "--dir", dir, "--no-example"]).status, 0, "init failed");
  const priorities = loadConfig(dir).priorities;
  assert.ok(priorities.length >= 2, "the fixture needs two distinct priorities to tell entries apart");
  return { dir, priorities };
}

function newTask(dir, title, priority) {
  const r = run(["new", "--dir", dir, "--title", title, "--priority", priority, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(run(["query", "--dir", dir, "--text", title, "--json"]).stdout).tasks[0].id;
}

function ask(dir, id, question) {
  const r = run(["ask", id, "--dir", dir, "--question", question, "--actor", "agent:asker", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).question.id;
}

function openQuestions(dir) {
  const r = run(["log", "--open-questions", "--dir", dir, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test("every open question carries the priority of its own task", () => {
  const { dir, priorities } = fixture();
  const [high, low] = [priorities[0], priorities[priorities.length - 1]];
  const urgent = newTask(dir, "An urgent task with a question", high);
  const later = newTask(dir, "A later task with a question", low);
  ask(dir, urgent, "Which store?");
  ask(dir, later, "Is the title right?");

  const answer = openQuestions(dir);
  assert.equal(answer.total, 2);
  const byTask = Object.fromEntries(answer.questions.map((q) => [q.task, q.priority]));
  assert.deepEqual(byTask, { [urgent]: high, [later]: low });
});

test("the priority follows the task file, not the moment the question was asked", () => {
  const { dir, priorities } = fixture();
  const [first, second] = priorities;
  const id = newTask(dir, "A task whose priority moves", first);
  ask(dir, id, "Should this move up?");
  assert.equal(openQuestions(dir).questions[0].priority, first);

  const moved = run(["set", id, "priority", second, "--dir", dir, "--actor", "agent:asker",
    "--reason", "the question raised its urgency"]);
  assert.equal(moved.status, 0, moved.stderr);
  assert.equal(openQuestions(dir).questions[0].priority, second);
});
