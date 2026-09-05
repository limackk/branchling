/**
 * `resume <ID>` — one briefing for a session that died mid-task (TL-151).
 *
 * WHAT IS AT RISK. A successor session has none of the dead session's
 * conversation. Today it reconstructs what that session knew from three
 * separate commands — `git diff`, the history log, and `done --dry-run` — and
 * each of them is a chance to miss one. The parts all exist; what does not
 * exist is the composition, and a composition is judged on ORDER and
 * on being CURRENT, neither of which any of the three parts can be asked about
 * individually.
 *
 * So the assertions here are not "the command exited zero". They are:
 *
 *   1. THE ORDER IS THE PRODUCT. The briefing is read top-down by an agent that
 *      acts on the first thing it understands. A briefing carrying every part
 *      in the wrong order is a wrong briefing, so the section headings are
 *      asserted as a SEQUENCE and each part's content is asserted inside its
 *      own slice — a marker found anywhere in the document proves nothing.
 *   2. THE DIFF IS AGAINST THE MERGE BASE. `main` moved while the session was
 *      dead. The fixture makes the distinction MEASURABLE — a foreign commit on
 *      `main` that a two-dot diff picks up and a three-dot diff does not — and
 *      a control test below proves the fixture separates the two before any
 *      assertion about `resume` relies on it. Without that control,
 *      "FOREIGN_MARKER is absent" is satisfied by a briefing with no diff at
 *      all.
 *   3. THE CONTRACT IS RE-RUN, NOT RECALLED. A stale result printed as if it
 *      were current is worse than no result: it is the one thing the successor
 *      will act on. A single run cannot show that a result is current, so it is
 *      measured by CHANGING the world between two runs of the same command over
 *      the same task and the same history — a recalled verdict cannot change,
 *      and a fresh one must.
 *
 * THE POSITIVE CONTROLS. Two of the tests below pass TODAY, against the
 * commands that already exist. They exist because every `resume` assertion is
 * of the form "the briefing shows X" or "the briefing does not show Y", and
 * both are trivially satisfiable by a fixture in which X and Y were never
 * distinguishable — a zero sample dressed as a guard. The controls establish
 * that this fixture separates a merge-base diff from a tip diff, and a red
 * contract from a green one, using nothing but `git` and `done --dry-run`.
 *
 * WHAT THE VOCABULARY BELOW IS. `TASK` as an id prefix, `always-green` and
 * `the-flip` as verification ids, and the two actors are this FIXTURE's, never
 * this repository's — a test that asserted this project's own values would be
 * asserting a copy of its config.yaml.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { KINDS, SCHEMA_VERSION } from "../json-envelope.mjs";
import { SCRIPTS_DIR, isolateHome, plainOutput } from "./_repo.mjs";

// The actor chain reads the user layer since TL-157, so a developer with an
// `actor:` in their own configuration would otherwise fail every ownership
// assertion below for a reason that has nothing to do with `resume`.
isolateHome("resume");
plainOutput();

const CLI = join(SCRIPTS_DIR, "cli.mjs");

/**
 * THE BRIEFING'S SECTIONS, IN THE ORDER THE TASK FIXES THEM. This list is the
 * contract, not a description of an implementation: (1) the open question or
 * decision, because a successor that starts work on a task waiting for an
 * answer has wasted the whole session; (2) the Goal, which says what "done"
 * means; (3) what changed since the take, which says who else has touched it;
 * (4) the branch diff, which is the code the dead session wrote; (5) the
 * contract, which says how far it got.
 */
const HEADINGS = [
  "## Open questions and decisions",
  "## Goal",
  "## Since the take",
  "## Diff against the merge base",
  "## Verification",
];

const OWNER = "agent:one";
const STRANGER = "agent:two";
const ANSWERED_BY = "user:kamil";

/** A marker per part of the briefing, so a slice can be told from its neighbour. */
const GOAL_MARKER = "GOAL-MARKER-the-parser-must-accept-an-empty-file";
const QUESTION_MARKER = "QUESTION-MARKER: one file or two";
const BRANCH_MARKER = "BRANCH_MARKER_written_by_the_dead_session";
const FOREIGN_MARKER = "FOREIGN_MARKER_somebody_elses_commit";

function cli(root, state, args) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: root, encoding: "utf8", timeout: 60_000, input: "",
    // The reservation is a lockfile OUTSIDE the repository (TL-87). It is put
    // outside the FIXTURE too, so that "the tree is untouched" below is a
    // statement about the repository and cannot be contradicted by a lock the
    // design deliberately keeps elsewhere.
    env: { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: state },
  });
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "", all: (r.stdout || "") + (r.stderr || "") };
}

function git(root, args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 60_000 });
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function commit(root, message) {
  assert.equal(git(root, ["add", "-A"]).code, 0);
  const r = git(root, ["commit", "-q", "-m", message]);
  assert.equal(r.code, 0, r.stderr);
}

/**
 * A repository with a task that was TAKEN, worked on, asked about, answered,
 * and then abandoned — while `main` moved underneath it.
 *
 * Every element is here because one assertion needs it, and no assertion
 * invents its own world: the whole file reads one fixture, so an implementation
 * cannot satisfy one test by contradicting another.
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "branchling-resume-"));
  const state = mkdtempSync(join(tmpdir(), "branchling-resume-state-"));

  assert.equal(git(root, ["init", "-q", "-b", "main", "."]).code, 0);
  assert.equal(cli(root, state, ["init", "--dir", ".", "--no-example"]).code, 0);

  const created = cli(root, state, ["new", "--dir", ".", "--title", "The parser accepts an empty file"]);
  assert.equal(created.code, 0, created.all);
  const id = (created.all.match(/[A-Z]+-\d+/) || [])[0];
  assert.ok(id, "the id of the new task is not in the output: " + created.all);

  // A contract with one entry that cannot fail and one that answers to the
  // filesystem — the second is the flip that separates a fresh run from a
  // recalled one.
  const file = join(root, "tasks", readdirSync(join(root, "tasks")).find((f) => f.startsWith(id)));
  let text = readFileSync(file, "utf8");
  text = text.replace(/verification:[\s\S]*?\n---\n/, [
    "verification:",
    "  - id: always-green",
    '    bash: "true"',
    "  - id: the-flip",
    '    bash: "test -f built.txt"',
    "---", "",
  ].join("\n"));
  text = text.replace(/## Goal\n\n[^\n]*/, "## Goal\n\n" + GOAL_MARKER + ".");
  text = text.replace(/- \[ \] Verifiable.*/, "- [ ] It parses. [proof: the-flip]");
  writeFileSync(file, text, "utf8");

  // A SECOND task, created by the tool and never taken by anybody. `new` writes
  // a WORD into `owner:` for "nobody" rather than leaving the field empty, and
  // that word is the fixture's, taken from the file the tool just wrote — this
  // repository's vocabulary is not asserted here.
  //
  // It sits on `main`, in the same commit as the first, so it is behind the
  // merge base and no assertion about the branch diff can see it.
  const second = cli(root, state, ["new", "--dir", ".", "--title", "Nobody has taken this one"]);
  assert.equal(second.code, 0, second.all);
  const unclaimedId = (second.all.match(/[A-Z]+-\d+/) || [])[0];
  assert.ok(unclaimedId, "the id of the second task is not in the output: " + second.all);
  assert.notEqual(unclaimedId, id, "the fixture made one task twice");
  const unclaimedFile = join(root, "tasks", readdirSync(join(root, "tasks")).find((f) => f.startsWith(unclaimedId)));
  const nobody = (readFileSync(unclaimedFile, "utf8").match(/^owner:\s*(\S+)\s*$/m) || [])[1] || "";

  commit(root, "the backlog, before anybody took anything");

  assert.equal(git(root, ["checkout", "-q", "-b", "tl-1-work"]).code, 0);
  const taken = cli(root, state, ["take", id, "--dir", ".", "--actor", OWNER]);
  assert.equal(taken.code, 0, taken.all);

  // The code the dead session wrote, and nothing else on this branch.
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "parser.mjs"), "export const " + BRANCH_MARKER + " = 1;\n", "utf8");

  // The question it stopped on, and the answer a person gave afterwards. Both
  // are events; `decide` puts the task back where it came from, so the fixture
  // ends with the task in progress and its answer in the log rather than in the
  // conversation that is gone.
  const asked = cli(root, state, [
    "ask", id, "--dir", ".", "--actor", OWNER,
    "--question", QUESTION_MARKER + "?",
    "--option", "One file", "--option", "Two files", "--recommend", "1",
  ]);
  assert.equal(asked.code, 0, asked.all);
  const rows = readFileSync(join(root, "history", id + ".jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const question = rows.filter((e) => e.field === "__comment__").pop();
  assert.ok(question, "the fixture did not record a question to answer");
  const decided = cli(root, state, [
    "decide", id, "--dir", ".", "--actor", ANSWERED_BY, "--resolves", question.id, "--choose", "2",
  ]);
  assert.equal(decided.code, 0, decided.all);
  commit(root, id + " work in progress, and the question it stopped on");

  // `main` moves while the session is dead. This is the whole reason the diff
  // has a merge base to be taken against.
  assert.equal(git(root, ["checkout", "-q", "main"]).code, 0);
  writeFileSync(join(root, "unrelated.txt"), FOREIGN_MARKER + "\n", "utf8");
  commit(root, "somebody else's commit, on main, after the session died");
  assert.equal(git(root, ["checkout", "-q", "tl-1-work"]).code, 0);

  return { root, state, id, file, unclaimedId, unclaimedFile, nobody };
}

function withFixture(fn) {
  const f = fixture();
  try {
    return fn(f);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
    rmSync(f.state, { recursive: true, force: true });
  }
}

const resume = (f, args = []) => cli(f.root, f.state, ["resume", f.id, "--dir", ".", "--actor", OWNER, ...args]);

/** Where a heading starts, or -1. Its FIRST occurrence: a briefing may quote a
 *  task file that carries `## Goal` of its own, and the quote comes after the
 *  heading that introduces it. */
function headingAt(text, heading) {
  const m = new RegExp("^" + heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$", "m").exec(text);
  return m ? m.index : -1;
}

/** The text UNDER one heading, up to the next one in the fixed order. */
function section(text, heading) {
  const i = HEADINGS.indexOf(heading);
  const start = headingAt(text, heading);
  assert.notEqual(start, -1, "the briefing has no `" + heading + "` section:\n" + text);
  let end = text.length;
  for (const later of HEADINGS.slice(i + 1)) {
    const at = headingAt(text, later);
    if (at > start) { end = at; break; }
  }
  return text.slice(start + heading.length, end);
}

/** Every file in the repository, by content — `.git` excluded, since a read of
 *  a git object updates nothing a task's state depends on. */
function treeSnapshot(root) {
  const out = {};
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === ".git") continue;
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(root, p)] = createHash("sha256").update(readFileSync(p)).digest("hex");
    }
  };
  walk(root);
  return out;
}

test("POSITIVE CONTROL: the fixture tells a merge-base diff from a diff against main's tip", () => {
  withFixture((f) => {
    const tip = git(f.root, ["diff", "main", "HEAD"]);
    const base = git(f.root, ["diff", "main...HEAD"]);
    assert.equal(tip.code, 0, tip.stderr);
    assert.equal(base.code, 0, base.stderr);
    // Both must carry the branch's own work, or the fixture proves nothing
    // about what a diff omits.
    assert.match(tip.stdout, new RegExp(BRANCH_MARKER));
    assert.match(base.stdout, new RegExp(BRANCH_MARKER));
    // And exactly one of them drags in the foreign commit. THIS is the
    // difference every merge-base assertion below rests on.
    assert.match(tip.stdout, new RegExp(FOREIGN_MARKER), "main's move is invisible even to a tip diff");
    assert.doesNotMatch(base.stdout, new RegExp(FOREIGN_MARKER));
  });
});

test("POSITIVE CONTROL: the fixture's contract is red before the flip and green after it", () => {
  withFixture((f) => {
    const red = cli(f.root, f.state, ["done", f.id, "--dry-run", "--dir", ".", "--actor", OWNER]);
    assert.equal(red.code, 1, red.all);
    assert.match(red.all, /the-flip/);

    writeFileSync(join(f.root, "built.txt"), "", "utf8");
    const green = cli(f.root, f.state, ["done", f.id, "--dry-run", "--dir", ".", "--actor", OWNER]);
    assert.equal(green.code, 0, green.all);
  });
});

test("the briefing carries every part, in the fixed order, each in its own section", () => {
  withFixture((f) => {
    const r = resume(f);
    // A briefing is a REPORT, not a gate: a failing contract is the most
    // important thing it has to say, and an exit code that made a successor
    // treat the report itself as a failure would lose it.
    assert.equal(r.code, 0, r.all);

    const at = HEADINGS.map((h) => headingAt(r.stdout, h));
    HEADINGS.forEach((h, i) => assert.notEqual(at[i], -1, "the briefing has no `" + h + "`:\n" + r.stdout));
    for (let i = 1; i < at.length; i++) {
      assert.ok(at[i - 1] < at[i],
        "`" + HEADINGS[i] + "` came before `" + HEADINGS[i - 1] + "` — the order IS the briefing");
    }

    assert.match(section(r.stdout, HEADINGS[0]), new RegExp(QUESTION_MARKER));
    assert.match(section(r.stdout, HEADINGS[0]), /Two files/, "the answer is missing from the decision");
    assert.match(section(r.stdout, HEADINGS[1]), new RegExp(GOAL_MARKER));
    assert.match(section(r.stdout, HEADINGS[3]), new RegExp(BRANCH_MARKER));
    assert.match(section(r.stdout, HEADINGS[4]), /the-flip/);
  });
});

test("what happened since the take is named with its actor", () => {
  withFixture((f) => {
    const r = resume(f);
    assert.equal(r.code, 0, r.all);
    const since = section(r.stdout, HEADINGS[2]);
    // A person answered the question after the session took the task. A
    // successor that cannot see WHO cannot tell an answer it must honour from
    // a change it may undo.
    assert.match(since, new RegExp(ANSWERED_BY), "the briefing does not say who acted since the take");
  });
});

test("the diff is against the merge base, so main's own movement stays out of it", () => {
  withFixture((f) => {
    const r = resume(f);
    assert.equal(r.code, 0, r.all);
    assert.match(section(r.stdout, HEADINGS[3]), new RegExp(BRANCH_MARKER));
    assert.doesNotMatch(r.stdout, new RegExp(FOREIGN_MARKER),
      "somebody else's commit on main was reported as this session's work");
  });
});

test("POSITIVE CONTROL: the contract is re-run, so the same task briefs red then green", () => {
  withFixture((f) => {
    const red = resume(f);
    assert.equal(red.code, 0, red.all);
    const failing = section(red.stdout, HEADINGS[4]);
    assert.match(failing, /the-flip/);
    assert.match(failing, /fail/i, "the briefing did not show the failing entry:\n" + red.stdout);

    // The world changes; the task file and its history do not. A verdict read
    // out of a store cannot move, and a verdict from a fresh run must.
    writeFileSync(join(f.root, "built.txt"), "", "utf8");
    const green = resume(f);
    assert.equal(green.code, 0, green.all);
    const passing = section(green.stdout, HEADINGS[4]);
    assert.match(passing, /the-flip/);
    assert.doesNotMatch(passing, /fail/i, "a stale failing verdict survived the fix:\n" + green.stdout);
  });
});

test("--no-verify states the omission before anything else, and prints no verdict", () => {
  withFixture((f) => {
    const r = resume(f, ["--no-verify"]);
    assert.equal(r.code, 0, r.all);

    const first = r.stdout.split("\n").find((l) => l.trim().length) || "";
    assert.match(first, /--no-verify/, "the omission is not the first thing on the page: " + first);
    assert.match(first, /not run/i, "the first line does not say the contract was skipped: " + first);
    assert.ok(r.stdout.indexOf(first) < headingAt(r.stdout, HEADINGS[0]),
      "the disclaimer came after the briefing had already started");

    // Silence is the only honest answer here. An old result printed again under
    // disclaimer is still an old result, and it is what a hurried reader acts on.
    assert.doesNotMatch(r.stdout, /the-flip/, "--no-verify printed a contract result anyway");
  });
});

test("resume writes nothing: the tree is byte-identical afterwards", () => {
  withFixture((f) => {
    const before = treeSnapshot(f.root);
    const status = git(f.root, ["status", "--porcelain"]).stdout;

    const r = resume(f);
    assert.equal(r.code, 0, r.all);

    assert.deepEqual(treeSnapshot(f.root), before,
      "`resume` changed the repository — it composes reads, and deleting nothing " +
      "has to be possible because nothing was written");
    assert.equal(git(f.root, ["status", "--porcelain"]).stdout, status);
  });
});

test("a different actor is refused and pointed at the takeover path", () => {
  withFixture((f) => {
    const before = treeSnapshot(f.root);
    const r = cli(f.root, f.state, ["resume", f.id, "--dir", ".", "--actor", STRANGER]);

    assert.equal(r.code, 1, "a stranger's resume was not refused:\n" + r.all);
    assert.match(r.all, new RegExp(OWNER), "the refusal does not name who holds the task");
    // Taking an abandoned task over is a decision with a stated window, and it
    // already has a command. A second, quieter route to the same effect is
    // exactly what this refusal exists to prevent, so it must SAY where the
    // loud one is.
    assert.match(r.all, /abandoned_after_days/, "the refusal does not point at the takeover path");
    assert.deepEqual(treeSnapshot(f.root), before, "a refused resume still wrote to the tree");
  });
});

/**
 * WHO COUNTS AS NOBODY (TL-151).
 *
 * `resume` refuses a stranger because a briefing must not become a second,
 * quieter takeover path. That refusal is only correct while it can tell a task
 * SOMEBODY holds from a task NOBODY holds, and `owner:` does not answer that
 * with a presence check: the tool writes a WORD for "unassigned" into the field
 * rather than leaving it empty, so the field is never blank and every unclaimed
 * task looks held.
 *
 * The three tests below are one argument. The control establishes that the
 * fixture carries both states and that the tool's OTHER commands read the word
 * as nobody; the second asks `resume` the same question; the third asks whether
 * the way out a refusal offers is one the tool would accept.
 */
test("POSITIVE CONTROL: the fixture holds a task nobody took, beside one somebody does", () => {
  withFixture((f) => {
    // TWO DIFFERENT WORDS, and neither is invented here — both are read back
    // out of files the tool itself wrote. The worked-on task's field was
    // CLEARED by `ask`, which is exactly why its claimant has to be recovered
    // from the log; the unclaimed one's carries the word `new` puts there.
    const parked = (readFileSync(f.file, "utf8").match(/^owner:\s*(.*)$/m) || [])[1].replace(/"/g, "").trim();
    assert.equal(parked, "",
      "the fixture's worked-on task still names an owner in its file, so `owner:` answers the " +
      "question directly and the pair below measures nothing");
    assert.ok(f.nobody, "the fixture's unclaimed task has an empty `owner:` too, so nothing below is measured");

    // AND THE WORD IS NOT A CLAIM, by the tool's own reading of it: `take`
    // hands the unclaimed task to a stranger without an argument. Without this
    // line the test below would be asserting a preference; with it, it is
    // asserting that two commands disagree about one field.
    const taken = cli(f.root, f.state, ["take", f.unclaimedId, "--dir", ".", "--actor", STRANGER]);
    assert.equal(taken.code, 0,
      "`owner: " + f.nobody + "` blocked a take, so it IS a claim and there is no defect to prove:\n" + taken.all);

    // AND THE REFUSAL REALLY FIRES where there is a claim: the worked-on task
    // turns a stranger away. Without this line the next test would be green
    // against a `resume` that had simply stopped refusing anybody.
    const refused = cli(f.root, f.state, ["resume", f.id, "--dir", ".", "--actor", STRANGER, "--no-verify"]);
    assert.equal(refused.code, 1, "the held task did not refuse a stranger, so refusals are not being measured:\n" + refused.all);
  });
});

test("a task nobody holds is briefed, not refused", () => {
  withFixture((f) => {
    // `--no-verify` because the contract is not what this asks about: the
    // unclaimed task still carries the template's placeholder command, and
    // running it would make the assertion depend on the observer's shell.
    const r = cli(f.root, f.state, ["resume", f.unclaimedId, "--dir", ".", "--actor", STRANGER, "--no-verify"]);

    assert.equal(r.code, 0,
      "a task with `owner: " + f.nobody + "` was refused to " + STRANGER + ". Nobody holds it, " +
      "so there is no claim to take over and no one to ask:\n" + r.all);
    for (const heading of HEADINGS) {
      assert.notEqual(headingAt(r.stdout, heading), -1,
        "the answer is not a briefing — `" + heading + "` is missing:\n" + r.stdout);
    }
  });
});

test("a refusal never names an actor the tool itself would reject", () => {
  withFixture((f) => {
    const routes = [];
    for (const target of [f.id, f.unclaimedId]) {
      const r = cli(f.root, f.state,
        ["resume", target, "--dir", ".", "--actor", STRANGER, "--no-verify", "--json"]);
      if (r.code === 0) continue;

      const answer = JSON.parse(r.stdout);
      assert.equal(answer.refusalKind, "other-owner", target + ": refused for another reason:\n" + r.stdout);
      const remedy = (answer.details.join(" ").match(/`--actor ([^`]+)`/) || [])[1];
      assert.ok(remedy, target + ": the refusal points at no actor at all:\n" + r.stdout);
      routes.push(remedy);

      // THE WAY OUT HAS TO BE A WAY OUT. A refusal that hands back a word the
      // next invocation rejects as a usage error leaves the successor with
      // nothing to do, which is worse than the refusal saying less.
      const retry = cli(f.root, f.state, ["resume", target, "--dir", ".", "--actor", remedy, "--no-verify"]);
      assert.notEqual(retry.code, 2,
        target + ": the refusal's own remedy `--actor " + remedy + "` is not an actor:\n" + retry.all);
    }
    // POSITIVE CONTROL: a run that refused nothing checked nothing.
    assert.ok(routes.length > 0, "no resume was refused, so no remedy was examined");
  });
});

test("--json answers in the envelope, with the parts in the same order", () => {
  withFixture((f) => {
    const r = resume(f, ["--json"]);
    assert.equal(r.code, 0, r.all);

    let parsed;
    try {
      parsed = JSON.parse(r.stdout);
    } catch (e) {
      // A contract that runs child processes has to keep their output off this
      // stream, or the fourth law's extension surface is unparseable.
      assert.fail("`resume --json` did not print one JSON document: " + e.message + "\n" + r.stdout);
    }
    assert.equal(parsed.schemaVersion, SCHEMA_VERSION);
    assert.equal(parsed.kind, "resume");

    // The kind is DECLARED, not invented at the emitter: that declaration is
    // what makes an absent part `null` rather than a missing key, and a missing
    // key indistinguishable from an older tool (TL-72).
    const declared = KINDS.resume;
    assert.ok(declared, "`resume` is not a declared kind in the envelope");
    for (const key of Object.keys(declared)) {
      assert.ok(key in parsed, "the declared key `" + key + "` is absent from the answer");
    }

    // Order is the product in JSON too — a consumer rendering the briefing gets
    // it from the key order or has to re-derive a sequence this tool already knows.
    const parts = ["decisions", "goal", "history", "diff", "verification"];
    const keys = Object.keys(declared);
    let previous = -1;
    for (const part of parts) {
      const at = keys.indexOf(part);
      assert.notEqual(at, -1, "the `resume` kind declares no `" + part + "`");
      assert.ok(at > previous, "`" + part + "` is declared out of the briefing's order");
      previous = at;
    }
  });
});
