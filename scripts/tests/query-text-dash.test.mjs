/**
 * `query --text` takes a value that begins with a dash (TL-691).
 *
 * WHAT WAS BROKEN. `query --text "--help"` printed query's help: the
 * dispatcher's help scan read every token, the value of `--text` included, so
 * the command never ran. A search string is free text, and a title may well
 * contain `--help` or `-h` — the answer has to be a search, not the help that
 * reads like the tool working.
 *
 * The fixture holds titles that contain the dash-leading strings AND titles
 * that do not, so a search that ignored its value (and returned everything)
 * fails as surely as one that printed help.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fixtureDir } from "./_fixture-dir.mjs";
import { SCRIPTS_DIR, isolateHome, plainOutput } from "./_repo.mjs";
import { wantsHelp, COMMANDS, takeColorFlags, literalValueFlagsFor } from "../cli.mjs";
import { takeDirFlag } from "../paths.mjs";

isolateHome("query-text-dash");
plainOutput();

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function run(args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1" },
  });
}

const TITLES = [
  "Document the --help flag",
  "Explain what -h prints",
  "Plain title with no dash",
];

function fixture() {
  const dir = fixtureDir(join(tmpdir(), "branchling-query-text-dash-"));
  assert.equal(run(["init", "--dir", dir, "--no-example"]).status, 0);
  const ids = [];
  for (const title of TITLES) {
    const r = run(["new", "--dir", dir, "--title", title]);
    assert.equal(r.status, 0, r.stderr);
    ids.push(r.stdout.match(/[A-Z]+-\d+/)[0]);
  }
  return { dir, ids };
}

function ask(dir, ...args) {
  const r = run(["query", "--dir", dir, "--json", ...args]);
  assert.equal(r.status, 0, "query failed or printed help:\n" + r.stdout + r.stderr);
  return JSON.parse(r.stdout).tasks.map((t) => t.id).sort();
}

test("the token after --text is its value, whatever it begins with", () => {
  const { dir, ids } = fixture();
  // Positive control: the tree holds all three tasks and a plain search works.
  assert.equal(ask(dir).length, 3);
  assert.deepEqual(ask(dir, "--text", "no dash"), [ids[2]]);

  assert.deepEqual(ask(dir, "--text", "--help"), [ids[0]]);
  assert.deepEqual(ask(dir, "--text", "-h"), [ids[0], ids[1]].sort());
  assert.deepEqual(ask(dir, "--text", "-h prints"), [ids[1]]);
  assert.deepEqual(ask(dir, "--text", "--nothing-matches"), []);
});

test("--text=<substring> is accepted, a dash-leading value included", () => {
  const { dir, ids } = fixture();
  assert.deepEqual(ask(dir, "--text=no dash"), [ids[2]]);
  assert.deepEqual(ask(dir, "--text=--help"), [ids[0]]);
});

test("the text output searches too, rather than printing help", () => {
  const { dir, ids } = fixture();
  const r = run(["query", "--dir", dir, "--text", "--help", "--files"]);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /usage:/, "the help came out instead of a search");
  assert.match(r.stdout, new RegExp(ids[0]));
});

test("--help elsewhere on the line still asks for help", () => {
  // The skip covers exactly the one token after --text: help has to keep working.
  const r = run(["query", "--text", "x", "--help"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /usage:/);

  const literal = COMMANDS.query.literalValueFlags;
  assert.equal(wantsHelp(["--text", "--help"], literal), false);
  assert.equal(wantsHelp(["--text", "-h"], literal), false);
  assert.equal(wantsHelp(["--text", "x", "--help"], literal), true);
  assert.equal(wantsHelp(["--help", "--text", "x"], literal), true);
  // A command without the list keeps the old scan.
  assert.equal(wantsHelp(["--text", "--help"]), true);
});

/**
 * A value that spells a DISPATCHER flag (TL-718). `--color` and `--no-color`
 * are taken off the line by `takeColorFlags()` before the command runs, and
 * the help path reads `--dir` with `takeDirFlag()`; both now skip the token
 * after a flag in the command's `literalValueFlags`, as query's parser does.
 *
 * The fixture holds one title per spelling and one without, so a search that
 * lost its value (and took the next flag as it, or matched everything) fails.
 */
const DISPATCHER_TITLES = [
  "Explain what --color forces",
  "Explain what --no-color turns off",
  "Explain where --dir points",
  "Plain title with no flag",
];

function dispatcherFixture() {
  const dir = fixtureDir(join(tmpdir(), "branchling-query-text-dispatcher-"));
  assert.equal(run(["init", "--dir", dir, "--no-example"]).status, 0);
  const ids = [];
  for (const title of DISPATCHER_TITLES) {
    const r = run(["new", "--dir", dir, "--title", title]);
    assert.equal(r.status, 0, r.stderr);
    ids.push(r.stdout.match(/[A-Z]+-\d+/)[0]);
  }
  return { dir, ids };
}

test("query --text takes --color, --no-color and --dir as its value", () => {
  const { dir, ids } = dispatcherFixture();
  // Positive control: all four tasks are there and a plain search narrows.
  assert.equal(ask(dir).length, 4);
  assert.deepEqual(ask(dir, "--text", "no flag"), [ids[3]]);

  // "--no-color" does not contain "--color" (the dashes precede "no"), so
  // each value matches exactly its own title.
  assert.deepEqual(ask(dir, "--text", "--color", "--scope", "all"), [ids[0]]);
  assert.deepEqual(ask(dir, "--text", "--no-color", "--scope", "all"), [ids[1]]);
  assert.deepEqual(ask(dir, "--text", "--dir", "--scope", "all"), [ids[2]]);

  // The colour flag still works where it IS a flag, on the same line.
  assert.deepEqual(ask(dir, "--no-color", "--text", "--color"), [ids[0]]);
  // The line from the report: a count, and no "unexpected argument".
  const r = run(["query", "--dir", dir, "--text", "--color", "--scope", "all", "--count"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "1");
});

test("the dispatcher's readers skip the token after a literal-value flag", () => {
  const literal = COMMANDS.query.literalValueFlags;
  assert.deepEqual(literalValueFlagsFor(["query", "--text", "x"]), literal);
  assert.deepEqual(literalValueFlagsFor(["--no-color", "query"]), literal);
  assert.deepEqual(literalValueFlagsFor(["new", "--title", "x"]), []);
  assert.deepEqual(literalValueFlagsFor(["frobnicate"]), []);

  assert.deepEqual(takeColorFlags(["query", "--text", "--color", "--no-color"], literal),
    { argv: ["query", "--text", "--color"], force: false });
  assert.deepEqual(takeColorFlags(["query", "--text", "--no-color"], literal),
    { argv: ["query", "--text", "--no-color"], force: null });
  // Without the list the old reading holds: every colour flag is taken.
  assert.deepEqual(takeColorFlags(["query", "--text", "--color"]),
    { argv: ["query", "--text"], force: true });

  assert.deepEqual(takeDirFlag(["--dir", "A", "--text", "--dir"], { literalValueFlags: literal }),
    { dir: "A", argv: ["--text", "--dir"] });
  assert.deepEqual(takeDirFlag(["--text", "--dir", "--dir", "B"], { literalValueFlags: literal }),
    { dir: "B", argv: ["--text", "--dir"] });
  assert.deepEqual(takeDirFlag(["--text", "--dir", "B"]), { dir: "B", argv: ["--text"] });
  // A literal-value flag closing the line hands on no phantom value: the
  // command's own parser reports the missing value, not an `undefined` one.
  assert.deepEqual(takeDirFlag(["--dir", "A", "--text"], { literalValueFlags: literal }),
    { dir: "A", argv: ["--text"] });
  assert.deepEqual(takeColorFlags(["query", "--text"], literal),
    { argv: ["query", "--text"], force: null });
});

test("help --json reads --dir past a --text value that spells it", () => {
  const { dir } = dispatcherFixture();
  // `--text --dir` is a search value, so `--dir <fixture>` names the backlog;
  // read as a flag, the second `--dir` would point the help at "--help".
  const r = run(["query", "--dir", dir, "--text", "--dir", "--help", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).configured, true);
});
