/**
 * `next --probe` and `take --probe` hand the task over with the live result of
 * its contract, entry by entry (TL-268).
 *
 * WHY. A task file says what should be true when the work is done; the contract
 * says how that will be checked; neither says what is true NOW, and that
 * difference is the work. A hand shown "this is what is red" starts from its
 * target instead of a description of green. And a contract that passes in full
 * before any work — TL-143's case, closed only because a charter outside the
 * repository told the hand to run it first — is named at the moment it is
 * handed out.
 *
 * THE DECISIONS THIS ENCODES. Opt-in: a contract may cost a whole suite, and a
 * loop that wants the task in a second is not made to wait for it. Every entry
 * runs, not up to the first failure — a probe is a survey, `done` is a verdict.
 * `manual` entries are listed and not judged. The block lands at the END of the
 * text, after the decisions under the frontmatter, in the place a refused
 * `done` arrives from the second attempt on, so the two feedback channels have
 * one shape. Nothing reaches the file on disk.
 *
 * POSITIVE CONTROLS. The first test fails against the code as it was: `--probe`
 * was an unknown flag. The last test pins that WITHOUT the flag nothing runs —
 * a contract that writes a witness file leaves none.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { probeContract } from "../done-task.mjs";
import { renderProbe } from "../probe.mjs";
import { isolateHome } from "./_repo.mjs";

isolateHome("next-probe");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");
const HEADING = "## The contract, as it stands now";

let counter = 0;
function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), "branchling-" + prefix + "-" + (counter++) + "-"));
}

function cli(args, env, opts = {}) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 120_000,
    env: { ...process.env, NO_COLOR: "1", ...(env || {}) },
    ...opts,
  });
}

function taskFile(backlog, id) {
  return join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-")));
}

function fixture() {
  const dir = tmp("probe");
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  const backlog = join(repo, "backlog");
  const env = { BACKLOG_STATE_DIR: join(dir, "state") };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env).status, 0);
  /** A task whose contract is the YAML block given, verbatim. */
  const add = (title, contract) => {
    const r = cli(["new", "--dir", backlog, "--title", title, "--priority", "P1"], env);
    assert.equal(r.status, 0, r.stderr);
    const id = (r.stdout.match(/([A-Z]+-\d+)/) || [])[1];
    const file = taskFile(backlog, id);
    writeFileSync(file, readFileSync(file, "utf8")
      .replace(/verification:[\s\S]*?\n---/, contract + "\n---")
      .replace(/\[proof:[^\]]*\]/g, ""), "utf8");
    cli(["build", "--dir", backlog], env);
    return id;
  };
  return { dir, repo, backlog, env, add };
}

function cleanup(...dirs) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

const MIXED = [
  "verification:",
  '  - id: still-red',
  '    bash: "echo the feature is missing >&2; exit 3"',
  '  - id: already-green',
  '    bash: "true"',
  '  - id: also-red',
  '    bash: "false"',
].join("\n");

test("`take --probe` runs EVERY entry and hands over what is red, in the text and as data", () => {
  const f = fixture();
  try {
    const id = f.add("A task with a target", MIXED);
    const r = cli(["take", id, "--dir", f.backlog, "--actor", "agent:hand", "--probe", "--json"], f.env, { cwd: f.repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    assert.ok(out.probe, "no `probe` in the envelope: " + Object.keys(out).join(","));
    assert.equal(out.probe.ran, 3, "the probe stopped at the first failure: " + JSON.stringify(out.probe.rows));
    assert.equal(out.probe.failed, 2);
    assert.equal(out.probe.allPassed, false);
    assert.deepEqual(out.probe.rows.map((x) => [x.id, x.ok, x.exitCode]),
      [["still-red", false, 3], ["already-green", true, 0], ["also-red", false, 1]]);
    assert.match(out.probe.rows[0].output, /the feature is missing/, "the failing entry's output is not carried");
    // The same, rendered into the text the hand reads.
    assert.ok(String(out.text).includes(HEADING), "the probe is not in `text`");
    assert.match(String(out.text), /2 of 3 entries fail now\. That is the target\./);
    assert.match(String(out.text), /`still-red` — \*\*FAILS \(exit 3\)\*\*/);
    assert.match(String(out.text), /`already-green` — \*\*passes\*\*/);
    assert.match(String(out.text), /the feature is missing/);
    assert.ok(String(out.text).indexOf(HEADING) > String(out.text).indexOf("## Goal"),
      "the probe must come AFTER the body, where a refused `done` would arrive");
    assert.ok(!readFileSync(taskFile(f.backlog, id), "utf8").includes(HEADING), "the block leaked into the file on disk");
  } finally {
    cleanup(f.dir);
  }
});

test("a contract that is green before any work is named as one that proves nothing — or a task already done", () => {
  const f = fixture();
  try {
    const id = f.add("A task whose proof cannot fail", 'verification:\n  - id: vacuous\n    bash: "true"');
    const r = cli(["take", id, "--dir", f.backlog, "--actor", "agent:hand", "--probe"], f.env, { cwd: f.repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Every entry passed before any work was done/, r.stdout);
    assert.match(r.stdout, /cannot fail and proves nothing/, r.stdout);
  } finally {
    cleanup(f.dir);
  }
});

test("`next --probe` does the same, and `run --probe` feeds it to the hand on stdin", () => {
  const f = fixture();
  try {
    const id = f.add("A task with a target", MIXED);
    const n = cli(["next", "--dir", f.backlog, "--actor", "agent:scout", "--probe", "--json"], f.env, { cwd: f.repo });
    assert.equal(n.status, 0, n.stdout + n.stderr);
    const out = JSON.parse(n.stdout);
    assert.equal(out.id, id);
    assert.equal(out.probe.failed, 2);
    assert.ok(String(out.text).includes(HEADING));
    // A second task with the same contract, for the run: the first is now held
    // by the scout, and this test is about what the LOOP feeds a hand, not about
    // giving a claim back.
    f.add("Another task with the same target", MIXED);
    const witness = join(f.dir, "stdin.txt");
    const agent = join(f.dir, "agent.sh");
    writeFileSync(agent, "#!/bin/sh\ncat > " + JSON.stringify(witness) + "\necho 'read it'\n", "utf8");
    chmodSync(agent, 0o755);
    const r = cli(["run", "--dir", f.backlog, "--actor", "agent:scout", "--max-attempts", "1", "--probe", "--agent", agent],
      f.env, { cwd: f.repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(existsSync(witness), "the agent never ran: " + r.stdout);
    const got = readFileSync(witness, "utf8");
    assert.ok(got.includes(HEADING), "the loop fed the agent a task without its contract's state:\n" + got.slice(-400));
    assert.match(got, /2 of 3 entries fail now/);
  } finally {
    cleanup(f.dir);
  }
});

test("`manual` entries are listed and not judged, and a broken contract is reported rather than thrown", () => {
  const withManual = probeContract([
    { id: "a", bash: "true" },
    { id: "sign", manual: "a person confirms the screenshot" },
    { id: "b", bash: "exit 7" },
  ], process.cwd());
  assert.equal(withManual.ran, 2, "a manual entry was counted as run");
  assert.equal(withManual.failed, 1);
  assert.equal(withManual.rows[1].kind, "manual");
  assert.equal(withManual.rows[1].ok, null);
  assert.equal(withManual.rows[2].exitCode, 7);
  assert.match(renderProbe(withManual), /`sign` — \*\*manual\*\*, asks a person/);

  const f = fixture();
  try {
    const id = f.add("A task whose contract cannot be read", "verification:\n  - id: nothing-to-check");
    const r = cli(["take", id, "--dir", f.backlog, "--actor", "agent:hand", "--probe", "--json"], f.env, { cwd: f.repo });
    assert.equal(r.status, 0, "a probe that cannot run must not fail the handover: " + r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    assert.ok(Array.isArray(out.probe.problems) && out.probe.problems.length, JSON.stringify(out.probe));
    assert.equal(out.probe.rows.length, 0);
    assert.match(String(out.text), /could not be read, so nothing was run/);
  } finally {
    cleanup(f.dir);
  }
});

test("POSITIVE CONTROL: without `--probe` nothing is run and the envelope says so", () => {
  const f = fixture();
  try {
    const witness = join(f.dir, "ran.txt");
    const id = f.add("A task whose contract leaves a trace",
      'verification:\n  - id: trace\n    bash: "echo ran > ' + witness + '"');
    const r = cli(["take", id, "--dir", f.backlog, "--actor", "agent:hand", "--json"], f.env, { cwd: f.repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.probe, null);
    assert.ok(!String(out.text).includes(HEADING));
    assert.ok(!existsSync(witness), "the contract ran without `--probe`");
  } finally {
    cleanup(f.dir);
  }
});
