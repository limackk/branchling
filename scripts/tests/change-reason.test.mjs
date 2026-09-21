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
import { BACKLOG_DIR, REPO_ROOT, isolateHome } from "./_repo.mjs";
// The suite must not read the DEVELOPER's preferences: since TL-157 the actor
// chain reads the user layer, so a machine with `actor:` in its own config file
// would otherwise see every default-actor assertion below fail.
isolateHome("change-reason");

import {
  FIELD_COMMENT,
  REASON_MAX_LENGTH,
  REASON_PROVEN,
  REASON_SENTINELS,
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

test("a real command runs the report — a guard wired to nothing proves nothing", () => {
  // The point of this test never was WHICH command runs it. Since TL-383 the
  // default `check` is a release gate and carries only guards that can fail one;
  // this guard reports transitions that predate the rule requiring a reason, so
  // it cannot fail and moved to `audit`. Both of its remaining doors are checked,
  // because a guard reachable through neither is a guard nobody runs.
  const dir = sandbox();
  assert.match(cli(["audit"], dir).stdout, /reasons:/, "`audit` does not carry the reasons report");
  assert.match(cli(["check", "--reasons"], dir).stdout, /reasons:/, "asked for by name, the guard says nothing");
  assert.doesNotMatch(cli(["check"], dir).stdout, /reasons:/, "an advisory report leaked back into the release verdict");
  rmSync(dir, { recursive: true, force: true });
});


// ── The replaced convention is not TAUGHT by a template ───────────────────

/**
 * TL-105 deleted `## Log` from the template that SHIPS, and its guard named
 * that ONE path. This repository keeps a second template — its own, the one
 * `new` actually reads here — and it kept the section, so `branchling new` went
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

// ── A refusal names the cause it actually had (TL-167) ────────────────────

/**
 * `isValidReason()` answers `false` to three different questions — the value is
 * empty, it is one of the two reserved sentinels, or it is longer than
 * `REASON_MAX_LENGTH` — and every command that reads that boolean turns all
 * three into one sentence about the first two. A 600-character reason is
 * therefore refused as "empty or reserved", which it is neither of, while the
 * one number that would explain the refusal — how long it was — is missing and
 * the whole 600 characters are echoed back in its place.
 *
 * A message naming the wrong cause is worse than a bare "invalid": it sends the
 * reader looking for a rule their input does not break.
 *
 * WHAT IS ASSERTED, AND WHAT IS LEFT TO THE IMPLEMENTATION. Each case demands
 * that the message names ITS cause and no other. The wording is nobody's
 * business here; the three facts are. A too-long value must be answered with
 * two numbers — the length it had and the length allowed — and neither of the
 * other two causes. That is what keeps the test blind to the wording and
 * strict about which rule the value actually broke.
 *
 * THE POSITIVE CONTROL. Almost every assertion below is a NEGATIVE one — the
 * message must not say X — and a negative assertion is green against a command
 * that never ran the validator at all, because a typo in the flags would refuse
 * for its own reasons and satisfy all of them. So each entry in the table is
 * first put through `reaches the reason validator`, which passes today and must
 * go on passing: it proves the invocation is well formed and that the refusal
 * being read really is the one this file is about. Beyond that, every cause
 * carries a POSITIVE requirement of its own (the length, the sentinel, the
 * word "empty"), so a run against a command that died earlier fails rather than
 * passing quietly.
 */

/** Long enough to be over the limit whatever the limit becomes. */
const OVER_LIMIT = "x".repeat(REASON_MAX_LENGTH + 100);

/** Whitespace, not "" — the flag parsers refuse a missing value before the
 *  validator sees it, so a blank string is how the EMPTY cause is reached from
 *  the terminal at all. */
const BLANK = "   ";

/**
 * Every place a person's reason is judged by `isValidReason` and the answer is
 * printed at them. The validation is done by the argument parsers, before any
 * config or task is read, so a fixture backlog is enough for all of them.
 *
 * `emptyRefusedEarlier` marks the one site that is not part of the EMPTY case:
 * `ask` demands a question of its own before the shared validator runs, and its
 * message for a blank one is already specific. That is not this defect.
 */
const REASON_SITES = [
  { name: "take --reason", argv: (v) => ["take", "FX-1", "--actor", "local:me", "--reason", v] },
  { name: "handoff --reason", argv: (v) => ["handoff", "FX-1", "--to-role", "dev", "--actor", "local:me", "--reason", v] },
  { name: "next --reason", argv: (v) => ["next", "--actor", "local:me", "--reason", v] },
  { name: "decide --reason", argv: (v) => ["decide", "FX-1", "--actor", "local:me", "--reason", v] },
  { name: "history --reason", argv: (v) => ["history", "--actor", "local:me", "--reason", v] },
  { name: "ask --option", argv: (v) => ["ask", "FX-1", "--actor", "local:me", "--question", "which way?", "--option", v, "--option", "the other way"] },
  { name: "ask --question", argv: (v) => ["ask", "FX-1", "--actor", "local:me", "--question", v], emptyRefusedEarlier: true },
  { name: "done --reason", argv: (v) => ["done", "FX-1", "--actor", "local:me", "--reason", v] },
];

/** A guard iterating an empty table is green and proves nothing. The count is
 *  the six call sites TL-167 names, plus `--question`, which shares the
 *  validator and therefore the defect, plus `done --reason` (TL-254), which
 *  TL-167 missed because it phrased the same refusal in words of its own and
 *  the grep that found the others looked for one literal sentence. */
test("every call site that prints this refusal is in the table", () => {
  assert.equal(REASON_SITES.length, 8);
});

/** The refusal, as a person reads it. Exit 2, because a reserved or malformed
 *  reason is a bad ARGUMENT — wrong whatever the task and the configuration
 *  say — and that is where the existing sites already put it. */
function refusalFor(site, value) {
  const dir = sandbox();
  try {
    const r = cli(site.argv(value), dir);
    assert.equal(r.status, 2, site.name + " did not refuse:\n" + r.stdout + r.stderr);
    return r.stderr + r.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** `\b` around a number so that a limit of 500 is not read out of "1500". */
function names(n) {
  return new RegExp("\\b" + n + "\\b");
}

for (const site of REASON_SITES) {
  test("positive control: `" + site.name + "` reaches the reason validator", () => {
    // Passes today and must go on passing. Without it the three tests below are
    // green against a command that refused for a reason of its own.
    const text = refusalFor(site, REASON_UNKNOWN);
    assert.match(
      text,
      names(REASON_UNKNOWN),
      "the refusal does not quote the value it was given, so it is probably not the validator's"
    );
  });

  test("`" + site.name + "` too long: the message names the length, not the sentinels", () => {
    const text = refusalFor(site, OVER_LIMIT);
    // The two numbers that explain the refusal.
    assert.match(text, names(OVER_LIMIT.length), "the message does not say how long the value was");
    assert.match(text, names(REASON_MAX_LENGTH), "the message does not say how long a reason may be");
    // And not one word about the two rules this value does not break.
    assert.doesNotMatch(text, /empty/i, "a value of " + OVER_LIMIT.length + " characters is not empty");
    for (const sentinel of REASON_SENTINELS) {
      assert.doesNotMatch(text, names(sentinel), "the value is not the reserved word `" + sentinel + "`");
    }
    assert.doesNotMatch(text, /reserved/i, "nothing here is reserved");
    // A reason printed back in full is most of the refusal, and it buries the
    // one number that explains it.
    assert.ok(!text.includes(OVER_LIMIT), "the whole value is echoed back at the person who typed it");
  });

  test("`" + site.name + "` reserved: the message names the word, not a length", () => {
    const text = refusalFor(site, REASON_UNKNOWN);
    assert.match(text, names(REASON_UNKNOWN), "the message does not name the word that was refused");
    assert.doesNotMatch(text, /empty/i, "`" + REASON_UNKNOWN + "` is not empty");
    assert.doesNotMatch(text, names(REASON_MAX_LENGTH), "the length limit has nothing to do with this refusal");
  });

  if (!site.emptyRefusedEarlier) {
    test("`" + site.name + "` empty: the message says so, and says nothing else", () => {
      const text = refusalFor(site, BLANK);
      assert.match(text, /empty/i, "the message does not say the value was empty");
      for (const sentinel of REASON_SENTINELS) {
        assert.doesNotMatch(text, names(sentinel), "a blank value is not the reserved word `" + sentinel + "`");
      }
      assert.doesNotMatch(text, names(REASON_MAX_LENGTH), "the length limit has nothing to do with this refusal");
    });
  }
}

// ── The eighth site: an option read out of the log (TL-255) ───────────────

/**
 * `decide --choose <n>` answers a question by picking a row from the menu the
 * `ask` event carries, and the row BECOMES the decision's reason. The same
 * three rules therefore judge it — but the value did not arrive in a flag
 * somebody just typed: it was read out of `backlog/history/`, which can only
 * hold an unusable option if the log was edited by hand. That is why this site
 * is not in the table above: it returns a refusal object instead of throwing,
 * and its headline has to keep naming WHICH option, of WHICH question, could
 * not be recorded.
 *
 * TL-167 left it behind with a message that enumerated all three rules at once
 * and wrote the length limit out as a literal. What is asserted here is the
 * same contract the seven sites carry — each cause names itself and no other —
 * plus the two things this site alone owes: the option number and the question
 * id stay in the headline, and the limit is whatever `REASON_MAX_LENGTH` says,
 * not a number frozen into a sentence.
 */

/** A Crockford base32 event id, so `--resolves` accepts it and the row it
 *  names is the question this menu belongs to. */
const QUESTION_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

/** A backlog whose log already holds a question asked with ONE option. Written
 *  by hand on purpose: `ask` refuses an unusable option at the boundary, so the
 *  only way to reach this branch is the only way it happens in life. */
function sandboxWithOption(option) {
  const dir = sandbox();
  mkdirSync(join(dir, "history"), { recursive: true });
  const question = {
    id: QUESTION_ID, ts: "2026-08-01T10:00:00.000Z", task: "FX-1", field: FIELD_COMMENT,
    from: "", to: "which way?", actor: "local:me", source: "ask", reason: "which way?",
    options: [option], recommend: 1,
  };
  writeFileSync(join(dir, "history", "FX-1.jsonl"), JSON.stringify(question) + "\n", "utf8");
  return dir;
}

/** The refusal as a person reads it. Exit 1, not 2: the invocation is well
 *  formed and the task exists — what is wrong is the state of the log. */
function chooseRefusal(option) {
  const dir = sandboxWithOption(option);
  try {
    const r = cli(["decide", "FX-1", "--actor", "local:me", "--resolves", QUESTION_ID, "--choose", "1"], dir);
    assert.equal(r.status, 1, "`decide --choose` did not refuse:\n" + r.stdout + r.stderr);
    return r.stderr + r.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("positive control: `decide --choose` records an option that breaks no rule", () => {
  // Without this every assertion below is green against a command that refused
  // for a reason of its own — a malformed fixture, a flag it does not know.
  const dir = sandboxWithOption("take the slow road");
  try {
    const r = cli(["decide", "FX-1", "--actor", "local:me", "--resolves", QUESTION_ID, "--choose", "1"], dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(readFileSync(join(dir, "history", "FX-1.jsonl"), "utf8"), /take the slow road/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("`decide --choose` too long: the message names the length, not the sentinels", () => {
  const text = chooseRefusal(OVER_LIMIT);
  // The headline this site owes: which option, of which question.
  assert.match(text, /option 1 of 01ARZ3NDEKTSV4RRFFQ69G5FAV/, "the refusal does not say which option it is about");
  // The two numbers that explain it — the second read from the constant, so
  // moving the limit moves the sentence with it.
  assert.match(text, names(OVER_LIMIT.length), "the message does not say how long the option was");
  assert.match(text, names(REASON_MAX_LENGTH), "the message does not say how long a reason may be");
  // And not one word about the two rules this option does not break.
  assert.doesNotMatch(text, /empty/i, "an option of " + OVER_LIMIT.length + " characters is not empty");
  for (const sentinel of REASON_SENTINELS) {
    assert.doesNotMatch(text, names(sentinel), "the option is not the reserved word `" + sentinel + "`");
  }
  assert.doesNotMatch(text, /reserved/i, "nothing here is reserved");
  assert.ok(!text.includes(OVER_LIMIT), "the whole option is echoed back at the reader");
});

test("`decide --choose` reserved: the message names the word, not a length", () => {
  for (const sentinel of REASON_SENTINELS) {
    const text = chooseRefusal(sentinel);
    assert.match(text, /option 1 of 01ARZ3NDEKTSV4RRFFQ69G5FAV/, "the refusal does not say which option it is about");
    assert.match(text, names(sentinel), "the message does not name the word that was refused");
    assert.doesNotMatch(text, /empty/i, "`" + sentinel + "` is not empty");
    assert.doesNotMatch(text, names(REASON_MAX_LENGTH), "the length limit has nothing to do with this refusal");
  }
});

test("`decide --choose` empty: the message says so, and says nothing else", () => {
  const text = chooseRefusal(BLANK);
  assert.match(text, /option 1 of 01ARZ3NDEKTSV4RRFFQ69G5FAV/, "the refusal does not say which option it is about");
  assert.match(text, /empty/i, "the message does not say the option was empty");
  for (const sentinel of REASON_SENTINELS) {
    assert.doesNotMatch(text, names(sentinel), "a blank option is not the reserved word `" + sentinel + "`");
  }
  assert.doesNotMatch(text, names(REASON_MAX_LENGTH), "the length limit has nothing to do with this refusal");
});
