/**
 * `ask` — an agent's open question stops the task until a person decides
 * (TL-148).
 *
 * WHAT HAS TO BE PROVED, and the control beside each claim:
 *
 *   1. THE QUEUE REALLY STOPS. Not "the status changed" but `next` handing out
 *      something else — the status is a means, and asserting on it would pass
 *      against a dispatcher that ignored it.
 *   2. THE ANSWER REALLY LIFTS IT, and only the right answer does. A decision
 *      naming another question leaves the task where it is; without that control
 *      a `decide` that unblocked unconditionally would look identical.
 *   3. IT GOES BACK WHERE IT CAME FROM, read from the history rather than
 *      chosen — a task asked about while `in_progress` returns to `in_progress`.
 *   4. NOTHING IS STORED. The task file gains no field; what a later session
 *      reads is rendered at print time from the log.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { blockingStatus, parseAskArgs } from "../ask-task.mjs";
import { questionBlockReason, questionIdFromReason } from "../history.mjs";
import { staleBlocked } from "../check-backlog-refs.mjs";
import { withDecisions } from "../decisions.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

let counter = 0;
function fixture(titles = ["The one that asks", "The one that follows"]) {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-ask-" + counter++ + "-"));
  const backlog = join(dir, "bl");
  const env = { ...process.env, BACKLOG_STATE_DIR: join(dir, "state"), NO_COLOR: "1" };
  assert.equal(run(["init", "--dir", backlog, "--no-example"], env).status, 0);
  const ids = titles.map((t, i) => {
    const r = run(["new", "--dir", backlog, "--title", t, "--priority", i === 0 ? "P0" : "P2"], env);
    assert.equal(r.status, 0, r.stderr);
    return (r.stdout.match(/([A-Z]+-\d+)/) || [])[1];
  });
  return { dir, backlog, env, ids };
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
const field = (text, key) => (text.match(new RegExp("^" + key + ": (.*)$", "m")) || [])[1];
const history = (backlog, id) =>
  readFileSync(join(backlog, "history", id + ".jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

/** Ask about a task and return the question's event id. */
function ask(fx, id, question = "do we keep the old prefix or migrate?") {
  const r = run(["ask", id, "--dir", fx.backlog, "--actor", "agent:worker", "--question", question, "--json"], fx.env);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).question.id;
}

// ── The queue stops ───────────────────────────────────────────────────────

test("a question moves the task into the protected status, with a reason naming it", () => {
  const fx = fixture();
  try {
    const qid = ask(fx, fx.ids[0]);
    const text = taskText(fx.backlog, fx.ids[0]);
    assert.equal(field(text, "status"), "blocked");
    assert.equal(field(text, "owner"), '""', "a claim was left behind on a task nobody is working");

    const row = history(fx.backlog, fx.ids[0]).find((e) => e.field === "status" && e.to === "blocked");
    assert.equal(row.reason, questionBlockReason(qid), "the block's reason does not name the question");
    assert.equal(questionIdFromReason(row.reason), qid);
    assert.equal(row.actor, "agent:worker");

    // NOTHING IS STORED: no new field appeared in the file.
    assert.doesNotMatch(text, /^question:/m);
    assert.doesNotMatch(text, /^awaiting/m);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("`next` passes over it and hands out the next task instead", () => {
  const fx = fixture();
  try {
    // POSITIVE CONTROL first: before the question, this IS the task `next` gives.
    const first = run(["next", "--dir", fx.backlog, "--actor", "agent:w1", "--json"], fx.env);
    assert.equal(JSON.parse(first.stdout).id, fx.ids[0], "the fixture's priorities stopped meaning anything");

    ask(fx, fx.ids[0]);
    const second = run(["next", "--dir", fx.backlog, "--actor", "agent:w2", "--json"], fx.env);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(JSON.parse(second.stdout).id, fx.ids[1], "a task waiting on an answer was handed out");
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

// ── The answer lifts it, and only the right answer ────────────────────────

test("`decide --resolves` lifts the block and restores the status it came from", () => {
  const fx = fixture();
  try {
    // Taken first, so the status it returns to is one the history recorded and
    // not the only one the vocabulary offers.
    assert.equal(run(["next", "--dir", fx.backlog, "--actor", "agent:w1", "--json"], fx.env).status, 0);
    assert.equal(field(taskText(fx.backlog, fx.ids[0]), "status"), "in_progress");

    const qid = ask(fx, fx.ids[0]);
    const r = run(["decide", fx.ids[0], "--dir", fx.backlog, "--actor", "user:kamil",
      "--resolves", qid, "--reason", "migrate: the old prefix is not worth the tooling"], fx.env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /the block is lifted — blocked . in_progress/);
    assert.equal(field(taskText(fx.backlog, fx.ids[0]), "status"), "in_progress",
      "the task did not go back where it came from");

    // The lift is a recorded change with the DECISION as its reason.
    const rows = history(fx.backlog, fx.ids[0]).filter((e) => e.field === "status" && e.to === "in_progress");
    assert.match(rows[rows.length - 1].reason, /migrate: the old prefix/);
    assert.equal(rows[rows.length - 1].actor, "user:kamil");
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("a decision naming a NON-MATCHING event leaves the task blocked", () => {
  const fx = fixture();
  try {
    ask(fx, fx.ids[0], "which of the two?");
    // A real event id that is not the question: the row `ask` itself wrote when
    // it moved the status. `--resolves` demands an event that exists, so this is
    // the shape of a wrong answer that gets past every other check.
    const other = history(fx.backlog, fx.ids[0]).find((e) => e.field === "status" && e.to === "blocked").id;
    const r = run(["decide", fx.ids[0], "--dir", fx.backlog, "--actor", "user:kamil",
      "--resolves", other, "--reason", "an answer to something else entirely"], fx.env);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(field(taskText(fx.backlog, fx.ids[0]), "status"), "blocked",
      "a decision naming another event lifted the block");
    assert.doesNotMatch(r.stdout, /the block is lifted/);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("two questions need two answers — one of them does not lift the block", () => {
  const fx = fixture();
  try {
    const first = ask(fx, fx.ids[0], "the first question");
    const second = ask(fx, fx.ids[0], "the second question");
    assert.notEqual(first, second, "two questions with different text collapsed into one");

    // Answering only ONE of the two: the task is still waiting on the other.
    const r = run(["decide", fx.ids[0], "--dir", fx.backlog, "--actor", "user:kamil",
      "--resolves", first, "--reason", "one of the two answered"], fx.env);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(field(taskText(fx.backlog, fx.ids[0]), "status"), "blocked",
      "one answer of two lifted a block the task is still waiting behind");
    assert.doesNotMatch(r.stdout, /the block is lifted/);

    // …and answering the last open one does lift it.
    const good = run(["decide", fx.ids[0], "--dir", fx.backlog, "--actor", "user:kamil",
      "--resolves", second, "--reason", "and the other one too"], fx.env);
    assert.equal(good.status, 0, good.stderr);
    assert.equal(field(taskText(fx.backlog, fx.ids[0]), "status"), "pending");
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

// ── What the next session reads ───────────────────────────────────────────

test("the next `next` prints the decision inside the file, above the body", () => {
  const fx = fixture();
  try {
    const qid = ask(fx, fx.ids[0], "which of the two shapes do we take?");
    assert.equal(run(["decide", fx.ids[0], "--dir", fx.backlog, "--actor", "local:kamil",
      "--resolves", qid, "--reason", "take the second shape"], fx.env).status, 0);

    const r = run(["next", "--dir", fx.backlog, "--actor", "agent:w2"], fx.env);
    assert.equal(r.status, 0, r.stderr);
    const out = r.stdout;
    assert.match(out, /## Decisions and open questions/);
    assert.match(out, /which of the two shapes do we take\?/);
    assert.match(out, /take the second shape/);
    // ABOVE the body: the decisions block comes before the first heading of the
    // task itself, which is what "the section read first" means.
    assert.ok(out.indexOf("## Decisions and open questions") < out.indexOf("## Goal"),
      "the decisions were printed below the body");

    // And the FILE is untouched — the block is print time only.
    assert.doesNotMatch(taskText(fx.backlog, fx.ids[0]), /## Decisions and open questions/);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

// ── Refusals ──────────────────────────────────────────────────────────────

test("a bare actor is refused, and so is a question about a closed task", () => {
  const fx = fixture();
  try {
    const bare = run(["ask", fx.ids[0], "--dir", fx.backlog, "--actor", "worker", "--question", "x?"], fx.env);
    assert.equal(bare.status, 2);
    assert.match(bare.stderr, /namespace/);
    assert.equal(field(taskText(fx.backlog, fx.ids[0]), "status"), "pending", "the file moved on a refusal");

    // POSITIVE CONTROL: the same call with a namespace works.
    assert.equal(run(["ask", fx.ids[0], "--dir", fx.backlog, "--actor", "agent:w", "--question", "x?"], fx.env).status, 0);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("no `--question` is a usage error — a stop nobody can answer is not a stop", () => {
  assert.throws(() => parseAskArgs(["TL-1"]), /--question. is required/);
  assert.throws(() => parseAskArgs(["TL-1", "--question", "unknown"]), /reserved/);
  assert.throws(() => parseAskArgs(["--question", "x?"]), /no task id/);
  assert.equal(parseAskArgs(["TL-1", "--question", "x?"]).question, "x?");
});

// ── The guard reads the question as a premise (TL-134 extended) ───────────

test("a question-block is a premise; the answered one is reported, the empty one is not", () => {
  const config = { archivedStatuses: ["done"], reasonRequiredStatuses: ["blocked"] };
  const tasks = [{ id: "T-1", file: "T-1.md", status: "blocked", blocked_by: [] }];

  const open = new Map([["T-1", { question: "01ABC", open: true }]]);
  assert.deepEqual(staleBlocked(tasks, config, open), [], "a task waiting on a real question was reported");

  const answered = new Map([["T-1", { question: "01ABC", open: false }]]);
  const found = staleBlocked(tasks, config, answered);
  assert.equal(found.length, 1, "an answered question left the task blocked and nobody said so");
  assert.equal(found[0].question, "01ABC");

  // Unchanged: no premise at all is still nobody's business — the tool cannot
  // observe a decision or another team arriving.
  assert.deepEqual(staleBlocked(tasks, config, new Map()), []);
  // Unchanged: every stated blocker closed is still the defect TL-134 caught.
  const withBlockers = [
    { id: "T-1", file: "T-1.md", status: "blocked", blocked_by: ["T-2"] },
    { id: "T-2", file: "T-2.md", status: "done", blocked_by: [] },
  ];
  assert.deepEqual(staleBlocked(withBlockers, config, new Map()).map((t) => t.id), ["T-1"]);
});

// ── The pure parts ────────────────────────────────────────────────────────

test("the blocking status is DERIVED from the project's own vocabulary", () => {
  assert.deepEqual(blockingStatus({ reasonRequiredStatuses: ["parked"], archivedStatuses: [] }, null),
    { status: "parked" });
  // Archived statuses need a reason too and are not somewhere to wait.
  assert.deepEqual(blockingStatus({ reasonRequiredStatuses: ["parked", "abandoned"], archivedStatuses: ["abandoned"] }, null),
    { status: "parked" });
  // Two candidates is a question only the project can settle.
  assert.deepEqual(blockingStatus({ reasonRequiredStatuses: ["parked", "held"], archivedStatuses: [] }, null),
    { ambiguous: ["parked", "held"] });
  assert.deepEqual(blockingStatus({ reasonRequiredStatuses: ["parked", "held"], archivedStatuses: [] }, "held"),
    { status: "held" });
  assert.equal(blockingStatus({ reasonRequiredStatuses: ["parked"], archivedStatuses: [] }, "nonsense").unknown, "nonsense");
});

test("the reason is a sentence a person reads AND an id the tool matches", () => {
  const id = "01J8ZQ0000000000000000000A";
  assert.match(questionBlockReason(id), /^waiting for an answer to /);
  assert.equal(questionIdFromReason(questionBlockReason(id)), id);
  assert.equal(questionIdFromReason("blocked on the release"), null);
  assert.equal(questionIdFromReason("waiting for an answer to not-an-id"), null);
  assert.equal(questionIdFromReason(null), null);
});

test("withDecisions places the block under the frontmatter and writes nothing without one", () => {
  const file = "---\nid: T-1\nstatus: pending\n---\n\n## Goal\n\nx\n";
  assert.equal(withDecisions(file, []), file, "a task with no history grew a section anyway");

  const q = { id: "Q1", field: "__comment__", to: "which one?", actor: "agent:w" };
  const a = { id: "D1", field: "__decision__", to: "the second", actor: "user:k", resolves: "Q1" };
  const out = withDecisions(file, [q, a]);
  assert.ok(out.indexOf("## Decisions and open questions") < out.indexOf("## Goal"));
  assert.ok(out.startsWith("---\nid: T-1\nstatus: pending\n---\n"), "the frontmatter was disturbed");
  assert.match(out, /\*\*Q\*\* \(agent:w\): which one\?/);
  assert.match(out, /\*\*A\*\* \(user:k\): the second/);

  // An unanswered question is shown too, with its id — that id is what an
  // answer has to name.
  assert.match(withDecisions(file, [q]), /unanswered — `Q1`/);
});
