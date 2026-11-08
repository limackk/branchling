/**
 * Every command under `--json` answers a missing backlog with an envelope of its
 * own kind (TL-548).
 *
 * TL-546 gave both foreseen states — no backlog found, and a `--dir` or
 * `BACKLOG_DIR` naming a directory that is not one — exit 1 from every command.
 * The SHAPE still differed: four writing commands printed an envelope with
 * `refusalKind: "no-backlog"`, and the rest printed the refusal on stderr and
 * left stdout empty. A consumer calling `take --json` had nothing to branch on
 * and could not tell this state from a crash.
 *
 * WHAT IS SWEPT. Every row registered in `KIND_EXERCISE` (one per kind, beside
 * the kind in `scripts/json-envelope.mjs`), plus the commands that answer in a
 * kind another command already registers, run in all three states. Each answer
 * must be the row's OWN kind — `set --fields` refusing as `task-set` would be a
 * consumer switching on the wrong key set — with `ok: false`, `refusalKind:
 * "no-backlog"`, a refusal sentence and every declared key present.
 *
 * WHAT KEEPS THE SWEEP HONEST. A new command answering `--json` that nobody adds
 * here would leave the sweep green while it prints nothing: the command table is
 * read, and every command whose usage declares `--json` must be swept, be the
 * command of a row that needs no backlog (`noDir`, `ANSWERS_THE_STATE`), or be
 * named in `EXEMPT_COMMANDS` with its reason. A floor on the number of cases
 * guards against an empty sample.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ABSENT_TASK, FIRST_TASK, KINDS, KIND_EXERCISE } from "../json-envelope.mjs";
import { COMMANDS } from "../cli.mjs";
import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("json-no-backlog-envelope");

const CLI = join(SCRIPTS_DIR, "cli.mjs");

/**
 * The kinds whose command ANSWERS this state instead of refusing on it. Their
 * question is about the machine or the tool, not about a backlog's contents.
 */
const ANSWERS_THE_STATE = {
  where: "reports which directories it resolved, and no backlog is one of its answers",
  "command-help": "describes a command's flags; without a backlog it says `configured: false`",
  // `hooks` answers about the git repository `--dir` lies in and never resolves
  // a backlog (TL-567); the test below holds each of its kinds to an answer.
  "hooks-print": "answers about a git repository, not a backlog",
  "hooks-install": "answers about a git repository, not a backlog",
  "hooks-uninstall": "answers about a git repository, not a backlog",
};

/** Commands sharing a kind another row registers — each must refuse in it too. */
const EXTRA_ROWS = [
  { kind: "task-take", args: ["take", "X-1", "--actor", "agent:test", "--json"] },
  { kind: "plan", args: ["plan", "init", "--rationale", "a fixture", "--json"] },
];

/**
 * Commands in the table whose usage names `--json` but that no row exercises.
 * Each entry says why; a command missing from both fails the coverage test.
 */
const EXEMPT_COMMANDS = {};

/** States per row in which the refusal is not the designed answer. */
const STATE_EXEMPT = {
  // An explicit `--dir` that is not a backlog yet is `seed`'s "seed a fresh
  // project" path and goes through `init`; `BACKLOG_DIR` still refuses.
  seed: ["dir"],
};

const base = fixtureDir(join(tmpdir(), "branchling-json-no-backlog-"));
spawnSync("git", ["init", "-q", "."], { cwd: base });

function rows() {
  const out = [];
  for (const [kind, row] of Object.entries(KIND_EXERCISE)) {
    if (row.noDir || ANSWERS_THE_STATE[kind]) continue;
    out.push({ kind, args: row.args, input: row.input });
  }
  return out.concat(EXTRA_ROWS);
}

let counter = 0;
/** A fresh, empty directory that is not a backlog, for one run. */
function notABacklog() {
  const d = join(base, "plain-" + counter++);
  mkdirSync(d);
  return d;
}

function run(args, state, input) {
  const env = { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(base, ".state") };
  delete env.BACKLOG_DIR;
  let argv = args.map((a) => (a === FIRST_TASK || a === ABSENT_TASK ? "X-1" : a));
  let named = null;
  if (state === "dir") { named = notABacklog(); argv = argv.concat(["--dir", named]); }
  if (state === "env") { named = notABacklog(); env.BACKLOG_DIR = named; }
  const r = spawnSync(process.execPath, [CLI, ...argv], { cwd: base, encoding: "utf8", timeout: 60_000, input: input || "", env });
  return { ...r, named };
}

const STATES = { none: "no backlog found", dir: "a --dir that is not a backlog", env: "a BACKLOG_DIR that is not a backlog" };
let cases = 0;

for (const row of rows()) {
  for (const [state, label] of Object.entries(STATES)) {
    if ((STATE_EXEMPT[row.args[0]] || []).includes(state)) continue;
    cases++;
    test("`" + row.args.join(" ") + "` with " + label + " answers a `" + row.kind + "` envelope", () => {
      const r = run(row.args, state, row.input);
      const all = r.stdout + r.stderr;
      assert.equal(r.status, 1, "exit " + r.status + ":\n" + all);
      let answer;
      try { answer = JSON.parse(r.stdout); } catch { assert.fail("stdout is not one JSON document:\n" + all); }
      assert.equal(answer.kind, row.kind, all);
      assert.equal(answer.ok, false, all);
      assert.equal(answer.refusalKind, "no-backlog", all);
      assert.equal(typeof answer.refusal, "string", all);
      assert.match(answer.refusal, state === "none" ? /no backlog here/ : /does not look like a backlog/, all);
      assert.ok(Array.isArray(answer.details), all);
      for (const key of Object.keys(KINDS[row.kind])) assert.ok(key in answer, "`" + key + "` is missing:\n" + all);
      assert.doesNotMatch(all, /^\s+at .+:\d+:\d+\)?$/m, "a stack trace reached the user:\n" + all);
      // A refusal writes nothing into the directory it refused.
      if (r.named) assert.deepEqual(readdirSync(r.named), [], "something was written into " + r.named);
    });
  }
}

test("the sweep is not a zero sample", () => {
  assert.ok(cases >= 90, "only " + cases + " cases were swept");
});

test("every command whose usage declares --json is swept or exempted with a reason", () => {
  const swept = new Set(rows().map((r) => r.args[0]));
  // The commands of the rows that answer without a backlog by design.
  const answering = new Set(Object.entries(KIND_EXERCISE)
    .filter(([kind, r]) => r.noDir || ANSWERS_THE_STATE[kind]).map(([, r]) => r.args[0]));
  const declaring = Object.entries(COMMANDS).filter(([, c]) => String(c.usage || "").includes("--json")).map(([n]) => n);
  assert.ok(declaring.length >= 25, "only " + declaring.length + " commands declare --json — the table was not read");
  const missing = declaring.filter((n) => !swept.has(n) && !answering.has(n) && !EXEMPT_COMMANDS[n]);
  assert.deepEqual(missing, [], "commands answering --json that the no-backlog sweep never runs");
  const stale = Object.keys(EXEMPT_COMMANDS).filter((n) => swept.has(n) || !declaring.includes(n));
  assert.deepEqual(stale, [], "exemptions for commands that are swept or no longer declare --json");
});

test("a kind that answers the state is still an answer, not a refusal", () => {
  const r = run(KIND_EXERCISE.where.args, "none");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const answer = JSON.parse(r.stdout);
  assert.equal(answer.kind, "where");
  assert.equal(answer.ok, true);
  assert.equal(answer.refusalKind, null);
});

test("`hooks` answers each of its kinds in every no-backlog state, and leaves no hook behind", () => {
  // Print, install, uninstall in that order per state: the base directory is a
  // git repository, so `install` really writes its hooks and `uninstall` really
  // removes them — the answer is about the repository, whatever the backlog.
  const order = ["hooks-print", "hooks-install", "hooks-uninstall"];
  let answered = 0;
  for (const state of Object.keys(STATES)) {
    for (const kind of order) {
      const r = run(KIND_EXERCISE[kind].args, state);
      const all = r.stdout + r.stderr;
      assert.equal(r.status, 0, kind + " with " + STATES[state] + ": exit " + r.status + ":\n" + all);
      assert.equal(r.stderr, "", all);
      const answer = JSON.parse(r.stdout);
      assert.equal(answer.kind, kind, all);
      assert.equal(answer.ok, true, all);
      assert.equal(answer.refusalKind, null, all);
      for (const key of Object.keys(KINDS[kind])) assert.ok(key in answer, "`" + key + "` is missing:\n" + all);
      answered++;
      if (kind === "hooks-install") assert.equal(answer.installed, true, all);
      if (kind === "hooks-uninstall") assert.equal(answer.removed, true, "install wrote nothing to remove:\n" + all);
    }
  }
  assert.equal(answered, order.length * Object.keys(STATES).length);
  assert.deepEqual(readdirSync(join(base, ".git", "hooks")).filter((f) => !f.endsWith(".sample")), [],
    "a hook outlived the uninstall");
});
