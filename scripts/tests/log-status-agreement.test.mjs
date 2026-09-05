/**
 * `## Log` versus `status:` — the drift nothing used to catch (TL-68).
 *
 * WHAT HAS TO BE PROVED, and why each half needs the other:
 *
 *   1. A CONSISTENT tree passes. On its own this is worthless: a guard that
 *      cannot fail passes every consistent tree too.
 *   2. A tree with a log AHEAD of its field FAILS. This is TL-52's actual
 *      defect — five `done` entries against `status: pending` — and it is the
 *      only half with evidential force, because this repository's own tree
 *      contains zero instances of it. A guard nobody has seen fire is a guard
 *      nobody has tested.
 *   3. A log merely BEHIND its field warns and does not fail. Not a detail: it
 *      is the difference between a guard that runs and one that gets switched
 *      off, since 27 of this repository's tasks are in exactly that state and
 *      no future write will ever change them.
 *   4. The second word is read against the CONFIGURATION's statuses. The tree
 *      writes `created`, `taken`, `renumbered` in that slot; a guard reading
 *      them as statuses would be wrong about 22 tasks on its first run.
 *
 * The fixtures are temporary directories. A test asserting against this
 * repository's own backlog would be asserting somebody's task file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { auditLogStatus, lastLoggedStatus } from "../check-backlog-log-status.mjs";
import { diagnose } from "../doctor.mjs";
import { loadConfig } from "../config.mjs";
import { parseCheckArgs } from "../cli.mjs";
import { BACKLOG_DIR, isolateHome, TASKS_DIR } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("log-status-agreement");


const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

let counter = 0;
function tmp() {
  return mkdtempSync(join(tmpdir(), "branchling-logstatus-" + counter++ + "-"));
}

function run(args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1" },
  });
}

/** A backlog with one task, whose status field and `## Log` are set by hand —
 *  which is exactly the state this guard exists to notice. */
function backlogWith({ status, log }) {
  const dir = tmp();
  const r = run(["init", "--dir", dir, "--no-example"]);
  assert.equal(r.status, 0, r.stderr);
  const nt = run(["new", "--dir", dir, "--title", "A task with a hand-written log"]);
  assert.equal(nt.status, 0, nt.stderr);
  const file = nt.stdout.match(/(\S+\.md)/)[1];
  let text = readFileSync(file, "utf8");
  text = text.replace(/^status: .*$/m, "status: " + status);
  if (log) text += "\n## Log\n\n" + log + "\n";
  writeFileSync(file, text);
  return { dir, file };
}

// The vocabulary the pure functions are judged against — declared here rather
// than borrowed from this project, because a test asserting another project's
// values is asserting data (AGENTS.md).
const CONFIG = { statuses: ["pending", "in_progress", "blocked", "done"], archivedStatuses: ["done"] };

// ── Reading one file ──────────────────────────────────────────────────────

test("no `## Log` at all is an absence of data, not a violation", () => {
  assert.equal(lastLoggedStatus("---\nstatus: done\n---\n\n## Goal\n\nx\n", CONFIG), null);
});

test("the LAST status-bearing entry is the one that counts", () => {
  const text = [
    "## Log", "",
    "- 2026-01-01 pending — local:me — opened",
    "- 2026-01-02 in_progress — local:me — started",
    "- 2026-01-03 done — local:me — finished",
  ].join("\n");
  assert.deepEqual(lastLoggedStatus(text, CONFIG), { status: "done", date: "2026-01-03" });
});

test("a word that is not in `statuses:` is prose in a slot, not a claim", () => {
  const text = [
    "## Log", "",
    "- 2026-01-02 done — local:me — finished",
    "- 2026-01-03 renumbered — local:me — TL-9 became TL-12",
    "- 2026-01-04 created — local:me — a follow-up",
  ].join("\n");
  // `renumbered` and `created` are events; the last STATUS claim is still `done`.
  assert.deepEqual(lastLoggedStatus(text, CONFIG), { status: "done", date: "2026-01-02" });
});

test("the vocabulary comes from the configuration, not from a list in the code", () => {
  const text = "## Log\n\n- 2026-01-02 shipped — local:me — out\n";
  assert.equal(lastLoggedStatus(text, CONFIG), null);
  assert.deepEqual(
    lastLoggedStatus(text, { statuses: ["icebox", "shipped"], archivedStatuses: ["shipped"] }),
    { status: "shipped", date: "2026-01-02" }
  );
});

test("entries are read with or without the leading dash", () => {
  assert.deepEqual(
    lastLoggedStatus("## Log\n\n2026-01-02 done — local:me — finished\n", CONFIG),
    { status: "done", date: "2026-01-02" }
  );
});

test("only the `## Log` section is read — a date in the body is not an entry", () => {
  const text = "## Goal\n\n2026-01-09 done — local:me — this is prose\n\n## Log\n\n- 2026-01-02 pending — local:me — opened\n";
  assert.deepEqual(lastLoggedStatus(text, CONFIG), { status: "pending", date: "2026-01-02" });
});

// ── The two directions ────────────────────────────────────────────────────

const file = (name, status, log) => ({ file: name, text: "---\nstatus: " + status + "\n---\n\n## Log\n\n" + log + "\n" });

test("the two directions are counted apart, and only one of them is a defect", () => {
  const audit = auditLogStatus([
    file("a.md", "pending", "- 2026-01-03 done — local:me — finished"),
    file("b.md", "done", "- 2026-01-01 pending — local:me — opened"),
    file("c.md", "done", "- 2026-01-03 done — local:me — finished"),
  ], CONFIG);

  assert.deepEqual(audit.ahead.map((r) => r.file), ["a.md"], "a closed log against an open field is the defect");
  assert.deepEqual(audit.behind.map((r) => r.file), ["b.md"], "a stale section is not");
  assert.equal(audit.logged, 3);
});

test("the row carries the file, BOTH values and the entry date", () => {
  const { ahead } = auditLogStatus([file("a.md", "pending", "- 2026-01-03 done — local:me — finished")], CONFIG);
  assert.deepEqual(ahead[0], { file: "a.md", date: "2026-01-03", logged: "done", field: "pending" });
});

test("a task with no log is not counted as agreeing — it is not counted at all", () => {
  const audit = auditLogStatus([{ file: "a.md", text: "---\nstatus: done\n---\n\nno log here\n" }], CONFIG);
  assert.equal(audit.logged, 0);
  assert.equal(audit.checked, 1);
});

// ── The command ───────────────────────────────────────────────────────────

test("a consistent tree passes — and the SAME tree fails once the log runs ahead", () => {
  const consistent = backlogWith({ status: "done", log: "- 2026-01-03 done — local:me — finished" });
  const green = run(["check", "--log-status", "--dir", consistent.dir]);
  assert.equal(green.status, 0, green.stdout + green.stderr);
  assert.match(green.stdout, /each agreeing with its field/);

  // The positive control, and the whole point of the guard: one field edited,
  // nothing else. TL-52's defect exactly.
  writeFileSync(consistent.file, readFileSync(consistent.file, "utf8").replace(/^status: done$/m, "status: pending"));
  const red = run(["check", "--log-status", "--dir", consistent.dir]);
  assert.equal(red.status, 1, "a log ahead of its field must fail");
  assert.match(red.stderr, /records a CLOSED status while the field is still open/);
  assert.match(red.stderr, /`## Log` 2026-01-03 says `done`, the field says `pending`/);
});

test("a log merely behind its field warns and does not fail", () => {
  const { dir } = backlogWith({ status: "done", log: "- 2026-01-01 pending — local:me — opened" });
  const r = run(["check", "--log-status", "--dir", dir]);
  assert.equal(r.status, 0, "stale prose must not turn check red");
  assert.match(r.stdout, /behind their field/);
  assert.match(r.stdout, /it does not fail/);
});

test("the guard fixes nothing — the file is byte-identical after a failing run", () => {
  const { dir, file: path } = backlogWith({ status: "pending", log: "- 2026-01-03 done — local:me — finished" });
  const before = readFileSync(path, "utf8");
  assert.equal(run(["check", "--log-status", "--dir", dir]).status, 1);
  assert.equal(readFileSync(path, "utf8"), before);
});

// ── The wiring ────────────────────────────────────────────────────────────

test("the guard joins the default run, and can be selected alone", () => {
  assert.equal(parseCheckArgs([]).wantLogStatus, true, "a new guard must join `check` with no selector");
  const only = parseCheckArgs(["--log-status"]);
  assert.equal(only.wantLogStatus, true);
  assert.equal(only.wantIds, false);
});

test("`check --json` reports the guard by name, so a consumer can see it ran", () => {
  const { dir } = backlogWith({ status: "pending", log: "- 2026-01-03 done — local:me — finished" });
  const r = run(["check", "--json", "--log-status", "--dir", dir]);
  const doc = JSON.parse(r.stdout);
  assert.deepEqual(doc.guards.map((g) => g.name), ["log-status"]);
  assert.deepEqual(doc.failed, ["log-status"]);
  assert.equal(doc.ok, false);
  assert.equal(r.status, 1, "the JSON describes the result, it does not replace the exit code");
});

test("doctor carries a log-status row, in all three states", () => {
  const bad = backlogWith({ status: "pending", log: "- 2026-01-03 done — local:me — finished" });
  const row = (dir) => diagnose(dir).find((r) => r.id === "log-status");
  assert.equal(row(bad.dir).status, "error");

  const stale = backlogWith({ status: "done", log: "- 2026-01-01 pending — local:me — opened" });
  assert.equal(row(stale.dir).status, "warn");

  const clean = backlogWith({ status: "done", log: "- 2026-01-03 done — local:me — finished" });
  assert.equal(row(clean.dir).status, "ok");
});

test("doctor exits non-zero on the failing direction and zero on the stale one", () => {
  const bad = backlogWith({ status: "pending", log: "- 2026-01-03 done — local:me — finished" });
  assert.equal(run(["doctor", "--dir", bad.dir]).status, 1);

  const stale = backlogWith({ status: "done", log: "- 2026-01-01 pending — local:me — opened" });
  const r = run(["doctor", "--dir", stale.dir]);
  // The whole run is in the message: this assertion has been seen to fail under
  // heavy parallel load, and "1 !== 0" alone says nothing about which row did it.
  assert.equal(r.status, 0, "a warning must not fail doctor\n" + r.stdout + r.stderr);
});

test("this repository's own tree has no log running ahead of a field", () => {
  // Not a tautology restated: the tests above prove the guard CAN fail, so a
  // green answer here is a statement about the tree rather than about the guard.
  // The directory comes from _repo.mjs, which settles both layouts — counting
  // upwards from this file would be co-location disguised as a rule (AGENTS.md).
  const config = loadConfig(BACKLOG_DIR);
  const { ahead, logged } = auditLogStatus(
    readdirSync(TASKS_DIR).filter((f) => f.endsWith(".md"))
      .map((f) => ({ file: f, text: readFileSync(join(TASKS_DIR, f), "utf8") })),
    config
  );
  assert.ok(logged > 0, "no logged tasks at all — this assertion would prove nothing");
  assert.deepEqual(ahead, []);
});
