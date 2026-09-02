/**
 * `docs-drift` — the detector, and the honesty rules that keep it readable (TL-100).
 *
 * WHAT HAS TO BE PROVED. TL-100 names the shape itself, and it is the same one
 * `audit` is held to: **every detector has a test where it finds something and
 * a test where it rightly stays silent.** Only the first half has evidential
 * force — a detector that never fires passes every "no findings" assertion —
 * and only the second says it is not simply flagging the whole tree.
 *
 * Beyond that, the four properties without which the report would itself be
 * misleading:
 *
 *   - a flag always carries its SPECIFIC signals; there is no bare verdict;
 *   - below `docs_drift_min_signals` a document is named under "too little
 *     signal" rather than called stale;
 *   - a detector that could not run SAYS so — a document git has never seen, a
 *     project with no status-heading convention — because silence meaning
 *     "nothing found" and silence meaning "nothing asked" read identically;
 *   - `--seed-tasks` is idempotent, and what it writes passes `check` and can
 *     actually be run.
 *
 * The fixture's vocabulary shares nothing with the defaults, so a status or a
 * role written as a literal in the code fails here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DETECTORS, alreadySeeded, deadReferences, driftReport, judgeDocument,
  normalizeDocPath, parseDriftArgs, seedTasks, statusClaims, tasksNewerThanDoc,
} from "../docs-drift.mjs";
import { taskIdPatterns } from "../task-id.mjs";
import { alignTemplate } from "./_repo.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

let counter = 0;
function run(args, opts = {}) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1", ...(opts.env || {}) },
    cwd: opts.cwd,
  });
}

// A vocabulary of the fixture's own — see the header. Nothing here is a default.
const IDS = taskIdPatterns("MAP");
const CONFIG = {
  archivedStatuses: ["charted"],
  taskId: IDS,
  titleMaxLength: 60,
  docsDrift: {
    taskThreshold: 3,
    minSignals: 2,
    pendingPatterns: ["^\\*\\*Progress:\\*\\*\\s+SURVEYING"],
    role: "scribe",
  },
};
const RE = () => new RegExp(IDS.anywhere.source, "g");

const task = (id, over = {}) => ({
  id, title: "T " + id, status: "icebox", related_docs: [], role: "",
  created: "2026-01-01", updated: "2026-02-01", ...over,
});

// ── The invocation ────────────────────────────────────────────────────────

test("an unknown flag and an unknown signal FAIL rather than being ignored", () => {
  assert.deepEqual(parseDriftArgs([]).signals, DETECTORS);
  assert.equal(parseDriftArgs(["--document", "docs/x.md"]).document, "docs/x.md");
  assert.deepEqual(parseDriftArgs(["--signal", "dead-refs", "--signal", "dead-refs"]).signals, ["dead-refs"]);
  assert.throws(() => parseDriftArgs(["--signal", "vibes"]), /unknown signal: vibes/);
  assert.throws(() => parseDriftArgs(["--stale"]), /unknown flag: --stale/);
  assert.throws(() => parseDriftArgs(["docs/x.md"]), /unexpected argument/);
  assert.throws(() => parseDriftArgs(["--document"]), /with no path/);
});

// ── Detector 1: tasks newer than the document ─────────────────────────────

const namingDoc = (n, over = {}) =>
  Array.from({ length: n }, (_, i) => task("MAP-" + (i + 1), {
    status: "charted", related_docs: ["docs/atlas.md"], updated: "2026-02-0" + (i + 1), ...over,
  }));

test("FINDS: enough tasks naming the document closed after it last changed", () => {
  const r = tasksNewerThanDoc(namingDoc(3), {
    doc: "docs/atlas.md", changed: "2026-01-15", archived: CONFIG.archivedStatuses, threshold: 3,
  });
  assert.equal(r.fired, true);
  assert.deepEqual(r.tasks.map((t) => t.task), ["MAP-1", "MAP-2", "MAP-3"]);
});

test("SILENT: one task under the threshold is the normal case, not drift", () => {
  const r = tasksNewerThanDoc(namingDoc(2), {
    doc: "docs/atlas.md", changed: "2026-01-15", archived: CONFIG.archivedStatuses, threshold: 3,
  });
  assert.equal(r.fired, false);
});

test("SILENT: tasks that closed BEFORE the document last changed", () => {
  const r = tasksNewerThanDoc(namingDoc(5), {
    doc: "docs/atlas.md", changed: "2026-03-01", archived: CONFIG.archivedStatuses, threshold: 3,
  });
  assert.equal(r.fired, false);
  assert.deepEqual(r.tasks, []);
});

test("SILENT: tasks that are still OPEN, however many name the document", () => {
  const r = tasksNewerThanDoc(namingDoc(5, { status: "surveying" }), {
    doc: "docs/atlas.md", changed: "2026-01-15", archived: CONFIG.archivedStatuses, threshold: 3,
  });
  assert.equal(r.fired, false);
});

test("a document git has never seen is a detector that COULD NOT RUN, not a clean one", () => {
  const r = tasksNewerThanDoc(namingDoc(5), {
    doc: "docs/atlas.md", changed: null, archived: CONFIG.archivedStatuses, threshold: 3,
  });
  assert.equal(r.fired, false);
  assert.match(r.reason, /no commit touching this document/);
});

// ── Detector 2: dead references ───────────────────────────────────────────

const noFiles = () => false;
const allFiles = () => true;

test("FINDS: a link to a file that is not there", () => {
  const r = deadReferences({
    doc: "docs/atlas.md", text: "see [the legend](legend.md)", exists: noFiles,
    root: "/repo", taskIds: new Set(), taskIdRe: RE(),
  });
  assert.equal(r.fired, true);
  assert.deepEqual(r.dead.map((d) => d.target), ["legend.md"]);
});

test("FINDS: a task id this backlog does not have", () => {
  const r = deadReferences({
    doc: "docs/atlas.md", text: "decided in MAP-9", exists: allFiles,
    root: "/repo", taskIds: new Set(["MAP-1"]), taskIdRe: RE(),
  });
  assert.deepEqual(r.dead, [{ kind: "task", target: "MAP-9", line: 1 }]);
});

test("SILENT: every link resolves and every task named exists", () => {
  const r = deadReferences({
    doc: "docs/atlas.md", text: "see [the legend](legend.md), decided in MAP-1", exists: allFiles,
    root: "/repo", taskIds: new Set(["MAP-1"]), taskIdRe: RE(),
  });
  assert.equal(r.fired, false);
});

test("SILENT: an external link is not a dead file", () => {
  const r = deadReferences({
    doc: "docs/atlas.md", text: "see [upstream](https://example.invalid/x)", exists: noFiles,
    root: "/repo", taskIds: new Set(), taskIdRe: RE(),
  });
  assert.deepEqual(r.dead, []);
});

// ── Detector 3: a status claim that has stopped being true ────────────────

const claimText = "# Atlas\n\n**Progress:** SURVEYING (MAP-1, MAP-2)\n";

test("FINDS: a line claiming work is still ahead, naming only closed tasks", () => {
  const r = statusClaims({
    text: claimText, patterns: CONFIG.docsDrift.pendingPatterns, archived: CONFIG.archivedStatuses,
    taskIdRe: RE(), statusById: new Map([["MAP-1", "charted"], ["MAP-2", "charted"]]),
  });
  assert.equal(r.fired, true);
  assert.deepEqual(r.claims[0].tasks, ["MAP-1", "MAP-2"]);
  assert.equal(r.claims[0].line, 3);
});

test("SILENT: one of the tasks it names is still open — the claim is true", () => {
  const r = statusClaims({
    text: claimText, patterns: CONFIG.docsDrift.pendingPatterns, archived: CONFIG.archivedStatuses,
    taskIdRe: RE(), statusById: new Map([["MAP-1", "charted"], ["MAP-2", "surveying"]]),
  });
  assert.equal(r.fired, false);
});

test("SILENT: a line that does not match this project's pending convention", () => {
  const r = statusClaims({
    text: "**Progress:** CHARTED (MAP-1)\n", patterns: CONFIG.docsDrift.pendingPatterns,
    archived: CONFIG.archivedStatuses, taskIdRe: RE(), statusById: new Map([["MAP-1", "charted"]]),
  });
  assert.equal(r.fired, false);
});

test("with no patterns declared the detector says it was never asked anything", () => {
  const r = statusClaims({
    text: claimText, patterns: [], archived: CONFIG.archivedStatuses,
    taskIdRe: RE(), statusById: new Map([["MAP-1", "charted"]]),
  });
  assert.equal(r.fired, false);
  assert.match(r.reason, /docs_status_pending_patterns` is empty/);
});

// ── The threshold, and the "too little signal" class ──────────────────────

const doc = (over = {}) => ({ doc: "docs/atlas.md", text: "", changed: "2026-01-15", ...over });

test("a document below the signal threshold is NAMED, not flagged", () => {
  const report = driftReport({
    documents: [doc({ text: "see [the legend](legend.md)" })],
    tasks: [], config: CONFIG, exists: noFiles, root: "/repo", signals: DETECTORS,
  });
  assert.deepEqual(report.flagged, []);
  assert.equal(report.tooLittle.length, 1, "one dead link is a typo, and it must not vanish either");
  assert.equal(report.tooLittle[0].signals.length, 1);
});

test("a document with enough signal is flagged, and every signal is spelled out", () => {
  const report = driftReport({
    documents: [doc({ text: "see [the legend](legend.md) and [the key](key.md)" })],
    tasks: [], config: CONFIG, exists: noFiles, root: "/repo", signals: DETECTORS,
  });
  assert.equal(report.flagged.length, 1);
  const targets = report.flagged[0].signals.flatMap((s) => s.items).join(" ");
  assert.match(targets, /legend\.md/);
  assert.match(targets, /key\.md/);
  for (const s of report.flagged[0].signals) {
    assert.ok(s.detail && s.items.length, "a verdict with no evidence cannot be argued with");
  }
});

test("a fresh document with nothing wrong is not reported at all", () => {
  const report = driftReport({
    documents: [doc({ text: "# Atlas\n\nAll current.\n", changed: "2026-03-01" })],
    tasks: namingDoc(5), config: CONFIG, exists: allFiles, root: "/repo", signals: DETECTORS,
  });
  assert.deepEqual(report.flagged, []);
  assert.deepEqual(report.tooLittle, []);
});

test("--signal narrows which detectors are asked", () => {
  const documents = [doc({ text: claimText })];
  const tasks = namingDoc(5);
  const statuses = { config: CONFIG, exists: allFiles, root: "/repo" };
  const all = judgeDocument({ ...documents[0], tasks, ...statuses, signals: DETECTORS });
  assert.ok(all.signals.some((s) => s.detector === "tasks-newer"));
  const narrowed = judgeDocument({ ...documents[0], tasks, ...statuses, signals: ["dead-refs"] });
  assert.deepEqual(narrowed.signals.map((s) => s.detector), []);
  assert.deepEqual(narrowed.notes, [], "a detector nobody asked for is not a detector that could not run");
});

// ── Seeding ───────────────────────────────────────────────────────────────

test("a document already covered by an OPEN task in the docs role is skipped", () => {
  const report = { flagged: [{ doc: "docs/atlas.md", signals: [], notes: [] }] };
  const open = [task("MAP-7", { role: "scribe", related_docs: ["docs/atlas.md"] })];
  const covered = alreadySeeded(open, { role: "scribe", archived: CONFIG.archivedStatuses });
  assert.equal(covered.get("docs/atlas.md"), "MAP-7");

  const created = [];
  const r = seedTasks(report, {
    tasks: open, config: CONFIG, board: "main",
    create: (spec) => { created.push(spec); return { taskId: "MAP-8", path: "x" }; },
  });
  assert.deepEqual(created, [], "a second run must create nothing");
  assert.deepEqual(r.skipped.map((s) => s.task), ["MAP-7"]);
});

test("a CLOSED docs task does not cover the document any more", () => {
  const closed = [task("MAP-7", { role: "scribe", status: "charted", related_docs: ["docs/atlas.md"] })];
  const covered = alreadySeeded(closed, { role: "scribe", archived: CONFIG.archivedStatuses });
  assert.equal(covered.size, 0);
});

test("a task in another role does not cover the document", () => {
  const other = [task("MAP-7", { role: "", related_docs: ["docs/atlas.md"] })];
  assert.equal(alreadySeeded(other, { role: "scribe", archived: CONFIG.archivedStatuses }).size, 0);
});

test("the seeded contract gates on detectors 1 and 2 only", () => {
  const report = { flagged: [{ doc: "docs/atlas.md", signals: [], notes: [] }] };
  let spec = null;
  seedTasks(report, { tasks: [], config: CONFIG, board: "main", create: (s) => { spec = s; return { taskId: "MAP-9", path: "x" }; } });
  assert.equal(spec.role, "scribe");
  assert.deepEqual(spec.relatedDocs, ["docs/atlas.md"]);
  const command = spec.verification[0].bash;
  assert.match(command, /--signal tasks-newer/);
  assert.match(command, /--signal dead-refs/);
  assert.ok(!command.includes("status-claim"),
    "a sentence somebody deliberately left as it stands must not block a close");
});

test("a path is compared in one shape, whatever separator it arrived in", () => {
  assert.equal(normalizeDocPath("./docs/atlas.md"), "docs/atlas.md");
  assert.equal(normalizeDocPath("/docs/atlas.md"), "docs/atlas.md");
});

// ── The command, over a real tree ─────────────────────────────────────────

function git(dir, args, env = {}) {
  const r = spawnSync("git", ["-C", dir].concat(args), { encoding: "utf8", env: { ...process.env, ...env } });
  assert.equal(r.status, 0, r.stderr);
  return r;
}

/** A repository with its OWN vocabulary, a git history and a `docs/` tree. */
function repo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "worktrail-drift-" + counter++ + "-")));
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "fixture@example.invalid"]);
  git(dir, ["config", "user.name", "Fixture"]);

  assert.equal(run(["init", "--dir", dir, "--no-example"]).status, 0);
  const p = join(dir, "config.yaml");
  writeFileSync(p, readFileSync(p, "utf8")
    .replace(/^task_id_prefix:.*$/m, "task_id_prefix: MAP")
    .replace(/^statuses:.*$/m, "statuses: [icebox, surveying, charted]")
    .replace(/^archived_statuses:.*$/m, "archived_statuses: [charted]")
    .replace(/^dashboard_open_statuses:.*$/m, "dashboard_open_statuses: [icebox, surveying]")
    .replace(/^reason_required_statuses:.*$/m, "reason_required_statuses: [charted]")
    + [
      "",
      "roles: [scribe]",
      "docs_role: scribe",
      "docs_drift_task_threshold: 3",
      "docs_drift_min_signals: 2",
      "docs_status_pending_patterns:",
      '  - "^\\\\*\\\\*Progress:\\\\*\\\\*\\\\s+SURVEYING"',
      "",
    ].join("\n"), "utf8");
  alignTemplate(dir);
  return dir;
}

/** Commit the tree at a fixed date, so `git log --format=%cs` is deterministic. */
function commit(dir, when) {
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "fixture"], {
    GIT_AUTHOR_DATE: when + "T00:00:00+00:00", GIT_COMMITTER_DATE: when + "T00:00:00+00:00",
  });
}

test("a clean tree exits 0; a document with two dead targets exits 1 and names them", () => {
  const dir = repo();
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs", "atlas.md"), "# Atlas\n\nNothing wrong here.\n", "utf8");
  commit(dir, "2026-01-15");

  const clean = run(["docs-drift", "--dir", dir]);
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.match(clean.stdout, /nothing to report/);

  writeFileSync(join(dir, "docs", "atlas.md"),
    "# Atlas\n\nsee [the legend](legend.md) and [the key](key.md)\n", "utf8");
  const dirty = run(["docs-drift", "--dir", dir]);
  assert.equal(dirty.status, 1, "a flagged document must be visible in the exit code");
  assert.match(dirty.stdout, /legend\.md/);
  assert.match(dirty.stdout, /key\.md/);
});

test("--json carries the signals, and the vocabulary is the project's own", () => {
  const dir = repo();
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs", "atlas.md"),
    "# Atlas\n\nsee [the legend](legend.md) and [the key](key.md)\n", "utf8");
  commit(dir, "2026-01-15");

  const r = run(["docs-drift", "--dir", dir, "--json"]);
  const out = JSON.parse(r.stdout);
  assert.equal(out.kind, "docs-drift");
  assert.equal(out.flagged.length, 1);
  assert.equal(out.flagged[0].doc, "docs/atlas.md");
  assert.equal(out.flagged[0].signals.length, 2);
  for (const word of ["pending", "in_progress", "done", "cancelled"]) {
    assert.ok(!r.stdout.includes(word), "a default status leaked into the report: " + word);
  }
});

test("--document judges one document, and refuses a path that is not there", () => {
  const dir = repo();
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs", "atlas.md"), "# Atlas\n\nall current\n", "utf8");
  writeFileSync(join(dir, "docs", "keys.md"), "[a](a.md) [b](b.md)\n", "utf8");
  commit(dir, "2026-01-15");

  assert.equal(run(["docs-drift", "--dir", dir, "--document", "docs/atlas.md"]).status, 0);
  assert.equal(run(["docs-drift", "--dir", dir, "--document", "docs/keys.md"]).status, 1);
  const missing = run(["docs-drift", "--dir", dir, "--document", "docs/nowhere.md"]);
  assert.equal(missing.status, 2, "a typo in a path must not read as a clean document");
});

test("--seed-tasks writes one task per flagged document, and a second run writes none", () => {
  const dir = repo();
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs", "atlas.md"), "[a](a.md) [b](b.md)\n", "utf8");
  commit(dir, "2026-01-15");

  const first = run(["docs-drift", "--dir", dir, "--seed-tasks"]);
  assert.equal(first.status, 1, first.stdout + first.stderr);
  const id = first.stdout.match(/MAP-\d+/);
  assert.ok(id, "the seeded task's id has to be reported: " + first.stdout);

  const second = run(["docs-drift", "--dir", dir, "--seed-tasks"]);
  assert.match(second.stdout, /already covered by MAP-\d+/);
  const before = run(["query", "--dir", dir, "--role", "scribe", "--count"]).stdout.trim();
  assert.equal(before, "1", "a second run created a duplicate: " + before);
});

test("what --seed-tasks writes passes check, and its contract really runs", () => {
  const dir = repo();
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs", "atlas.md"), "[a](a.md) [b](b.md)\n", "utf8");
  commit(dir, "2026-01-15");
  assert.equal(run(["docs-drift", "--dir", dir, "--seed-tasks"]).status, 1);

  // The contract as written into the task, run the way `done` would run it: from
  // the repository root, through a `worktrail` on PATH.
  const file = run(["query", "--dir", dir, "--role", "scribe", "--files"]).stdout.trim();
  const contract = readFileSync(join(dir, file), "utf8").match(/bash: "(.+)"/)[1];
  const bin = join(dir, ".bin");
  mkdirSync(bin, { recursive: true });
  const shim = join(bin, "worktrail");
  writeFileSync(shim, '#!/bin/sh\nexec "' + process.execPath + '" "' + CLI + '" "$@"\n', "utf8");
  chmodSync(shim, 0o755);
  const sh = (cmd) => spawnSync("/bin/sh", ["-c", cmd], {
    cwd: dir, encoding: "utf8", env: { ...process.env, NO_COLOR: "1", PATH: bin + ":" + process.env.PATH },
  });

  assert.equal(sh(contract).status, 1, "the contract must FAIL while the document is still broken");
  writeFileSync(join(dir, "docs", "a.md"), "a\n", "utf8");
  writeFileSync(join(dir, "docs", "b.md"), "b\n", "utf8");
  assert.equal(sh(contract).status, 0, "and pass once the document is repaired");

  // Only now: `check` judges the SET, and until the document was repaired the
  // dead links it was seeded for were a real finding of its own.
  const check = run(["check", "--dir", dir]);
  assert.equal(check.status, 0, check.stdout + check.stderr);
});

test("--seed-tasks REFUSES when the project has not said who maintains its docs", () => {
  const dir = repo();
  const p = join(dir, "config.yaml");
  writeFileSync(p, readFileSync(p, "utf8").replace(/^docs_role:.*$/m, 'docs_role: ""'), "utf8");
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs", "atlas.md"), "[a](a.md) [b](b.md)\n", "utf8");
  commit(dir, "2026-01-15");

  const r = run(["docs-drift", "--dir", dir, "--seed-tasks"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /who maintains its documentation/);
});
