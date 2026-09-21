/**
 * The default `check` is a release gate, not a noticeboard (TL-383).
 *
 * WHAT WAS WRONG. `check` printed a wall of `!` lines and exited 0. Four of its
 * thirteen guards report findings they cannot fail on — legacy `## Log` prose,
 * transitions that predate the rule requiring a reason, a task file whose state
 * has not been committed yet, criteria links the project configured as advisory
 * — and a green command whose output is mostly things a reader must learn to
 * skip stops being read at all. Strictness is only worth having while the
 * verdict is unambiguous.
 *
 * WHAT REPLACES IT. Severity is a property of the guard TABLE, not of the guard
 * process: `CHECK_GUARDS` says which guards can block a release, the default run
 * executes only those, and the rest move under `audit`, which has always been
 * "a report, not a gate". No guard script's exit contract changes, and nothing
 * is computed in two places — `audit` runs the same guards rather than
 * reimplementing their findings.
 *
 * WHY THE FIXTURES BUILD THEIR OWN VOCABULARY. Statuses, the criteria-link
 * policy and reason-required statuses are this project's DATA, not the tool's
 * contract, so a test that asserted the values in `backlog/config.yaml` would
 * be asserting somebody's configuration back at them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { HOME_ENV } from "../home.mjs";
import { CHECK_GUARDS } from "../cli.mjs";
import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("check-default-signal");
const CLI = join(SCRIPTS_DIR, "cli.mjs");
const run = (args, env, cwd) =>
  spawnSync(process.execPath, [CLI].concat(args), { cwd, encoding: "utf8", timeout: 120_000, env });

/** A backlog of this tool's own making, with no sample task to judge. */
function fixture(label) {
  const root = mkdtempSync(join(tmpdir(), "branchling-" + label + "-"));
  const backlog = join(root, "backlog");
  const env = { ...process.env, NO_COLOR: "1", [HOME_ENV]: join(root, "home"), BACKLOG_STATE_DIR: join(root, "state") };
  const init = run(["init", "--dir", backlog, "--no-example"], env, root);
  assert.equal(init.status, 0, init.stdout + init.stderr);
  return { root, backlog, env };
}

function task(backlog, id) {
  const name = readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-"));
  return join(backlog, "tasks", name);
}

function create(backlog, env, root, title) {
  const made = run(["new", "--dir", backlog, "--title", title], env, root);
  assert.equal(made.status, 0, made.stdout + made.stderr);
  return made.stdout.match(/[A-Z]+-\d+/)[0];
}

/** Every line a reader is meant to treat as a finding rather than a tick. */
const warnings = (text) => text.split("\n").filter((l) => l.trimStart().startsWith("!"));

test("the guard table states a severity for every guard, and at least one of each", () => {
  // Without this the rest of the file would pass just as happily against a table
  // where the axis exists and nothing uses it.
  for (const guard of CHECK_GUARDS) {
    assert.ok(["gate", "advisory"].includes(guard.severity),
      "guard `" + guard.name + "` declares no severity, so the default run cannot classify it");
  }
  const gates = CHECK_GUARDS.filter((g) => g.severity === "gate");
  const advisory = CHECK_GUARDS.filter((g) => g.severity === "advisory");
  assert.ok(gates.length > 0, "no guard can fail a release — check is not a gate at all");
  assert.ok(advisory.length > 0, "no guard is advisory — the axis was added and never used");
});

test("a clean tree gets a bounded success report with no warnings", () => {
  const { root, backlog, env } = fixture("clean");
  try {
    create(backlog, env, root, "Ordinary work");
    const out = run(["check", "--dir", backlog], env, root);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.deepEqual(warnings(out.stdout), [], "a clean tree still produced findings the command cannot act on");
    const lines = out.stdout.trim().split("\n").filter(Boolean);
    assert.ok(lines.length <= CHECK_GUARDS.length,
      "the success report grows with the tree: " + lines.length + " lines for " + CHECK_GUARDS.length + " guards");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an advisory finding stays out of the release verdict and is reachable on request", () => {
  const { root, backlog, env } = fixture("advisory");
  try {
    const id = create(backlog, env, root, "A task whose prose fell behind");
    const file = task(backlog, id);
    const config = readFileSync(join(backlog, "config.yaml"), "utf8");
    const statuses = config.match(/^statuses:\s*\[([^\]]+)\]/m)[1].split(",").map((s) => s.trim());
    const [first, closed] = [statuses[0], statuses[statuses.length - 2]];
    writeFileSync(file,
      readFileSync(file, "utf8").replace(/^status:.*$/m, "status: " + closed) +
      "\n## Log\n\n2026-01-01 " + first + " — somebody — the prose nobody came back to\n", "utf8");

    const silent = run(["check", "--dir", backlog], env, root);
    assert.equal(silent.status, 0, "an advisory finding failed the release gate");
    assert.deepEqual(warnings(silent.stdout), [], "an advisory finding leaked into the default verdict");

    const asked = run(["check", "--log-status", "--dir", backlog], env, root);
    assert.equal(asked.status, 0);
    assert.ok(warnings(asked.stdout).length > 0, "asked for it directly, the guard reported nothing");

    // NAMED, not merely counted. `audit` has findings of its own and prints a `!`
    // for them, so "audit warned about something" is satisfied by a coincidence —
    // measured on 2026-09-21, that is exactly what this assertion first passed on.
    const audited = run(["audit", "--dir", backlog], env, root);
    assert.match(audited.stdout, /log\/status/,
      "the advisory guard's finding is reachable through neither check nor audit — it is lost");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a gate failure is named, fails the command, and reads the same in both modes", () => {
  const { root, backlog, env } = fixture("gate");
  try {
    const id = create(backlog, env, root, "A task blocked by nothing that exists");
    const file = task(backlog, id);
    writeFileSync(file, readFileSync(file, "utf8").replace(/^blocked_by:.*$/m, "blocked_by: [ZZ-9999]"), "utf8");

    const human = run(["check", "--dir", backlog], env, root);
    assert.notEqual(human.status, 0, "a dangling dependency passed the release gate");

    const json = run(["check", "--dir", backlog, "--json"], env, root);
    assert.equal(json.status, human.status, "the two modes disagree on the exit code");
    const report = JSON.parse(json.stdout);
    assert.equal(report.ok, false);
    assert.ok(report.failed.length > 0, "the command failed and named no guard");
    for (const name of report.failed) {
      assert.ok(human.stdout.includes(name) || human.stderr.includes(name),
        "JSON blames `" + name + "`, and the human output never mentions it");
    }
    for (const guard of report.guards) {
      assert.ok(["gate", "advisory"].includes(guard.severity),
        "guard `" + guard.name + "` reached a consumer with no severity to act on");
    }
    assert.deepEqual(report.guards.filter((g) => g.severity === "advisory"), [],
      "an advisory guard ran in the default verdict, so `ok` no longer means releasable");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
