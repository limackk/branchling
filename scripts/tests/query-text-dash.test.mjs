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
import { wantsHelp, COMMANDS } from "../cli.mjs";

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
