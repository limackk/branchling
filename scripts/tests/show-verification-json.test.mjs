/**
 * `show <ID> --json` carries the task's verification contract (TL-561).
 *
 * WHY. A consumer reaches the tool only through `--json`, and until this key no
 * reading command exposed a task's `verification:` entries: a program that
 * wanted the closing contract had to parse the task file itself, which is the
 * one thing the consumer contract tells it not to do.
 *
 * WHAT HAS TO BE PROVED, against a task file written by hand so every byte of
 * the contract is known:
 *
 *   1. a `bash:` entry holding quotes and a backslash comes back as the command
 *      the shell would run, not as the YAML spelling of it;
 *   2. a `manual:` entry comes back with its vouch text, and `bash: null`;
 *   3. each entry carries the acceptance criteria that name it through
 *      `[proof: <id>]` — including a criterion that names two entries and one
 *      that wraps — and a criterion naming no entry is attached to none;
 *   4. a task with no contract answers `[]`, a contract `done` could not read
 *      says why in `verificationProblems`, and a refusal still carries both
 *      keys, as every declared key is carried.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SCRIPTS_DIR, isolateHome, isolateState } from "./_repo.mjs";

isolateHome("show-verification");
isolateState("show-verification");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
let counter = 0;

function run(dir, args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, cwd: dir, env: { ...process.env, NO_COLOR: "1" },
  });
}

function backlogRepo() {
  const dir = fixtureDir(join(tmpdir(), "branchling-show-verification-" + counter++ + "-"));
  execFileSync("git", ["init", "-q", "-b", "main", "."], { cwd: dir });
  assert.equal(run(dir, ["init", "--dir", "backlog", "--no-example"]).status, 0);
  return dir;
}

/**
 * A task created by the tool, then given the contract and the criteria under
 * test. The rest of the frontmatter stays the tool's own, so the fixture cannot
 * drift from the shape `new` writes.
 */
function taskWith(dir, { verification, criteria }) {
  const r = run(dir, ["new", "--dir", "backlog", "--title", "A task with a contract"]);
  assert.equal(r.status, 0, r.stderr);
  const id = r.stdout.match(/[A-Z]+-\d+/)[0];
  const name = readdirSync(join(dir, "backlog", "tasks")).find((f) => f.startsWith(id + "-"));
  const path = join(dir, "backlog", "tasks", name);
  const text = readFileSync(path, "utf8");
  const replaced = text
    .replace(/^verification:.*\n(?:[ \t]+.*\n)*/m, verification)
    .replace(/## Acceptance criteria[\s\S]*$/, "## Acceptance criteria\n\n" + criteria);
  assert.notEqual(replaced, text, "the fixture did not replace the template's contract");
  writeFileSync(path, replaced, "utf8");
  return id;
}

function showJson(dir, id) {
  const r = run(dir, ["show", "--dir", "backlog", id, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const json = JSON.parse(r.stdout);
  assert.equal(json.kind, "task-show");
  return json;
}

test("every verification entry comes back with its id, its command or vouch text, and the criteria linked to it", () => {
  const dir = backlogRepo();
  const id = taskWith(dir, {
    verification: [
      "verification:",
      "  - id: grep-quoted              # a comment the reader must not keep",
      "    bash: \"grep -q \\\"a\\\\b\\\" notes.txt\"",
      "  - id: page-read",
      "    manual: \"the reviewer opens the page and reads every row\"",
      "  - bash: \"true\"                 # an entry with no id: nothing can link to it",
      "",
    ].join("\n"),
    criteria: [
      "- [ ] the pattern is found [proof: grep-quoted]",
      "- [x] the page reads well and the pattern is",
      "  found on it [proof: page-read, grep-quoted]",
      "- [ ] a sentence nobody linked",
      "",
    ].join("\n"),
  });

  const json = showJson(dir, id);
  assert.deepEqual(json.verificationProblems, []);
  assert.deepEqual(json.verification, [
    {
      id: "grep-quoted",
      bash: "grep -q \"a\\b\" notes.txt",
      manual: null,
      criteria: [
        { text: "the pattern is found", checked: false },
        { text: "the page reads well and the pattern is found on it", checked: true },
      ],
    },
    {
      id: "page-read",
      bash: null,
      manual: "the reviewer opens the page and reads every row",
      criteria: [{ text: "the page reads well and the pattern is found on it", checked: true }],
    },
    { id: null, bash: "true", manual: null, criteria: [] },
  ]);
});

test("a task with no contract answers an empty list, and an unreadable one says why", () => {
  const dir = backlogRepo();
  const none = taskWith(dir, { verification: "", criteria: "- [ ] nothing proves this\n" });
  const empty = showJson(dir, none);
  assert.deepEqual(empty.verification, []);
  assert.deepEqual(empty.verificationProblems, []);

  const broken = taskWith(dir, {
    verification: "verification:\n  - id: one\n    shell: \"true\"\n",
    criteria: "- [ ] it runs [proof: one]\n",
  });
  const unreadable = showJson(dir, broken);
  // The entry is still reported as read, so a consumer sees WHAT is wrong with
  // it; the problems are what tells it that `done` would refuse this contract.
  assert.equal(unreadable.verification.length, 1);
  assert.equal(unreadable.verification[0].id, "one");
  assert.ok(unreadable.verificationProblems.length > 0, "an unreadable contract reported no problem");
  assert.ok(unreadable.verificationProblems.some((p) => p.includes("shell")), unreadable.verificationProblems.join("\n"));
});

test("a refusal carries both keys, empty, in its complete envelope", () => {
  const dir = backlogRepo();
  const r = run(dir, ["show", "--dir", "backlog", "TASK-999", "--json"]);
  assert.equal(r.status, 1);
  const json = JSON.parse(r.stdout);
  assert.equal(json.ok, false);
  assert.deepEqual(json.verification, []);
  assert.deepEqual(json.verificationProblems, []);
});
