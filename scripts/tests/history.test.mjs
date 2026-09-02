/**
 * The contract of the change history (BL-1397).
 *
 * Why these assertions: the history is meant to be PROOF of who changed what, so
 * the two most dangerous defects are (1) inventing an entry nobody made — a first
 * start on an existing backlog must not produce a thousand "changes" — and (2)
 * losing an entry because two write routes (the server, the hook) overwrote each
 * other's file. Both have a test here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  FIELD_CREATED,
  FIELD_DELETED,
  appendEntries,
  hasSnapshot,
  historyPath,
  isValidActor,
  lastChangeByField,
  normalizeActor,
  readAllHistory,
  readHistory,
  recordEdit,
  reconcile,
  metaFromText,
  actorParts,
  FIELD_BODY,
  FIELD_COMMENT,
  PSEUDO_FIELDS,
} from "../history.mjs";
import { diffMeta } from "../task-fields.mjs";

function taskFile(over = {}) {
  const f = Object.assign(
    { id: "BL-900", title: "Do the thing", type: "code", labels: "[pre-launch]", board: "main",
      epic: '""', priority: "P2", status: "pending", owner: "unassigned", estimate: "2h",
      confidence: "high", created: "2026-08-01", updated: "2026-08-01" },
    over
  );
  return [
    "---",
    ...Object.keys(f).map((k) => k + ": " + f[k]),
    "blocked_by: []",
    "blocks: []",
    "---",
    "",
    "## Cel",
    "",
    "The body.",
    "",
  ].join("\n");
}

function sandbox(tasks = { "BL-900-zrob-rzecz.md": taskFile() }) {
  const dir = mkdtempSync(join(tmpdir(), "backlog-history-"));
  mkdirSync(join(dir, "tasks"));
  for (const [name, text] of Object.entries(tasks)) writeFileSync(join(dir, "tasks", name), text, "utf8");
  return dir;
}

// ── Aktorzy ───────────────────────────────────────────────────────────────

test("actor: a slug with a namespace passes, junk lands as unknown", () => {
  assert.equal(isValidActor("local:founder"), true);
  assert.equal(isValidActor("agent:claude"), true);
  assert.equal(isValidActor("agent:agent-2"), true);
  assert.equal(isValidActor("local:Founder Smith"), false);
  assert.equal(isValidActor(""), false);
  assert.equal(normalizeActor("../../etc/passwd"), "unknown");
  assert.equal(normalizeActor(undefined), "unknown");
});

test("the history path cannot be made to point outside the directory", () => {
  const dir = sandbox();
  assert.throws(() => historyPath(dir, "../../evil"), /identifier/i);
  assert.throws(() => historyPath(dir, "BL-1/../../x"), /identifier/i);
  rmSync(dir, { recursive: true, force: true });
});

// ── recordEdit ────────────────────────────────────────────────────────────

test("recordEdit writes one entry per changed field, with the author", () => {
  const dir = sandbox();
  const before = metaFromText(taskFile());
  const after = metaFromText(taskFile({ status: "in_progress", owner: "founder", updated: "2026-08-29" }));
  const entries = recordEdit(dir, { taskId: "BL-900", before, after, actor: "local:founder", source: "viewer" });

  assert.deepEqual(entries.map((e) => e.field).sort(), ["owner", "status"]);
  const status = entries.find((e) => e.field === "status");
  assert.equal(status.from, "pending");
  assert.equal(status.to, "in_progress");
  assert.equal(status.actor, "local:founder");
  assert.equal(status.source, "viewer");
  assert.match(status.ts, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(readHistory(dir, "BL-900").length, 2);
  rmSync(dir, { recursive: true, force: true });
});

test("recordEdit does not log `updated` — bookkeeping is not a change", () => {
  const dir = sandbox();
  const before = metaFromText(taskFile());
  const after = metaFromText(taskFile({ updated: "2026-08-29" }));
  assert.deepEqual(recordEdit(dir, { taskId: "BL-900", before, after, actor: "local:founder" }), []);
  assert.equal(readHistory(dir, "BL-900").length, 0);
  rmSync(dir, { recursive: true, force: true });
});

test("entries ACCUMULATE — a second change does not overwrite the first", () => {
  const dir = sandbox();
  const v1 = metaFromText(taskFile());
  const v2 = metaFromText(taskFile({ status: "in_progress" }));
  const v3 = metaFromText(taskFile({ status: "done" }));
  recordEdit(dir, { taskId: "BL-900", before: v1, after: v2, actor: "agent:claude" });
  recordEdit(dir, { taskId: "BL-900", before: v2, after: v3, actor: "local:founder" });
  const h = readHistory(dir, "BL-900");
  assert.equal(h.length, 2);
  assert.deepEqual(h.map((e) => e.to), ["in_progress", "done"]);
  assert.equal(lastChangeByField(h).status.actor, "local:founder");
  rmSync(dir, { recursive: true, force: true });
});

test("a corrupt line does not take the rest of the history with it", () => {
  const dir = sandbox();
  appendEntries(dir, "BL-900", [{ ts: "2026-01-01T00:00:00Z", task: "BL-900", field: "status", from: "a", to: "b", actor: "local:founder", source: "test" }]);
  writeFileSync(historyPath(dir, "BL-900"), readFileSync(historyPath(dir, "BL-900"), "utf8") + "{ this is not json\n", "utf8");
  appendEntries(dir, "BL-900", [{ ts: "2026-01-02T00:00:00Z", task: "BL-900", field: "owner", from: "x", to: "y", actor: "agent:claude", source: "test" }]);
  const h = readHistory(dir, "BL-900");
  assert.equal(h.length, 2);
  assert.deepEqual(Object.keys(readAllHistory(dir)), ["BL-900"]);
  rmSync(dir, { recursive: true, force: true });
});

// ── reconcile ─────────────────────────────────────────────────────────────

test("the first pass SEEDS — zero entries, despite 2 existing tasks", () => {
  const dir = sandbox({
    "BL-900-a.md": taskFile(),
    "BL-901-b.md": taskFile({ id: "BL-901", status: "done" }),
  });
  assert.equal(hasSnapshot(dir), false);
  const first = reconcile(dir, { actor: "agent:claude", source: "hook" });
  assert.equal(first.seeded, true);
  assert.deepEqual(first.entries, []);
  assert.equal(hasSnapshot(dir), true);
  assert.deepEqual(readAllHistory(dir), {});
  rmSync(dir, { recursive: true, force: true });
});

test("an edit made outside the server is detected and attributed to the given actor", () => {
  const dir = sandbox();
  reconcile(dir, { actor: "agent:claude", source: "hook" });                 // seed
  writeFileSync(join(dir, "tasks", "BL-900-zrob-rzecz.md"), taskFile({ status: "blocked", labels: "[pre-launch, prod]" }), "utf8");
  const { entries, seeded } = reconcile(dir, { actor: "agent:claude", source: "hook" });
  assert.equal(seeded, false);
  assert.deepEqual(entries.map((e) => e.field).sort(), ["labels", "status"]);
  assert.equal(entries.find((e) => e.field === "status").actor, "agent:claude");
  assert.deepEqual(entries.find((e) => e.field === "labels").to, ["pre-launch", "prod"]);
  rmSync(dir, { recursive: true, force: true });
});

test("a second pass with no changes appends nothing (idempotence)", () => {
  const dir = sandbox();
  reconcile(dir, { actor: "agent:claude" });
  writeFileSync(join(dir, "tasks", "BL-900-zrob-rzecz.md"), taskFile({ status: "done" }), "utf8");
  assert.equal(reconcile(dir, { actor: "agent:claude" }).entries.length, 1);
  assert.equal(reconcile(dir, { actor: "agent:claude" }).entries.length, 0);
  assert.equal(reconcile(dir, { actor: "local:founder" }).entries.length, 0);
  rmSync(dir, { recursive: true, force: true });
});

test("a write by the server is not counted a second time by reconciliation", () => {
  const dir = sandbox();
  reconcile(dir, { actor: "agent:claude" });                                  // seed
  const before = metaFromText(readFileSync(join(dir, "tasks", "BL-900-zrob-rzecz.md"), "utf8"));
  const text = taskFile({ status: "in_progress", updated: "2026-08-29" });
  writeFileSync(join(dir, "tasks", "BL-900-zrob-rzecz.md"), text, "utf8");
  recordEdit(dir, { taskId: "BL-900", before, after: metaFromText(text), actor: "local:founder", source: "viewer" });
  assert.deepEqual(reconcile(dir, { actor: "unknown", source: "watch" }).entries, []);
  const h = readHistory(dir, "BL-900");
  assert.equal(h.length, 1);
  assert.equal(h[0].actor, "local:founder");
  rmSync(dir, { recursive: true, force: true });
});

test("a new and a deleted task are events of the task, not of a field", () => {
  const dir = sandbox();
  reconcile(dir, { actor: "agent:claude" });
  writeFileSync(join(dir, "tasks", "BL-901-new.md"), taskFile({ id: "BL-901", title: "A new task" }), "utf8");
  const added = reconcile(dir, { actor: "local:founder", source: "watch" }).entries;
  assert.equal(added.length, 1);
  assert.equal(added[0].field, FIELD_CREATED);
  assert.equal(added[0].task, "BL-901");
  assert.equal(added[0].to, "A new task");

  rmSync(join(dir, "tasks", "BL-901-new.md"));
  const removed = reconcile(dir, { actor: "local:founder", source: "watch" }).entries;
  assert.equal(removed.length, 1);
  assert.equal(removed[0].field, FIELD_DELETED);
  assert.equal(readHistory(dir, "BL-901").length, 2);
  rmSync(dir, { recursive: true, force: true });
});

test("`only` narrows the pass to one task and does not report the rest as deleted", () => {
  const dir = sandbox({ "BL-900-a.md": taskFile(), "BL-901-b.md": taskFile({ id: "BL-901" }) });
  reconcile(dir, { actor: "agent:claude" });
  writeFileSync(join(dir, "tasks", "BL-900-a.md"), taskFile({ status: "done" }), "utf8");
  writeFileSync(join(dir, "tasks", "BL-901-b.md"), taskFile({ id: "BL-901", status: "done" }), "utf8");
  const { entries } = reconcile(dir, { actor: "agent:claude", only: ["BL-900"] });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].task, "BL-900");
  assert.equal(readHistory(dir, "BL-901").length, 0);
  rmSync(dir, { recursive: true, force: true });
});

test("a task brought in by a merge or pull does NOT get a second `__created__` entry", () => {
  // The class of defect, measured on a real tree: the snapshot is LOCAL (gitignored)
  // history file is SHARED (versioned). A task created in a worktree has a
  // `__created__` entry there; after a merge into the main checkout that
  // checkout's snapshot never saw it, so reconciliation recorded the creation a
  // SECOND time — into the same file. With several people, every `git pull` would
  const dir = sandbox();
  reconcile(dir, { actor: "agent:claude" });                       // seed without BL-900

  // The task appears together with a ready-made history — this is what `git merge` looks like.
  writeFileSync(join(dir, "tasks", "BL-901-from-merge.md"), taskFile({ id: "BL-901", title: "From a merge" }), "utf8");
  appendEntries(dir, "BL-901", [{
    ts: "2026-08-29T10:00:00.000Z", task: "BL-901", field: FIELD_CREATED,
    from: "", to: "From a merge", actor: "local:founder", source: "viewer",
  }]);

  const { entries } = reconcile(dir, { actor: "unknown", source: "boot" });
  assert.deepEqual(entries, []);
  assert.equal(readHistory(dir, "BL-901").length, 1);
  rmSync(dir, { recursive: true, force: true });
});

test("a field change recorded in another tree is not logged a second time", () => {
  const dir = sandbox();
  reconcile(dir, { actor: "agent:claude" });                       // seed: status pending
  // Somebody changed a status on their side and brought THE CHANGE TOGETHER WITH ITS ENTRY.
  writeFileSync(join(dir, "tasks", "BL-900-zrob-rzecz.md"), taskFile({ status: "done" }), "utf8");
  appendEntries(dir, "BL-900", [{
    ts: "2026-08-29T10:00:00.000Z", task: "BL-900", field: "status",
    from: "pending", to: "done", actor: "local:founder", source: "viewer",
  }]);

  const { entries } = reconcile(dir, { actor: "unknown", source: "boot" });
  assert.deepEqual(entries, []);
  assert.equal(readHistory(dir, "BL-900").length, 1);
  assert.equal(readHistory(dir, "BL-900")[0].actor, "local:founder");
  rmSync(dir, { recursive: true, force: true });
});

test("but a GENUINE change after the imported one is logged normally", () => {
  const dir = sandbox();
  reconcile(dir, { actor: "agent:claude" });
  writeFileSync(join(dir, "tasks", "BL-900-zrob-rzecz.md"), taskFile({ status: "done" }), "utf8");
  appendEntries(dir, "BL-900", [{
    ts: "2026-08-29T10:00:00.000Z", task: "BL-900", field: "status",
    from: "pending", to: "done", actor: "local:founder", source: "viewer",
  }]);
  reconcile(dir, { actor: "unknown", source: "boot" });      // silence (see above)

  writeFileSync(join(dir, "tasks", "BL-900-zrob-rzecz.md"), taskFile({ status: "blocked" }), "utf8");
  const { entries } = reconcile(dir, { actor: "agent:claude", source: "hook" });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].from, "done");
  assert.equal(entries[0].to, "blocked");
  rmSync(dir, { recursive: true, force: true });
});

test("the history lives in backlog/history/<ID>.jsonl — one task, one file", () => {
  const dir = sandbox();
  recordEdit(dir, {
    taskId: "BL-900",
    before: metaFromText(taskFile()),
    after: metaFromText(taskFile({ status: "done" })),
    actor: "local:founder",
  });
  assert.ok(existsSync(join(dir, "history", "BL-900.jsonl")));
  const raw = readFileSync(join(dir, "history", "BL-900.jsonl"), "utf8").trim().split("\n");
  assert.equal(raw.length, 1);
  // `reason` joined the record in TL-105 and is on EVERY entry: a field present
  // on some rows only would make "no reason given" and "none needed" one shape.
  assert.deepEqual(Object.keys(JSON.parse(raw[0])).sort(), ["actor", "field", "from", "id", "reason", "source", "task", "to", "ts"]);
  rmSync(dir, { recursive: true, force: true });
});

// ── Identyfikator zdarzenia (BL-1404 krok 1) ──────────────────────────────
//
// WHY AN id: the log has to merge by the union of lines (`merge=union`) and one
// day synchronise with a server. Both require being able to say "this is THE
// SAME entry I already have". Without an identifier, two rows with the same
// content are indistinguishable from two genuine changes to the same value.

test("every new event gets an id", () => {
  const dir = sandbox();
  const before = { status: "pending" };
  const after = { status: "in_progress" };
  const written = recordEdit(dir, { taskId: "BL-900", before, after, actor: "local:founder", source: "viewer" });
  assert.equal(written.length, 1);
  assert.match(written[0].id, /^[0-9A-HJKMNP-TV-Z]{26}$/, "the id has to be a ULID (26 Crockford base32 characters)");
  rmSync(dir, { recursive: true, force: true });
});

test("the id is unique even for two events in the same millisecond", () => {
  const ts = "2026-08-29T10:00:00.000Z";
  const dir = sandbox();
  const a = recordEdit(dir, { taskId: "BL-900", before: { status: "pending" }, after: { status: "in_progress" }, actor: "local:founder", source: "viewer", ts });
  const b = recordEdit(dir, { taskId: "BL-900", before: { status: "in_progress" }, after: { status: "pending" }, actor: "local:founder", source: "viewer", ts });
  assert.notEqual(a[0].id, b[0].id);
  rmSync(dir, { recursive: true, force: true });
});

test("the id grows lexicographically together with time — a synchronisation cursor", () => {
  const dir = sandbox();
  const older = recordEdit(dir, { taskId: "BL-900", before: { status: "pending" }, after: { status: "blocked" }, actor: "local:founder", source: "viewer", ts: "2026-01-01T00:00:00.000Z" });
  const newer = recordEdit(dir, { taskId: "BL-900", before: { status: "blocked" }, after: { status: "done" }, actor: "local:founder", source: "viewer", ts: "2026-12-31T23:59:59.999Z" });
  assert.ok(older[0].id < newer[0].id, "the older event has to have the smaller id");
  rmSync(dir, { recursive: true, force: true });
});

test("entries WITHOUT an id (from before BL-1404) still read — we do not rewrite the log", () => {
  const dir = sandbox();
  appendEntries(dir, "BL-900", [
    { ts: "2026-08-01T10:00:00.000Z", task: "BL-900", field: "status", from: "pending", to: "done", actor: "agent:claude", source: "hook" },
  ]);
  const entries = readHistory(dir, "BL-900");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].field, "status");
  assert.equal(entries[0].id, undefined);
  rmSync(dir, { recursive: true, force: true });
});

test("dedup by id: the same entry twice in the file gives ONE event", () => {
  const dir = sandbox();
  const e = { id: "01J0000000000000000000000A", ts: "2026-08-01T10:00:00.000Z", task: "BL-900", field: "status", from: "pending", to: "done", actor: "agent:claude", source: "hook" };
  appendEntries(dir, "BL-900", [e]);
  appendEntries(dir, "BL-900", [e]);
  const entries = readHistory(dir, "BL-900");
  assert.equal(entries.length, 1, "a union merge can insert the same row twice — the read has to fold it back");
  rmSync(dir, { recursive: true, force: true });
});

test("dedup does NOT merge two different events with the same content", () => {
  const dir = sandbox();
  const base = { ts: "2026-08-01T10:00:00.000Z", task: "BL-900", field: "status", from: "pending", to: "done", actor: "agent:claude", source: "hook" };
  appendEntries(dir, "BL-900", [
    Object.assign({ id: "01J0000000000000000000000A" }, base),
    Object.assign({ id: "01J0000000000000000000000B" }, base),
  ]);
  assert.equal(readHistory(dir, "BL-900").length, 2, "different ids mean different events, even with identical content");
  rmSync(dir, { recursive: true, force: true });
});

test("entries with no id are never deduplicated — there is nothing to compare them by", () => {
  const dir = sandbox();
  const e = { ts: "2026-08-01T10:00:00.000Z", task: "BL-900", field: "status", from: "pending", to: "done", actor: "agent:claude", source: "hook" };
  appendEntries(dir, "BL-900", [e, e]);
  assert.equal(readHistory(dir, "BL-900").length, 2);
  rmSync(dir, { recursive: true, force: true });
});

// -- The actor namespace (BL-1404, step 4) --------------------------------
//
// WHY: once accounts exist, a DECLARED "anne" has to be told apart from an
// AUTHENTICATED Anne. Without that distinction there is no team plan to sell,
// because that difference is exactly what a company pays for.
//
// The rule: the code DOES NOT GUESS the namespace. The author is stated by
// whoever knows it — just as with `source`. For a NEW record, a name with no
// namespace is an absence of declaration, so it lands as `unknown` rather than as

test("actor: a namespace is required for new records", () => {
  assert.equal(isValidActor("local:kamil"), true);
  assert.equal(isValidActor("agent:claude"), true);
  assert.equal(isValidActor("user:0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0"), true);
  assert.equal(isValidActor("unknown"), true, "the nobody-knows sentinel stays without a namespace");
});

test("actor: a name WITHOUT a namespace is not promoted — guessing is inventing", () => {
  // `claude` to agent, `founder` to czlowiek. Hurtowe dopisanie `local:`
  // would reclassify an agent as a person — a tidy untruth.
  assert.equal(normalizeActor("kamil"), "unknown");
  assert.equal(normalizeActor("claude"), "unknown");
});

test("actor: an unknown namespace does not pass", () => {
  assert.equal(normalizeActor("robot:x"), "unknown");
  assert.equal(normalizeActor("local:"), "unknown");
  assert.equal(normalizeActor(":kamil"), "unknown");
  assert.equal(normalizeActor("local:ka:mil"), "unknown");
});

test("actor: paths and junk still land as unknown", () => {
  assert.equal(normalizeActor("local:../../etc/passwd"), "unknown");
  assert.equal(normalizeActor("local:Founder Smith"), "unknown");
  assert.equal(normalizeActor(undefined), "unknown");
});

test("actor: split into namespace and name — old entries get the legacy namespace", () => {
  assert.deepEqual(actorParts("agent:claude"), { namespace: "agent", name: "claude" });
  assert.deepEqual(actorParts("user:abc"), { namespace: "user", name: "abc" });
  // An entry from before BL-1404 is explicitly marked as predating the convention,
  // rather than being forced into one of today's namespaces.
  assert.deepEqual(actorParts("claude"), { namespace: "legacy", name: "claude" });
  assert.deepEqual(actorParts("unknown"), { namespace: "unknown", name: "unknown" });
});

test("actor: a log from before BL-1404 reads unchanged — we do not rewrite history", () => {
  const dir = sandbox();
  appendEntries(dir, "BL-900", [
    // A BARE actor — this is what an entry looked like before BL-1404.
    { ts: "2026-08-01T10:00:00.000Z", task: "BL-900", field: "status", from: "pending", to: "done", actor: "claude", source: "hook" },
  ]);
  assert.equal(readHistory(dir, "BL-900")[0].actor, "claude", "bajty w logu zostaja nietkniete");
  rmSync(dir, { recursive: true, force: true });
});

test("actor: a record with a namespace travels the whole way to the file", () => {
  const dir = sandbox();
  const written = recordEdit(dir, {
    taskId: "BL-900", before: { status: "pending" }, after: { status: "done" },
    actor: "agent:claude", source: "hook",
  });
  assert.equal(written[0].actor, "agent:claude");
  assert.equal(readHistory(dir, "BL-900")[0].actor, "agent:claude");
  rmSync(dir, { recursive: true, force: true });
});

// -- Zarezerwowane typy zdarzen (BL-1404 krok 5) --------------------------
//
// We do not implement body history or comments. The schema is to ADMIT them, so
// that adding them is an append rather than a migration of somebody's data.

test("pseudo-fields: body and comment are reserved alongside created/deleted", () => {
  assert.equal(FIELD_BODY, "__body__");
  assert.equal(FIELD_COMMENT, "__comment__");
  for (const f of [FIELD_CREATED, FIELD_DELETED, FIELD_BODY, FIELD_COMMENT]) {
    assert.ok(PSEUDO_FIELDS.includes(f), f + " has to be in PSEUDO_FIELDS");
  }
  assert.equal(new Set(PSEUDO_FIELDS).size, PSEUDO_FIELDS.length, "bez duplikatow");
});

test("pseudo-fields: a body and a comment entry survive a write and a read", () => {
  const dir = sandbox();
  appendEntries(dir, "BL-900", [
    { id: "01J00000000000000000000BOD", ts: "2026-08-01T10:00:00.000Z", task: "BL-900", field: FIELD_BODY, from: "", to: "new body", actor: "user:abc", source: "server" },
    { id: "01J00000000000000000000COM", ts: "2026-08-01T10:01:00.000Z", task: "BL-900", field: FIELD_COMMENT, from: "", to: "support: klient zglosil ponownie", actor: "user:abc", source: "server" },
  ]);
  const entries = readHistory(dir, "BL-900");
  assert.equal(entries.length, 2);
  assert.equal(lastChangeByField(entries)[FIELD_COMMENT].to, "support: klient zglosil ponownie");
  rmSync(dir, { recursive: true, force: true });
});

test("pseudo-fields: a frontmatter diff NEVER produces them", () => {
  // Were they to leak into diffMeta, reconciliation would start inventing changes to
  // a body it does not read at all.
  const changes = diffMeta(metaFromText(taskFile()), metaFromText(taskFile({ status: "done" })));
  for (const c of changes) assert.ok(!PSEUDO_FIELDS.includes(c.field), "diffMeta wyprodukowal " + c.field);
});

// ── CLI history-record: the output must not lie about the author ──────────

const RECORDER = join(dirname(fileURLToPath(import.meta.url)), "..", "history-record.mjs");

/** The CLI resolves the directory through resolveBacklogDir, which needs a MARKER. */
function cliSandbox() {
  const dir = sandbox();
  writeFileSync(join(dir, "_template.md"), "---\nid: BL-NNN\n---\n", "utf8");
  return dir;
}

function runRecorder(dir, file, args) {
  return spawnSync(process.execPath, [RECORDER, "--dir", dir, "--file", file].concat(args || []), { encoding: "utf8" });
}

test("CLI: a bare --actor is rejected LOUDLY, not quietly degraded", () => {
  const dir = cliSandbox();
  const file = join(dir, "tasks", "BL-900-zrob-rzecz.md");
  runRecorder(dir, file, []);                                   // seed snapshotu
  writeFileSync(file, taskFile({ status: "done" }), "utf8");
  const r = runRecorder(dir, file, ["--actor", "kamil"]);
  assert.notEqual(r.status, 0, "a bad actor has to end in an error, not a success");
  const out = (r.stdout || "") + (r.stderr || "");
  assert.match(out, /kamil/, "the message has to show what was wrong");
  assert.match(out, /local:|agent:|user:/, "and say how to fix it");
  assert.equal(readHistory(dir, "BL-900").length, 0, "nothing was written");
  rmSync(dir, { recursive: true, force: true });
});

test("CLI: a valid actor passes and is reported in line with what was written", () => {
  const dir = cliSandbox();
  const file = join(dir, "tasks", "BL-900-zrob-rzecz.md");
  runRecorder(dir, file, []);
  writeFileSync(file, taskFile({ status: "done" }), "utf8");
  const r = runRecorder(dir, file, ["--actor", "local:kamil"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readHistory(dir, "BL-900")[0].actor, "local:kamil");
  rmSync(dir, { recursive: true, force: true });
});

