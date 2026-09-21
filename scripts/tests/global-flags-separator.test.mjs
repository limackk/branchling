/**
 * After `--` nothing is a flag — INCLUDING the dispatcher's own flags (TL-247).
 *
 * WHAT WAS WRONG. `--` is the tool's answer to "my value begins with a dash":
 * TL-58 taught `new` to read it, TL-248 taught `plan add | move`, and
 * `foldAppendFlags()` and `wantsHelp()` in the dispatcher already stopped at it.
 * `takeDirFlag()` and `takeColorFlags()` did not. They run ABOVE every command,
 * so a word the command was about to accept as a value was taken off the line
 * before the command ever saw it. Measured on 2026-09-21, before a line changed:
 *
 *   takeDirFlag(["--title", "--", "--dir", "X"])
 *     -> { dir: "X", argv: ["--title", "--"] }
 *
 * — a user asking for a task titled `--dir` got no task and no refusal, and the
 * write went to whatever directory followed. That is the worst shape available:
 * silent, and in the wrong tree.
 *
 * WHY A FILE OF ITS OWN. The subject is one convention read by two modules,
 * `scripts/paths.mjs` and `scripts/cli.mjs`. Split across their two test files
 * the agreement between them is the thing nobody is asserting, and it is the
 * whole point: a command line is read by ONE set of rules, whichever layer is
 * doing the reading. The end-to-end case lives here too, because it proves the
 * two layers composing rather than either of them alone.
 *
 * `-- --dir X` IS TWO ARGUMENTS, NOT A FLAG: the separator and everything past
 * it stay in `argv` for the command below to read, exactly as `foldAppendFlags`
 * leaves them. `--dir A -- --dir B` therefore means directory A, and `--dir B`
 * is a value — the first occurrence is the flag, the second is text.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isolateHome, SCRIPTS_DIR, plainOutput } from "./_repo.mjs";

isolateHome("global-flags-separator");
plainOutput();

import { takeDirFlag } from "../paths.mjs";
import { takeColorFlags } from "../cli.mjs";

const CLI = join(SCRIPTS_DIR, "cli.mjs");

// ── the pure functions ────────────────────────────────────────────────────

test("takeDirFlag reads nothing past `--` as a flag", () => {
  // THE POSITIVE CONTROL: the flag IS taken when it is a flag. Without this
  // every assertion below would also pass against a function that never
  // recognised `--dir` at all.
  assert.deepEqual(takeDirFlag(["--dir", "X", "--title", "T"]), { dir: "X", argv: ["--title", "T"] },
    "`--dir` before the separator is not being read — the measurement is broken, not the separator");

  assert.deepEqual(takeDirFlag(["--title", "--", "--dir", "X"]),
    { dir: null, argv: ["--title", "--", "--dir", "X"] },
    "`--dir` past the separator was eaten as a flag");

  // The `--dir=` spelling is the same word and gets the same answer.
  assert.deepEqual(takeDirFlag(["--title", "--", "--dir=X"]),
    { dir: null, argv: ["--title", "--", "--dir=X"] });

  // The decision recorded in this task: the FIRST occurrence is the flag, the
  // second is text. Nothing past the separator can move the write.
  assert.deepEqual(takeDirFlag(["--dir", "A", "--title", "--", "--dir", "B"]),
    { dir: "A", argv: ["--title", "--", "--dir", "B"] });

  // The separator survives the pass, because the command below reads it.
  assert.ok(takeDirFlag(["--title", "--", "v"]).argv.includes("--"),
    "the separator was consumed — the command below can no longer see it");
});

test("takeColorFlags reads nothing past `--` as a flag", () => {
  assert.deepEqual(takeColorFlags(["new", "--no-color", "--title", "T"]),
    { argv: ["new", "--title", "T"], force: false },
    "`--no-color` before the separator is not being read — the measurement is broken");
  assert.equal(takeColorFlags(["new", "--color"]).force, true);

  assert.deepEqual(takeColorFlags(["new", "--title", "--", "--no-color"]),
    { argv: ["new", "--title", "--", "--no-color"], force: null },
    "`--no-color` past the separator was eaten as a flag");
  assert.deepEqual(takeColorFlags(["new", "--title", "--", "--color"]),
    { argv: ["new", "--title", "--", "--color"], force: null });

  // The first occurrence still decides; the second is text.
  assert.equal(takeColorFlags(["new", "--no-color", "--title", "--", "--color"]).force, false);
});

// ── the two layers composing, against a real write ────────────────────────

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-sep-"));
  mkdirSync(join(dir, "tasks"));
  writeFileSync(join(dir, "_template.md"), readFileSync(join(SCRIPTS_DIR, "..", "_template.md"), "utf8"), "utf8");
  writeFileSync(join(dir, "config.yaml"), "task_id_prefix: TL\n", "utf8");
  writeFileSync(join(dir, "boards.yaml"), 'default: main\nboards:\n  - slug: main\n    name: "Main"\n', "utf8");
  return dir;
}

const run = (args) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
};
const tasksIn = (dir) => readdirSync(join(dir, "tasks")).sort();

test("a task can be TITLED `--dir`, and the write does not move", () => {
  const home = sandbox();
  const elsewhere = sandbox();
  try {
    // THE POSITIVE CONTROL: this fixture accepts an ordinary `new`.
    const ordinary = run(["new", "--dir", home, "--title", "an ordinary title"]);
    assert.equal(ordinary.code, 0, ordinary.out + ordinary.err);
    assert.equal(tasksIn(home).length, 1, "`new` writes nothing in this fixture — the measurement is broken");

    const r = run(["new", "--dir", home, "--title", "--", "--dir"]);
    assert.equal(r.code, 0, "a title of `--dir` was refused: " + r.err);

    assert.equal(tasksIn(elsewhere).length, 0,
      "the write moved: the word past the separator was read as the directory flag");
    const files = tasksIn(home);
    assert.equal(files.length, 2, "the task was not written where `--dir` said: " + files.join(" "));
    const written = files.map((f) => readFileSync(join(home, "tasks", f), "utf8")).join("\n");
    assert.match(written, /title: "--dir"/, "the title is not the word that was typed");
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test("a SECOND `--dir` past the separator is a value, not a redirection", () => {
  const home = sandbox();
  const elsewhere = sandbox();
  try {
    // `new` takes no positional, so the leftover word is REFUSED by name rather
    // than dropped. What matters here is which tree is untouched afterwards:
    // neither directory may gain a task from a line the tool would not accept.
    const r = run(["new", "--dir", home, "--title", "T", "--", "--dir", elsewhere]);
    assert.equal(r.code, 2, "a trailing argument was accepted: " + r.out + r.err);
    assert.equal(tasksIn(elsewhere).length, 0, "the second `--dir` moved the write");
    assert.equal(tasksIn(home).length, 0, "a refused invocation still wrote a task");
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
});
