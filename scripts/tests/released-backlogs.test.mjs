/**
 * The current code reads every backlog a published release wrote (TL-587).
 *
 * Every other fixture in the suite is made by the current code, so a change
 * that stopped reading a backlog an earlier release had written would pass
 * all of them. On 2026-11-06 the upgrade from v0.1.0 was checked by hand —
 * `init` with the old release, then the current commands on the result — and
 * this file is that run, against trees captured from each published release
 * by `fixtures/released/capture.mjs` and committed, so it holds where a
 * shallow checkout has no tags.
 *
 * The key lists beside the trees answer the second half of an upgrade: a key
 * a release knew must still be known, or every backlog that set it stops
 * loading; and `KEY_SINCE`, which `declare` uses to write `requires_version`
 * (TL-586), must agree with what each release actually knew.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULTS, KEY_SINCE } from "../config.mjs";
import { compareVersions } from "../config-version.mjs";
import { REPO_ROOT, SCRIPTS_DIR, isolateHome, isolateState, plainOutput } from "./_repo.mjs";
import { RELEASED_DIR, releasedKeys, releasedVersions, restoreReleasedBacklog } from "./_released.mjs";

// Every directory this file creates is removed when the file ends (TL-599),
// whether its tests passed or not: one run made seven repositories, a home
// and a state directory, and kept all nine. `released-backlogs-cleanup.test.mjs`
// runs this file against a private temporary directory and holds it to
// leaving that directory empty.
const TEMP = [];
test.after(() => { for (const d of TEMP) rmSync(d, { recursive: true, force: true }); });

/** A fresh temporary directory, removed in the `after` hook above. */
function tempDir(label) {
  const dir = fixtureDir(join(tmpdir(), "branchling-released-" + label + "-"));
  TEMP.push(dir);
  return dir;
}

TEMP.push(isolateHome("released-backlogs"));
TEMP.push(isolateState("released-backlogs"));
plainOutput();

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const VERSIONS = releasedVersions();

function cli(cwd, args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", timeout: 60_000, env: process.env });
}

/** A git repository holding `version`'s backlog; returns its root. */
function upgradedRepo(version) {
  const root = tempDir(version);
  const r = spawnSync("git", ["init", "-q"], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  restoreReleasedBacklog(version, root);
  return root;
}

const COMMANDS = [["build"], ["check"], ["doctor"], ["query"], ["stats"], ["new", "--title", "A task written after the upgrade"]];

test("every published release has a captured backlog, and only published ones do", () => {
  const notes = readdirSync(join(REPO_ROOT, "docs", "releases"))
    .map((f) => f.match(/^v(\d+\.\d+\.\d+)\.md$/)?.[1]).filter(Boolean).sort(compareVersions);
  // Positive control: four releases were published before this test existed,
  // so fewer is a broken capture or a broken pattern, not a pass.
  assert.ok(VERSIONS.length >= 4, "released fixtures found: " + VERSIONS.join(", "));
  assert.deepEqual(VERSIONS, notes,
    "each docs/releases/v<version>.md needs scripts/tests/fixtures/released/<version>/ — " +
    "node scripts/tests/fixtures/released/capture.mjs <version>");
});

for (const version of VERSIONS) {
  test("the current code builds, checks and adds a task in a backlog " + version + " wrote", () => {
    const root = upgradedRepo(version);
    for (const args of COMMANDS) {
      const r = cli(root, args);
      assert.equal(r.status, 0, version + ": branchling " + args.join(" ") + " exited " + r.status + "\n" + r.stdout + r.stderr);
    }
    const count = cli(root, ["query", "--count"]);
    assert.equal(count.status, 0, count.stderr);
    assert.match(count.stdout, /^2\b/m, version + ": the released task and the new one, read back: " + count.stdout);
  });
}

test("positive control: the run fails on a backlog the current code cannot read", () => {
  const root = upgradedRepo(VERSIONS[0]);
  appendFileSync(join(root, "backlog", "config.yaml"), "\nkey_from_a_release_not_yet_made: 1\n");
  for (const args of [["build"], ["check"], ["new", "--title", "Refused"]]) {
    assert.notEqual(cli(root, args).status, 0, "branchling " + args.join(" ") + " read a config.yaml it does not understand");
  }
});

// The fixture stores `.gitignore` as `dot-gitignore`. Copied without restoring
// the names, the same tree fails doctor — so the green doctor above read the
// release's own ignore rules, not an absence nobody looked at.
test("positive control: doctor fails the released tree when its dotfiles are not restored", () => {
  const root = tempDir("raw");
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
  cpSync(join(RELEASED_DIR, VERSIONS[0], "backlog"), join(root, "backlog"), { recursive: true });
  assert.notEqual(cli(root, ["doctor"]).status, 0, "doctor passed a backlog with no .gitignore");
  assert.ok(existsSync(join(upgradedRepo(VERSIONS[0]), "backlog", "tasks", ".gitkeep")), "tasks/.gitkeep was not restored");
});

test("every config key a published release knew is still known", () => {
  const known = new Set(Object.keys(DEFAULTS));
  for (const version of VERSIONS) {
    const lost = releasedKeys(version).filter((k) => !known.has(k));
    assert.deepEqual(lost, [], version + " knew keys the current code refuses as unknown");
  }
});

test("KEY_SINCE names, for each release, exactly the keys that release knew", () => {
  for (const version of VERSIONS) {
    const claimed = Object.keys(KEY_SINCE).filter((k) => compareVersions(KEY_SINCE[k], version) <= 0).sort();
    assert.deepEqual(claimed, [...releasedKeys(version)].sort(), "KEY_SINCE disagrees with what " + version + " knew");
  }
});
