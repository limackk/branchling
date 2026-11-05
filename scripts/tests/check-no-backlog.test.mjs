/**
 * `check --json` over a directory that is not a backlog answers an envelope
 * (TL-541), the way `doctor --json` does — never an empty stdout or a stack.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SCRIPTS_DIR, isolateHome, plainOutput } from "./_repo.mjs";

isolateHome("check-no-backlog");
plainOutput();

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function run(cwd, args) {
  const env = { ...process.env, NO_COLOR: "1" };
  delete env.BACKLOG_DIR;
  return spawnSync(process.execPath, [CLI].concat(args), { cwd, encoding: "utf8", timeout: 60_000, env });
}

function assertNoBacklogEnvelope(r) {
  assert.equal(r.status, 1, r.stderr);
  const answer = JSON.parse(r.stdout);
  assert.equal(answer.kind, "check");
  assert.equal(answer.ok, false);
  assert.equal(answer.root, null);
  assert.deepEqual(answer.failed, ["backlog"]);
  assert.deepEqual(answer.guards.map((g) => [g.name, g.ok, g.exit]), [["backlog", false, 1]]);
  return answer;
}

test("check --json in an empty directory prints a check envelope with root null and failed backlog", () => {
  const empty = mkdtempSync(join(tmpdir(), "branchling-check-none-"));
  const answer = assertNoBacklogEnvelope(run(empty, ["check", "--json"]));
  assert.match(answer.guards[0].output, /no backlog here/);
});

test("a --dir that is not a backlog answers the same envelope, not a stack trace", () => {
  const empty = mkdtempSync(join(tmpdir(), "branchling-check-notone-"));
  const r = run(tmpdir(), ["check", "--json", "--dir", empty]);
  const answer = assertNoBacklogEnvelope(r);
  assert.match(answer.guards[0].output, /does not look like a backlog/);
  assert.doesNotMatch(r.stderr, /at resolveBacklogDir/);
});

test("the human form still prints the 'no backlog here' message, and stdout stays empty", () => {
  const empty = mkdtempSync(join(tmpdir(), "branchling-check-human-"));
  const r = run(empty, ["check"]);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /no backlog here/);
});

test("POSITIVE CONTROL: over a real backlog the envelope names its root", () => {
  const repo = mkdtempSync(join(tmpdir(), "branchling-check-real-"));
  assert.equal(run(repo, ["init", "--dir", "backlog", "--no-example"]).status, 0);
  const r = run(repo, ["check", "--json", "--refs", "--dir", "backlog"]);
  const answer = JSON.parse(r.stdout);
  assert.equal(realpathSync(answer.root), realpathSync(join(repo, "backlog")));
  assert.ok(!answer.failed.includes("backlog"));
});
