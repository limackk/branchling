/**
 * Decisions from earlier reviews can be found again by the area they concern
 * (TL-444). The task-to-file relation is computed from commits, while the
 * decision itself remains the existing append-only event.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isolateHome } from "./_repo.mjs";

isolateHome("review-findings");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

function run(cwd, args, input) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd, input, encoding: "utf8", timeout: 60_000,
    env: { ...process.env, NO_COLOR: "1" },
  });
}

function commit(repo, message, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(repo, dirname(path)), { recursive: true });
    writeFileSync(join(repo, path), content, "utf8");
  }
  execFileSync("git", ["add", "-A"], { cwd: repo });
  execFileSync("git", ["commit", "-q", "-m", message], { cwd: repo });
}

function makeDecidedTask(repo, backlog, title, reason, actor) {
  const made = run(repo, ["new", "--dir", backlog, "--title", title, "--status", "done"]);
  assert.equal(made.status, 0, made.stderr);
  const id = made.stdout.match(/[A-Z]+-\d+/)[0];
  const decided = run(repo, ["decide", id, "--dir", backlog, "--reason", reason, "--actor", actor]);
  assert.equal(decided.status, 0, decided.stderr);
  return id;
}

function fixture() {
  const repo = mkdtempSync(join(tmpdir(), "branchling-review-findings-"));
  execFileSync("git", ["init", "-q", "-b", "main", "."], { cwd: repo });
  execFileSync("git", ["config", "user.email", "review@example.test"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Reviewer"], { cwd: repo });
  const backlog = join(repo, "backlog");
  assert.equal(run(repo, ["init", "--dir", backlog, "--no-example"]).status, 0);

  const relevantReason = "Rejected: the parser already preserves this boundary.";
  const relevant = makeDecidedTask(repo, backlog, "Review the parser boundary", relevantReason, "user:reviewer");
  commit(repo, relevant + " parser boundary is reviewed", { "scripts/parser.mjs": "export const parser = true;\n" });

  const unrelatedReason = "Rejected: the viewer already renders this state.";
  const unrelated = makeDecidedTask(repo, backlog, "Review the viewer state", unrelatedReason, "user:other-reviewer");
  commit(repo, unrelated + " viewer state is reviewed", { "web/viewer.js": "export const viewer = true;\n" });

  return { repo, backlog, relevant, relevantReason, unrelated, unrelatedReason };
}

test("a rejected finding is readable by the path its task touched", () => {
  const fx = fixture();
  const r = run(fx.repo, ["log", "--dir", fx.backlog, "--modified-file", "scripts/parser.mjs", "--decisions", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const answer = JSON.parse(r.stdout);
  assert.equal(answer.kind, "task-log");
  assert.deepEqual(answer.tasks.map((task) => task.id), [fx.relevant]);
  assert.equal(answer.modifiedFile.path, "scripts/parser.mjs");
  assert.equal(answer.modifiedFile.scanned, true);
  assert.equal(answer.exchanges.length, 1);
  assert.equal(answer.exchanges[0].task.id, fx.relevant);
  assert.equal(answer.exchanges[0].actor, "user:reviewer");
  assert.equal(answer.exchanges[0].reason, fx.relevantReason);

  const text = run(fx.repo, ["log", "--dir", fx.backlog, "--modified-file", "scripts/parser.mjs", "--decisions"]);
  assert.equal(text.status, 0, text.stderr);
  assert.ok(text.stdout.includes(fx.relevant));
  assert.ok(text.stdout.includes("user:reviewer"));
  assert.ok(text.stdout.includes(fx.relevantReason));
});

test("POSITIVE CONTROL: a decision from a task outside the area is excluded", () => {
  const fx = fixture();
  const answer = JSON.parse(run(fx.repo, [
    "log", "--dir", fx.backlog, "--modified-file", "scripts/", "--decisions", "--json",
  ]).stdout);
  assert.deepEqual(answer.tasks.map((task) => task.id), [fx.relevant]);
  assert.ok(!JSON.stringify(answer).includes(fx.unrelated), "the unrelated task reached the area result");
  assert.ok(!JSON.stringify(answer).includes(fx.unrelatedReason), "the unrelated decision reached the area result");
});

test("the area form is explicit about decisions and about what it does not do", () => {
  const fx = fixture();
  const missingMode = run(fx.repo, ["log", "--dir", fx.backlog, "--modified-file", "scripts/parser.mjs"]);
  assert.equal(missingMode.status, 2);
  assert.match(missingMode.stderr, /requires `--decisions`/);

  const help = run(fx.repo, ["log", "--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /does not run reviews, call a model, or judge/);
});
