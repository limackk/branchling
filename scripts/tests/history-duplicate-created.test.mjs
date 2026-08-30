/**
 * A task lifecycle event recorded by TWO observers (BL-1449).
 *
 * THE CLASS OF DEFECT. `__created__` describes one creation of a task, so it is
 * meant to exist once. Today it comes into being once PER OBSERVER: a task created
 * in one tree records `__created__` there, and a second tree — which does not have
 * that entry yet — takes the task for new and records its own, as
 * `unknown`/`external`. The dedup in `readHistory()` goes by `id`, and a ULID
 * identifies a WRITE, not an EVENT, so both rows stay and the history claims the
 * task was created twice.
 *
 * WHY THE BL-1397 GATE DOES NOT CATCH IT. That one asks the history file before it
 * writes anything — and it works WHEN THERE IS SOMETHING TO READ. The third
 * occurrence happened after it: the `.md` arrived by git while the `.jsonl` did
 * not, because nobody had committed it. A gate on the write cannot be the only
 * defence when its premise travels by a different channel than the task. Hence a
 * second layer, at READ time, which works even when both entries already exist.
 *
 * WHAT THIS FILE GUARDS FROM THE OTHER SIDE: "deleted and created again" is two
 * genuine creations, and two `pending → in_progress` transitions at different times
 * are two genuine events. The rule has to tell a repeated WRITE from a repeated
 * EVENT — otherwise the cure deletes history.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FIELD_CREATED, FIELD_DELETED, appendEntries, readHistory, reconcile } from "../history.mjs";

function taskFile(over = {}) {
  const f = Object.assign(
    { id: "BL-900", title: "Do the thing", type: "code", labels: "[pre-launch]", board: "main",
      epic: '""', priority: "P2", status: "pending", owner: "unassigned", estimate: "2h",
      confidence: "high", created: "2026-08-01", updated: "2026-08-01" },
    over
  );
  return ["---", ...Object.keys(f).map((k) => k + ": " + f[k]), "blocked_by: []", "blocks: []", "---", "", "## Goal", "", "The body.", ""].join("\n");
}

function sandbox(tasks = {}) {
  const dir = mkdtempSync(join(tmpdir(), "backlog-dupcreated-"));
  mkdirSync(join(dir, "tasks"));
  for (const [name, text] of Object.entries(tasks)) writeFileSync(join(dir, "tasks", name), text, "utf8");
  return dir;
}

function lifecycle(over) {
  return Object.assign(
    { id: "01J000000000000000000000AA", ts: "2026-08-30T18:30:00.000Z", task: "BL-900",
      field: FIELD_CREATED, from: "", to: "Do the thing", actor: "agent:claude", source: "hook" },
    over
  );
}

const only = (entries, field) => entries.filter((e) => e.field === field);

// ── A repeated WRITE of one event ─────────────────────────────────────────

test("two observers of one creation give ONE `__created__` entry", () => {
  const dir = sandbox();
  // This is what the log looks like once both copies finally meet (merge=union):
  // the same fact, two writes, two different ULIDs.
  appendEntries(dir, "BL-900", [
    lifecycle({ id: "01J000000000000000000000AA", actor: "agent:claude", source: "hook" }),
    lifecycle({ id: "01J000000000000000000000BB", ts: "2026-08-30T18:30:41.000Z", actor: "unknown", source: "external" }),
  ]);
  assert.equal(only(readHistory(dir, "BL-900"), FIELD_CREATED).length, 1);
  rmSync(dir, { recursive: true, force: true });
});

test("on a duplicate the BETTER ATTRIBUTED entry wins, not the last one written", () => {
  const dir = sandbox();
  // The order matters here: `unknown` is the LATER one, so a naive "last write
  // wins" would pick exactly the one that does not know who created the task.
  appendEntries(dir, "BL-900", [
    lifecycle({ id: "01J000000000000000000000AA", actor: "agent:claude", source: "hook" }),
    lifecycle({ id: "01J000000000000000000000BB", ts: "2026-08-30T18:30:41.000Z", actor: "unknown", source: "external" }),
  ]);
  const kept = only(readHistory(dir, "BL-900"), FIELD_CREATED);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].actor, "agent:claude");
  assert.equal(kept[0].source, "hook");
  rmSync(dir, { recursive: true, force: true });
});

test("the order in the file does not decide — the better attributed one wins even when second", () => {
  const dir = sandbox();
  appendEntries(dir, "BL-900", [
    lifecycle({ id: "01J000000000000000000000AA", actor: "unknown", source: "external" }),
    lifecycle({ id: "01J000000000000000000000BB", ts: "2026-08-30T18:30:41.000Z", actor: "user:founder", source: "viewer" }),
  ]);
  const kept = only(readHistory(dir, "BL-900"), FIELD_CREATED);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].actor, "user:founder");
  rmSync(dir, { recursive: true, force: true });
});

test("a tie in attribution is settled by the EARLIER entry — an event has one time", () => {
  const dir = sandbox();
  appendEntries(dir, "BL-900", [
    lifecycle({ id: "01J000000000000000000000BB", ts: "2026-08-30T18:30:41.000Z", actor: "agent:claude" }),
    lifecycle({ id: "01J000000000000000000000AA", ts: "2026-08-30T18:30:00.000Z", actor: "agent:claude" }),
  ]);
  const kept = only(readHistory(dir, "BL-900"), FIELD_CREATED);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].ts, "2026-08-30T18:30:00.000Z");
  rmSync(dir, { recursive: true, force: true });
});

test("`__deleted__` has the same rule — the same route, the same duplicate", () => {
  const dir = sandbox();
  appendEntries(dir, "BL-900", [
    lifecycle({ id: "01J000000000000000000000AA", field: FIELD_DELETED, from: "Do the thing", to: "", actor: "local:founder", source: "cli" }),
    lifecycle({ id: "01J000000000000000000000BB", ts: "2026-08-30T18:31:00.000Z", field: FIELD_DELETED, from: "Do the thing", to: "", actor: "unknown", source: "external" }),
  ]);
  const kept = only(readHistory(dir, "BL-900"), FIELD_DELETED);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].actor, "local:founder");
  rmSync(dir, { recursive: true, force: true });
});

test("a duplicate is recognised by the EVENT, not by the content — a changed title does not save the entry", () => {
  const dir = sandbox();
  // If the key were `task+field+to`, a title changed between one observer and the
  // next would be enough for a duplicate to pass the gate.
  appendEntries(dir, "BL-900", [
    lifecycle({ id: "01J000000000000000000000AA", to: "Do the thing", actor: "agent:claude" }),
    lifecycle({ id: "01J000000000000000000000BB", ts: "2026-08-30T18:30:41.000Z", to: "Do the thing differently", actor: "unknown" }),
  ]);
  assert.equal(only(readHistory(dir, "BL-900"), FIELD_CREATED).length, 1);
  rmSync(dir, { recursive: true, force: true });
});

// ── Negative controls: a repeated EVENT stays ─────────────────────────────

test("deleted and created again is TWO creations, not a duplicate", () => {
  const dir = sandbox();
  appendEntries(dir, "BL-900", [
    lifecycle({ id: "01J000000000000000000000AA", ts: "2026-08-01T10:00:00.000Z" }),
    lifecycle({ id: "01J000000000000000000000BB", ts: "2026-08-10T10:00:00.000Z", field: FIELD_DELETED, from: "Do the thing", to: "" }),
    lifecycle({ id: "01J000000000000000000000CC", ts: "2026-08-20T10:00:00.000Z" }),
  ]);
  const entries = readHistory(dir, "BL-900");
  assert.equal(only(entries, FIELD_CREATED).length, 2);
  assert.equal(only(entries, FIELD_DELETED).length, 1);
  rmSync(dir, { recursive: true, force: true });
});

test("two genuine `pending → in_progress` transitions stay two entries", () => {
  const dir = sandbox();
  // Ordinary fields are deduplicated ONLY by `id`. If the event rule covered them
  // too, reverting a status and setting it again would vanish from the history.
  appendEntries(dir, "BL-900", [
    lifecycle({ id: "01J000000000000000000000AA", ts: "2026-08-01T10:00:00.000Z", field: "status", from: "pending", to: "in_progress" }),
    lifecycle({ id: "01J000000000000000000000BB", ts: "2026-08-02T10:00:00.000Z", field: "status", from: "in_progress", to: "pending" }),
    lifecycle({ id: "01J000000000000000000000CC", ts: "2026-08-03T10:00:00.000Z", field: "status", from: "pending", to: "in_progress" }),
  ]);
  assert.equal(readHistory(dir, "BL-900").length, 3);
  rmSync(dir, { recursive: true, force: true });
});

test("a single `__created__` passes untouched — the rule does not eat a normal log", () => {
  const dir = sandbox();
  appendEntries(dir, "BL-900", [
    lifecycle({ id: "01J000000000000000000000AA" }),
    lifecycle({ id: "01J000000000000000000000BB", ts: "2026-08-02T10:00:00.000Z", field: "status", from: "pending", to: "done" }),
  ]);
  const entries = readHistory(dir, "BL-900");
  assert.equal(entries.length, 2);
  assert.equal(entries[0].field, FIELD_CREATED);
  rmSync(dir, { recursive: true, force: true });
});

// ── Writing: a second observer does not add a second `__deleted__` ────────

test("reconciliation does not append `__deleted__` when the history already knows it", () => {
  const dir = sandbox({ "BL-900-zrob-rzecz.md": taskFile() });
  reconcile(dir, { actor: "agent:claude" });                 // seed
  reconcile(dir, { actor: "agent:claude", source: "hook" }); // BL-900 enters the snapshot

  // Somebody else recorded the deletion and brought it along with the history file.
  rmSync(join(dir, "tasks", "BL-900-zrob-rzecz.md"));
  appendEntries(dir, "BL-900", [
    lifecycle({ id: "01J000000000000000000000ZZ", ts: "2026-08-30T20:00:00.000Z", field: FIELD_DELETED, from: "Do the thing", to: "", actor: "local:founder", source: "viewer" }),
  ]);

  const { entries } = reconcile(dir, { actor: "unknown", source: "boot" });
  assert.deepEqual(entries, []);
  assert.equal(only(readHistory(dir, "BL-900"), FIELD_DELETED).length, 1);
  rmSync(dir, { recursive: true, force: true });
});

test("but a RE-creation after a deletion is logged — the gate is not blind", () => {
  const dir = sandbox({ "BL-900-zrob-rzecz.md": taskFile() });
  reconcile(dir, { actor: "agent:claude" });
  reconcile(dir, { actor: "agent:claude", source: "hook" });
  rmSync(join(dir, "tasks", "BL-900-zrob-rzecz.md"));
  reconcile(dir, { actor: "agent:claude", source: "hook" });   // __deleted__

  writeFileSync(join(dir, "tasks", "BL-900-zrob-rzecz.md"), taskFile(), "utf8");
  const { entries } = reconcile(dir, { actor: "agent:claude", source: "hook" });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].field, FIELD_CREATED);
  rmSync(dir, { recursive: true, force: true });
});
