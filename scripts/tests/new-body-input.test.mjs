/**
 * `new` accepts the task itself, not only its frontmatter (TL-237).
 *
 * WHAT WAS BROKEN. The fourth law asks for a callable input on every writing
 * command. `new` had flags for the frontmatter and nothing for the task: the
 * goal, the context, the steps and the `verification:` block — the one field
 * that decides whether a task can ever be closed — had to be written into the
 * generated file afterwards. The project's own guide says to create a task with
 * `new` and never by hand, and both were obeyed by calling `new` and then
 * rewriting its output with a heredoc. The rule and the interface disagreed,
 * and the workaround was the thing the rule forbids.
 *
 * WHAT IS PROVED HERE, and why the first case is the one that matters: a task
 * created with a document on stdin CLOSES through `done` with no hand edit in
 * between. A test that only read the file's text would pass for a body written
 * into the wrong place — `done` runs the contract and ticks the criteria, so it
 * is the only reader that can tell a task apart from a file that looks like one.
 *
 * THE POSITIVE CONTROL for the second case: with nothing on stdin the command
 * must still produce the template, placeholder and all. Every other caller of
 * `new` — this suite, `init`, any script — arrives with a stdin that is not a
 * terminal, so "nothing arrived" has to keep meaning what it meant before.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { TEMPLATE_PLACEHOLDER } from "../done-task.mjs";
import { STDIN_WAIT_MS } from "../stdin.mjs";
import { isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it.
isolateHome("new-body-input");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");
const ACTOR = "local:who-ran-new";

function run(args, opts = {}) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1" }, ...opts,
  });
}

function freshBacklog() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-body-"));
  const r = run(["init", "--dir", dir, "--no-example"]);
  assert.equal(r.status, 0, r.stderr);
  return dir;
}

const tasksIn = (dir) => readdirSync(join(dir, "tasks"));

/** The document format: the task's prose and its closing contract. */
const DOCUMENT = {
  goal: "The task arrives finished, from whatever produced it.",
  context: "The fourth law asks for a callable input on every writing command.",
  steps: ["Pipe the document in", "Close the task with no hand edit"],
  verification: [
    { id: "it-runs", bash: "true", proves: "The contract runs and passes." },
  ],
};

// ── The end-to-end claim ──────────────────────────────────────────────────

test("a task created from a document on stdin closes through `done`, unedited", () => {
  const dir = freshBacklog();
  const created = run(["new", "--dir", dir, "--title", "Piped in whole"], { input: JSON.stringify(DOCUMENT) });
  assert.equal(created.status, 0, created.stderr);
  const id = created.stdout.match(/[A-Z]+-\d+/)[0];

  const file = join(dir, "tasks", tasksIn(dir)[0]);
  const text = readFileSync(file, "utf8");
  assert.ok(!text.includes(TEMPLATE_PLACEHOLDER), "the template's placeholder contract survived the document");

  assert.equal(run(["take", id, "--dir", dir, "--actor", ACTOR]).status, 0);
  // NO EDIT BETWEEN THE TWO COMMANDS — that is the whole assertion. `done` runs
  // the `verification:` block and refuses a task that has none, so a green exit
  // here is the contract having arrived where the tool reads it from.
  const closed = run(["done", id, "--dir", dir, "--actor", ACTOR]);
  assert.equal(closed.status, 0, closed.stdout + closed.stderr);

  const after = readFileSync(file, "utf8");
  assert.match(after, /^status: done/m);
  assert.match(after, /- \[x\] The contract runs and passes\. \[proof: it-runs\]/,
    "the criterion the document earned was not ticked by the run");
});

test("the goal, the context and the steps land under the headings the tool reads", () => {
  const dir = freshBacklog();
  const r = run(["new", "--dir", dir, "--title", "Under the headings"], { input: JSON.stringify(DOCUMENT) });
  assert.equal(r.status, 0, r.stderr);
  const text = readFileSync(join(dir, "tasks", tasksIn(dir)[0]), "utf8");

  assert.match(text, /## Goal\n\nThe task arrives finished/);
  assert.match(text, /## Context\n\nThe fourth law/);
  assert.match(text, /## Steps\n\n1\. Pipe the document in\n2\. Close the task/);
  assert.match(text, /^  - id: it-runs\n    bash: "true"$/m);
});

test("a document may arrive in a file, for a caller whose stdin is spoken for", () => {
  const dir = freshBacklog();
  const path = join(dir, "document.json");
  writeFileSync(path, JSON.stringify(DOCUMENT), "utf8");

  // Stdin carries something that is NOT the document: the flag suppresses the
  // read rather than competing with it, so this must not reach the task.
  const r = run(["new", "--dir", dir, "--title", "From a file", "--body-file", path], { input: "not a document" });
  assert.equal(r.status, 0, r.stderr);
  const text = readFileSync(join(dir, "tasks", tasksIn(dir)[0]), "utf8");
  assert.match(text, /The task arrives finished/);
  assert.ok(!text.includes("not a document"), "stdin was read although --body-file was given");
});

// ── Nothing arrived: the old behaviour, unchanged ─────────────────────────

test("with nothing on stdin the template is still what gets written", () => {
  const dir = freshBacklog();
  const r = run(["new", "--dir", dir, "--title", "The old way"]);
  assert.equal(r.status, 0, r.stderr);
  const text = readFileSync(join(dir, "tasks", tasksIn(dir)[0]), "utf8");
  // The positive control: this is the state the command produced before TL-237,
  // and a test asserting only the new path would be green with the old path
  // broken for every other caller of `new`.
  assert.ok(text.includes(TEMPLATE_PLACEHOLDER), "the template's own contract is gone from a task nobody sent a document for");
  assert.match(r.stdout, /fill in ## Goal/);
});

test("stdin that nobody closes is given up on, not waited on forever", () => {
  const dir = freshBacklog();
  const started = Date.now();
  const child = spawn(process.execPath, [CLI, "new", "--dir", dir, "--title", "Nobody closes the pipe"], {
    stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, NO_COLOR: "1" },
  });
  // The pipe stays open and empty — a parent that inherited stdin and has
  // nothing to say. Before the bounded read this was indistinguishable from
  // slow work, and it never ended.
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => {
      const elapsed = Date.now() - started;
      try {
        assert.equal(code, 0);
        assert.ok(elapsed < STDIN_WAIT_MS * 4,
          `it took ${elapsed}ms with a stdin nobody closed (the window is ${STDIN_WAIT_MS}ms) — it is blocking`);
        assert.equal(tasksIn(dir).length, 1, "the task was not written");
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
});

// ── The refusals ──────────────────────────────────────────────────────────

test("a refused document writes nothing and reports every complaint at once", () => {
  const dir = freshBacklog();
  const r = run(["new", "--dir", dir, "--title", "Refused"], {
    input: JSON.stringify({ steps: "not a list", verification: [] }),
  });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /`goal` is required/);
  assert.match(r.stderr, /`steps` must be an array/);
  assert.match(r.stderr, /`verification` is required/);
  assert.deepEqual(tasksIn(dir), [], "a refused document left a task behind");
});

test("frontmatter in the document is named with the flag it belongs to", () => {
  const dir = freshBacklog();
  const r = run(["new", "--dir", dir, "--title", "Two sources"], {
    input: JSON.stringify({ ...DOCUMENT, title: "Somebody else's title", priority: "P0" }),
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /`title` is frontmatter.*--title/);
  assert.match(r.stderr, /`priority` is frontmatter.*--priority/);
  assert.deepEqual(tasksIn(dir), []);
});

test("a plan's own keys are refused: one task is not a plan", () => {
  const dir = freshBacklog();
  const r = run(["new", "--dir", dir, "--title", "Not a plan"], {
    input: JSON.stringify({ ...DOCUMENT, plan_id: "build-cli", blocked_by: ["other"] }),
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /`plan_id` belongs to a plan/);
  assert.match(r.stderr, /`blocked_by` belongs to a plan/);
});

test("the template's placeholder is not a contract, wherever it is typed", () => {
  const dir = freshBacklog();
  const r = run(["new", "--dir", dir, "--title", "Placeholder"], {
    input: JSON.stringify({ goal: "g", verification: [{ bash: TEMPLATE_PLACEHOLDER }] }),
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /still the template placeholder/);
  assert.deepEqual(tasksIn(dir), []);
});

test("a document that is not JSON is refused as such, with nothing written", () => {
  const dir = freshBacklog();
  const r = run(["new", "--dir", dir, "--title", "Not JSON"], { input: "## Goal\n\nprose, not a document" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not valid JSON/);
  assert.deepEqual(tasksIn(dir), []);
});

test("a --body-file that is not there is refused before anything is written", () => {
  const dir = freshBacklog();
  const r = run(["new", "--dir", dir, "--title", "Missing file", "--body-file", join(dir, "nope.json")]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /could not be read/);
  assert.deepEqual(tasksIn(dir), []);
});

test("an unknown key fails rather than being dropped in silence", () => {
  const dir = freshBacklog();
  const r = run(["new", "--dir", dir, "--title", "Typo"], {
    input: JSON.stringify({ ...DOCUMENT, goals: "a typo for goal" }),
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown key `goals`/);
});
