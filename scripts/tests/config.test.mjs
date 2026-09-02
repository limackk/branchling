/**
 * The contract of the backlog configuration (BL-1400).
 *
 * Two kinds of assertion, and both are needed:
 *
 * 1. THE PARSER AND THE CONSISTENCY RULES — an unknown key has to be a PROBLEM
 *    rather than a silent loss, because a typo in a vocabulary would otherwise
 *    only show up much later, when a field is written.
 * 2. THE GENERICNESS OF THE DEFAULTS — DEFAULTS must not know any particular
 *    project's vocabulary. That is the whole point of this change: a fresh
 *    repository must not be handed somebody else's labels.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULTS,
  loadConfig,
  parseBoardsYaml,
  parseConfigYaml,
  validateConfig,
} from "../config.mjs";

import { spawnSync } from "node:child_process";

import { BACKLOG_DIR as REAL_BACKLOG, SCRIPTS_DIR } from "./_repo.mjs";
import { queueStatuses } from "../next-task.mjs";

function sandbox(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "backlog-config-"));
  mkdirSync(join(dir, "tasks"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text, "utf8");
  return dir;
}

/**
 * A minimal, VALID configuration — the starting point for the validation tests.
 * We take it from loadConfig rather than from a literal, so that the test does
 * not drift away from the shape the code actually produces.
 */
function baseConfig() {
  const dir = sandbox({ "config.yaml": "project_name: \"Test\"\n" });
  try {
    return loadConfig(dir, { strict: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── Parser ────────────────────────────────────────────────────────────────

test("the parser reads an inline list, a block list, a number, a bool and a map", () => {
  const { values, problems } = parseConfigYaml([
    "statuses: [pending, done]",
    "labels:",
    "  - pre-launch   # a comment next to the entry",
    "  - prod",
    "labels_closed: true",
    "title_max_length: 42",
    "epic_aliases:",
    '  "A / B": "A (B)"',
    "",
  ].join("\n"));
  assert.deepEqual(problems, []);
  assert.deepEqual(values.statuses, ["pending", "done"]);
  assert.deepEqual(values.labels, ["pre-launch", "prod"]);
  assert.equal(values.labels_closed, true);
  assert.equal(values.title_max_length, 42);
  assert.deepEqual(values.epic_aliases, { "A / B": "A (B)" });
});

test("an unknown key is a PROBLEM, not a silent loss", () => {
  const { problems } = parseConfigYaml("statusez: [pending]\n");
  assert.equal(problems.length, 1);
  assert.match(problems[0], /unknown key `statusez`/);
});

test("a bad number and a bad bool are reported", () => {
  assert.match(parseConfigYaml("title_max_length: lots\n").problems[0], /is not a number/);
  assert.match(parseConfigYaml("labels_closed: yes\n").problems[0], /true\/false/);
});

test("a # inside quotes stays, a comment after the value goes", () => {
  const { values } = parseConfigYaml([
    "dashboard_burndown_value: pre-launch   # the default axis",
    "epic_aliases:",
    '  "Sprint #1": "Sprint 1"',
  ].join("\n"));
  assert.equal(values.dashboard_burndown_value, "pre-launch");
  assert.deepEqual(values.epic_aliases, { "Sprint #1": "Sprint 1" });
});

// ── boards.yaml ───────────────────────────────────────────────────────────

test("the boards parser reads slug, name, paths and ignore_paths", () => {
  const r = parseBoardsYaml([
    "ignore_paths:",
    '  - "backlog/README.md"',
    "default: main",
    "boards:",
    "  - slug: main",
    '    name: "Main"',
    "  - slug: tooling",
    '    name: "Tooling"',
    "    paths:",
    '      - "backlog/scripts/**"',
  ].join("\n"));
  assert.equal(r.default, "main");
  assert.deepEqual(r.ignorePaths, ["backlog/README.md"]);
  assert.deepEqual(r.boards.map((b) => b.slug), ["main", "tooling"]);
  assert.equal(r.boards[1].name, "Tooling");
  assert.deepEqual(r.boards[1].paths, ["backlog/scripts/**"]);
  assert.deepEqual(r.boards[0].paths, []);
});

// ── Consistency ───────────────────────────────────────────────────────────

test("an archived status outside `statuses` fails", () => {
  const dir = sandbox({ "config.yaml": "statuses: [pending, done]\narchived_statuses: [done, wontfix]\n" });
  assert.throws(() => loadConfig(dir), /wontfix/);
  rmSync(dir, { recursive: true, force: true });
});

test("a board `default:` outside the list fails", () => {
  const dir = sandbox({ "boards.yaml": "default: nosuchboard\nboards:\n  - slug: main\n" });
  assert.throws(() => loadConfig(dir), /default: nosuchboard/);
  rmSync(dir, { recursive: true, force: true });
});

test("strict:false returns the problems instead of throwing (a guard wants to print them)", () => {
  const dir = sandbox({ "config.yaml": "archived_statuses: [wontfix]\n" });
  const cfg = loadConfig(dir, { strict: false });
  assert.ok(cfg.problems.length);
  rmSync(dir, { recursive: true, force: true });
});

test("no config.yaml means DEFAULTS, not a crash", () => {
  const dir = sandbox({ "boards.yaml": "default: main\nboards:\n  - slug: main\n" });
  const cfg = loadConfig(dir);
  assert.deepEqual(cfg.statuses, DEFAULTS.statuses);
  assert.deepEqual(cfg.labels, []);
  assert.equal(cfg.defaultBoard, "main");
  rmSync(dir, { recursive: true, force: true });
});

// ── The genericness of the defaults ───────────────────────────────────────

test("DEFAULTS know no particular project's vocabulary — that is the whole point", () => {
  const serialized = JSON.stringify(DEFAULTS);
  for (const foreign of ["pre-launch", "post-launch", "test_env", "data-gated", "ops-hardening", "founder", "claude", "manual"]) {
    assert.equal(serialized.includes(foreign), false, `DEFAULTS contains "${foreign}" — that is one project's value, not a default`);
  }
  assert.deepEqual(DEFAULTS.labels, []);
  assert.equal(DEFAULTS.labels_closed, false);
});

test("`roles` is empty by default, and a declared vocabulary reaches the config", () => {
  // The empty default is the load-bearing half (TL-97): it is what makes "this
  // project does not use roles" the out-of-the-box answer, so a stray `role:` in
  // somebody's tree fails instead of inventing a requirement nobody serves.
  assert.deepEqual(DEFAULTS.roles, []);
  const dir = sandbox({ "config.yaml": "roles: [archivist, stonemason]\n" });
  assert.deepEqual(loadConfig(dir).roles, ["archivist", "stonemason"]);
  rmSync(dir, { recursive: true, force: true });
});

test("activeStatuses is derived from statuses minus archived (not from a second list)", () => {
  const dir = sandbox({ "config.yaml": "statuses: [a, b, c]\narchived_statuses: [c]\ndashboard_open_statuses: [a]\n" });
  assert.deepEqual(loadConfig(dir).activeStatuses, ["a", "b"]);
  rmSync(dir, { recursive: true, force: true });
});

// ── The gate: the code knows no project's vocabulary ──────────────────────

test("a viewer built from a foreign configuration carries no other project's vocabulary", async () => {
  const { buildHtml, computeStats } = await import("../build-viewer.mjs");
  const dir = sandbox({
    "config.yaml": [
      'project_name: "Demo"',
      "statuses: [todo, doing, shipped]",
      "archived_statuses: [shipped]",
      "priorities: [now, later]",
      "types: [feature]",
      "labels: [ui]",
      "labels_closed: true",
      "label_axis_timing: []",
      "label_axis_env: []",
      "actors: [local:ada]",
      "dashboard_open_statuses: [todo, doing]",
      "dashboard_burndown_kind: board",
      "dashboard_burndown_value: core",
      "",
    ].join("\n"),
    "boards.yaml": "default: core\nboards:\n  - slug: core\n    name: \"Core\"\n",
  });
  const config = loadConfig(dir);
  const html = buildHtml([], computeStats([]), config, {});

  // No other project's values may appear in a page built for a different
  // project. This is the test of the WHOLE BL-1400 change — one place that catches
  // every new hardcoded value in the viewer's code.
  for (const word of ["pre-launch", "post-launch", "test_env", "data-gated", "ops-hardening", "on_queue"]) {
    assert.equal(html.includes(word), false, `the built viewer contains "${word}" despite a different configuration`);
  }
  assert.ok(html.includes("Demo"));
  assert.ok(html.includes("doing"));
  rmSync(dir, { recursive: true, force: true });
});

test("project_name has a generic default and can be OVERRIDDEN from config.yaml", () => {
  assert.equal(DEFAULTS.project_name, "Backlog");

  // The second assertion used to read the project name out of THIS repository's
  // config.yaml — that is, it checked what one project had written into its own
  // file. The tool's contract is that the value from the file WINS over the
  // default, not that somebody happened to write that particular one (BL-1448).
  const dir = sandbox({ "config.yaml": 'project_name: "Anything Else"\n' });
  try {
    assert.equal(loadConfig(dir).projectName, "Anything Else");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // A positive control: with no file the default has to remain. Without this
  // clause the test would also pass for code that ignores the default and always
  // reads the file.
  const bare = sandbox();
  try {
    assert.equal(loadConfig(bare).projectName, DEFAULTS.project_name);
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }
});

// ── Parity with the code from before BL-1400 ──────────────────────────────

// REMOVED (BL-1448): "the project's config.yaml reproduces the vocabularies that
// used to be hardcoded".
//
// It was a one-off proof of PARITY at BL-1400: that moving the vocabularies out
// of the code and into config.yaml lost nothing. It checked 14 concrete values of
// one project — its statuses, labels, epic aliases, board slugs. In this
// repository there is nothing to compare them against, and rewriting them to the
// values of THIS config.yaml would give a test that says only "the file contains
// what the file contains".
//
// What we therefore do NOT have: parity with the code from before BL-1400. That
// was a one-off proof and it was delivered where it made sense — in the
// repository that went through the migration. The contract that REMAINS covered:
// "an unknown key is a PROBLEM", "an archived status outside statuses fails", "no
// config.yaml means DEFAULTS", "DEFAULTS know no project's vocabulary" — all on
// fixtures.

// ── Actors with a namespace (BL-1404 step 4) ──────────────────────────────

test("config: an actor with no namespace FAILS, with a message saying what to write", () => {
  const problems = validateConfig(Object.assign({}, baseConfig(), { actors: ["founder", "claude"] }));
  assert.equal(problems.length, 2, "every bad actor has to be reported separately");
  assert.match(problems[0], /founder/);
  assert.match(problems[0], /local:|agent:|user:/, "the message has to name the allowed namespaces");
});

test("config: actors with a namespace pass", () => {
  const problems = validateConfig(Object.assign({}, baseConfig(), { actors: ["local:founder", "agent:claude", "user:abc-123"] }));
  assert.deepEqual(problems, []);
});

test("config: an unknown actor namespace FAILS", () => {
  const problems = validateConfig(Object.assign({}, baseConfig(), { actors: ["robot:r2d2"] }));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /robot:r2d2/);
});


// ── What a FRESH backlog protects (TL-140) ────────────────────────────────

test("`init` DECLARES reason_required_statuses, so a fresh backlog matches the documentation", () => {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-fresh-"));
  try {
    const r = spawnSync(process.execPath, [join(SCRIPTS_DIR, "cli.mjs"), "init", "--dir", dir, "--no-example"], {
      encoding: "utf8", env: { ...process.env, NO_COLOR: "1" },
    });
    assert.equal(r.status, 0, r.stderr);
    const config = loadConfig(dir);
    // The key is WRITTEN, not left to the fallback. With it absent it resolves
    // to `archived_statuses`, and then the stuck status is one the dispatcher
    // hands out — a queue that never empties, and a README that describes
    // nothing.
    assert.ok(config.reasonRequiredStatuses.length > 0, "a fresh backlog protects no status at all");
    assert.deepEqual(
      config.reasonRequiredStatuses,
      config.reasonRequiredStatuses.filter((s2) => config.statuses.includes(s2)),
      "a protected status that is not in `statuses`"
    );
    // POSITIVE CONTROL for the property that matters: at least one protected
    // status is OPEN, so `run` has somewhere to park a task it could not close
    // that the dispatcher will not immediately hand out again.
    const open = config.reasonRequiredStatuses.filter((s2) => !config.archivedStatuses.includes(s2));
    assert.ok(open.length > 0, "no OPEN protected status: `run` would have nowhere to park a task");
    assert.deepEqual(queueStatuses(config).filter((s2) => open.includes(s2)), [],
      "the dispatcher hands out the very status a failed run parks a task in");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
