/**
 * An ADOPTED field reaches the log as an adoption, never as silence (TL-387).
 *
 * THE DEFECT, MEASURED. While repairing the links broken by TL-382 a
 * `related_docs` edit was made by hand to sixteen tasks, and `history --file …
 * --actor agent:codex --source manual --reason "…"` recorded two of them and
 * said "no changes to record" for the rest. Those tasks were absent from the
 * local snapshot and their log had never carried a `related_docs` line, so
 * TL-185's adoption branch took the file as read: the new value moved into the
 * snapshot and no `.jsonl` gained anything. TL-185 made that run SAY so, which
 * is a sentence printed once — the next run over the same tree finds the value
 * already in the snapshot and prints "no changes to record", truthfully about
 * the diff and falsely about the log. The edit is then unrecorded forever, and
 * nothing in the repository remembers that it was absorbed.
 *
 * WHAT IS ASSERTED HERE, and it is the log rather than the wording: the run
 * appends an `__adopted__` entry naming the fields it took on trust, signed
 * with the actor, source and reason of the run that absorbed them. That is the
 * honest record — it claims a transition for nothing, because there is no
 * earlier value to compare against, and it states which fields entered the
 * snapshot without one.
 *
 * WHAT MUST NOT CHANGE. The log is append-only: an entry already standing as
 * `unknown` keeps saying `unknown`, and a field the log CAN vouch for still
 * produces a real `from → to` transition rather than an adoption. Both have a
 * case below, because a fix that adopted everything would pass the first test
 * and destroy the evidence the second one rests on.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FIELD_ADOPTED, appendEntries, loadSnapshot, readHistory, reconcile, saveSnapshot } from "../history.mjs";
import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

// The actor chain reads the user layer, so a developer with `actor:` in their
// own configuration would see the attribution assertions fail for a reason that
// belongs to their machine and not to this task.
isolateHome("history-adoption");

const TRASH = [];
process.on("exit", () => {
  for (const dir of TRASH) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* a leftover fixture is not a failure */ } }
});

function taskText(over = {}) {
  const docs = over.related_docs;
  const f = Object.assign(
    { id: "BL-900", title: "Do the thing", type: "code", labels: "[]", board: "main",
      epic: '""', priority: "P2", status: "pending", owner: "unassigned", estimate: "2h",
      confidence: "high", executor: '""', created: "2026-08-01", updated: "2026-08-01" },
    over
  );
  delete f.related_docs;
  return ["---", ...Object.keys(f).map((k) => k + ": " + f[k]), "blocked_by: []", "blocks: []",
    ...(docs ? ["related_docs:", ...docs.map((d) => "  - " + d)] : []),
    "---", "", "## Goal", "", "The body.", ""].join("\n");
}

/** A backlog directory with `tasks/` and enough beside it to be recognised. */
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "backlog-adoption-"));
  TRASH.push(dir);
  mkdirSync(join(dir, "tasks"));
  writeFileSync(join(dir, "config.yaml"), "", "utf8");
  return dir;
}

function writeTask(dir, name, over) {
  writeFileSync(join(dir, "tasks", name), taskText(over), "utf8");
}

/**
 * The tree the incident happened in: the task arrived on the branch with its
 * own log, so it is ABSENT from the local snapshot while the snapshot itself
 * has covered the tree (it is not `partial`). `only` is what the post-edit hook
 * passes, and it is what narrowed the original run.
 */
function arrivedByMerge(dir, { log = [], docs = null } = {}) {
  writeTask(dir, "BL-901-neighbour.md", { id: "BL-901" });
  reconcile(dir, { actor: "agent:claude", source: "hook" });   // a reference point covering the tree
  writeTask(dir, "BL-900-one.md", { id: "BL-900", related_docs: docs || undefined });
  appendEntries(dir, "BL-900", log);
}

function logEntry(over) {
  return Object.assign(
    { id: "01J000000000000000000000AA", ts: "2026-08-30T18:30:00.000Z", task: "BL-900",
      field: "status", from: "", to: "pending", actor: "unknown", source: "external",
      reason: "unknown" },
    over
  );
}

const run = (dir, args) => {
  const r = spawnSync(process.execPath, [join(SCRIPTS_DIR, "history-record.mjs"), "--dir", dir, ...args],
    { encoding: "utf8" });
  return { out: r.stdout + r.stderr, code: r.status };
};

// ── 1. The absorbed field lands in the log ────────────────────────────────

test("a field the log cannot vouch for is recorded as an adoption", () => {
  const dir = sandbox();
  arrivedByMerge(dir, { log: [logEntry({})], docs: ["docs/one.md"] });

  const res = reconcile(dir, {
    actor: "agent:codex", source: "manual", only: ["BL-900"], reason: "repairing the links of TL-382",
  });

  assert.deepEqual(res.adopted, ["BL-900"], "the task had no reference point of its own");
  const adoptions = readHistory(dir, "BL-900").filter((e) => e.field === FIELD_ADOPTED);
  assert.equal(adoptions.length, 1, "the absorbed fields have to reach the log, not only the terminal");
  assert.ok(
    (Array.isArray(adoptions[0].to) ? adoptions[0].to : [adoptions[0].to]).includes("related_docs"),
    "the entry names the field that was taken on trust: " + JSON.stringify(adoptions[0].to)
  );
  assert.equal(adoptions[0].actor, "agent:codex", "the run that absorbed it signs it");
  assert.equal(adoptions[0].reason, "repairing the links of TL-382");
  assert.equal(adoptions[0].from, "", "an adoption claims no earlier value — there is none to claim");
  assert.equal(
    loadSnapshot(dir).tasks["BL-900"].related_docs.join(","), "docs/one.md",
    "the value still enters the snapshot: adoption records the absorption, it does not refuse it"
  );
});

// ── 2. The positive control: an attested field is still a transition ──────

test("a field the log CAN vouch for is recorded as a transition, not an adoption", () => {
  const dir = sandbox();
  arrivedByMerge(dir, {
    log: [logEntry({ field: "related_docs", from: "", to: ["docs/old.md"] })],
    docs: ["docs/new.md"],
  });

  const res = reconcile(dir, { actor: "agent:codex", source: "manual", only: ["BL-900"], reason: "the links" });

  const change = res.entries.find((e) => e.field === "related_docs");
  assert.ok(change, "the log holds the previous value, so the edit is a real transition");
  assert.deepEqual(change.from, ["docs/old.md"]);
  assert.deepEqual(change.to, ["docs/new.md"]);
  const adoptions = readHistory(dir, "BL-900").filter((e) => e.field === FIELD_ADOPTED);
  assert.ok(
    !(Array.isArray(adoptions[0] && adoptions[0].to) ? adoptions[0].to : []).includes("related_docs"),
    "a field with a recorded previous value is not adopted"
  );
});

// ── 3. Append-only: the earlier `unknown` entry is left exactly as it was ──

test("an already reconciled `unknown` entry is not rewritten by the adoption", () => {
  const dir = sandbox();
  arrivedByMerge(dir, { log: [logEntry({})], docs: ["docs/one.md"] });
  const before = readFileSync(join(dir, "history", "BL-900.jsonl"), "utf8");

  reconcile(dir, { actor: "agent:codex", source: "manual", only: ["BL-900"], reason: "the links" });

  const after = readFileSync(join(dir, "history", "BL-900.jsonl"), "utf8");
  assert.ok(after.startsWith(before), "the adoption stands BESIDE the old line; it does not replace it");
  const old = readHistory(dir, "BL-900").find((e) => e.id === "01J000000000000000000000AA");
  assert.equal(old.actor, "unknown", "what nobody knew at the time keeps saying so");
  assert.equal(old.reason, "unknown");
});

// ── 4. Nothing to adopt writes nothing ────────────────────────────────────

test("a task whose log vouches for every tracked field gains no adoption entry", () => {
  const dir = sandbox();
  // The task arrives with its own log AND its own reference point: the ordinary
  // case, and the one an unconditional adoption entry would fill with noise.
  writeTask(dir, "BL-900-one.md", { id: "BL-900", related_docs: ["docs/one.md"] });
  reconcile(dir, { actor: "agent:claude", source: "hook" });

  const res = reconcile(dir, { actor: "agent:codex", source: "manual", only: ["BL-900"], reason: "nothing changed" });

  assert.equal(res.entries.length, 0);
  assert.equal(
    readHistory(dir, "BL-900").filter((e) => e.field === FIELD_ADOPTED).length, 0,
    "a task with a reference point of its own is not adopted from anything"
  );
});

// ── 5. `doctor`'s contract: a diagnosis writes nothing ────────────────────

test("a dry run reports the adoption and appends nothing", () => {
  const dir = sandbox();
  arrivedByMerge(dir, { log: [logEntry({})], docs: ["docs/one.md"] });
  const before = readFileSync(join(dir, "history", "BL-900.jsonl"), "utf8");

  const res = reconcile(dir, { dryRun: true, actor: "agent:codex", source: "manual", only: ["BL-900"] });

  assert.ok(res.entries.some((e) => e.field === FIELD_ADOPTED), "the diagnosis sees what would be adopted");
  assert.equal(readFileSync(join(dir, "history", "BL-900.jsonl"), "utf8"), before, "and writes none of it");
});

// ── 6. The terminal: the adoption names its fields, and the SECOND run is
//      silent only because the first one recorded something ────────────────

test("the command names the adopted fields, and its silence afterwards is earned", () => {
  const dir = sandbox();
  arrivedByMerge(dir, { log: [logEntry({})], docs: ["docs/one.md"] });

  const first = run(dir, ["--file", "tasks/BL-900-one.md", "--actor", "agent:codex",
    "--source", "manual", "--reason", "repairing the links of TL-382"]);
  assert.equal(first.code, 0, first.out);
  assert.match(first.out, /BL-900/, first.out);
  assert.match(first.out, /related_docs/,
    "a caller who edited `related_docs` has to read which field was absorbed:\n" + first.out);

  const second = run(dir, ["--file", "tasks/BL-900-one.md", "--actor", "agent:codex",
    "--source", "manual", "--reason", "repairing the links of TL-382"]);
  assert.equal(second.code, 0, second.out);
  // "no changes to record" is now TRUE: the first run put the absorption in the
  // log, so the second one is describing a tree with nothing left unrecorded.
  assert.equal(
    readHistory(dir, "BL-900").filter((e) => e.field === FIELD_ADOPTED).length, 1,
    "the record the second run's silence rests on is in the log, and there is one of it"
  );
});

// ── 7. The fact is recorded once, not once per worktree ───────────────────

test("a second tree adopting the same task appends nothing further", () => {
  const dir = sandbox();
  arrivedByMerge(dir, { log: [logEntry({})], docs: ["docs/one.md"] });
  reconcile(dir, { actor: "agent:codex", source: "manual", only: ["BL-900"], reason: "the links" });

  // A sibling worktree shares the `.jsonl` (versioned) and has a snapshot of
  // its own (gitignored) that has never seen this task — the same state the
  // first run met, and the reason this must not be counted per tree.
  const snap = loadSnapshot(dir);
  delete snap.tasks["BL-900"];
  saveSnapshot(dir, snap);

  const res = reconcile(dir, { actor: "agent:claude", source: "hook", only: ["BL-900"] });

  assert.deepEqual(res.entries.filter((e) => e.field === FIELD_ADOPTED), []);
  assert.equal(
    readHistory(dir, "BL-900").filter((e) => e.field === FIELD_ADOPTED).length, 1,
    "the same sentence twice in an append-only file is noise, not evidence"
  );
});

// ── 8. A seeded tree is untouched by any of this ──────────────────────────

test("a first run with no snapshot still adopts nothing", () => {
  const dir = sandbox();
  writeTask(dir, "BL-900-one.md", { id: "BL-900", related_docs: ["docs/one.md"] });

  const res = reconcile(dir, { actor: "agent:codex", source: "manual", only: ["BL-900"] });

  assert.equal(res.seeded, true);
  assert.equal(res.entries.length, 0, "a seed invents no history, and an adoption is history");
  assert.equal(readHistory(dir, "BL-900").length, 0);
});
