/**
 * A question carries the options it was asked with, and names one (TL-204).
 *
 * WHAT HAS TO BE PROVED, and the control beside each claim:
 *
 *   1. THE MENU REACHES THE EVENT AND NOTHING ELSE. Options and the
 *      recommendation are in the `__comment__` row and the task file gains no
 *      field — the property TL-114 settled and this must not quietly undo.
 *   2. THE ABSENCE IS RECORDED TOO. A bare question writes `options: []`, which
 *      is a different fact from an event written before the field existed. A
 *      test that only checked the menu would pass against a command that wrote
 *      the key only when it was interesting.
 *   3. A CHOSEN ANSWER IS INDISTINGUISHABLE FROM A TYPED ONE. `--choose` writes
 *      the option's TEXT into the same `to` a `--reason` fills, and lifts the
 *      block by the same mechanism — asserting only that the row exists would
 *      pass for a command that recorded a number nobody can read.
 *   4. EVERY REFUSAL IS A REFUSAL. A menu with nothing recommended, a number
 *      pointing at no row, a chosen row with no question named: each fails
 *      BEFORE anything is written, which is checked by counting the log.
 *   5. THE READER SEES IT. The options are in the task file as printed to the
 *      session that picks the task up — the whole complaint the task was
 *      written about.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseAskArgs, resolveOptions } from "../ask-task.mjs";
import { parseDecideArgs } from "../decide-task.mjs";
import { withDecisions } from "../decisions.mjs";
import { REASON_MAX_LENGTH, REASON_SENTINELS } from "../task-fields.mjs";

import { isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("ask-options");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

const SOLID = "take it whole in a fresh session — it is the only option that keeps the merge rule with the dispatcher";
const QUICK = "split it into four tasks — each design then gets its own verification";

let counter = 0;
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-ask-options-" + counter++ + "-"));
  const backlog = join(dir, "bl");
  const env = { ...process.env, BACKLOG_STATE_DIR: join(dir, "state"), NO_COLOR: "1" };
  assert.equal(run(["init", "--dir", backlog, "--no-example"], env).status, 0);
  const r = run(["new", "--dir", backlog, "--title", "The one that asks"], env);
  assert.equal(r.status, 0, r.stderr);
  return { dir, backlog, env, id: (r.stdout.match(/([A-Z]+-\d+)/) || [])[1] };
}

function run(args, env) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, env: env || { ...process.env, NO_COLOR: "1" },
  });
}

const taskText = (backlog, id) => {
  const file = readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-"));
  return readFileSync(join(backlog, "tasks", file), "utf8");
};
// A task nothing has happened to yet has NO history file, and that is zero
// rows rather than an error — the "writes nothing" cases start from there.
const history = (backlog, id) => {
  const file = join(backlog, "history", id + ".jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
};
const comments = (backlog, id) => history(backlog, id).filter((e) => e.field === "__comment__");
const decisions = (backlog, id) => history(backlog, id).filter((e) => e.field === "__decision__");

/** Ask with the two-option menu above, and return the question's event id. */
function askWithOptions(fx, extra = []) {
  const r = run([
    "ask", fx.id, "--dir", fx.backlog, "--actor", "agent:worker", "--json",
    "--question", "a week of work in one task: take it whole, or split it?",
    "--option", SOLID, "--option", QUICK, "--recommend", "1",
  ].concat(extra), fx.env);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

// ── The menu reaches the event, and nothing else ───────────────────────────

test("the options and the recommendation are in the question's event", () => {
  const fx = fixture();
  try {
    const asked = askWithOptions(fx);
    const q = comments(fx.backlog, fx.id).find((e) => e.id === asked.question.id);

    assert.deepEqual(q.options, [SOLID, QUICK], "the menu is not in the event");
    assert.equal(q.recommend, 1, "the recommendation is not in the event");
    // The number is the one a reader types back: options are 1-based at both
    // ends, so the recommended row is the FIRST, not the second.
    assert.equal(q.options[q.recommend - 1], SOLID);

    // NOTHING IS STORED (law 2, TL-114). The task file gains no field for any
    // of it — a menu in the frontmatter would be a second home for the log.
    const text = taskText(fx.backlog, fx.id);
    assert.doesNotMatch(text, /^options:/m);
    assert.doesNotMatch(text, /^recommend/m);
    assert.doesNotMatch(text, /^question:/m);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("asking with NO options is legal, and the event records that none were offered", () => {
  const fx = fixture();
  try {
    const r = run(["ask", fx.id, "--dir", fx.backlog, "--actor", "agent:worker", "--json",
      "--question", "this one genuinely has no menu"], fx.env);
    assert.equal(r.status, 0, r.stderr);

    const q = comments(fx.backlog, fx.id)[0];
    // PRESENT AND EMPTY, not absent: "none were offered" and "written before the
    // field existed" are two different facts, and a review counting bare
    // questions has to be able to tell them apart.
    assert.ok(Object.prototype.hasOwnProperty.call(q, "options"), "the empty menu was not recorded at all");
    assert.deepEqual(q.options, []);
    assert.equal(q.recommend, undefined, "a recommendation appeared with nothing to recommend");
    assert.deepEqual(JSON.parse(r.stdout).question.options, []);
    assert.equal(JSON.parse(r.stdout).question.recommend, null);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("--json carries the menu and which row is recommended", () => {
  const fx = fixture();
  try {
    const out = askWithOptions(fx);
    assert.deepEqual(out.question.options, [SOLID, QUICK]);
    assert.equal(out.question.recommend, 1);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("the menu is printed with the numbers `decide --choose` takes", () => {
  const fx = fixture();
  try {
    const r = run([
      "ask", fx.id, "--dir", fx.backlog, "--actor", "agent:worker",
      "--question", "take it whole, or split it?",
      "--option", SOLID, "--option", QUICK, "--recommend", "1",
    ], fx.env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^\s*1\. take it whole/m);
    assert.match(r.stdout, /^\s*2\. split it into four/m);
    // A WORD, not only a colour — this output is read through pipes and in CI.
    assert.match(r.stdout, /take it whole.*\(recommended\)/);
    assert.match(r.stdout, /decide .* --choose <n>/, "the answer line does not offer the menu");
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

// ── The refusals, none of which may write ──────────────────────────────────

test("a menu with nothing recommended is refused", () => {
  assert.throws(
    () => parseAskArgs(["T-1", "--question", "q", "--option", "one"]),
    /`--recommend <n>` is required once `--option` is given/
  );
});

test("`--recommend` with no options, out of range, or not a number is refused", () => {
  const ask = (...extra) => parseAskArgs(["T-1", "--question", "q"].concat(extra));
  assert.throws(() => ask("--recommend", "1"), /with no options to point at/);
  assert.throws(() => ask("--option", "one", "--recommend", "2"), /names no option — this question has 1/);
  assert.throws(() => ask("--option", "one", "--recommend", "0"), /names no option/);
  assert.throws(() => ask("--option", "one", "--recommend", "x"), /is not an option number/);
});

// `unknown` and `proven` are the tool's own words. A chosen option BECOMES the
// decision's reason, so admitting one here would launder a machine's word into
// somebody's answer at `decide` time, where nothing is left to catch it.
//
// WHAT IS PINNED HERE, AND WHAT IS NOT (TL-167). That each value is refused AT
// THIS BOUNDARY — inside `resolveOptions`, before `ask` has written anything —
// and that the refusal names the cause that fired rather than a rule the value
// does not break. The SENTENCES belong to `reasonRefusal` and are asserted
// once, in `change-reason.test.mjs`. This file used to hold a second copy of
// them, and that copy is how one diagnosis came to be corrected in one place
// and left wrong in another.
test("an option that could not be recorded as a reason is refused", () => {
  // The control: an option that breaks none of the rules is ACCEPTED. Without
  // it every case below is green against a `resolveOptions` that throws at
  // whatever it is handed.
  assert.deepEqual(resolveOptions(["one"], "1"), { options: ["one"], recommend: 1 });

  for (const sentinel of REASON_SENTINELS) {
    assert.throws(() => resolveOptions([sentinel], "1"), (e) => {
      assert.match(e.message, new RegExp("`--option " + sentinel + "` is reserved"));
      assert.doesNotMatch(e.message, /is empty/, "a reserved word is not an empty one");
      return true;
    });
  }

  assert.throws(() => resolveOptions(["   "], "1"), (e) => {
    assert.match(e.message, /`--option` is empty/);
    assert.doesNotMatch(e.message, /reserved/, "a blank option is not one of the tool's own words");
    return true;
  });

  const tooLong = "x".repeat(REASON_MAX_LENGTH + 1);
  assert.throws(() => resolveOptions([tooLong], "1"), (e) => {
    // The two numbers that explain the refusal, and not one word about the
    // rules an over-long option does not break.
    assert.match(e.message, new RegExp("`--option` is " + tooLong.length + " characters long"));
    assert.match(e.message, new RegExp("\\b" + REASON_MAX_LENGTH + "\\b"));
    assert.doesNotMatch(e.message, /is empty|reserved/, "an option of " + tooLong.length + " characters is neither");
    return true;
  });
});

test("the same option twice is refused — choosing between them decides nothing", () => {
  assert.throws(() => resolveOptions(["one", "one"], "1"), /was given twice/);
});

test("a refused `ask` writes nothing at all", () => {
  const fx = fixture();
  try {
    const before = history(fx.backlog, fx.id).length;
    const r = run(["ask", fx.id, "--dir", fx.backlog, "--actor", "agent:worker",
      "--question", "q", "--option", "one"], fx.env);
    assert.equal(r.status, 2, "a menu with no recommendation was accepted");
    assert.equal(history(fx.backlog, fx.id).length, before, "a refused ask left a row behind");
    assert.equal(comments(fx.backlog, fx.id).length, 0);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

// ── Answering by number ────────────────────────────────────────────────────

test("`--choose` records the option's TEXT, so the log reads like a typed answer", () => {
  const fx = fixture();
  try {
    const asked = askWithOptions(fx);
    const r = run(["decide", fx.id, "--dir", fx.backlog, "--actor", "user:kamil",
      "--resolves", asked.question.id, "--choose", "2", "--json"], fx.env);
    assert.equal(r.status, 0, r.stderr);

    const d = decisions(fx.backlog, fx.id)[0];
    // THE ANSWER IS THE SENTENCE, not the number: a reader of the log must not
    // have to resolve a foreign key into another event to know what was decided.
    assert.equal(d.to, QUICK);
    assert.equal(d.reason, QUICK);
    assert.equal(d.resolves, asked.question.id);
    // The number is kept BESIDE it, which is the only way to ask later how often
    // the recommendation was followed.
    assert.equal(d.chose, 2);

    const out = JSON.parse(r.stdout);
    assert.equal(out.decision.text, QUICK);
    assert.deepEqual(out.chosen, { n: 2, of: 2, recommend: 1 });
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("a chosen answer lifts the block exactly as a typed one does", () => {
  const fx = fixture();
  try {
    // Taken first, so the status it returns to is one the history recorded.
    assert.equal(run(["take", fx.id, "--dir", fx.backlog, "--actor", "agent:worker"], fx.env).status, 0);
    const asked = askWithOptions(fx);
    assert.match(taskText(fx.backlog, fx.id), /^status: blocked/m);

    const r = run(["decide", fx.id, "--dir", fx.backlog, "--actor", "user:kamil",
      "--resolves", asked.question.id, "--choose", "1"], fx.env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(taskText(fx.backlog, fx.id), /^status: in_progress/m,
      "answering by number did not lift the block");
    assert.match(r.stdout, /chose option 1 of 2 — the one recommended/);

    // The lift carries the CHOSEN SENTENCE as its reason, like any other answer.
    const rows = history(fx.backlog, fx.id).filter((e) => e.field === "status" && e.to === "in_progress");
    assert.equal(rows[rows.length - 1].reason, SOLID);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("choosing a row that is not the recommended one says so", () => {
  const fx = fixture();
  try {
    const asked = askWithOptions(fx);
    const r = run(["decide", fx.id, "--dir", fx.backlog, "--actor", "user:kamil",
      "--resolves", asked.question.id, "--choose", "2"], fx.env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /chose option 2 of 2 — the recommendation was 1/);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("`--choose` needs the question it indexes, and refuses a second answer beside it", () => {
  const d = (...extra) => parseDecideArgs(["T-1"].concat(extra));
  assert.throws(() => d("--choose", "1"), /with no `--resolves <event id>`/);
  assert.throws(
    () => d("--resolves", "01ARZ3NDEKTSV4RRFFQ69G5FAV", "--choose", "1", "--reason", "also this"),
    /both say what was decided/
  );
  assert.throws(() => d("--resolves", "01ARZ3NDEKTSV4RRFFQ69G5FAV", "--choose", "0"), /is not an option number/);
  assert.throws(() => d("--resolves", "01ARZ3NDEKTSV4RRFFQ69G5FAV", "--choose", "x"), /is not an option number/);
  // The POSITIVE CONTROL: `--reason` alone is still the ordinary way to decide,
  // and `--choose` alone with a question named is accepted.
  assert.equal(d("--reason", "because").reason, "because");
  assert.equal(d("--resolves", "01ARZ3NDEKTSV4RRFFQ69G5FAV", "--choose", "2").choose, 2);
});

test("choosing a row that is not on the menu is refused, and writes nothing", () => {
  const fx = fixture();
  try {
    const asked = askWithOptions(fx);
    const before = history(fx.backlog, fx.id).length;
    const r = run(["decide", fx.id, "--dir", fx.backlog, "--actor", "user:kamil",
      "--resolves", asked.question.id, "--choose", "9"], fx.env);
    assert.equal(r.status, 1, "a number past the end of the menu was accepted");
    assert.match(r.stderr, /names no option/);
    // The refusal PRINTS the menu — the reader's next move is to pick a real row.
    assert.match(r.stderr, /take it whole/);
    assert.equal(history(fx.backlog, fx.id).length, before, "a refused decide left a row behind");
    assert.match(taskText(fx.backlog, fx.id), /^status: blocked/m, "the block was lifted by a refusal");
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("`--choose` on a question asked without options is refused", () => {
  const fx = fixture();
  try {
    const asked = run(["ask", fx.id, "--dir", fx.backlog, "--actor", "agent:worker", "--json",
      "--question", "this one has no menu"], fx.env);
    assert.equal(asked.status, 0, asked.stderr);
    const qid = JSON.parse(asked.stdout).question.id;

    const r = run(["decide", fx.id, "--dir", fx.backlog, "--actor", "user:kamil",
      "--resolves", qid, "--choose", "1"], fx.env);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /asked with no options/);
    assert.equal(decisions(fx.backlog, fx.id).length, 0);

    // POSITIVE CONTROL: the same question answers perfectly well with a reason.
    const typed = run(["decide", fx.id, "--dir", fx.backlog, "--actor", "user:kamil",
      "--resolves", qid, "--reason", "we keep the old prefix"], fx.env);
    assert.equal(typed.status, 0, typed.stderr);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

// ── The reader ─────────────────────────────────────────────────────────────

test("the printed task file carries the menu, with the recommended row marked", () => {
  const entries = [
    { id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", field: "__comment__", actor: "agent:worker",
      to: "take it whole, or split it?", options: [SOLID, QUICK], recommend: 1 },
  ];
  const out = withDecisions("---\nid: T-1\n---\nbody\n", entries);
  assert.match(out, /1\. take it whole.*\*\*\(recommended\)\*\*/);
  assert.match(out, /2\. split it into four/);
  assert.doesNotMatch(out, /2\. split it into four.*recommended/);

  // POSITIVE CONTROL: a question with no menu still renders, and invents none.
  const bare = withDecisions("---\nid: T-1\n---\nbody\n",
    [{ id: "01ARZ3NDEKTSV4RRFFQ69G5FAW", field: "__comment__", actor: "agent:worker", to: "no menu here", options: [] }]);
  assert.match(bare, /no menu here/);
  assert.doesNotMatch(bare, /recommended/);
});

test("the task file printed by `take` shows a waiting question's options", () => {
  const fx = fixture();
  try {
    askWithOptions(fx);
    const r = run(["take", fx.id, "--dir", fx.backlog, "--actor", "agent:second"], fx.env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /## Decisions and open questions/);
    assert.match(r.stdout, /1\. take it whole.*\*\*\(recommended\)\*\*/,
      "the session picking the task up cannot see the options");
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});
