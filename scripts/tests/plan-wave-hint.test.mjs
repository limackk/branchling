/**
 * A follow-up filed on a branch names its wave in its OWN file, and the plan
 * takes it in on the main line (TL-689).
 *
 * WHAT WAS MEASURED. On 2026-11-10 parallel loops filed follow-ups with
 * `new --wave`, which rewrites the wave's one-line `tasks:` list in plan.yaml
 * inside the loop's worktree. Two branches filing into one wave therefore
 * edited the same line, and the coordinator's merge hit a plan.yaml conflict.
 * `new --wave-hint` writes the wave into the new task's file as `wave_hint:`,
 * `plan` reports such a task as waiting to be placed, and `plan place` folds
 * it into plan.yaml and removes the hint.
 *
 * THE MERGE TEST HAS A CONTROL: the same two branches filing with `--wave`
 * conflict on the same merge, so a fixture in which nothing could ever
 * conflict cannot pass for proof that the hint avoids it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fixtureDir } from "./_fixture-dir.mjs";
import { isolateHome, plainOutput, SCRIPTS_DIR } from "./_repo.mjs";
import { FOLLOW_UP_WAVE } from "../instructions.mjs";
import { planState } from "../plan.mjs";
import { removeFrontmatterField } from "../task-fields.mjs";

isolateHome("plan-wave-hint");
plainOutput();

const CLI = join(SCRIPTS_DIR, "cli.mjs");
let counter = 0;

function cli(args, env, cwd) {
  const r = spawnSync(process.execPath, [CLI].concat(args), { encoding: "utf8", timeout: 60_000, env, cwd });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

const GIT = ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false"];

function vcs(cwd, args) {
  return execFileSync("git", GIT.concat(args), { cwd, encoding: "utf8" });
}

function taskFile(backlog, id) {
  const file = readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-"));
  assert.ok(file, "no file for " + id);
  return join(backlog, "tasks", file);
}

function waveTasks(backlog, name) {
  const text = readFileSync(join(backlog, "plan.yaml"), "utf8");
  const at = text.indexOf('name: "' + name + '"');
  assert.ok(at >= 0, "no wave " + name + " in\n" + text);
  const line = text.slice(at).match(/tasks: \[(.*)\]/);
  return line[1].split(",").map((s) => s.trim()).filter(Boolean);
}

/** A backlog with a plan whose wave `First` holds one task, committed on main. */
function backlogWithPlan() {
  const dir = fixtureDir(join(tmpdir(), "branchling-wave-hint-" + counter++ + "-"));
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  const backlog = join(repo, "backlog");
  const env = { ...process.env, BACKLOG_STATE_DIR: join(dir, "state"), NO_COLOR: "1" };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env).code, 0);
  const r = cli(["new", "--dir", backlog, "--title", "Work the plan already holds", "--actor", "agent:test"], env);
  assert.equal(r.code, 0, r.err);
  const first = (r.out.match(/([A-Z]+-\d+)/) || [])[1];
  writeFileSync(join(backlog, "plan.yaml"), [
    "updated: 2026-11-10", 'rationale: "fixture"', "waves:",
    '  - name: "First"', "    tasks: [" + first + "]", "",
  ].join("\n"), "utf8");
  vcs(repo, ["init", "-q", "-b", "main"]);
  vcs(repo, ["add", "-A"]);
  vcs(repo, ["commit", "-qm", "seed"]);
  return { dir, repo, backlog, env, first };
}

/** File one follow-up on its own branch in its own worktree, and commit it. */
function fileOnBranch(f, branch, flag) {
  const tree = join(f.dir, branch);
  vcs(f.repo, ["worktree", "add", "-q", "-b", branch, tree]);
  const backlog = join(tree, "backlog");
  const r = cli(["new", "--dir", backlog, "--title", "Follow-up from " + branch, flag, "First",
    "--actor", "agent:" + branch], f.env, tree);
  assert.equal(r.code, 0, r.out + r.err);
  const id = (r.out.match(/([A-Z]+-\d+)/) || [])[1];
  vcs(tree, ["add", "-A"]);
  vcs(tree, ["commit", "-qm", id + " filed on " + branch]);
  return id;
}

function merge(f, branch) {
  return spawnSync("git", GIT.concat(["merge", "--no-edit", "-q", branch]), { cwd: f.repo, encoding: "utf8" });
}

test("follow-ups filed with --wave-hint in two worktrees merge without a conflict and land in the wave", () => {
  const f = backlogWithPlan();
  const a = fileOnBranch(f, "loop-a", "--wave-hint");
  const b = fileOnBranch(f, "loop-b", "--wave-hint");
  assert.notEqual(a, b);

  // Neither branch touched plan.yaml: the wave is in each task's own file.
  assert.equal(vcs(f.repo, ["diff", "--name-only", "main", "loop-a", "--", "backlog/plan.yaml"]), "");
  assert.match(readFileSync(taskFile(join(f.dir, "loop-a", "backlog"), a), "utf8"), /^wave_hint: First$/m);

  const first = merge(f, "loop-a");
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const second = merge(f, "loop-b");
  assert.equal(second.status, 0, "the second merge conflicted: " + second.stdout + second.stderr);

  // On main, before placing: waiting with their wave, not unplanned.
  const before = cli(["plan", "--dir", f.backlog, "--json"], f.env, f.repo);
  assert.equal(before.code, 0, before.out + before.err);
  const state = JSON.parse(before.out);
  assert.deepEqual(state.waiting.map((t) => [t.id, t.wave]).sort(), [[a, "First"], [b, "First"]].sort());
  assert.deepEqual(state.unplanned, []);
  const text = cli(["plan", "--dir", f.backlog], f.env, f.repo).out;
  assert.match(text, /waiting to be placed[^\n]*: 2 \(`[^`]+ plan place` puts each in its wave\)/);
  for (const id of [a, b]) assert.match(text, new RegExp("^  " + id + "  First$", "m"));

  const placed = cli(["plan", "place", "--dir", f.backlog], f.env, f.repo);
  assert.equal(placed.code, 0, placed.out + placed.err);
  for (const id of [a, b]) assert.match(placed.out, new RegExp(id + " is scheduled in wave 1 \\(First\\)"));
  assert.doesNotMatch(placed.out, /already scheduled/);
  assert.match(placed.out, /`wave_hint:` is removed from each of the 2 files/);
  assert.deepEqual(waveTasks(f.backlog, "First"), [f.first, a, b].sort((x, y) => x.localeCompare(y, "en", { numeric: true })));
  for (const id of [a, b]) assert.doesNotMatch(readFileSync(taskFile(f.backlog, id), "utf8"), /^wave_hint:/m);

  assert.match(cli(["plan", "--dir", f.backlog], f.env, f.repo).out,
    /waiting to be placed — a wave named in the task's own file: none\n\nstale/);
  const after = JSON.parse(cli(["plan", "--dir", f.backlog, "--json"], f.env, f.repo).out);
  assert.deepEqual(after.waiting, []);
  assert.deepEqual(after.unplanned, []);

  // Placing again finds nothing and writes nothing.
  const planBefore = readFileSync(join(f.backlog, "plan.yaml"), "utf8");
  const again = cli(["plan", "place", "--dir", f.backlog], f.env, f.repo);
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /nothing was written/);
  assert.equal(readFileSync(join(f.backlog, "plan.yaml"), "utf8"), planBefore);
});

test("CONTROL: the same two worktrees filing with --wave conflict on plan.yaml", () => {
  const f = backlogWithPlan();
  fileOnBranch(f, "loop-a", "--wave");
  fileOnBranch(f, "loop-b", "--wave");
  assert.equal(merge(f, "loop-a").status, 0);
  const second = merge(f, "loop-b");
  assert.notEqual(second.status, 0, "the control did not conflict, so the fixture proves nothing");
  assert.match(vcs(f.repo, ["diff", "--name-only", "--diff-filter=U"]), /backlog\/plan\.yaml/);
});

test("plan place refuses a hint naming a wave the plan does not have, names the task, and writes nothing", () => {
  const f = backlogWithPlan();
  const good = cli(["new", "--dir", f.backlog, "--title", "Placed fine", "--wave-hint", "First", "--actor", "agent:t"], f.env, f.repo);
  assert.equal(good.code, 0, good.err);
  const goodId = (good.out.match(/([A-Z]+-\d+)/) || [])[1];
  const bad = cli(["new", "--dir", f.backlog, "--title", "Placed badly", "--wave-hint", "First", "--actor", "agent:t"], f.env, f.repo);
  const badId = (bad.out.match(/([A-Z]+-\d+)/) || [])[1];
  const badFile = taskFile(f.backlog, badId);
  writeFileSync(badFile, readFileSync(badFile, "utf8").replace(/^wave_hint: First$/m, "wave_hint: Gone"), "utf8");

  const planBefore = readFileSync(join(f.backlog, "plan.yaml"), "utf8");
  const goodBefore = readFileSync(taskFile(f.backlog, goodId), "utf8");
  const r = cli(["plan", "place", "--dir", f.backlog], f.env, f.repo);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.err, new RegExp(badId + " names the wave `Gone`"));
  assert.match(r.err, /the waves it has: First/);
  assert.match(r.err, /nothing was placed/);
  assert.equal(readFileSync(join(f.backlog, "plan.yaml"), "utf8"), planBefore);
  assert.equal(readFileSync(taskFile(f.backlog, goodId), "utf8"), goodBefore);
});

test("a task the plan already schedules keeps its place and loses only the hint", () => {
  const f = backlogWithPlan();
  const file = taskFile(f.backlog, f.first);
  writeFileSync(file, readFileSync(file, "utf8").replace(/^verification:/m, "wave_hint: First\nverification:"), "utf8");
  const planBefore = readFileSync(join(f.backlog, "plan.yaml"), "utf8");
  const r = cli(["plan", "place", "--dir", f.backlog], f.env, f.repo);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, new RegExp(f.first + " was already scheduled in wave 1 \\(First\\); the plan keeps that place"));
  assert.match(r.out, /`wave_hint:` is removed from its file/);
  assert.equal(readFileSync(join(f.backlog, "plan.yaml"), "utf8"), planBefore);
  assert.doesNotMatch(readFileSync(file, "utf8"), /^wave_hint:/m);
});

test("new --wave-hint is refused for an unknown wave, without a plan, and beside --wave — before any file is written", () => {
  const f = backlogWithPlan();
  const count = () => readdirSync(join(f.backlog, "tasks")).length;
  const n = count();
  const unknown = cli(["new", "--dir", f.backlog, "--title", "x", "--wave-hint", "Nope", "--actor", "agent:t"], f.env, f.repo);
  assert.notEqual(unknown.code, 0);
  assert.match(unknown.err, /no wave `Nope`/);
  const both = cli(["new", "--dir", f.backlog, "--title", "x", "--wave", "First", "--wave-hint", "First", "--actor", "agent:t"], f.env, f.repo);
  assert.equal(both.code, 2);
  assert.match(both.err, /--wave-hint/);
  rmSync(join(f.backlog, "plan.yaml"));
  const noPlan = cli(["new", "--dir", f.backlog, "--title", "x", "--wave-hint", "First", "--actor", "agent:t"], f.env, f.repo);
  assert.notEqual(noPlan.code, 0);
  assert.match(noPlan.err, /`--wave-hint` was given and this backlog has no plan/);
  assert.equal(count(), n);

  const json = cli(["new", "--dir", f.backlog, "--title", "x", "--actor", "agent:t", "--json"], f.env, f.repo);
  assert.equal(JSON.parse(json.out).waveHint, null);
  assert.equal(JSON.parse(json.out).ok, true);
  const plain = cli(["new", "--dir", f.backlog, "--title", "Plain", "--actor", "agent:t"], f.env, f.repo);
  assert.equal(plain.code, 0, plain.err);
  assert.doesNotMatch(plain.out, /wave hint/);
});

test("plan place names the wave each task landed in, beyond the first", () => {
  const f = backlogWithPlan();
  const second = cli(["new", "--dir", f.backlog, "--title", "Second-wave work", "--actor", "agent:t"], f.env, f.repo);
  const secondId = (second.out.match(/([A-Z]+-\d+)/) || [])[1];
  assert.equal(cli(["plan", "add", secondId, "--wave", "Second", "--why", "Later.", "--dir", f.backlog], f.env, f.repo).code, 0);
  const r = cli(["new", "--dir", f.backlog, "--title", "Late follow-up", "--wave-hint", "Second", "--actor", "agent:t"], f.env, f.repo);
  const id = (r.out.match(/([A-Z]+-\d+)/) || [])[1];
  const placed = cli(["plan", "place", "--dir", f.backlog], f.env, f.repo);
  assert.equal(placed.code, 0, placed.out + placed.err);
  assert.match(placed.out, new RegExp(id + " is scheduled in wave 2 \\(Second\\)"));
  assert.deepEqual(waveTasks(f.backlog, "Second"), [secondId, id]);
  assert.deepEqual(waveTasks(f.backlog, "First"), [f.first]);
});

test("planState: a hinted open task is waiting, not unplanned; a closed one is neither", () => {
  const config = { archivedStatuses: ["done"] };
  const plan = { waves: [{ name: "First", tasks: ["T-1"], together: [] }] };
  const tasks = [
    { id: "T-1", status: "pending", blocked_by: [] },
    { id: "T-2", status: "pending", blocked_by: [], wave_hint: "First" },
    { id: "T-3", status: "pending", blocked_by: [] },
    { id: "T-4", status: "done", blocked_by: [], wave_hint: "First" },
    { id: "T-5", status: "pending", blocked_by: [], wave_hint: "   " },
  ];
  const state = planState(plan, tasks, config);
  assert.deepEqual(state.waiting, [{ id: "T-2", status: "pending", wave: "First" }]);
  assert.deepEqual(state.unplanned.map((t) => t.id), ["T-3", "T-5"]);
  assert.deepEqual(state.coverage, { open: 4, planned: 1, unplanned: 2, share: 50 });
});

test("removeFrontmatterField removes the key and its continuation lines and nothing else", () => {
  const text = "---\nid: T-1\nwave_hint: First\nverification:\n  - id: x\n---\nbody\n";
  assert.equal(removeFrontmatterField(text, "wave_hint"), "---\nid: T-1\nverification:\n  - id: x\n---\nbody\n");
  assert.equal(removeFrontmatterField(text, "verification"), "---\nid: T-1\nwave_hint: First\n---\nbody\n");
  assert.equal(removeFrontmatterField(text, "absent"), text);
  const crlf = text.replace(/\n/g, "\r\n");
  assert.equal(removeFrontmatterField(crlf, "wave_hint"), "---\r\nid: T-1\r\nverification:\r\n  - id: x\r\n---\r\nbody\r\n");
  assert.throws(() => removeFrontmatterField("no frontmatter", "x"), /no YAML frontmatter/);
  assert.throws(() => removeFrontmatterField("x\n---\nid: T-1\n---\n", "id"), /no YAML frontmatter/);
  // The first key, a key that another key begins with, and a scalar followed
  // by another scalar or a one-space continuation.
  assert.equal(removeFrontmatterField(text, "id"), "---\nwave_hint: First\nverification:\n  - id: x\n---\nbody\n");
  assert.equal(removeFrontmatterField(text, "wave"), text);
  const scalars = "---\nwave_hint: First\nstatus: pending\nlist:\n - a\nend: 1\n---\n";
  assert.equal(removeFrontmatterField(scalars, "wave_hint"), "---\nstatus: pending\nlist:\n - a\nend: 1\n---\n");
  assert.equal(removeFrontmatterField(scalars, "list"), "---\nwave_hint: First\nstatus: pending\nend: 1\n---\n");
});

test("task-execution recommends --wave-hint for a follow-up only where a plan exists", () => {
  const f = backlogWithPlan();
  const advice = FOLLOW_UP_WAVE.find((line) => line.includes("--wave-hint"));
  assert.ok(advice, "the one source of the advice names no --wave-hint");
  const withPlan = cli(["instructions", "task-execution", "--dir", f.backlog], f.env, f.repo);
  assert.equal(withPlan.code, 0, withPlan.err);
  for (const line of FOLLOW_UP_WAVE.filter(Boolean)) assert.ok(withPlan.out.includes(line), "missing: " + line);
  // The command itself, at the column of the section, and the paragraph's
  // shape: two blank lines around the command, none in the prose.
  const indent = " ".repeat(23);
  assert.ok(withPlan.out.includes("\n\n" + indent + FOLLOW_UP_WAVE[0] + "\n"), "the paragraph is not set apart in the column");
  assert.match(withPlan.out, new RegExp("^" + indent + "  \\S+ new --title \"…\" --wave-hint \"<wave>\"$", "m"));
  assert.equal(FOLLOW_UP_WAVE.filter((line) => line === "").length, 2);
  assert.ok(withPlan.out.includes(indent + FOLLOW_UP_WAVE[FOLLOW_UP_WAVE.length - 1] + "\n  You hit a blocker"),
    "the paragraph does not end where the next entry begins");
  assert.ok(FOLLOW_UP_WAVE.every((line) => line === "" || line.length <= 55), "a line overflows the column");

  rmSync(join(f.backlog, "plan.yaml"));
  const without = cli(["instructions", "task-execution", "--dir", f.backlog], f.env, f.repo);
  assert.equal(without.code, 0, without.err);
  assert.doesNotMatch(without.out, /--wave-hint/);
  assert.match(without.out, /blurred task has no verification\.\n  You hit a blocker/);
  assert.match(without.out, /The scope grows/);
});

test("plan place refuses every unknown wave by task, an order the guard rejects, a bad invocation and a missing plan", () => {
  const f = backlogWithPlan();
  const ids = [];
  for (const title of ["One bad hint", "Another bad hint"]) {
    const r = cli(["new", "--dir", f.backlog, "--title", title, "--wave-hint", "First", "--actor", "agent:t"], f.env, f.repo);
    ids.push((r.out.match(/([A-Z]+-\d+)/) || [])[1]);
  }
  for (const id of ids) {
    const file = taskFile(f.backlog, id);
    writeFileSync(file, readFileSync(file, "utf8").replace(/^wave_hint: First$/m, "wave_hint: Gone"), "utf8");
  }
  const both = cli(["plan", "place", "--dir", f.backlog], f.env, f.repo);
  assert.equal(both.code, 1);
  for (const id of ids) assert.match(both.err, new RegExp(id + " names the wave `Gone`"));

  // A hint that would put a task BEFORE its blocker is refused in the guard's words.
  const g = backlogWithPlan();
  const blocker = cli(["new", "--dir", g.backlog, "--title", "The blocker", "--actor", "agent:t"], g.env, g.repo);
  const blockerId = (blocker.out.match(/([A-Z]+-\d+)/) || [])[1];
  assert.equal(cli(["plan", "add", blockerId, "--wave", "Second", "--why", "Later.", "--dir", g.backlog], g.env, g.repo).code, 0);
  const waiting = cli(["new", "--dir", g.backlog, "--title", "Blocked follow-up", "--wave-hint", "First", "--actor", "agent:t"], g.env, g.repo);
  const waitingId = (waiting.out.match(/([A-Z]+-\d+)/) || [])[1];
  const file = taskFile(g.backlog, waitingId);
  writeFileSync(file, readFileSync(file, "utf8").replace(/^blocked_by: \[\]/m, "blocked_by: [" + blockerId + "]"), "utf8");
  const planBefore = readFileSync(join(g.backlog, "plan.yaml"), "utf8");
  const fileBefore = readFileSync(file, "utf8");
  const order = cli(["plan", "place", "--dir", g.backlog], g.env, g.repo);
  assert.equal(order.code, 1, order.out + order.err);
  assert.match(order.err, new RegExp(blockerId));
  assert.equal(readFileSync(join(g.backlog, "plan.yaml"), "utf8"), planBefore);
  assert.equal(readFileSync(file, "utf8"), fileBefore);

  const flag = cli(["plan", "place", "--bogus", "--dir", g.backlog], g.env, g.repo);
  assert.equal(flag.code, 2);
  assert.match(flag.err, /unknown flag: --bogus/);
  const word = cli(["plan", "place", "TL-1", "--dir", g.backlog], g.env, g.repo);
  assert.equal(word.code, 2);
  assert.match(word.err, /unexpected argument: TL-1/);
  const sub = cli(["plan", "nonsense", "--dir", g.backlog], g.env, g.repo);
  assert.equal(sub.code, 2);
  assert.match(sub.err, /available: init, place, add, move, remove/);

  writeFileSync(join(g.backlog, "plan.yaml"), "waves: [\n", "utf8");
  const unreadable = cli(["plan", "place", "--dir", g.backlog], g.env, g.repo);
  assert.equal(unreadable.code, 1, unreadable.out + unreadable.err);
  assert.match(unreadable.err, /the plan cannot be read, so nothing can be placed in it/);
  assert.equal(readFileSync(file, "utf8"), fileBefore);

  rmSync(join(g.backlog, "plan.yaml"));
  const missing = cli(["plan", "place", "--dir", g.backlog], g.env, g.repo);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /there is no plan to place tasks in/);
  const json = JSON.parse(cli(["plan", "--dir", g.backlog, "--json"], g.env, g.repo).out);
  assert.deepEqual(json.waiting, []);
});

test("new --wave-hint writes the hint before `verification:` and says so, in text and in --json", () => {
  const f = backlogWithPlan();
  const r = cli(["new", "--dir", f.backlog, "--title", "Hinted", "--wave-hint", "First", "--actor", "agent:t"], f.env, f.repo);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /wave hint: First — written into the task's file; `[^`]+ plan place` schedules it/);
  const id = (r.out.match(/([A-Z]+-\d+)/) || [])[1];
  const lines = readFileSync(taskFile(f.backlog, id), "utf8").split("\n");
  const at = lines.indexOf("wave_hint: First");
  assert.ok(at > 0, "no wave_hint line");
  assert.match(lines[at - 1], /^related_docs:/);
  assert.match(lines[at + 1], /^verification:/);

  const json = cli(["new", "--dir", f.backlog, "--title", "Hinted twice", "--wave-hint", "First", "--actor", "agent:t", "--json"], f.env, f.repo);
  assert.equal(json.code, 0, json.err);
  assert.equal(JSON.parse(json.out).waveHint, "First");
  assert.equal(JSON.parse(json.out).wave, null);

  const both = cli(["new", "--dir", f.backlog, "--title", "x", "--wave", "First", "--wave-hint", "First", "--actor", "agent:t"], f.env, f.repo);
  assert.match(both.err, /`--wave` and `--wave-hint` both name a wave/);
  assert.match(both.err, /`--wave` schedules the task in plan.yaml now; `--wave-hint` writes the wave into the task's own file/);
});
