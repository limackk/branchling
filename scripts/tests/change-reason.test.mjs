/**
 * The reason for a change is recorded WITH the change, and is refused when it is
 * missing (TL-105).
 *
 * WHY THIS FILE EXISTS. The convention it replaces — a `## Log` section filled in
 * by hand — was described in the template, repeated in the skill and required by
 * the closing procedure, and the thing that decides whether such a layer exists
 * is not any of those. `actor` in the same repository has full coverage because a
 * record without a namespaced actor is REFUSED at write time. So the assertions
 * that matter here are the refusals, not the happy path.
 *
 * THE POSITIVE CONTROL. Every fixture below uses a status vocabulary that is NOT
 * the default (`open` / `parked` / `shipped` / `dropped`). A test written against
 * the literals `blocked` and `cancelled` would pass on a rule hard-coded in the
 * scripts, which is exactly the defect this design avoids: the list of statuses
 * requiring a reason is one project's vocabulary and lives in its config.yaml.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { auditReasons } from "../check-backlog-reasons.mjs";
import { loadConfig } from "../config.mjs";
import { TEMPLATE_FILENAME } from "../paths.mjs";
import { BACKLOG_DIR, REPO_ROOT } from "./_repo.mjs";
import {
  REASON_PROVEN,
  REASON_UNKNOWN,
  hasStatedReason,
  isValidReason,
  normalizeReason,
  readHistory,
  recordEdit,
  reconcile,
  requiresReason,
  metaFromText,
} from "../history.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const CLI = join(ROOT, "scripts", "cli.mjs");

// ── A backlog whose vocabulary shares no word with the defaults ───────────

const STATUSES = ["open", "parked", "shipped", "dropped"];

function configYaml(extra = "") {
  return [
    'project_name: "Fixture"',
    "task_id_prefix: FX",
    "statuses: [" + STATUSES.join(", ") + "]",
    "archived_statuses: [shipped, dropped]",
    "dashboard_open_statuses: [open, parked]",
    "priorities: [P0, P1, P2, P3]",
    "types: [task]",
    "labels: []",
    "owners: [unassigned]",
    "estimates: [30m, 2h, 1d, 1w]",
    "actors: [local:me, agent:claude]",
    "title_max_length: 60",
    extra,
    "",
  ].join("\n");
}

function taskFile(over = {}) {
  const f = Object.assign(
    {
      id: "FX-1", title: '"Do the thing"', type: "task", labels: "[]", board: "main",
      epic: '""', priority: "P2", status: "open", owner: "unassigned", estimate: "2h",
      confidence: "high", created: "2026-08-01", updated: "2026-08-01",
    },
    over
  );
  return [
    "---",
    ...Object.keys(f).map((k) => k + ": " + f[k]),
    "blocked_by: []",
    "blocks: []",
    "verification:",
    '  - bash: "true"',
    "---",
    "",
    "## Goal",
    "",
    "The body.",
    "",
  ].join("\n");
}

function sandbox(extraConfig = "", tasks = { "FX-1-do-the-thing.md": taskFile() }) {
  const dir = mkdtempSync(join(tmpdir(), "change-reason-"));
  mkdirSync(join(dir, "tasks"));
  writeFileSync(join(dir, "config.yaml"), configYaml(extraConfig), "utf8");
  writeFileSync(
    join(dir, "boards.yaml"),
    "default: main\nboards:\n  - slug: main\n    name: Main\n    paths: []\n",
    "utf8"
  );
  for (const [name, text] of Object.entries(tasks)) {
    writeFileSync(join(dir, "tasks", name), text, "utf8");
  }
  return dir;
}

function cli(args, dir) {
  return spawnSync(process.execPath, [CLI, ...args, "--dir", dir], { encoding: "utf8" });
}

// ── The value itself ──────────────────────────────────────────────────────

test("a reason nobody gave is `unknown`, never an empty string", () => {
  // "" and `unknown` are two different claims: "no reason was needed" and "nobody
  // was there to ask". Collapsing them loses the only interesting one.
  assert.equal(normalizeReason(""), REASON_UNKNOWN);
  assert.equal(normalizeReason(undefined), REASON_UNKNOWN);
  assert.equal(normalizeReason("   "), REASON_UNKNOWN);
});

test("the tool's own words are refused as somebody's answer", () => {
  assert.equal(isValidReason(REASON_UNKNOWN), false);
  assert.equal(isValidReason(REASON_PROVEN), false);
  assert.equal(isValidReason("blocked on the vendor's answer"), true);
  assert.equal(hasStatedReason({ reason: REASON_PROVEN }), false);
  assert.equal(hasStatedReason({ reason: "waiting on legal" }), true);
});

// ── The rule comes from the configuration, not from the code ──────────────

test("with no key stated, the rule falls back to `archived_statuses`", () => {
  const dir = sandbox();
  const config = loadConfig(dir);
  assert.deepEqual(config.reasonRequiredStatuses, ["shipped", "dropped"]);
  assert.equal(requiresReason(config, { field: "status", to: "dropped" }), true);
  assert.equal(requiresReason(config, { field: "status", to: "open" }), false);
  rmSync(dir, { recursive: true, force: true });
});

test("the stated key wins, and a value outside `statuses` fails the config", () => {
  const dir = sandbox("reason_required_statuses: [parked]");
  const config = loadConfig(dir);
  assert.deepEqual(config.reasonRequiredStatuses, ["parked"]);
  // POSITIVE CONTROL for the whole file: this project's `blocked`/`cancelled`
  // mean nothing here, and a rule written with those literals would answer wrong.
  assert.equal(requiresReason(config, { field: "status", to: "parked" }), true);
  assert.equal(requiresReason(config, { field: "status", to: "blocked" }), false);
  assert.equal(requiresReason(config, { field: "status", to: "cancelled" }), false);
  rmSync(dir, { recursive: true, force: true });

  const bad = sandbox("reason_required_statuses: [nonsense]");
  assert.throws(() => loadConfig(bad), /reason_required_statuses/);
  rmSync(bad, { recursive: true, force: true });
});

test("only a status change can require a reason — a title fix never does", () => {
  // A reason demanded on every field change produces "update" on every typo, and
  // a field that is always filled carries no signal a week later.
  const dir = sandbox("reason_required_statuses: [parked]");
  const config = loadConfig(dir);
  assert.equal(requiresReason(config, { field: "title", to: "parked" }), false);
  assert.equal(requiresReason(config, { field: "owner", to: "parked" }), false);
  rmSync(dir, { recursive: true, force: true });
});

// ── It reaches the record ─────────────────────────────────────────────────

test("a stated reason travels the whole way into the entry", () => {
  const dir = sandbox();
  recordEdit(dir, {
    taskId: "FX-1",
    before: metaFromText(taskFile()),
    after: metaFromText(taskFile({ status: "parked" })),
    actor: "local:me",
    source: "viewer",
    reason: "waiting on the vendor",
  });
  const entries = readHistory(dir, "FX-1");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].reason, "waiting on the vendor");
  rmSync(dir, { recursive: true, force: true });
});

test("one act, several fields — each entry carries the same reason", () => {
  // The reason belongs to the ACT. An answer readable only from whichever entry
  // happened to be first is an answer that depends on how you read the log.
  const dir = sandbox();
  recordEdit(dir, {
    taskId: "FX-1",
    before: metaFromText(taskFile()),
    after: metaFromText(taskFile({ status: "parked", owner: "local:me" })),
    actor: "local:me",
    source: "viewer",
    reason: "handing it over while it waits",
  });
  const entries = readHistory(dir, "FX-1");
  assert.ok(entries.length >= 2, "expected more than one field to change");
  for (const e of entries) assert.equal(e.reason, "handing it over while it waits");
  rmSync(dir, { recursive: true, force: true });
});

test("a change seen rather than made is recorded as `unknown`, explicitly", () => {
  const dir = sandbox();
  reconcile(dir, { actor: "agent:claude", source: "hook" });          // reference point
  writeFileSync(join(dir, "tasks", "FX-1-do-the-thing.md"), taskFile({ status: "parked" }), "utf8");
  const { entries } = reconcile(dir, { actor: "agent:claude", source: "hook" });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].reason, REASON_UNKNOWN);
  // The field is PRESENT. Absent, "nobody asked" and "no reason needed" would be
  // the same shape on disk.
  assert.ok("reason" in entries[0]);
  rmSync(dir, { recursive: true, force: true });
});

test("a person reconciling their own edits speaks for them", () => {
  const dir = sandbox();
  reconcile(dir, { actor: "local:me", source: "manual" });
  writeFileSync(join(dir, "tasks", "FX-1-do-the-thing.md"), taskFile({ status: "parked" }), "utf8");
  const { entries } = reconcile(dir, { actor: "local:me", source: "manual", reason: "vendor went quiet" });
  assert.equal(entries[0].reason, "vendor went quiet");
  rmSync(dir, { recursive: true, force: true });
});

// ── The refusals ──────────────────────────────────────────────────────────

test("`done` REFUSES a closure that needs a reason and has none", () => {
  const dir = sandbox("reason_required_statuses: [dropped]");
  const r = cli(["done", "FX-1", "--status", "dropped", "--actor", "local:me"], dir);
  // A REFUSAL (1), not a usage error: the flags are fine, it is this closure of
  // this task under this configuration that is not allowed without an answer.
  assert.equal(r.status, 1, r.stdout + r.stderr);
  // The message says WHICH transition and WHY, not just "a field is missing".
  assert.match(r.stderr, /dropped/);
  assert.match(r.stderr, /reason_required_statuses/);
  // Nothing was written: the file is untouched and there is no history.
  assert.match(readFileSync(join(dir, "tasks", "FX-1-do-the-thing.md"), "utf8"), /^status: open$/m);
  assert.deepEqual(readHistory(dir, "FX-1"), []);
  rmSync(dir, { recursive: true, force: true });
});

test("`done` with a reason closes, and the reason is in the record", () => {
  const dir = sandbox("reason_required_statuses: [dropped]");
  const r = cli(["done", "FX-1", "--status", "dropped", "--actor", "local:me", "--reason", "superseded by FX-9"], dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const entries = readHistory(dir, "FX-1");
  const statusEntry = entries.find((e) => e.field === "status");
  assert.equal(statusEntry.to, "dropped");
  assert.equal(statusEntry.reason, "superseded by FX-9");
  rmSync(dir, { recursive: true, force: true });
});

test("the default closing status needs no reason — the run is the reason", () => {
  // `shipped` is first in `archived_statuses`, so it is where `done` goes by
  // default, and it gets there by RUNNING the contract. Demanding a sentence
  // there teaches people to type "done" into a reason box.
  const dir = sandbox("reason_required_statuses: [shipped, dropped]");
  const r = cli(["done", "FX-1", "--actor", "local:me"], dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const statusEntry = readHistory(dir, "FX-1").find((e) => e.field === "status");
  assert.equal(statusEntry.to, "shipped");
  assert.equal(statusEntry.reason, REASON_PROVEN);
  rmSync(dir, { recursive: true, force: true });
});

test("`--reason unknown` is a USAGE error — a sentinel is not somebody's answer", () => {
  // Exit 2, not 1: the value is wrong whatever the task and the configuration
  // say, so it belongs with the other bad arguments.
  const dir = sandbox("reason_required_statuses: [dropped]");
  const r = cli(["done", "FX-1", "--status", "dropped", "--actor", "local:me", "--reason", REASON_UNKNOWN], dir);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /reserved/);
  rmSync(dir, { recursive: true, force: true });
});

test("`done` no longer appends a prose line to the task file", () => {
  // The section it used to write into is gone from the template: a second,
  // hand-kept copy of what the history already holds is the thing this change
  // removes.
  const dir = sandbox();
  const before = readFileSync(join(dir, "tasks", "FX-1-do-the-thing.md"), "utf8");
  const r = cli(["done", "FX-1", "--actor", "local:me"], dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const after = readFileSync(join(dir, "tasks", "FX-1-do-the-thing.md"), "utf8");
  assert.equal(after.replace(/^status: .*$/m, "").replace(/^updated: .*$/m, ""),
    before.replace(/^status: .*$/m, "").replace(/^updated: .*$/m, ""));
  rmSync(dir, { recursive: true, force: true });
});

// ── The report ────────────────────────────────────────────────────────────

test("`check --reasons` counts the gaps and never fails on them", () => {
  const dir = sandbox("reason_required_statuses: [parked]");
  reconcile(dir, { actor: "local:me", source: "manual" });
  writeFileSync(join(dir, "tasks", "FX-1-do-the-thing.md"), taskFile({ status: "parked" }), "utf8");
  reconcile(dir, { actor: "local:me", source: "manual" });

  const r = cli(["check", "--reasons"], dir);
  assert.equal(r.status, 0, "the report must not fail: its gaps are in the past");
  assert.match(r.stdout, /parked/);
  rmSync(dir, { recursive: true, force: true });
});

test("the report separates `unknown`, legacy rows and real gaps", () => {
  // Rolled into one number they read as "everybody skipped the question", which
  // of the three is the only one that is anybody's fault.
  const dir = sandbox("reason_required_statuses: [parked]");
  const config = loadConfig(dir);
  const history = {
    "FX-1": [
      { field: "status", to: "parked", reason: REASON_UNKNOWN, ts: "2026-08-01T00:00:00Z" },
      { field: "status", to: "parked", ts: "2026-08-02T00:00:00Z" },                       // pre-schema
      { field: "status", to: "parked", reason: "", ts: "2026-08-03T00:00:00Z" },           // asked, skipped
      { field: "status", to: "parked", reason: "vendor", ts: "2026-08-04T00:00:00Z" },     // answered
      { field: "title", to: "parked", reason: "", ts: "2026-08-05T00:00:00Z" },            // not a status
    ],
  };
  const out = auditReasons(config, history);
  assert.equal(out.required, 4);
  assert.equal(out.unwitnessed.length, 1);
  assert.equal(out.legacy.length, 1);
  assert.equal(out.gaps.length, 1);
  rmSync(dir, { recursive: true, force: true });
});

test("a bare `check` runs the report — a guard wired to nothing proves nothing", () => {
  const dir = sandbox();
  const r = cli(["check"], dir);
  assert.match(r.stdout, /reasons:/, "the default `check` run does not include the reasons report");
  rmSync(dir, { recursive: true, force: true });
});


// ── The replaced convention is not TAUGHT by a template ───────────────────

/**
 * TL-105 deleted `## Log` from the template that SHIPS, and its guard named
 * that ONE path. This repository keeps a second template — its own, the one
 * `new` actually reads here — and it kept the section, so `worktrail new` went
 * on writing "Append-only" into every task created in this checkout while the
 * guard stayed green. A rule about "the template" has to hold for every
 * template on disk, which is why the list below is derived, not typed.
 *
 * Both entries can resolve to the same path in a co-located checkout, where the
 * backlog IS the repository root; the set collapses them rather than judging
 * one file twice.
 */
const TEMPLATES = [...new Set([join(REPO_ROOT, TEMPLATE_FILENAME), join(BACKLOG_DIR, TEMPLATE_FILENAME)])];

/** The HEADING, not the word. `## Log` is the section this contract replaced;
 *  "log" inside a sentence is prose and none of this test's business. */
const LOG_HEADING = /^##[ \t]+Log[ \t]*$/m;

/** A backlog whose template is the one named by the caller. `init` copies the
 *  shipped template, so the overwrite is what makes the run judge the OTHER one
 *  as well — reading a file is not the same as proving what `new` writes. */
function backlogFrom(templatePath) {
  const dir = mkdtempSync(join(tmpdir(), "log-section-"));
  const r = spawnSync(process.execPath, [CLI, "init", "--dir", dir, "--no-example"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  writeFileSync(join(dir, TEMPLATE_FILENAME), readFileSync(templatePath, "utf8"), "utf8");
  return dir;
}

function createdTask(dir) {
  const r = spawnSync(process.execPath, [CLI, "new", "--dir", dir, "--title", "A fresh task"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const files = readdirSync(join(dir, "tasks"));
  assert.equal(files.length, 1, "expected exactly one created task, got: " + files.join(", "));
  return readFileSync(join(dir, "tasks", files[0]), "utf8");
}

test("no task template on disk still teaches `## Log`", () => {
  assert.ok(TEMPLATES.length > 0, "no template was found, so this check judged nothing");
  for (const path of TEMPLATES) {
    assert.doesNotMatch(
      readFileSync(path, "utf8"),
      LOG_HEADING,
      path + " still carries a `## Log` section; the reason for a change is the " +
        "`reason` field of the history record, not prose in the task file"
    );
  }
});

test("a freshly created task carries no `## Log` heading", () => {
  for (const path of TEMPLATES) {
    const dir = backlogFrom(path);
    try {
      assert.doesNotMatch(createdTask(dir), LOG_HEADING, "`new` from " + path + " wrote a `## Log` section");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("positive control: the same check CATCHES a template that carries the section", () => {
  // Without this, the two tests above are green on a template nobody read and on
  // a `new` that wrote nothing at all. A guard that cannot fail proves nothing.
  const dir = backlogFrom(TEMPLATES[0]);
  try {
    const path = join(dir, TEMPLATE_FILENAME);
    writeFileSync(path, readFileSync(path, "utf8") + "\n## Log\n\nAppend-only.\n", "utf8");
    assert.match(createdTask(dir), LOG_HEADING, "the section was put back and the check did not notice");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
