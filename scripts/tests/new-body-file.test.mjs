/**
 * `new --body-file` names what the file must hold (TL-690).
 *
 * WHAT WAS BROKEN. An agent passed a markdown body to `new --body-file` and was
 * told `not valid JSON: Unexpected token '#'`. The flag's name reads as "a file
 * holding the body", and `body --body-file` really does take markdown, so the
 * mistake is the expected one; the parser's message named the character it met
 * and not the document it wanted.
 *
 * WHAT IS PROVED HERE: the help line says JSON task document; a non-JSON file is
 * refused with a message that names the flag, the JSON shape and its keys, with
 * nothing written. The POSITIVE CONTROL is the same file's JSON counterpart,
 * which creates a task: without it, a refusal of every file would pass the
 * refusal cases. Stdin keeps its own wording, because it names no file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fixtureDir } from "./_fixture-dir.mjs";
import { isolateHome } from "./_repo.mjs";

isolateHome("new-body-file");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");
const ACTOR = "local:who-ran-new";

function run(args, opts = {}) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1" }, ...opts,
  });
}

function freshBacklog() {
  const dir = fixtureDir(join(tmpdir(), "branchling-body-file-"));
  const r = run(["init", "--dir", dir, "--no-example"]);
  assert.equal(r.status, 0, r.stderr);
  return dir;
}

const tasksIn = (dir) => readdirSync(join(dir, "tasks")).filter((f) => f.endsWith(".md"));

const MARKDOWN = "## Goal\n\nA markdown body, which is not the document.\n";
const DOCUMENT = { goal: "A goal", verification: [{ id: "ok", bash: "true", proves: "it holds" }] };

test("the help line says the file is the JSON task document, not a markdown body", () => {
  const r = run(["new", "--help"]);
  assert.equal(r.status, 0, r.stderr);
  const line = r.stdout.split("\n").findIndex((l) => l.trimStart().startsWith("--body-file <p>"));
  assert.ok(line >= 0, "no --body-file line in the help");
  const entry = r.stdout.split("\n").slice(line, line + 3).join(" ");
  assert.match(entry, /JSON task document/);
  assert.match(entry, /not a markdown/);
});

test("a markdown --body-file is refused naming the flag and the JSON shape, with nothing written", () => {
  const dir = freshBacklog();
  const path = join(dir, "body.md");
  writeFileSync(path, MARKDOWN);
  const r = run(["new", "--dir", dir, "--title", "Markdown file", "--body-file", path, "--actor", ACTOR]);
  assert.equal(r.status, 2, r.stderr);
  // The command names itself before the message, as every refusal does.
  assert.ok(r.stderr.includes(" new: `--body-file " + path + "` is not the JSON task document"), r.stderr);
  // The parser's own finding stays beside the explanation: it says WHERE.
  assert.match(r.stderr, /the task is not valid JSON: /);
  for (const key of ["goal", "context", "steps", "verification"]) {
    assert.ok(r.stderr.includes('"' + key + '"'), "the shape does not name `" + key + "`:\n" + r.stderr);
  }
  assert.match(r.stderr, /not a markdown body/);
  assert.match(r.stderr, /a markdown body for an EXISTING task is `\S+ body <ID> --body-file <f>`/);
  assert.deepEqual(tasksIn(dir), []);
});

test("--json carries the same refusal as data", () => {
  const dir = freshBacklog();
  const path = join(dir, "body.md");
  writeFileSync(path, MARKDOWN);
  const r = run(["new", "--dir", dir, "--title", "Markdown file", "--body-file", path, "--actor", ACTOR, "--json"]);
  assert.equal(r.status, 2, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.refusalKind, "invalid-document");
  assert.match(out.refusal, /is not the JSON task document/);
  assert.ok(out.details.some((d) => d.includes('"verification"')), JSON.stringify(out.details));
  assert.deepEqual(tasksIn(dir), []);
});

test("positive control: the JSON document in the same file creates the task", () => {
  const dir = freshBacklog();
  const path = join(dir, "task.json");
  writeFileSync(path, JSON.stringify(DOCUMENT));
  const r = run(["new", "--dir", dir, "--title", "JSON file", "--body-file", path, "--actor", ACTOR]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(tasksIn(dir).length, 1);
});

test("a valid JSON file with a wrong key keeps the general refusal: it IS the document", () => {
  const dir = freshBacklog();
  const path = join(dir, "task.json");
  writeFileSync(path, JSON.stringify({ ...DOCUMENT, goals: "typo" }));
  const r = run(["new", "--dir", dir, "--title", "Typo file", "--body-file", path, "--actor", ACTOR]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /the task document was refused/);
  assert.match(r.stderr, /the shape: \{ "goal"/);
  assert.doesNotMatch(r.stderr, /is not the JSON task document/);
  assert.deepEqual(tasksIn(dir), []);
});

test("non-JSON on stdin keeps the stdin wording, which names no file", () => {
  const dir = freshBacklog();
  const r = run(["new", "--dir", dir, "--title", "Stdin prose", "--actor", ACTOR], { input: MARKDOWN });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /the task document was refused/);
  assert.doesNotMatch(r.stderr, /--body-file .* is not the JSON task document/);
  assert.deepEqual(tasksIn(dir), []);
});
