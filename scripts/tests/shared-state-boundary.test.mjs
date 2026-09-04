/**
 * What a session may write OUTSIDE the worktree it was given (TL-202).
 *
 * THE MEASUREMENT THIS FILE COMES FROM. On 2026-09-03 a session working in one
 * worktree wrote `<config>/config.yaml` — correctly, as part of TL-196. Every
 * other tree on the machine was still running code in which that key belonged
 * to the project layer, so from that second every command in those trees exited
 * 2 with `cannot read the user preferences`, including a `run` in flight. The
 * failure looked like a defect in the run and was not.
 *
 * THE ASYMMETRY IS THE WHOLE POINT, and nothing states it anywhere an agent
 * reads. A write INSIDE the worktree travels with a branch and arrives when
 * somebody merges — that is Law 1. A write OUTSIDE it is instant for every
 * other tree on the machine, and no branch mediates it. The two paths a session
 * legitimately writes outside its tree are named by the constants imported
 * below; they are not optional extras, the tool cannot work without them.
 *
 * WHAT IS PROVED HERE, in two halves, because a decision that lives in only one
 * of them is not a decision:
 *
 *   1. THE GUIDE STATES THE BOUNDARY. `instructions autonomous-loop` is what an
 *      unattended agent reads, so the list of writable outside paths, whether
 *      it is closed, what a run owes the other trees, and whether anything
 *      enforces it all have to be IN it. The check is a pure function over the
 *      rendered text and it is fed a compliant text first: a guard nobody has
 *      seen go green cannot tell an unimplemented decision from an impossible
 *      one.
 *   2. THE RUN NAMES WHAT IT USED. The operator on 2026-09-03 had no way to
 *      tell a shared-state change from a defect in their own work. The report
 *      carries `sharedState`, in `--json` and in the rendering, so the question
 *      has an answer that does not require reading this repository's source.
 *
 * WHY THE PATHS ARE ASSERTED AGAINST TWO DIFFERENT DIRECTORIES. A report that
 * printed a constant would satisfy any single run. Two runs, pointed at two
 * homes and two state directories, are the positive control: the paths have to
 * MOVE with the environment, which is the only evidence that they were computed
 * from the run rather than typed into the renderer.
 *
 * ENFORCEMENT IS NOT ASSERTED, deliberately. The loop is composition — it does
 * not own the agent's filesystem access and never will — so this file requires
 * the guide to ANSWER the question, in either direction, and requires the run
 * to report. It does not require a prohibition that nothing could uphold.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../config.mjs";
import { HOME_ENV, userConfigPath } from "../home.mjs";
import { STATE_DIR_ENV } from "../lock.mjs";
import { topicText } from "../instructions.mjs";
import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("shared-state-boundary");

const CLI = join(SCRIPTS_DIR, "cli.mjs");

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

// ── Half one: the guide states the boundary ───────────────────────────────

/**
 * PURE — given the rendered guide, what is it still not saying?
 *
 * The needles are the THESIS, never the wording. Two of them are KEYS and are
 * therefore exact: an environment variable is a name a person types, and the
 * guide naming the directory some other way would leave the reader unable to
 * find it. The rest are read in a WINDOW around those two names, so the words
 * have to be in the paragraph that discusses them and not somewhere else in a
 * guide that already says `report` and `outside` for other reasons.
 *
 * @returns {string[]} problems; empty means the decision is stated
 */
export function boundaryStated(text) {
  // Flattened first: the guides are wrapped at 72 columns, so a sentence is
  // regularly cut by a newline and a needle that could not survive the break
  // would be measuring the typesetting.
  const flat = String(text).replace(/\s+/g, " ");
  const problems = [];
  const stateAt = flat.indexOf(STATE_DIR_ENV);
  const homeAt = flat.indexOf(HOME_ENV);
  if (stateAt < 0) problems.push("the state directory is not named (" + STATE_DIR_ENV + ")");
  if (homeAt < 0) problems.push("the user configuration is not named (" + HOME_ENV + ")");
  // With neither name there is no paragraph to read, and reporting four
  // problems where the reader has one thing to write would be noise.
  if (stateAt < 0 || homeAt < 0) return problems;

  const window = flat.slice(Math.max(0, Math.min(stateAt, homeAt) - 700), Math.max(stateAt, homeAt) + 700);
  if (!/\bonly\b|\bno other\b|nothing else/i.test(window)) {
    problems.push("the list of writable paths is not stated to be closed");
  }
  if (!/report/i.test(window)) {
    problems.push("nothing says a run must announce a change to shared state");
  }
  if (!/enforc/i.test(window)) {
    problems.push("whether anything enforces the boundary is left unanswered");
  }
  return problems;
}

/** A backlog to render the guide against. Its own vocabulary, not this
 *  project's: a test that rendered against the repository it lives in would be
 *  asserting one project's configuration. */
function backlogFixture() {
  const dir = tmp("boundary");
  const backlog = join(dir, "backlog");
  const env = { [STATE_DIR_ENV]: join(dir, "state") };
  assert.equal(cli(["init", "--dir", backlog, "--no-example", "--no-nudge"], env).status, 0);
  return { dir, backlog, env };
}

/** What the guide has to say, in a shape nobody would publish. It exists to
 *  show the check can be satisfied at all. */
const COMPLIANT = [
  "WHAT A SESSION MAY WRITE OUTSIDE ITS OWN TREE. Two paths, and no other:",
  "the state directory (" + STATE_DIR_ENV + ") and the user configuration",
  "(" + HOME_ENV + "). Only these. A write to either is instant for every",
  "other tree on this machine, so a run that changes one says so in its",
  "report. Nothing enforces this — the loop does not own your filesystem.",
].join("\n");

test("positive control: the check can be satisfied, and each needle can be missed", () => {
  // Green first. A guard nobody has watched pass says nothing about the text it
  // is judging — only that it rejects everything.
  assert.deepEqual(boundaryStated(COMPLIANT), []);

  // Then each half of it removed on its own, so a failure names what to write.
  assert.deepEqual(boundaryStated(COMPLIANT.replace(STATE_DIR_ENV, "the usual place")),
    ["the state directory is not named (" + STATE_DIR_ENV + ")"]);
  assert.deepEqual(boundaryStated(COMPLIANT.replace(HOME_ENV, "your preferences")),
    ["the user configuration is not named (" + HOME_ENV + ")"]);
  assert.deepEqual(boundaryStated(COMPLIANT.replace(/no other/, "among others").replace(/Only these\./, "")),
    ["the list of writable paths is not stated to be closed"]);
  assert.deepEqual(boundaryStated(COMPLIANT.replace(/says so in its\nreport/, "carries on")),
    ["nothing says a run must announce a change to shared state"]);
  assert.deepEqual(boundaryStated(COMPLIANT.replace(/Nothing enforces this/, "Nobody checks")),
    ["whether anything enforces the boundary is left unanswered"]);

  // And a guide with nothing in it fails on the two names rather than on none.
  assert.equal(boundaryStated("").length, 2);
});

test("`instructions autonomous-loop` states which paths outside the tree may be written", () => {
  const fx = backlogFixture();
  try {
    const text = topicText("autonomous-loop", loadConfig(fx.backlog));
    assert.ok(text.length > 400, "the guide rendered empty — the measurement below would be vacuous");
    assert.deepEqual(boundaryStated(text), []);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

// ── Half two: the run names the shared state it used ──────────────────────

/** A backlog with one task whose contract a shell script can satisfy, in a home
 *  and a state directory of this fixture's own. */
function runFixture() {
  const dir = tmp("boundary-run");
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  const backlog = join(repo, "backlog");
  const home = join(dir, "home");
  const state = join(dir, "state");
  const env = { [STATE_DIR_ENV]: state, [HOME_ENV]: home };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env).status, 0);

  const r = cli(["new", "--dir", backlog, "--title", "One task for the report", "--priority", "P1"], env);
  assert.equal(r.status, 0, r.stderr);
  const id = (r.stdout.match(/([A-Z]+-\d+)/) || [])[1];
  const file = join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-")));
  writeFileSync(file, readFileSync(file, "utf8")
    .replace(/verification:[\s\S]*?\n---/, 'verification:\n  - id: it-is-done\n    bash: "test -f ' + id + '.done"\n---')
    .replace(/\[proof:[^\]]*\]/g, "[proof: it-is-done]"), "utf8");
  cli(["build", "--dir", backlog], env);

  const agent = join(dir, "agent.sh");
  writeFileSync(agent, '#!/bin/sh\nid=$(grep -m1 "^id: " | sed "s/^id: //"); touch "$id.done"\n', "utf8");
  chmodSync(agent, 0o755);
  return { dir, repo, backlog, home, state, env, id, agent };
}

/** One run, and what it reported. */
function reportOf(fx, json) {
  const args = ["run", "--dir", fx.backlog, "--actor", "agent:worker", "--agent", fx.agent, "--max-tasks", "1"];
  if (json) args.push("--json");
  const r = cli(args, fx.env, { cwd: fx.repo });
  assert.equal(r.status, 0, "the run itself failed: " + r.stdout + r.stderr);
  return r;
}

test("the run report names the paths outside the tree it used", () => {
  const fx = runFixture();
  try {
    const parsed = JSON.parse(reportOf(fx, true).stdout);
    // The control that the run really ran: a report about a run that took
    // nothing would carry the paths just as well and prove nothing.
    assert.equal(parsed.tally.closed, 1, "the fixture agent did not close its task");

    assert.ok(parsed.sharedState, "the report does not say which shared state this run used");
    assert.equal(parsed.sharedState.userConfig, userConfigPath({ ...process.env, [HOME_ENV]: fx.home }),
      "the user configuration the run reads is not named by its real path");
    assert.ok(String(parsed.sharedState.stateDir).startsWith(fx.state),
      "the state directory the run writes is not named: " + parsed.sharedState.stateDir);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("the paths MOVE with the environment — they are computed, not printed", () => {
  // The positive control for the assertion above. A renderer with the default
  // locations typed into it passes that test on any machine where the defaults
  // happen to be right, and fails nobody.
  const one = runFixture();
  const two = runFixture();
  try {
    const a = JSON.parse(reportOf(one, true).stdout).sharedState;
    const b = JSON.parse(reportOf(two, true).stdout).sharedState;
    assert.notEqual(a.userConfig, b.userConfig, "two runs under two homes reported one path");
    assert.notEqual(a.stateDir, b.stateDir, "two runs under two state directories reported one path");
    assert.ok(b.userConfig.startsWith(two.home) && b.stateDir.startsWith(two.state));
  } finally {
    rmSync(one.dir, { recursive: true, force: true });
    rmSync(two.dir, { recursive: true, force: true });
  }
});

test("the operator reading the terminal is told too, not only a JSON consumer", () => {
  // The person whose tree broke on 2026-09-03 was reading a terminal. A fact
  // available only under `--json` would not have reached them.
  //
  // MEASURED AGAINST THE VALUES `--json` GAVE, not against the fixture's own
  // directories. The two renderings of one report may not disagree about which
  // files this run's behaviour depends on, and comparing each against the
  // environment separately would let them.
  const fx = runFixture();
  try {
    const shared = JSON.parse(reportOf(fx, true).stdout).sharedState;
    assert.ok(shared, "the report does not say which shared state this run used");
    const out = reportOf(fx, false).stdout;
    assert.ok(out.includes(shared.userConfig),
      "the rendered report never names the user configuration it read");
    assert.ok(out.includes(shared.stateDir),
      "the rendered report never names the state directory it wrote to");
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});
