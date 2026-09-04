/**
 * An over-sized task is not handed to an unattended run (TL-211).
 *
 * WHAT IS BROKEN TODAY. Nothing in the tree marks a task as too large for one
 * session, so `next` re-offers it the moment it is handed back. Measured twice
 * in this repository's own log: TL-137 (`1w`) was handed back by the same run
 * twice, and TL-149 (`1w`) sits in the queue where every run can take it again.
 * `handoff` records the judgement for ONE actor (TL-141); it says nothing about
 * the SIZE of the task, so the next actor along is offered it with no warning.
 *
 * THE CONTRACT THIS FILE FIXES. It is a filter of the same family as
 * `executor:` (TL-113) and `role:` (TL-98) — it narrows the candidates BEFORE
 * the claim, it reports what it passed over, and it never touches `take`:
 *
 *   config.yaml  `max_unattended_estimate: <value>` names the LARGEST estimate
 *                an unattended run may be handed. Absent means no gate — a
 *                project that has not stated one keeps today's behaviour. It
 *                reaches the code as `config.maxUnattendedEstimate`, and a
 *                value outside `estimates` FAILS the load, because a threshold
 *                naming a word the vocabulary does not have gates nothing and
 *                looks exactly like no gate at all.
 *
 *   isOverSized(task, config)   PURE, exported from `next-task.mjs`. "Above the
 *                threshold" means LATER IN `estimates`, which is a list and not
 *                a duration. Nothing is parsed into hours: that would invent a
 *                scale this project has not stated and would break on `2mo`.
 *
 *   next         passes an over-sized task over for an `agent:` actor, and
 *                NAMES it — in `--json` as `skippedSize: [{id, estimate}]`, in
 *                the terminal as a line carrying the id, the estimate and the
 *                threshold. A person asking is not unattended and still gets it.
 *
 *   run          reports the same beside its executor block:
 *                `waitingForSize(records, config, species)` and the
 *                `waitingForSize` key in `--json`.
 *
 *   take <ID>    is untouched. Naming a task IS the deliberate human decision
 *                the gate asks for — the rule TL-97 set for `role` and TL-113
 *                for `executor`.
 *
 * WHY EVERY CASE HERE CARRIES A POSITIVE CONTROL. A gate is trivially green: a
 * queue that hands out nothing passes every assertion below about what was NOT
 * handed out. So each refusal is paired with the same fixture answering the
 * other way — the threshold removed, or a human actor asking — and the task
 * that was refused is then taken. A guard that passes on a zero sample has no
 * evidentiary force (CLAUDE.md).
 *
 * THE VOCABULARY IS THE FIXTURE'S OWN, deliberately. `estimates` here is
 * `[tiny, small, large, huge]` and never `[30m, 2h, 1d, 1w]`: asserting
 * this project's values would make the test a copy of its config.yaml, and
 * words that are not durations are the sharpest proof that the comparison reads
 * the ORDER of the list rather than parsing what the words say.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as nextTask from "../next-task.mjs";
import * as runLoop from "../run-loop.mjs";

import { isolateHome, plainOutput } from "./_repo.mjs";

/**
 * The two new exports, reached through the module NAMESPACE rather than named
 * in the `import` line.
 *
 * WHY, and it is not a matter of taste. A named import of a symbol that does not
 * exist is a link error: the file never loads, every case in it is reported as
 * one failure, and the failure says "no such export" about a module — which is
 * a fact about the import line, not about the dispatcher. The cases below that
 * drive the CLI need no new export at all and can measure the real defect right
 * now, so they must be allowed to run and fail on what `next` actually does.
 * A namespace import loads whatever is there and lets each case say its own
 * piece.
 */
function missing(module, name) {
  return (...args) => {
    assert.equal(typeof module[name], "function",
      "`" + name + "` is not exported yet — the ordered comparison this file " +
        "states does not exist, which is the defect, not a fault of the test");
    return module[name](...args);
  };
}
const isOverSized = missing(nextTask, "isOverSized");
const waitingForSize = missing(runLoop, "waitingForSize");

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166): a test must not read the
// developer's own `config.yaml`, or the suite answers differently per machine.
isolateHome("next-size-gate");
// And the ASSERTIONS ABOUT HUMAN-FACING TEXT declare which observer they mean
// (TL-238), rather than adopting whichever terminal the suite happens to run in.
plainOutput();

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

/** The fixture's own ordered vocabulary. Not this project's, and not durations. */
const SIZES = ["tiny", "small", "large", "huge"];
const THRESHOLD = "small";
/** The key in config.yaml, named once so the fixture and the assertions agree. */
const THRESHOLD_KEY = "max_unattended_estimate";

let counter = 0;
function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), "branchling-" + prefix + "-" + (counter++) + "-"));
}

function cli(args, env, opts = {}) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 120_000,
    env: { ...process.env, ...(env || {}) },
    ...opts,
  });
}

function taskFile(backlog, id) {
  return join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-")));
}

function field(backlog, id, key) {
  const m = readFileSync(taskFile(backlog, id), "utf8").match(new RegExp("^" + key + ": (.*)$", "m"));
  return m ? m[1].trim() : null;
}

/**
 * A backlog whose `estimates` vocabulary is the one above, with one task per
 * entry of `specs` — `{ priority, estimate }`.
 *
 * Each task's contract is "the file `<id>.done` exists", so the same fixture
 * serves `next` (which never runs a contract) and `run` (which does), and the
 * agent stays a shell script in both.
 */
function fixture(specs, opts = {}) {
  const dir = tmp("size-gate");
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  const backlog = join(repo, "backlog");
  const env = { BACKLOG_STATE_DIR: join(dir, "state") };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env).status, 0);

  const cfg = join(backlog, "config.yaml");
  const threshold = "threshold" in opts ? opts.threshold : THRESHOLD;
  const stated = threshold === null ? [] : ["", THRESHOLD_KEY + ": " + threshold, ""];
  writeFileSync(cfg,
    [readFileSync(cfg, "utf8").replace(/^estimates:.*$/m, "estimates: [" + SIZES.join(", ") + "]")]
      .concat(stated).join("\n"),
    "utf8");

  const ids = [];
  for (let i = 0; i < specs.length; i++) {
    const r = cli(["new", "--dir", backlog, "--title", "Task number " + (i + 1),
      "--priority", specs[i].priority || "P1"], env);
    assert.equal(r.status, 0, r.stderr);
    const id = (r.stdout.match(/([A-Z]+-\d+)/) || [])[1];
    ids.push(id);
    const file = taskFile(backlog, id);
    writeFileSync(file, readFileSync(file, "utf8")
      .replace(/^estimate:.*$/m, "estimate: " + specs[i].estimate)
      // The template's criteria name a proof id of their own; left in place
      // every `run` would refuse on the criteria link before reaching the gate.
      .replace(/verification:[\s\S]*?\n---/,
        'verification:\n  - id: it-is-done\n    bash: "test -f ' + id + '.done"\n---')
      .replace(/\[proof:[^\]]*\]/g, "[proof: it-is-done]"), "utf8");
  }
  cli(["build", "--dir", backlog], env);
  return { dir, repo, backlog, env, ids };
}

function agentScript(dir, body) {
  const p = join(dir, "agent.sh");
  writeFileSync(p, "#!/bin/sh\n" + body + "\n", "utf8");
  chmodSync(p, 0o755);
  return p;
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

// ── The comparison is ORDERED, and it is PURE ─────────────────────────────

const CONFIG = { estimates: SIZES, maxUnattendedEstimate: THRESHOLD };

test("above the threshold means LATER IN THE LIST, not a longer duration", () => {
  assert.equal(isOverSized({ estimate: "large" }, CONFIG), true);
  assert.equal(isOverSized({ estimate: "huge" }, CONFIG), true);
  // The boundary is `above`, not `at or above`: the threshold names the largest
  // estimate a run MAY be handed, so that value itself is still handed out.
  assert.equal(isOverSized({ estimate: THRESHOLD }, CONFIG), false);
  assert.equal(isOverSized({ estimate: "tiny" }, CONFIG), false);
});

test("the ORDER of `estimates` decides, and nothing else — the same words, reversed", () => {
  // The single most important case in this file. Under a vocabulary written the
  // other way round the same words give the opposite answer, which no
  // implementation that parses the word into a duration can produce.
  const reversed = { estimates: SIZES.slice().reverse(), maxUnattendedEstimate: "large" };
  assert.equal(isOverSized({ estimate: "huge" }, reversed), false);
  assert.equal(isOverSized({ estimate: "large" }, reversed), false);
  assert.equal(isOverSized({ estimate: "small" }, reversed), true);
  assert.equal(isOverSized({ estimate: "tiny" }, reversed), true);
});

test("POSITIVE CONTROL: with no threshold stated, nothing is over-sized", () => {
  // Without this every assertion above could be passing on a predicate that is
  // true of everything, and the gate would empty a queue it was asked to narrow.
  for (const estimate of SIZES) {
    assert.equal(isOverSized({ estimate }, { estimates: SIZES, maxUnattendedEstimate: null }), false,
      "`" + estimate + "` is gated by a project that stated no threshold");
  }
});

test("an estimate with no place in the vocabulary is NOT gated", () => {
  // `estimate` is a free field — the vocabulary suggests, it does not close — so
  // a task may carry a word the list has never seen. Such a word has no position
  // in the order, and inventing one for it is the very thing this design refuses.
  // Withholding it would be worse than handing it out: the gate is not a block,
  // and a task nobody can see is indistinguishable from an empty queue.
  assert.equal(isOverSized({ estimate: "2mo" }, CONFIG), false);
  // The field is optional, and an empty one means the task says nothing about
  // its size — the same reading `executor:` gives an empty value.
  assert.equal(isOverSized({ estimate: "" }, CONFIG), false);
  assert.equal(isOverSized({}, CONFIG), false);
});

// ── `next`: the gate, and the report that keeps it from being silent ──────

test("an agent is not handed a task above the threshold", () => {
  const { dir, backlog, env, ids } = fixture([
    { priority: "P1", estimate: "huge" },
    { priority: "P3", estimate: "tiny" },
  ]);
  try {
    const r = cli(["next", "--dir", backlog, "--actor", "agent:claude", "--json"], env);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).id, ids[1],
      "a week of work was handed to an unattended run ahead of the task it could finish");

    // POSITIVE CONTROL: the refused task is otherwise perfectly takeable, and a
    // person asking is not an unattended run — they get it, and it is the P1.
    const p = cli(["next", "--dir", backlog, "--actor", "local:kamil", "--json"], env);
    assert.equal(p.status, 0, p.stderr);
    assert.equal(JSON.parse(p.stdout).id, ids[0]);
  } finally {
    cleanup(dir);
  }
});

test("POSITIVE CONTROL: with the key absent, the very same task IS handed out", () => {
  // The gate has to be the reason, not the fixture. The only difference from
  // the case above is the one line in config.yaml.
  const { dir, backlog, env, ids } = fixture([
    { priority: "P1", estimate: "huge" },
    { priority: "P3", estimate: "tiny" },
  ], { threshold: null });
  try {
    const r = cli(["next", "--dir", backlog, "--actor", "agent:claude", "--json"], env);
    assert.equal(r.status, 0, r.stderr);
    const answer = JSON.parse(r.stdout);
    assert.equal(answer.id, ids[0], "a project that stated no threshold had one applied anyway");
    // The key is declared for the kind, so it is present and empty rather than
    // missing — a consumer must not have to tell "no value" from "old version".
    assert.deepEqual(answer.skippedSize, []);
  } finally {
    cleanup(dir);
  }
});

test("the skip is NAMED — the id, the estimate and the bar it failed", () => {
  const { dir, backlog, env, ids } = fixture([{ priority: "P1", estimate: "huge" }]);
  try {
    const r = cli(["next", "--dir", backlog, "--actor", "agent:claude"], env);
    assert.equal(r.status, 3, r.stderr);
    // A skip nobody names reads exactly like an empty queue, and the reader has
    // no second place to look. Three things have to be in that sentence: WHICH
    // task, HOW BIG it is, and WHAT THE BAR IS — without the last of the three
    // a reader cannot tell whether to raise the threshold or split the task.
    assert.match(r.stdout, new RegExp(ids[0]), r.stdout);
    assert.match(r.stdout, /huge/, r.stdout);
    assert.match(r.stdout, new RegExp(THRESHOLD), r.stdout);

    const j = cli(["next", "--dir", backlog, "--actor", "agent:claude", "--json"], env);
    assert.equal(j.status, 3, j.stderr);
    assert.deepEqual(JSON.parse(j.stdout).skippedSize, [{ id: ids[0], estimate: "huge" }]);
  } finally {
    cleanup(dir);
  }
});

test("the task at the threshold is handed out — the bar is `above`, not `at`", () => {
  const { dir, backlog, env, ids } = fixture([{ priority: "P1", estimate: THRESHOLD }]);
  try {
    const r = cli(["next", "--dir", backlog, "--actor", "agent:claude", "--json"], env);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).id, ids[0]);
  } finally {
    cleanup(dir);
  }
});

test("`take <ID>` is untouched: naming a task IS the deliberate decision", () => {
  const { dir, backlog, env, ids } = fixture([{ priority: "P1", estimate: "huge" }]);
  try {
    const r = cli(["take", ids[0], "--dir", backlog, "--actor", "agent:claude"], env);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(field(backlog, ids[0], "status"), "in_progress",
      "the gate leaked out of the dispatcher and refused a task somebody named");
  } finally {
    cleanup(dir);
  }
});

test("the READING commands still see it — this is a gate, not a block", () => {
  const { dir, backlog, env } = fixture([
    { priority: "P1", estimate: "huge" },
    { priority: "P3", estimate: "tiny" },
  ]);
  try {
    const r = cli(["query", "--dir", backlog, "--status", "pending", "--count"], env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /2/, "the over-sized task disappeared from `query`:\n" + r.stdout);
  } finally {
    cleanup(dir);
  }
});

// ── `run`: the same fact, beside the executor block ───────────────────────

test("waitingForSize counts only OPEN work an unattended run may not be handed", () => {
  const config = {
    archivedStatuses: ["done"], inProgressStatus: "in_progress",
    estimates: SIZES, maxUnattendedEstimate: THRESHOLD,
  };
  const records = [
    { id: "FX-1", estimate: "huge", status: "pending" },
    { id: "FX-2", estimate: "huge", status: "done" },        // closed
    { id: "FX-3", estimate: "large", status: "in_progress" },  // somebody has it
    { id: "FX-4", estimate: "tiny", status: "pending" },       // small enough
    { id: "FX-5", estimate: "large", status: "pending" },
  ];
  assert.deepEqual(waitingForSize(records, config, "agent"),
    { huge: ["FX-1"], large: ["FX-5"] });
  // POSITIVE CONTROL: a person is not an unattended run, so nothing waits on
  // them for its size — otherwise this could be counting every open task.
  assert.deepEqual(waitingForSize(records, config, "human"), {});
  // And a project with no threshold has nothing waiting either.
  assert.deepEqual(waitingForSize(records, { ...config, maxUnattendedEstimate: null }, "agent"), {});
});

test("a run leaves the over-sized task alone and says so, in words and in JSON", () => {
  const { dir, repo, backlog, env, ids } = fixture([
    { priority: "P1", estimate: "huge" },
    { priority: "P2", estimate: "tiny" },
  ]);
  try {
    const agent = agentScript(dir, 'id=$(grep -m1 "^id: " | sed "s/^id: //"); touch "$id.done"');
    const r = cli(["run", "--dir", backlog, "--actor", "agent:worker", "--agent", agent, "--json"],
      env, { cwd: repo });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(field(backlog, ids[0], "status"), "pending",
      "an unattended run worked a task larger than this project allows it");
    assert.equal(field(backlog, ids[1], "status"), "done",
      "the run did nothing at all — the gate cannot be what stopped it");

    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.waitingForSize, [{ estimate: "huge", count: 1, ids: [ids[0]] }]);

    // The operator reads a terminal, so a fact only a JSON consumer can see has
    // not reached the person who has to act on it (the rule TL-202 settled).
    const text = cli(["run", "--dir", backlog, "--actor", "agent:worker", "--agent", agent],
      env, { cwd: repo });
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /1 task\(s\)/, text.stdout);
    assert.match(text.stdout, /huge/, text.stdout);
    assert.match(text.stdout, new RegExp(ids[0]), text.stdout);
  } finally {
    cleanup(dir);
  }
});

// ── The configuration: a threshold that gates nothing must not look like one ──

test("a threshold outside `estimates` FAILS the load", () => {
  const { dir, backlog, env } = fixture([{ priority: "P1", estimate: "tiny" }],
    { threshold: "medium" });
  try {
    const r = cli(["next", "--dir", backlog, "--actor", "agent:claude"], env);
    assert.equal(r.status, 2,
      "a threshold naming a word the vocabulary does not have was accepted — it gates " +
        "nothing, and a gate that gates nothing is indistinguishable from no gate");
    const said = r.stdout + r.stderr;
    assert.match(said, /max_unattended_estimate/, said);
    assert.match(said, /estimates/, said);
  } finally {
    cleanup(dir);
  }
});

test("POSITIVE CONTROL: the same configuration with a stated value loads", () => {
  // Without this the refusal above could be a config file that fails for any
  // reason at all — a stray line, a bad `estimates` list — rather than for the
  // threshold naming a word nobody declared.
  const { dir, backlog, env } = fixture([{ priority: "P1", estimate: "tiny" }]);
  try {
    const r = cli(["check", "--dir", backlog], env);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    cleanup(dir);
  }
});
