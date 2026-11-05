/**
 * A guard captured without colour is not also told to colour (TL-538).
 *
 * `check --json` captures each guard with NO_COLOR=1. A FORCE_COLOR inherited
 * from the caller made that a contradiction, and Node answers it on stderr with
 * "The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set".
 * The capture joins stderr to stdout, so a guard that answers `--json` with a
 * document of its own (`release`) stopped parsing and its `report` became
 * null. CI sets FORCE_COLOR=1 for the whole suite, which is where it surfaced.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { HOME_ENV } from "../home.mjs";
import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("guard-capture-colour");
const CLI = join(SCRIPTS_DIR, "cli.mjs");
const WARNING = /'NO_COLOR' env is ignored/;

function forcedEnv(root) {
  const env = { ...process.env, FORCE_COLOR: "1", [HOME_ENV]: join(root, "home"), BACKLOG_STATE_DIR: join(root, "state") };
  delete env.NO_COLOR;
  return env;
}

// Positive control: on this Node the contradiction must produce the warning,
// or the assertions below would pass without measuring anything.
test("this Node warns when NO_COLOR and FORCE_COLOR are both set", (t) => {
  const r = spawnSync(process.execPath, ["-e", "console.log(1)"], {
    encoding: "utf8", env: { ...process.env, FORCE_COLOR: "1", NO_COLOR: "1" },
  });
  if (!WARNING.test(r.stderr)) t.skip("this Node version does not warn, so the regression cannot occur here");
  else assert.match(r.stderr, WARNING);
});

test("check --release --json under FORCE_COLOR carries the release report, not null", () => {
  const root = mkdtempSync(join(tmpdir(), "branchling-guard-colour-"));
  try {
    const env = forcedEnv(root);
    const git = (args) => spawnSync("git", args, { cwd: root, encoding: "utf8", env });
    git(["init", "-q", "-b", "main"]);
    const init = spawnSync(process.execPath, [CLI, "init", "--dir", "backlog"], { cwd: root, encoding: "utf8", env });
    assert.equal(init.status, 0, init.stderr);
    git(["add", "-A"]);
    git(["-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-q", "-m", "init"]);

    const r = spawnSync(process.execPath, [CLI, "check", "--release", "--dir", "backlog", "--json"], { cwd: root, encoding: "utf8", env });
    const doc = JSON.parse(r.stdout);
    for (const g of doc.guards) assert.doesNotMatch(g.output, WARNING, g.name + " captured Node's colour warning");
    const release = doc.guards.find((g) => g.name === "release");
    assert.ok(release, "the release guard did not run");
    assert.notEqual(release.report, null, "the release guard's --json document did not parse");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
