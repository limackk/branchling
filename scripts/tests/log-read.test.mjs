/**
 * Reading a task's recorded exchanges back (TL-256).
 *
 * WHAT HAS TO BE PROVED, and why each part needs a control of its own:
 *
 *   1. THE FOLD IS A FOLD. One write produces one row. The assertion that
 *      matters is not "the command printed something" but that the REASON — the
 *      expensive part, a paragraph stored verbatim on every field a handoff
 *      moved — appears ONCE in the answer while the log holds it once per field.
 *      A count, not a match: `assert.match` would pass just as well on the raw
 *      file printed unchanged, which is the defect this command replaces.
 *   2. NOTHING IS LOST. Folding is a rendering, so every field that moved is
 *      still named and every distinct message still reaches the reader. A
 *      cheaper answer that dropped half the log would satisfy 1 perfectly.
 *   3. A TASK WITH NO LOG IS AN ANSWER. Exit 0 with an empty list, not an
 *      error: "nothing was decided" is a fact, and a non-zero exit would make a
 *      loop treat it as a failure to retry.
 *   4. IT WRITES NOTHING. The command reads an append-only log; a read that
 *      left a byte behind would be the one defect nobody could undo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { foldExchanges } from "../log-task.mjs";
import { SCRIPTS_DIR, isolateHome, plainOutput } from "./_repo.mjs";

isolateHome("log-read");
plainOutput();

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function run(args, input) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8", timeout: 60_000, input, env: { ...process.env, NO_COLOR: "1" },
  });
}

/** A backlog with one task, inside a real repository. */
function fixture() {
  const repo = mkdtempSync(join(tmpdir(), "branchling-log-"));
  execFileSync("git", ["init", "-q", "-b", "main", "."], { cwd: repo, stdio: "ignore" });
  const dir = join(repo, "backlog");
  assert.equal(run(["init", "--dir", dir, "--no-example"]).status, 0, "init failed");
  const made = run(["new", "--dir", dir, "--title", "A task that changes hands", "--priority", "P1"]);
  assert.equal(made.status, 0, made.stderr);
  const id = JSON.parse(run(["query", "--dir", dir, "--json"]).stdout).tasks[0].id;
  return { repo, dir, id };
}

/**
 * One exchange of the kind this command exists for: a task claimed and handed
 * back with a stated reason. Two writes, and the second stores its reason on
 * every field it moved plus the comment it leaves behind.
 *
 * THE ROLE IS NOT USED. A freshly initialised backlog declares no `roles:`, and
 * a test that declared some would be asserting a vocabulary this project made
 * up — the thing law 3 forbids. Owner and status carry the handoff just as well.
 */
function handOver(fx, actor, reason) {
  const took = run(["take", fx.id, "--dir", fx.dir, "--actor", actor]);
  assert.equal(took.status, 0, took.stderr);
  const gave = run(["handoff", fx.id, "--dir", fx.dir, "--to-owner", "unassigned",
    "--reason", reason, "--actor", actor]);
  assert.equal(gave.status, 0, gave.stderr);
}

/**
 * The paragraph a handoff stores on every field it moves. Long on purpose: the
 * whole measurement is that a reader pays for it once rather than four times,
 * and a three-word reason would make the difference unmeasurable.
 */
const PARAGRAPH =
  "the failing test is written and the code is another hand's; " +
  "retiring the stale assertion needs somebody entitled to edit tests, " +
  "so this goes back to the queue rather than being forced through here";

/** How many times a string occurs in another. */
function occurrences(haystack, needle) {
  let n = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) { n++; at = haystack.indexOf(needle, at + needle.length); }
  return n;
}

/** Every file under a directory, with its bytes — for the "wrote nothing" control. */
function snapshot(dir) {
  const out = {};
  const walk = (d, prefix) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full, prefix + name + "/");
      else out[prefix + name] = readFileSync(full, "utf8");
    }
  };
  walk(dir, "");
  return out;
}

// ── The fold itself, without a directory ──────────────────────────────────

test("entries from ONE write become ONE exchange, with the reason once", () => {
  const write = { ts: "2026-09-04T13:21:03.816Z", actor: "agent:spec", source: "handoff", reason: PARAGRAPH };
  const folded = foldExchanges([
    { ...write, id: "A", field: "status", from: "in_progress", to: "pending" },
    { ...write, id: "B", field: "owner", from: "agent:spec", to: "" },
    { ...write, id: "C", field: "role", from: "spec", to: "dev" },
    { ...write, id: "D", field: "__comment__", from: "", to: PARAGRAPH },
  ]);
  assert.equal(folded.length, 1, "four entries of one handoff did not fold into one exchange");
  const [x] = folded;
  assert.equal(x.reason, PARAGRAPH);
  assert.deepEqual(x.changes.map((c) => c.field), ["status", "owner", "role"],
    "a field that moved was dropped by the fold");
  // The comment keeps its id — that is what `decide --resolves` names — and
  // loses its text, because the text is the reason above it.
  assert.deepEqual(x.messages, [{ id: "D", kind: "comment", text: null }]);
});

test("POSITIVE CONTROL: two separate writes do NOT collapse", () => {
  // Without this, a fold that returned one row whatever it was handed would
  // pass the test above perfectly.
  const folded = foldExchanges([
    { ts: "2026-09-04T13:21:03.816Z", actor: "agent:spec", source: "handoff", reason: "one", field: "status", from: "a", to: "b" },
    { ts: "2026-09-04T13:59:25.099Z", actor: "agent:dev", source: "run", reason: "two", field: "status", from: "b", to: "c" },
  ]);
  assert.equal(folded.length, 2);
  assert.deepEqual(folded.map((x) => x.reason), ["one", "two"]);
});

test("a message that is NOT the reason keeps its text", () => {
  const [x] = foldExchanges([
    { ts: "T", actor: "user:a", source: "ask", reason: "waiting for an answer", id: "Q", field: "__comment__", from: "", to: "which of the two?" },
  ]);
  assert.deepEqual(x.messages, [{ id: "Q", kind: "question", text: "which of the two?" }]);
});

test("a reserved reason is marked as one, so nobody quotes a machine's word", () => {
  const [x] = foldExchanges([
    { ts: "T", actor: "agent:x", source: "done", reason: "proven", field: "status", from: "in_progress", to: "done" },
  ]);
  assert.equal(x.reserved, true);
  const [y] = foldExchanges([
    { ts: "T", actor: "user:a", source: "handoff", reason: "a sentence somebody wrote", field: "status", from: "a", to: "b" },
  ]);
  assert.equal(y.reserved, false);
});

// ── The command, against a real tree ──────────────────────────────────────

test("the answer carries one paragraph once, where the log carries it once per field", () => {
  const fx = fixture();
  handOver(fx, "agent:spec", PARAGRAPH);

  const raw = readFileSync(join(fx.dir, "history", fx.id + ".jsonl"), "utf8");
  const inFile = occurrences(raw, PARAGRAPH);
  assert.ok(inFile >= 3,
    "the fixture did not reproduce the defect: the log stores the reason " + inFile + " time(s)");

  const read = run(["log", fx.id, "--dir", fx.dir]);
  assert.equal(read.status, 0, read.stderr);
  assert.equal(occurrences(read.stdout, PARAGRAPH), 1,
    "the reason reached the reader more than once — the fold bought nothing");
  // NOTHING IS LOST: every field the handoff moved is still named.
  for (const field of ["status", "owner"]) {
    assert.ok(read.stdout.includes(field), "the answer does not name `" + field + "`");
  }
  assert.ok(read.stdout.length < raw.length,
    "the answer is not smaller than the file it replaced (" + read.stdout.length + " vs " + raw.length + ")");
});

test("`--json` answers in the envelope, with the records and the exchanges they fold into", () => {
  const fx = fixture();
  handOver(fx, "agent:spec", PARAGRAPH);

  const r = run(["log", fx.id, "--dir", fx.dir, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const answer = JSON.parse(r.stdout);
  assert.equal(answer.kind, "task-log");
  assert.equal(answer.ok, true);
  assert.equal(answer.id, fx.id);
  assert.ok(answer.records > answer.total,
    "the fold reports as many exchanges as records: " + answer.records + " / " + answer.total);
  const handoff = answer.exchanges.find((x) => x.source === "handoff");
  assert.ok(handoff, "the handoff is not in the answer");
  assert.equal(handoff.reason, PARAGRAPH);
  assert.equal(JSON.stringify(handoff).split(PARAGRAPH).length - 1, 1,
    "the paragraph appears more than once inside one exchange");
});

test("`--limit` slices from the NEWEST end and says what it left behind", () => {
  const fx = fixture();
  handOver(fx, "agent:spec", "the first handoff");
  handOver(fx, "agent:dev", "the second handoff");

  const all = JSON.parse(run(["log", fx.id, "--dir", fx.dir, "--json"]).stdout);
  assert.ok(all.total >= 3, "the fixture has too few exchanges to slice");

  const one = JSON.parse(run(["log", fx.id, "--dir", fx.dir, "--limit", "1", "--json"]).stdout);
  assert.equal(one.exchanges.length, 1);
  assert.equal(one.total, all.total, "a slice reports itself as the whole log");
  assert.deepEqual(one.exchanges[0], all.exchanges[all.exchanges.length - 1],
    "`--limit` kept the oldest exchange, not the newest");

  const bad = run(["log", fx.id, "--dir", fx.dir, "--limit", "none"]);
  assert.equal(bad.status, 2, "a nonsense limit was accepted");
});

test("a task with no log at all is ANSWERED, not refused", () => {
  const fx = fixture();
  // A task file written by hand, so nothing has ever recorded anything about
  // it — the state a backlog that predates the history log is entirely in.
  const prefix = fx.id.replace(/-\d+$/, "");
  const id = prefix + "-900";
  writeFileSync(join(fx.dir, "tasks", id + "-silent.md"),
    "---\nid: " + id + "\ntitle: \"Nothing was ever recorded\"\nstatus: pending\n---\n\n## Goal\n\nNothing.\n", "utf8");

  const r = run(["log", id, "--dir", fx.dir]);
  assert.equal(r.status, 0, "a task with no history was treated as an error: " + r.stderr);
  assert.match(r.stdout, /no recorded history/);

  const j = JSON.parse(run(["log", id, "--dir", fx.dir, "--json"]).stdout);
  assert.equal(j.ok, true);
  assert.equal(j.records, 0);
  assert.deepEqual(j.exchanges, []);
});

test("a task that is nowhere is a refusal — in the envelope, and exit 1", () => {
  const fx = fixture();
  const absent = fx.id.replace(/-\d+$/, "-404");
  const r = run(["log", absent, "--dir", fx.dir, "--json"]);
  assert.equal(r.status, 1);
  const answer = JSON.parse(r.stdout);
  assert.equal(answer.kind, "task-log");
  assert.equal(answer.ok, false);
  assert.equal(answer.refusalKind, "no-such-task");
});

test("reading the log WRITES NOTHING — the tree is byte-identical afterwards", () => {
  const fx = fixture();
  handOver(fx, "agent:spec", PARAGRAPH);

  const before = snapshot(fx.dir);
  assert.ok(Object.keys(before).length > 3, "the snapshot saw almost nothing — it is not reading the tree");
  assert.equal(run(["log", fx.id, "--dir", fx.dir]).status, 0);
  assert.equal(run(["log", fx.id, "--dir", fx.dir, "--json"]).status, 0);
  assert.deepEqual(snapshot(fx.dir), before, "reading the log changed the backlog");
});
