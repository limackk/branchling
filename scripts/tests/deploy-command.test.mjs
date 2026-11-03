/**
 * The deployment commands live under `deploy`, and `release` means one thing
 * (TL-513).
 *
 * WHAT WAS AMBIGUOUS. TL-502 and TL-506 routed `status` and `record` through
 * `release`, beside `release <ID>`, so one word named two unrelated acts:
 * returning a claimed task to the queue and shipping software. The owner
 * decided on 2026-11-02 to move the two subcommands to `deploy` with no alias,
 * since neither had shipped in a published version.
 *
 * WHAT HAS TO BE PROVED:
 *
 *   1. `deploy status` and `deploy record` answer as the old words did — the
 *      same modules, the same `--json` kinds.
 *   2. `deploy` alone, or with a word it does not know, fails and names both
 *      subcommands; `deploy --help` documents both.
 *   3. `release status` and `release record` fail as an id naming no task
 *      would (exit 2, `not-found` in `--json`), with a hint naming `deploy`, and
 *      they do so before `--reason` is demanded.
 *   4. `release <ID>` still returns a task — including one whose reason is the
 *      word `status`, which is a flag value and not a subcommand.
 *   5. `release` no longer advertises a subcommand in its help or its refusal.
 *
 * The fixture backlogs are created by `init`, so no id here refers into this
 * repository's backlog.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { COMMANDS } from "../cli.mjs";
import { DEPLOY_SUBCOMMANDS } from "../deploy-command.mjs";
import { PRODUCT_NAME as N } from "../product.mjs";
import { releaseSubject } from "../release-task.mjs";

import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("deploy-command");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
let counter = 0;

function run(dir, args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, cwd: dir, env: { ...process.env, NO_COLOR: "1" },
  });
}

function backlogRepo() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-deploy-command-" + counter++ + "-"));
  execFileSync("git", ["init", "-q", "-b", "main", "."], { cwd: dir });
  assert.equal(run(dir, ["init", "--dir", "backlog", "--no-example"]).status, 0);
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-q", "-m", "the backlog"], { cwd: dir });
  return dir;
}

function newTask(dir, title) {
  const r = run(dir, ["new", "--dir", "backlog", "--title", title]);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.match(/[A-Z]+-\d+/)[0];
}

// ── 1. The new words answer ───────────────────────────────────────────────

test("`deploy status` answers with the `release-status` kind", () => {
  const dir = backlogRepo();
  const r = run(dir, ["deploy", "status", "--dir", "backlog", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.kind, "release-status");
  assert.equal(parsed.scan.reason, "no-targets");
  const text = run(dir, ["deploy", "status", "--dir", "backlog"]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /declares no `deploy_targets`/);
});

test("`deploy record` reaches the record path and refuses under its own name", () => {
  const dir = backlogRepo();
  const args = ["deploy", "record", "--dir", "backlog", "--actor", "agent:test", "--target", "web",
    "--stage", "production", "HEAD", "--reason", "a fixture"];
  const json = run(dir, args.concat("--json"));
  assert.notEqual(json.status, 0);
  assert.equal(JSON.parse(json.stdout).kind, "release-record");
  const text = run(dir, args);
  assert.notEqual(text.status, 0);
  assert.match(text.stderr, new RegExp(N + " deploy record"));
  assert.doesNotMatch(text.stderr, /release record/);
});

// ── 2. `deploy` itself ────────────────────────────────────────────────────

test("`deploy` without a known subcommand fails and names both", () => {
  assert.deepEqual([...DEPLOY_SUBCOMMANDS], ["status", "record"]);
  for (const [args, problem] of [[[], /no subcommand/], [["ship"], /unknown subcommand: ship/], [["--frobnicate"], /unknown subcommand: --frobnicate/]]) {
    const r = run(tmpdir(), ["deploy"].concat(args));
    assert.equal(r.status, 2, JSON.stringify(args));
    assert.match(r.stderr, problem);
    assert.match(r.stderr, /available: status, record/);
  }
});

test("`deploy --help` documents both subcommands, and the table routes to the deploy module", () => {
  assert.equal(COMMANDS.deploy.script, "deploy-command.mjs");
  const r = run(tmpdir(), ["deploy", "--help"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(N + " deploy status "));
  assert.match(r.stdout, new RegExp(N + " deploy record "));
  assert.doesNotMatch(r.stdout, /release (status|record)/);
});

// ── 3. The old words fail, and say where they went ────────────────────────

test("`release status` and `release record` fail as an absent task, pointing at deploy", () => {
  const dir = backlogRepo();
  for (const word of ["status", "record"]) {
    // Without `--reason`: the pointer must come first, not a demand for a reason.
    for (const extra of [[], ["--reason", "x"]]) {
      const r = run(dir, ["release", word, "--dir", "backlog"].concat(extra));
      assert.equal(r.status, 2, word + " " + extra.join(" ") + ": " + r.stderr);
      assert.match(r.stderr, new RegExp("no task " + word));
      assert.match(r.stderr, new RegExp("`" + N + " deploy " + word + "`"));
      assert.doesNotMatch(r.stderr, /--reason` is required/);
    }
    const j = run(dir, ["release", word, "--dir", "backlog", "--json"]);
    assert.equal(j.status, 2);
    const parsed = JSON.parse(j.stdout);
    assert.equal(parsed.kind, "task-release");
    assert.equal(parsed.ok, false);
    assert.equal(parsed.refusalKind, "not-found");
    assert.match(parsed.details.join("\n"), new RegExp("deploy " + word));
  }
});

test("positive control: an id that names no task is refused with the same exit code", () => {
  // The claim above is "as an unknown task id would"; this measures that path
  // rather than assuming its exit code.
  const dir = backlogRepo();
  const id = newTask(dir, "Present");
  const absent = id.replace(/\d+$/, (n) => String(Number(n) + 900));
  const r = run(dir, ["release", absent, "--dir", "backlog", "--actor", "agent:a", "--reason", "x", "--json"]);
  assert.equal(r.status, 2, r.stderr);
  assert.equal(JSON.parse(r.stdout).refusalKind, "not-found");
});

// ── 4. `release <ID>` is untouched ────────────────────────────────────────

test("the subject of a release line skips flag values", () => {
  assert.equal(releaseSubject(["status"]), "status");
  assert.equal(releaseSubject(["--json", "record"]), "record");
  assert.equal(releaseSubject(["--reason", "status", "ABC-1"]), "ABC-1");
  assert.equal(releaseSubject(["--reason", "record"]), null);
});

test("release <ID> returns a task, even when its reason is the word `status`", () => {
  const dir = backlogRepo();
  const id = newTask(dir, "Held");
  assert.equal(run(dir, ["take", id, "--dir", "backlog", "--actor", "agent:a"]).status, 0);
  const r = run(dir, ["release", id, "--dir", "backlog", "--actor", "agent:a", "--reason", "status", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.kind, "task-release");
  assert.equal(parsed.ok, true);
  assert.equal(parsed.id, id);
});

// ── 5. `release` advertises nothing else ──────────────────────────────────

test("`release` names no subcommand in its help or its refusal", () => {
  const help = run(tmpdir(), ["release", "--help"]);
  assert.equal(help.status, 0, help.stderr);
  // The usage lines are the table's own, read before they are rendered.
  const usageLines = COMMANDS.release.usage.split("\n").filter((l) => l.startsWith(N + " release "));
  assert.deepEqual(usageLines.map((l) => l.split(/\s+/)[2]), ["<ID>"]);
  assert.match(help.stdout, new RegExp(N + " release <ID>"));
  const refused = run(tmpdir(), ["release", "--frobnicate"]);
  assert.equal(refused.status, 2);
  const available = refused.stderr.match(/available:([^\n]*)/);
  assert.ok(available, "positive control: the refusal names its accepted set");
  assert.doesNotMatch(available[1], /(?<![-\w])(status|record)\b/);
});

// ── 6. An undeclared name is a refusal envelope (TL-533) ───────────────────

test("an undeclared release, target and env each answer the unknown-name envelope with exit 1", () => {
  const dir = backlogRepo();
  for (const [flag, value] of [["--release", "nope"], ["--target", "web"], ["--env", "prod"]]) {
    const r = run(dir, ["deploy", "status", "--dir", "backlog", flag, value, "--json"]);
    assert.equal(r.status, 1, flag + ": " + r.stderr);
    const answer = JSON.parse(r.stdout);
    assert.equal(answer.kind, "release-status");
    assert.equal(answer.ok, false);
    assert.equal(answer.refusalKind, "unknown-name");
    assert.deepEqual(answer.rejected, { flag, value });
    // The fixture declares neither releases nor targets: nothing to offer.
    assert.deepEqual(answer.declared, []);
    assert.match(answer.refusal, new RegExp("`" + value + "`"));
  }
});

test("the declared set is named when there is one, and an answer carries ok: true", () => {
  const dir = backlogRepo();
  for (const [key, name] of [["releases", "r1"], ["releases", "r2"]]) {
    const r = run(dir, ["declare", key, name, "--dir", "backlog", "--reason", "a fixture"]);
    assert.equal(r.status, 0, r.stderr);
  }
  const refused = JSON.parse(run(dir, ["deploy", "status", "--dir", "backlog", "--release", "r9", "--json"]).stdout);
  assert.deepEqual(refused.declared, ["r1", "r2"]);
  const answered = run(dir, ["deploy", "status", "--dir", "backlog", "--release", "r1", "--json"]);
  assert.equal(answered.status, 0, answered.stderr);
  assert.equal(JSON.parse(answered.stdout).ok, true);
});

test("a misspelt flag and a missing value are still usage errors (exit 2)", () => {
  const dir = backlogRepo();
  for (const args of [["--relase", "r1"], ["--release"]]) {
    const r = run(dir, ["deploy", "status", "--dir", "backlog", ...args, "--json"]);
    assert.equal(r.status, 2, args.join(" "));
    assert.equal(r.stdout, "");
  }
});
