/**
 * `seed` — a backlog from one structured plan (TL-94).
 *
 * WHAT HAS TO BE PROVED HERE, and why each part needs a positive control:
 *
 *   1. A REFUSED plan writes nothing. An empty directory is empty whatever the
 *      command does, including nothing at all — so every "nothing was written"
 *      test seeds a GOOD plan into the same directory afterwards and asserts the
 *      files appear. Without that, the assertion is green with no evidential
 *      force (CLAUDE.md).
 *   2. The refusal is caused by the DEFECT under test. Each bad plan differs from
 *      a known-good one in exactly one way, so a message about something else is
 *      a failure of the test rather than a pass.
 *   3. `seed` cannot reach a model or a network. Asserting that of the command's
 *      behaviour is impossible — the real claim is about its DEPENDENCIES, so the
 *      test walks the import graph rather than watching a run.
 *
 * Fixtures live in temporary directories: a suite that seeded the repository's
 * own backlog would write real tasks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../config.mjs";
import { createTask } from "../new-task.mjs";
import { contractFor, findCycles, parsePlan, parseSeedArgs, renderBody, writePlan } from "../seed-backlog.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, "..");
const CLI = join(SCRIPTS, "cli.mjs");

let counter = 0;
function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), "worktrail-seed-" + prefix + "-" + counter++ + "-"));
}

/** Run `seed` with the plan on stdin, exactly as a caller would. */
function seed(dir, plan, extra = []) {
  return spawnSync(process.execPath, [CLI, "seed", "--dir", dir].concat(extra), {
    encoding: "utf8", timeout: 60_000, input: typeof plan === "string" ? plan : JSON.stringify(plan),
    env: { ...process.env, NO_COLOR: "1" },
  });
}

function run(args, dir) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, cwd: dir, env: { ...process.env, NO_COLOR: "1" },
  });
}

function taskFiles(dir) {
  const tasks = join(dir, "tasks");
  return existsSync(tasks) ? readdirSync(tasks).filter((f) => f.endsWith(".md")) : [];
}

function taskText(dir, id) {
  const file = taskFiles(dir).find((f) => f.startsWith(id + "-"));
  return readFileSync(join(dir, "tasks", file), "utf8");
}

function field(text, key) {
  const m = text.match(new RegExp("^" + key + ": (.*)$", "m"));
  return m ? m[1].replace(/\s+#.*$/, "").trim() : null;
}

/** Two tasks, the second waiting on the first. The baseline every bad plan below
 *  is one edit away from. */
function goodPlan() {
  return {
    planVersion: 1,
    tasks: [
      {
        plan_id: "skeleton",
        title: "Set up the project skeleton",
        goal: "A runnable package with a test command.",
        context: "Nothing exists yet.",
        steps: ["npm init", "add a test script"],
        verification: [{ id: "tests-run", bash: "npm test", proves: "The test command exits 0." }],
        priority: "P1",
        estimate: "1h",
      },
      {
        plan_id: "cli",
        title: "Add the command line entry point",
        goal: "The tool can be run from a shell.",
        blocked_by: ["skeleton"],
        verification: ["node bin/cli.mjs --help"],
      },
    ],
  };
}

/** The ids `seed` allocated, in plan order — read from `--json`, which is the
 *  mapping the plan cannot compute for itself. */
function createdIds(stdout) {
  return JSON.parse(stdout).created.map((c) => c.id);
}

// ── The happy path ────────────────────────────────────────────────────────

test("a plan seeds an empty directory, through init", () => {
  const dir = join(tmp("fresh"), "backlog");
  const r = seed(dir, goodPlan(), ["--json"]);
  assert.equal(r.status, 0, r.stderr);

  // init ran: the backlog's own files are here, and the example task is NOT —
  // an unrelated task would be the first thing `next` handed out.
  for (const f of ["config.yaml", "boards.yaml", "_template.md"]) {
    assert.ok(existsSync(join(dir, f)), f + " is missing — init did not run");
  }
  assert.equal(taskFiles(dir).length, 2, "the seeded backlog holds the plan's tasks and nothing else");

  const [first, second] = createdIds(r.stdout);
  assert.equal(field(taskText(dir, second), "blocked_by"), "[" + first + "]");
  assert.equal(field(taskText(dir, first), "blocks"), "[" + second + "]", "the reverse edge is written too");
});

test("the plan's own fields land in the task file", () => {
  const dir = join(tmp("fields"), "backlog");
  const r = seed(dir, goodPlan(), ["--json"]);
  assert.equal(r.status, 0, r.stderr);
  const text = taskText(dir, createdIds(r.stdout)[0]);

  assert.equal(field(text, "title"), '"Set up the project skeleton"');
  assert.equal(field(text, "priority"), "P1");
  assert.equal(field(text, "estimate"), "1h");
  assert.match(text, /## Goal\n\nA runnable package with a test command\./);
  assert.match(text, /## Context\n\nNothing exists yet\./);
  assert.match(text, /## Steps\n\n1\. npm init\n2\. add a test script/);
  assert.match(text, /- \[ \] The test command exits 0\. \[proof: tests-run\]/);
  assert.match(text, /- id: tests-run\n {4}bash: "npm test"/);
});

test("a seeded backlog passes `check` with nothing to say", () => {
  const dir = join(tmp("check"), "backlog");
  assert.equal(seed(dir, goodPlan()).status, 0);

  const r = run(["check", "--dir", dir]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  // The criteria guard is the one that could be green on an empty sample: a task
  // with no criteria at all passes every rule below its own absence. So assert it
  // actually saw links.
  assert.match(r.stdout, /criterion→verification link\(s\) across 2 open tasks all resolve/);
});

test("`next` hands out the unblocked task and skips the one waiting on it", () => {
  const dir = join(tmp("next"), "backlog");
  const r = seed(dir, goodPlan(), ["--json"]);
  const [first] = createdIds(r.stdout);

  const state = tmp("state");
  const taken = spawnSync(process.execPath, [CLI, "next", "--dir", dir, "--actor", "agent:test", "--json"], {
    encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: state },
  });
  assert.equal(taken.status, 0, taken.stderr);
  assert.equal(JSON.parse(taken.stdout).id, first, "`next` handed out a task whose blocker is open");
});

// ── The gate: a task with no runnable verification ────────────────────────

test("a task with no verification fails the WHOLE plan and leaves the tree untouched", () => {
  const dir = join(tmp("noverify"), "backlog");
  const plan = goodPlan();
  delete plan.tasks[1].verification;

  const r = seed(dir, plan);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /verification` is required/);
  assert.match(r.stderr, /nothing was written/);
  assert.equal(existsSync(dir), false, "a refused plan created a directory");

  // POSITIVE CONTROL. Without it, "no files" would also be the reading if `seed`
  // were broken in a way that never writes anything at all.
  assert.equal(seed(dir, goodPlan()).status, 0);
  assert.equal(taskFiles(dir).length, 2, "the same directory refuses a bad plan and accepts a good one");
});

test("the template's placeholder is not a verification", () => {
  const dir = join(tmp("placeholder"), "backlog");
  const plan = goodPlan();
  plan.tasks[1].verification = ["command to run"];

  const r = seed(dir, plan);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /template placeholder/);
  assert.equal(taskFiles(dir).length, 0);
});

test("every faulty item is named, not just the first", () => {
  const plan = goodPlan();
  plan.tasks[0].verification = [];
  plan.tasks[1].verification = [{ bash: "" }];
  const { errors } = parsePlan(JSON.stringify(plan));
  assert.equal(errors.length, 2, errors.join("\n"));
  assert.match(errors[0], /^tasks\[0\] \(plan_id: skeleton\)/);
  assert.match(errors[1], /^tasks\[1\] \(plan_id: cli\)/);
});

// ── The dependency graph ──────────────────────────────────────────────────

test("a cycle in blocked_by is refused before anything is written", () => {
  const dir = join(tmp("cycle"), "backlog");
  const plan = goodPlan();
  plan.tasks[0].blocked_by = ["cli"];             // cli already waits on skeleton

  const r = seed(dir, plan);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /forms a cycle/);
  assert.equal(existsSync(dir), false);

  assert.equal(seed(dir, goodPlan()).status, 0, "positive control: the same tree takes an acyclic plan");
});

test("a blocked_by naming nothing in the plan is refused", () => {
  const plan = goodPlan();
  plan.tasks[1].blocked_by = ["deployment"];
  const { errors } = parsePlan(JSON.stringify(plan));
  assert.equal(errors.length, 1, errors.join("\n"));
  assert.match(errors[0], /`deployment`, which is not a `plan_id` in this plan/);
});

test("findCycles reports one loop once, however many nodes reach it", () => {
  const edges = new Map([["a", ["b"]], ["b", ["c"]], ["c", ["a"]], ["d", ["a"]]]);
  const cycles = findCycles(edges);
  assert.equal(cycles.length, 1, JSON.stringify(cycles));
  assert.deepEqual(new Set(cycles[0]), new Set(["a", "b", "c"]));
  assert.deepEqual(findCycles(new Map([["a", ["b"]], ["b", []]])), [], "an acyclic graph reports nothing");
});

// ── The numbers belong to the tool ────────────────────────────────────────

test("a plan cannot name a task id — the numbers are the tool's", () => {
  const plan = goodPlan();
  plan.tasks[0].plan_id = "TASK-7";
  plan.tasks[1].blocked_by = ["TASK-7"];
  const { errors } = parsePlan(JSON.stringify(plan));
  assert.ok(errors.some((e) => /the numbers belong to the tool/.test(e)), errors.join("\n"));
});

test("seeding a backlog that already has tasks continues its numbering", () => {
  const dir = join(tmp("continue"), "backlog");
  assert.equal(seed(dir, goodPlan(), ["--json"]).status, 0);

  const second = goodPlan();
  second.tasks = [{ ...second.tasks[0], plan_id: "third", title: "A third thing" }];
  const r = seed(dir, second, ["--json"]);
  assert.equal(r.status, 0, r.stderr);

  const numbers = taskFiles(dir).map((f) => Number(f.match(/-(\d+)-/)[1])).sort((a, b) => a - b);
  assert.deepEqual(numbers, [1, 2, 3], "a second seed reused a number");
});

// ── Unknown keys, the same rule as everywhere else ────────────────────────

test("an unknown key fails — in the document and in an item", () => {
  const withTopKey = parsePlan(JSON.stringify({ tasks: goodPlan().tasks, board: "main" }));
  assert.ok(withTopKey.errors.some((e) => /unknown key `board` in the plan/.test(e)), withTopKey.errors.join("\n"));

  const plan = goodPlan();
  plan.tasks[0].urgency = "high";
  const withItemKey = parsePlan(JSON.stringify(plan));
  assert.ok(withItemKey.errors.some((e) => /unknown key `urgency`/.test(e)), withItemKey.errors.join("\n"));
});

test("a plan that is not JSON, or not an object, says which", () => {
  assert.match(parsePlan("not json").errors[0], /not valid JSON/);
  assert.match(parsePlan("[]").errors[0], /must be a JSON object, not an array/);
  assert.match(parsePlan('{"tasks": []}').errors[0], /`tasks` is empty/);
});

test("a priority outside this project's vocabulary is refused, and nothing is written", () => {
  const dir = join(tmp("priority"), "backlog");
  assert.equal(seed(dir, goodPlan()).status, 0);
  const before = taskFiles(dir).length;

  const plan = goodPlan();
  plan.tasks = [{ ...plan.tasks[0], plan_id: "later", title: "Something else", priority: "URGENT" }];
  const r = seed(dir, plan);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /is not a value this project uses/);
  assert.equal(taskFiles(dir).length, before, "a refused plan added a task anyway");
});

// ── --dry-run ─────────────────────────────────────────────────────────────

test("--dry-run names the numbers and writes nothing", () => {
  const dir = join(tmp("dry"), "backlog");
  const r = seed(dir, goodPlan(), ["--dry-run", "--json"]);
  assert.equal(r.status, 0, r.stderr);

  const out = JSON.parse(r.stdout);
  assert.equal(out.dryRun, true);
  assert.deepEqual(out.created.map((c) => c.planId), ["skeleton", "cli"]);
  assert.deepEqual(out.created.map((c) => c.id), ["TASK-1", "TASK-2"]);
  assert.equal(existsSync(dir), false, "--dry-run created the backlog");
});

test("--dry-run on an existing backlog numbers from where it actually stands", () => {
  const dir = join(tmp("dry2"), "backlog");
  assert.equal(seed(dir, goodPlan()).status, 0);

  const r = seed(dir, goodPlan(), ["--dry-run", "--json"]);
  assert.deepEqual(JSON.parse(r.stdout).created.map((c) => c.id), ["TASK-3", "TASK-4"]);
  assert.equal(taskFiles(dir).length, 2, "--dry-run wrote into an existing backlog");
});

// ── History ───────────────────────────────────────────────────────────────

test("each creation reaches the history, attributed to --actor", () => {
  const dir = join(tmp("history"), "backlog");
  const r = seed(dir, goodPlan(), ["--json", "--actor", "agent:seeder"]);
  const ids = createdIds(r.stdout);

  for (const id of ids) {
    const file = join(dir, "history", id + ".jsonl");
    assert.ok(existsSync(file), "no history for " + id);
    const events = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const created = events.filter((e) => e.field === "__created__");
    assert.equal(created.length, 1, id + " has " + created.length + " creation events");
    assert.equal(created[0].actor, "agent:seeder");
    assert.equal(created[0].source, "seed");
  }
});

test("a later reconciliation does not record the creations a second time", () => {
  const dir = join(tmp("reconcile"), "backlog");
  const r = seed(dir, goodPlan(), ["--json", "--actor", "agent:seeder"]);
  const id = createdIds(r.stdout)[0];

  assert.equal(run(["history", "--dir", dir, "--actor", "local:me", "--source", "manual"]).status, 0);
  const events = readFileSync(join(dir, "history", id + ".jsonl"), "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(events.filter((e) => e.field === "__created__").length, 1);
  assert.equal(events.find((e) => e.field === "__created__").actor, "agent:seeder",
    "the observer that saw the creation lost the attribution to a later reconciliation");
});

// ── Arguments ─────────────────────────────────────────────────────────────

test("an unknown flag and a positional argument both fail", () => {
  assert.throws(() => parseSeedArgs(["--plan", "x"]), /unknown flag/);
  assert.throws(() => parseSeedArgs(["plan.json"]), /the plan comes in on stdin/);
  assert.throws(() => parseSeedArgs(["--actor", "nobody"]), /no valid namespace/);
  assert.throws(() => parseSeedArgs(["--reason", "unknown"]), /reserved/);
  assert.deepEqual(parseSeedArgs(["--dry-run", "--json"]), { dryRun: true, json: true, actor: null, reason: null });
});

// ── The contract between verification and criteria ────────────────────────

test("every verification entry gets an id, and every criterion points at one", () => {
  const { entries, criteria } = contractFor({
    verification: ["npm test", { manual: "the page renders" }, { id: "given", bash: "true", proves: "It is true." }],
  });
  assert.deepEqual(entries.map((e) => e.id), ["check-1", "check-2", "given"]);
  assert.deepEqual(criteria, ["`npm test` passes.", "the page renders", "It is true."]);

  const body = renderBody({ goal: "g" }, entries.map((e, i) => ({ id: e.id, text: criteria[i] })));
  for (const e of entries) assert.ok(body.includes("[proof: " + e.id + "]"), "no criterion names " + e.id);
});

test("a generated id never collides with one the plan gave", () => {
  const { entries } = contractFor({ verification: [{ id: "check-1", bash: "a" }, { bash: "b" }] });
  assert.deepEqual(entries.map((e) => e.id), ["check-1", "check-2"]);
});

// ── No model, no network ──────────────────────────────────────────────────

/**
 * The claim "`seed` works without any model" is a claim about what it CAN reach,
 * not about what one run happened to do — a run that simply did not call out
 * would pass either way. So this reads the import graph: the whole set of modules
 * `seed` can execute, and what they are allowed to pull in.
 */
function importGraph(entry) {
  const seen = new Set();
  const stack = [entry];
  const externals = new Set();
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/^\s*import[\s\S]*?from\s+"([^"]+)"/gm)) {
      const spec = m[1];
      if (spec.startsWith(".")) stack.push(join(dirname(file), spec));
      else externals.add(spec);
    }
  }
  return { files: seen, externals };
}

test("seed reaches no network and no model", () => {
  const { files, externals } = importGraph(join(SCRIPTS, "seed-backlog.mjs"));
  assert.ok(files.size > 5, "the graph walk found almost nothing — the measurement is broken");

  // Positive control on the WALK: the server does reach the network, so a walk
  // that cannot see `node:http` there proves nothing about not seeing it here.
  const server = importGraph(join(SCRIPTS, "serve-backlog.mjs"));
  assert.ok([...server.externals].some((s) => /^node:(http|https|net)$/.test(s)),
    "the walk cannot see a network import even where there is one");

  const network = [...externals].filter((s) => /^node:(http|https|http2|net|tls|dgram)$/.test(s));
  assert.deepEqual(network, [], "seed can reach the network through " + network.join(", "));
  assert.deepEqual([...externals].filter((s) => !s.startsWith("node:")), [],
    "seed depends on a package outside the standard library");

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.equal(/\bfetch\s*\(/.test(source), false, "a fetch() call is reachable from seed, in " + file);
  }
});

// ── Rollback ──────────────────────────────────────────────────────────────

test("a write that fails part-way through leaves no half-seeded backlog", () => {
  const dir = join(tmp("rollback"), "backlog");
  assert.equal(run(["init", "--dir", dir, "--no-example"]).status, 0);
  const config = loadConfig(dir);

  // A file already in the tasks directory, put there by somebody else. It must
  // survive: the rollback removes what THIS run created, not what it found.
  const bystander = join(dir, "tasks", "TASK-9-not-ours.md");
  writeFileSync(bystander, "---\nid: TASK-9\n---\n", "utf8");

  // The fault is INJECTED because it cannot be arranged: numbers are max+1 over
  // everything present, so a file placed in the way of the second write just
  // pushes the numbers past itself and nothing ever collides.
  let calls = 0;
  const createOne = (opts) => {
    if (++calls === 2) throw new Error("disk full");
    return createTask(opts);
  };

  assert.throws(
    () => writePlan({ root: dir, config, board: "main", plan: goodPlan(), createOne }),
    /disk full/
  );
  assert.deepEqual(taskFiles(dir), ["TASK-9-not-ours.md"], "the first task survived a failed seed");

  // POSITIVE CONTROL on the injection: the same call with nothing thrown writes
  // both tasks. Without it, an empty tree would also be the reading if the
  // writing pass were broken outright.
  const written = writePlan({ root: dir, config, board: "main", plan: goodPlan() });
  assert.equal(written.length, 2);
  assert.equal(taskFiles(dir).length, 3);
});

// ── The plan format is documented where adapters will look ────────────────

test("`seed --help` states the required fields", () => {
  const r = run(["seed", "--help"]);
  assert.equal(r.status, 0, r.stderr);
  for (const key of ["plan_id", "title", "goal", "verification", "blocked_by", "planVersion"]) {
    assert.ok(r.stdout.includes(key), "`seed --help` does not mention " + key);
  }
});

test("the README describes the plan format", () => {
  const readme = readFileSync(join(SCRIPTS, "..", "README.md"), "utf8");
  assert.match(readme, /^## Seeding a backlog from a plan$/m);
  for (const key of ["plan_id", "verification", "blocked_by"]) {
    assert.ok(readme.includes(key), "the README does not mention " + key);
  }
});

test("`--json` writes the same envelope every other command answers in", () => {
  const dir = join(tmp("envelope"), "backlog");
  const out = JSON.parse(seed(dir, goodPlan(), ["--json"]).stdout);
  assert.equal(out.schemaVersion, 1);
  assert.equal(out.kind, "seed");
  // The emptiness rule: a declared key is present even when it has nothing in it.
  for (const key of ["ok", "root", "dryRun", "created", "errors"]) {
    assert.ok(key in out, "`" + key + "` is missing from the seed envelope");
  }
  assert.deepEqual(out.errors, []);
});
