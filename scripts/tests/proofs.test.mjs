/**
 * `check --proofs` — a closed task's proof, re-run against the tree as it is
 * now (TL-147).
 *
 * WHY THE FIXTURE IS TINY AND ITS CONTRACTS ARE `true` / `false`. The guard runs
 * whatever a task's `verification:` says, which in a real backlog is a test
 * suite; a fixture that ran one would be measuring node's test runner, not this.
 * What has to be proved is the SELECTION and the REPORT, and for that a command
 * that exits 0 and one that exits 1 are the whole of the input.
 *
 * THE PAIR THAT GIVES IT FORCE. The same fixture, with the contract intact and
 * with it broken: green then red. Without both, a guard that reported nothing
 * and a guard that reported everything would each pass one half of this file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { REASON_PROVEN, REASON_UNKNOWN } from "../history.mjs";
import { provenClosing, touchedByRange } from "../check-backlog-proofs.mjs";

import { isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("proofs");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

let counter = 0;

/**
 * A backlog holding one closed task whose contract is `command`, closed with
 * `reason`. Written directly rather than through `done`, because what is under
 * test is what the guard makes of a history that already exists.
 */
function backlog({ command = "true", reason = REASON_PROVEN, manual = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "branchling-proofs-" + counter++ + "-"));
  const init = spawnSync(process.execPath, [CLI, "init", "--dir", dir, "--no-example"], { encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);

  const entry = manual ? '  - id: seen\n    manual: "' + manual + '"' : '  - id: runs\n    bash: "' + command + '"';
  writeFileSync(join(dir, "tasks", "TASK-1-a-closed-task.md"), [
    "---", "id: TASK-1", 'title: "A closed task"', "type: task", "labels: []", "board: main",
    'epic: ""', "priority: P1", "status: done", "owner: local:test", "estimate: 2h",
    "created: 2026-08-01", "updated: 2026-08-01", "blocked_by: []", "blocks: []",
    "verification:", entry, "---", "", "## Goal", "", "Something proved once.", "",
  ].join("\n"), "utf8");

  mkdirSync(join(dir, "history"), { recursive: true });
  const row = (field, from, to, source, why) => JSON.stringify({
    id: "E" + Math.random().toString(36).slice(2), ts: "2026-08-02T10:00:00.000Z",
    task: "TASK-1", field, from, to, actor: "local:closer", source, reason: why,
  });
  writeFileSync(join(dir, "history", "TASK-1.jsonl"),
    row("status", "pending", "in_progress", "take", REASON_UNKNOWN) + "\n" +
    row("status", "in_progress", "done", "done", reason) + "\n", "utf8");
  return dir;
}

function check(dir, args = []) {
  const r = spawnSync(process.execPath, [CLI, "check", "--proofs", "--dir", dir, ...args],
    { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

function withBacklog(opts, fn) {
  const dir = backlog(opts);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── The claim, and the control ────────────────────────────────────────────

test("a proven task whose contract now fails is reported, with its id and closer", () => {
  withBacklog({ command: "exit 3" }, (dir) => {
    const r = check(dir);
    assert.equal(r.code, 1, "a broken proof passed: " + r.out);
    assert.match(r.out, /TASK-1 by local:closer/);
    assert.match(r.out, /2026-08-02/, "the closing was not named");
    assert.match(r.out, /exits 3/);
    // A finding for a person: nothing is reopened and nothing is written.
    assert.match(r.out, /no task was reopened/);
  });
});

test("POSITIVE CONTROL: the same fixture with the contract intact reports nothing", () => {
  withBacklog({ command: "true" }, (dir) => {
    const r = check(dir);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 verification command\(s\) re-run across 1 proven closing\(s\)/,
      "the guard ran nothing and said so as if it had: " + r.out);
  });
});

test("a task closed with `unknown` is not a broken proof — it was never proved", () => {
  // TL-90's finding, not this one's. Two guards claiming the same task would say
  // one problem twice, and this one would be claiming a proof that never existed.
  withBacklog({ command: "exit 3", reason: REASON_UNKNOWN }, (dir) => {
    const r = check(dir);
    assert.equal(r.code, 0, "a hand-closed task was reported as a broken proof: " + r.out);
    assert.match(r.out, /across 0 proven closing\(s\)/);
  });
});

test("a `manual:` entry is vouched, not broken and not silently green", () => {
  withBacklog({ manual: "a person opened the page and saw the chart" }, (dir) => {
    const r = check(dir);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /vouched for by a person and cannot be re-run/);
    assert.match(r.out, /TASK-1: seen/);
  });
});

// ── It is never part of a bare run ────────────────────────────────────────

test("a bare `check` does NOT re-run proofs", () => {
  // The reason is in `parseCheckArgs`: contracts are test suites, and one of
  // this backlog's own contracts is `check` itself.
  withBacklog({ command: "exit 3" }, (dir) => {
    const r = spawnSync(process.execPath, [CLI, "check", "--dir", dir],
      { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
    const out = (r.stdout || "") + (r.stderr || "");
    assert.doesNotMatch(out, /proofs:/, "a bare check re-ran the proofs: " + out);
    // POSITIVE CONTROL for this very assertion: asked by name, it runs — and on
    // this fixture it finds the broken proof the bare run said nothing about.
    assert.match(check(dir).out, /proofs: 1 closed task\(s\) whose proof no longer holds/);
  });
});

test("`--since` alone is a usage error, and an unreadable range runs nothing", () => {
  withBacklog({}, (dir) => {
    const alone = spawnSync(process.execPath, [CLI, "check", "--dir", dir, "--since", "HEAD"],
      { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
    assert.equal(alone.status, 2);
    assert.match(alone.stderr, /`--since` with no `--proofs`/);

    const bad = check(dir, ["--since", "nosuchcommit"]);
    assert.equal(bad.code, 2, bad.out);
    assert.match(bad.out, /nothing was run/);
  });
});

// ── `--json`, and the exit code it does not replace ───────────────────────

test("`check --proofs --json` answers in the envelope and still exits non-zero", () => {
  withBacklog({ command: "exit 3" }, (dir) => {
    const r = spawnSync(process.execPath, [CLI, "check", "--proofs", "--json", "--dir", dir],
      { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
    assert.equal(r.status, 1, "the envelope replaced the exit code");
    const doc = JSON.parse(r.stdout);
    assert.equal(doc.kind, "check");
    assert.deepEqual(doc.guards.map((g) => g.name), ["proofs"]);
    assert.deepEqual(doc.failed, ["proofs"]);
    assert.match(doc.guards[0].output, /TASK-1 by local:closer/);
  });
});

// ── The pure parts ────────────────────────────────────────────────────────

test("provenClosing takes the LAST closing, and only a proven one", () => {
  const archived = ["done"];
  const close = (reason) => ({ field: "status", from: "in_progress", to: "done", reason, actor: "local:a", ts: "T" });
  const reopen = { field: "status", from: "done", to: "pending", reason: "changed my mind", actor: "local:a" };

  assert.equal(provenClosing([close(REASON_PROVEN)], archived).actor, "local:a");
  assert.equal(provenClosing([close(REASON_UNKNOWN)], archived), null);
  // Closed, reopened, closed again by hand: the old proof described a tree two
  // changes ago and must not stand in for the new closing.
  assert.equal(provenClosing([close(REASON_PROVEN), reopen, close(REASON_UNKNOWN)], archived), null);
  assert.equal(provenClosing([close(REASON_UNKNOWN), reopen, close(REASON_PROVEN)], archived).actor, "local:a");
  assert.equal(provenClosing([], archived), null);
});

test("touchedByRange keeps a task by its own files OR by a path its contract names", () => {
  const changed = new Set(["scripts/query.mjs", "README.md"]);
  const entries = [{ bash: "node --test scripts/tests/query.test.mjs" }];
  assert.equal(touchedByRange({}, entries, changed, ["scripts/query.mjs"]), true, "its own file");
  assert.equal(touchedByRange({}, [{ bash: "node scripts/cli.mjs check README.md" }], changed, []), true,
    "a path named in the contract");
  assert.equal(touchedByRange({}, entries, changed, ["docs/elsewhere.md"]), false);
  assert.equal(touchedByRange({}, [], new Set(), []), false);
});
