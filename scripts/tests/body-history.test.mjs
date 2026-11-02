/**
 * `body` — a task's prose rewritten through the tool and recorded like a field
 * edit (TL-523).
 *
 * WHAT IS AT RISK, and why each assertion reads the DISK rather than the exit
 * code:
 *
 *   1. A BODY WRITE THAT MOVES THE FRONTMATTER. The command's promise is that
 *      the frontmatter is byte-identical afterwards, so it is compared as bytes,
 *      `updated:` included.
 *   2. A RECORD THAT IS MISSING, DOUBLED OR UNEXPLAINED. Exactly one `__body__`
 *      entry, carrying the actor and the reason, and the hashes of the two
 *      bodies — never their text.
 *   3. A REFUSAL THAT ALREADY WROTE. Every refusal — a stale base, a body that
 *      drops the acceptance criteria, a pasted frontmatter block — is checked
 *      against the file and the history afterwards, each beside a positive
 *      control that the same input shape is accepted when it is valid.
 *   4. A LOG THAT CANNOT SHOW IT. `log` has to name the change without printing
 *      the body it replaced.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bodyHash, lineDelta } from "../body-task.mjs";
import { FIELD_BODY, splitFrontmatter } from "../task-fields.mjs";
import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("body-history");

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function run(cwd, args, input) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    cwd, encoding: "utf8", timeout: 60_000, input: input === undefined ? "" : input,
    env: { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(cwd, ".state") },
  });
}

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-body-"));
  assert.equal(spawnSync("git", ["init", "-q", "."], { cwd: dir }).status, 0);
  assert.equal(run(dir, ["init", "--dir", ".", "--no-example"]).status, 0);
  const r = run(dir, ["new", "--dir", ".", "--title", "A task whose body is rewritten"]);
  assert.equal(r.status, 0, r.stderr);
  const id = r.stdout.match(/[A-Z]+-\d+/)[0];
  return { dir, id };
}

function taskFile(dir, id) {
  const name = readdirSync(join(dir, "tasks")).find((f) => f.startsWith(id + "-"));
  return join(dir, "tasks", name);
}

function bodyEntries(dir, id) {
  const path = join(dir, "history", id + ".jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").trim().split("\n").filter(Boolean)
    .map((l) => JSON.parse(l)).filter((e) => e.field === FIELD_BODY);
}

const GOAL = "Why this task exists, and what has to be true once it is done.";
const NEW_GOAL = "The rewritten goal: a sentence that only the new body carries.";

function rewritten(raw) {
  return splitFrontmatter(raw).body.replace(GOAL, NEW_GOAL);
}

test("a body written through the tool keeps the frontmatter byte-identical, records one __body__ entry, and log shows it", () => {
  const { dir, id } = repo();
  const file = taskFile(dir, id);
  const before = readFileSync(file, "utf8");
  const head = before.slice(0, before.length - splitFrontmatter(before).body.length);
  const oldBody = splitFrontmatter(before).body;
  assert.ok(oldBody.includes(GOAL), "the fixture's template no longer carries the sentence this test edits");

  const input = join(dir, "new-body.md");
  writeFileSync(input, rewritten(before), "utf8");
  const r = run(dir, ["body", id, "--dir", ".", "--body-file", input, "--reason", "the goal was vague", "--actor", "agent:writer"]);
  assert.equal(r.status, 0, r.stderr);

  const after = readFileSync(file, "utf8");
  assert.ok(after.startsWith(head), "the frontmatter moved");
  assert.equal(after.slice(0, head.length), head);
  assert.equal(after.slice(head.length), rewritten(before));

  const entries = bodyEntries(dir, id);
  assert.equal(entries.length, 1, "exactly one __body__ record");
  const e = entries[0];
  assert.equal(e.actor, "agent:writer");
  assert.equal(e.reason, "the goal was vague");
  assert.equal(e.source, "body");
  assert.equal(e.from, "sha256:" + createHash("sha256").update(oldBody, "utf8").digest("hex"));
  assert.equal(e.to, bodyHash(rewritten(before)));
  assert.deepEqual(e.lines, { added: 1, removed: 1 });
  assert.ok(!JSON.stringify(e).includes(NEW_GOAL), "the record carries the body text");

  const log = run(dir, ["log", id, "--dir", "."]);
  assert.equal(log.status, 0, log.stderr);
  assert.match(log.stdout, /body \+1 -1 line\(s\)/);
  assert.match(log.stdout, /the goal was vague/);
  assert.match(log.stdout, /agent:writer/);
  assert.ok(!log.stdout.includes(NEW_GOAL) && !log.stdout.includes(GOAL), "log printed a body");

  const json = JSON.parse(run(dir, ["log", id, "--dir", ".", "--json"]).stdout);
  const shown = JSON.stringify(json);
  assert.ok(shown.includes("body +1 -1 line(s)"), "log --json does not carry the body change");
});

test("the body arrives on stdin, and --json hands back the hash a next write uses as --base", () => {
  const { dir, id } = repo();
  const file = taskFile(dir, id);
  const before = readFileSync(file, "utf8");
  const r = run(dir, ["body", id, "--dir", ".", "--reason", "rewritten from a pipe", "--actor", "agent:writer", "--json"], rewritten(before));
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.kind, "task-body");
  assert.equal(out.changed, true);
  assert.equal(out.body.to, bodyHash(rewritten(before)));

  // The hash just returned is accepted as the base of the next edit.
  const next = rewritten(before).replace(NEW_GOAL, NEW_GOAL + " Twice.");
  const again = run(dir, ["body", id, "--dir", ".", "--reason", "second pass", "--base", out.body.to, "--actor", "agent:writer"], next);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(bodyEntries(dir, id).length, 2);
});

test("a stale --base is refused and nothing is written", () => {
  const { dir, id } = repo();
  const file = taskFile(dir, id);
  const before = readFileSync(file, "utf8");
  const stale = bodyHash("a body nobody has on disk");
  const r = run(dir, ["body", id, "--dir", ".", "--reason", "an edit against an old read", "--base", stale, "--actor", "agent:writer"], rewritten(before));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /changed since/);
  assert.equal(readFileSync(file, "utf8"), before);
  assert.equal(bodyEntries(dir, id).length, 0);

  // POSITIVE CONTROL: the current hash passes the same gate.
  const ok = run(dir, ["body", id, "--dir", ".", "--reason", "an edit against the head", "--base", bodyHash(splitFrontmatter(before).body), "--actor", "agent:writer"], rewritten(before));
  assert.equal(ok.status, 0, ok.stderr);
});

test("a body that drops the acceptance criteria, or carries a frontmatter block, is refused before anything is written", () => {
  const { dir, id } = repo();
  const file = taskFile(dir, id);
  const before = readFileSync(file, "utf8");
  const body = splitFrontmatter(before).body;

  const dropped = body.slice(0, body.indexOf("## Acceptance criteria"));
  const r1 = run(dir, ["body", id, "--dir", ".", "--reason", "trimmed", "--actor", "agent:writer"], dropped);
  assert.equal(r1.status, 1, r1.stdout + r1.stderr);
  assert.match(r1.stderr, /Acceptance criteria/);

  const fenced = "---\nstatus: done\n---\n" + body;
  const r2 = run(dir, ["body", id, "--dir", ".", "--reason", "pasted", "--actor", "agent:writer"], fenced);
  assert.equal(r2.status, 1, r2.stdout + r2.stderr);
  assert.match(r2.stderr, /frontmatter/);

  const r3 = run(dir, ["body", id, "--dir", ".", "--reason", "emptied", "--actor", "agent:writer"], "\n\n");
  assert.equal(r3.status, 1, r3.stdout + r3.stderr);

  const r4 = run(dir, ["body", id, "--dir", ".", "--actor", "agent:writer"], rewritten(before));
  assert.equal(r4.status, 2, "a body with no reason is a usage error");

  assert.equal(readFileSync(file, "utf8"), before);
  assert.equal(bodyEntries(dir, id).length, 0);
});

test("an unchanged body writes nothing and records nothing", () => {
  const { dir, id } = repo();
  const file = taskFile(dir, id);
  const before = readFileSync(file, "utf8");
  const r = run(dir, ["body", id, "--dir", ".", "--reason", "no edit", "--actor", "agent:writer"], splitFrontmatter(before).body);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /unchanged/);
  assert.equal(readFileSync(file, "utf8"), before);
  assert.equal(bodyEntries(dir, id).length, 0);
});

test("lineDelta counts a changed line as one added and one removed, and a moved line as both", () => {
  assert.deepEqual(lineDelta("a\nb\nc", "a\nB\nc"), { added: 1, removed: 1 });
  assert.deepEqual(lineDelta("a\nb", "a\nb\nc"), { added: 1, removed: 0 });
  assert.deepEqual(lineDelta("a\nb\nc", "c\na\nb"), { added: 1, removed: 1 });
});
