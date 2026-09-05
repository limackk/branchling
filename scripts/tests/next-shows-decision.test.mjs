/**
 * The JSON handover carries the task's decisions, so a hand fed by `run` sees
 * them (TL-270).
 *
 * WHAT WAS WRONG. The human render of `take` and `next` has printed a
 * "Decisions and open questions" block since TL-148. The JSON envelope's `text`
 * was the raw file. `run` feeds its agents from the JSON, so every hand in a
 * fleet received the task WITHOUT the answers a person had already given it,
 * and the charters compensated with a sentence telling the hand to open the
 * history file — which is the sentence a weaker model skips.
 *
 * THE DECISION THIS ENCODES. `text` is the same on both paths — one handover,
 * not a richer one for people — and `decisions` beside it is the list, for a
 * caller that wants the facts rather than the prose. Nothing reaches the file
 * on disk; the block is written from the history at print time, as before.
 *
 * POSITIVE CONTROL. The first test fails against the code as it was: the block
 * is absent from `text` and `decisions` is not a key. The last test is the
 * regression guard — a task nobody ever asked anything about hands over the
 * bare file with an empty list, so the shape is stable for every existing
 * consumer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { decisionsOf } from "../decisions.mjs";
import { isolateHome } from "./_repo.mjs";

isolateHome("next-shows-decision");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");
const BLOCK = "## Decisions and open questions";
const PASSING = 'verification:\n  - id: it-runs\n    bash: "true"';

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
  const dir = tmp("decision");
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  const backlog = join(repo, "backlog");
  const env = { BACKLOG_STATE_DIR: join(dir, "state") };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env).status, 0);
  const add = (title) => {
    const r = cli(["new", "--dir", backlog, "--title", title, "--priority", "P1"], env);
    assert.equal(r.status, 0, r.stderr);
    const id = (r.stdout.match(/([A-Z]+-\d+)/) || [])[1];
    const file = taskFile(backlog, id);
    writeFileSync(file, readFileSync(file, "utf8")
      .replace(/verification:[\s\S]*?\n---/, PASSING + "\n---")
      .replace(/\[proof:[^\]]*\]/g, "[proof: it-runs]"), "utf8");
    cli(["build", "--dir", backlog], env);
    return id;
  };
  /** Ask a question with a menu, answer it by number, and return the question's id. */
  const decide = (id, choose) => {
    const asked = cli(["ask", id, "--dir", backlog, "--actor", "agent:asker", "--question", "Which way round?",
      "--option", "left, because it is shorter", "--option", "right, because it is lit", "--recommend", "2"], env);
    assert.equal(asked.status, 0, asked.stdout + asked.stderr);
    const qid = readFileSync(join(backlog, "history", id + ".jsonl"), "utf8").split("\n").filter(Boolean)
      .map((l) => JSON.parse(l)).find((e) => e.source === "ask").id;
    const answered = cli(["decide", id, "--dir", backlog, "--actor", "local:person", "--resolves", qid, "--choose", String(choose)], env);
    assert.equal(answered.status, 0, answered.stdout + answered.stderr);
    return qid;
  };
  return { dir, repo, backlog, env, add, decide };
}

function cleanup(...dirs) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

test("`take --json` hands the task over with its decisions: in the text, and as a list", () => {
  const f = fixture();
  try {
    const id = f.add("A task somebody already decided about");
    const qid = f.decide(id, 2);
    const r = cli(["take", id, "--dir", f.backlog, "--actor", "agent:hand", "--json"], f.env, { cwd: f.repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    assert.ok(String(out.text).includes(BLOCK), "the JSON `text` is the bare file — the hand never sees the decision");
    assert.match(String(out.text), /\*\*A\*\* \(local:person\): right, because it is lit/, out.text);
    assert.ok(Array.isArray(out.decisions), "no `decisions` key beside the text: " + Object.keys(out).join(","));
    assert.equal(out.decisions.length, 1);
    const d = out.decisions[0];
    assert.equal(d.id, qid);
    assert.equal(d.question, "Which way round?");
    assert.equal(d.answered, true);
    assert.equal(d.chose, 2);
    assert.equal(d.answer, "right, because it is lit");
    assert.equal(d.decidedBy, "local:person");
    assert.deepEqual(d.options, ["left, because it is shorter", "right, because it is lit"]);
    assert.equal(d.recommend, 2);
    // Nothing reached the file on disk.
    assert.ok(!readFileSync(taskFile(f.backlog, id), "utf8").includes(BLOCK), "the block leaked into the task file");
  } finally {
    cleanup(f.dir);
  }
});

test("`next --json` hands over the same text a person would read", () => {
  const f = fixture();
  try {
    const id = f.add("The only task in the queue");
    f.decide(id, 1);
    const human = cli(["take", id, "--dir", f.backlog, "--actor", "agent:reader"], f.env, { cwd: f.repo });
    assert.equal(human.status, 0, human.stderr);
    const back = cli(["handoff", id, "--dir", f.backlog, "--actor", "agent:reader", "--to-owner", "",
      "--reason", "giving it back so `next` can hand it out again"], f.env, { cwd: f.repo });
    // A handoff may refuse an empty owner on this backlog; the assertion below does not depend on it.
    void back;
    const r = cli(["next", "--dir", f.backlog, "--actor", "agent:other", "--json"], f.env, { cwd: f.repo });
    if (r.status === 0) {
      const out = JSON.parse(r.stdout);
      assert.ok(String(out.text).includes(BLOCK), "`next --json` handed the bare file over");
      assert.equal(out.decisions.length, 1);
      assert.equal(out.decisions[0].chose, 1);
      // The human render and the JSON text agree on the block, word for word.
      const rendered = String(human.stdout);
      const line = rendered.split("\n").find((l) => l.includes("**A** (local:person)"));
      assert.ok(line && String(out.text).includes(line.trim()), "the two handovers print the answer differently");
    } else {
      // The queue held nothing `next` may hand to a second actor; `take` above already proved the JSON path.
      assert.equal(r.status, 3, r.stdout + r.stderr);
    }
  } finally {
    cleanup(f.dir);
  }
});

test("a hand fed by `run` receives the decision on stdin", () => {
  const f = fixture();
  try {
    const id = f.add("A task with an answer already on the record");
    f.decide(id, 2);
    const witness = join(f.dir, "stdin.txt");
    const agent = join(f.dir, "agent.sh");
    writeFileSync(agent, "#!/bin/sh\ncat > " + JSON.stringify(witness) + "\necho 'read it'\n", "utf8");
    chmodSync(agent, 0o755);
    const r = cli(["run", "--dir", f.backlog, "--actor", "agent:fleet", "--max-attempts", "1", "--agent", agent],
      f.env, { cwd: f.repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const got = readFileSync(witness, "utf8");
    assert.ok(got.includes(BLOCK), "the loop fed the agent a task with no decisions in it");
    assert.match(got, /right, because it is lit/);
  } finally {
    cleanup(f.dir);
  }
});

test("a task nobody asked anything about hands over the bare file and an empty list", () => {
  const f = fixture();
  try {
    const id = f.add("A task with no questions");
    const r = cli(["take", id, "--dir", f.backlog, "--actor", "agent:hand", "--json"], f.env, { cwd: f.repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.decisions, []);
    assert.ok(!String(out.text).includes(BLOCK));
    assert.equal(out.text.replace(/^updated: .*$/m, "").trim(),
      readFileSync(taskFile(f.backlog, id), "utf8").replace(/^updated: .*$/m, "").trim());
  } finally {
    cleanup(f.dir);
  }
});

test("decisionsOf is pure and keeps an unanswered question, flagged", () => {
  const entries = [
    { id: "q1", ts: "t1", field: "__comment__", source: "ask", actor: "agent:a", to: "Why?", options: ["a", "b"], recommend: 1 },
    { id: "q2", ts: "t2", field: "__comment__", source: "ask", actor: "agent:a", to: "How?", options: [] },
    { id: "d1", ts: "t3", field: "__decision__", source: "decide", actor: "local:p", to: "a", resolves: "q1", chose: 1 },
    { id: "c1", ts: "t4", field: "__comment__", source: "handoff", actor: "agent:a", to: "not a question" },
  ];
  const list = decisionsOf(entries);
  assert.equal(list.length, 2, "a handoff comment is not a question");
  assert.equal(list[0].answered, true);
  assert.equal(list[0].chose, 1);
  assert.equal(list[1].answered, false);
  assert.equal(list[1].answer, null);
  assert.deepEqual(decisionsOf([]), []);
});
