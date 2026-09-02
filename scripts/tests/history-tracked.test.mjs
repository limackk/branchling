/**
 * Does the history log actually reach git? (TL-43)
 *
 * WHY THIS GUARD NEEDS A REAL REPOSITORY IN EVERY CASE. It is the only guard in
 * the tool whose answer depends on something outside the backlog directory, and
 * the failure it exists to catch — a log left untracked beside a task that was
 * committed — cannot be produced without a real index. A fixture faking `git
 * ls-files` would be a test of the fake.
 *
 * THE FOUR THINGS THAT HAVE TO BE RULED OUT:
 *
 *   1. A GUARD GREEN ON AN EMPTY SAMPLE. "0 untracked" over 0 logs is not a
 *      pass, and the counts in the output are what let a reader tell the two
 *      apart. Every green case here is paired with the one change that must
 *      turn it red.
 *   2. A GUARD RED ON A FRESH BACKLOG. The defect is the ASYMMETRY — a log
 *      untracked while its own task is tracked. A backlog nobody has committed
 *      yet has neither, and a guard failing there would make `check` red on a
 *      brand-new `init`, which is where it must be trusted most.
 *   3. A TICK NOBODY EARNED. Outside git this guard has nothing to say, and
 *      saying "all logs are tracked" there would be a claim about versioning
 *      made by a run that never looked at a repository.
 *   4. TWO DEFECTS ROLLED INTO ONE NUMBER. An orphaned log is somebody's other
 *      branch; an untracked one is somebody's missing commit. Reported together
 *      they would hide each other.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { auditTracking, gitRoot } from "../check-backlog-history-tracked.mjs";

import { isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("history-tracked");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

let counter = 0;
function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), "worktrail-" + prefix + "-" + (counter++) + "-"));
}

function run(args, cwd, env) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 30_000, input: "", cwd,
    env: env || { ...process.env, NO_COLOR: "1" },
  });
}

function git(cwd, args) {
  return spawnSync("git", args, {
    cwd, encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.com",
    },
  });
}

/**
 * A real repository with a backlog, one task, and one history entry for it.
 * Nothing is committed yet — each case decides what reaches the index, because
 * that decision IS the thing under test.
 */
function fixture() {
  const dir = tmp("tracked");
  const backlog = join(dir, "backlog");
  const env = { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(dir, "state") };
  assert.equal(git(dir, ["init", "-q", "-b", "main"]).status, 0);
  assert.equal(run(["init", "--dir", backlog, "--no-example"], dir, env).status, 0);

  const created = run(["new", "--dir", backlog, "--title", "A task with a history"], dir, env);
  assert.equal(created.status, 0, created.stderr);
  const id = (created.stdout.match(/([A-Z]+-\d+)/) || [])[1];
  // A history entry, so there is a log to be left behind.
  assert.equal(run(["take", id, "--dir", backlog, "--actor", "local:me"], dir, env).status, 0);
  return { dir, backlog, env, id };
}

const check = (fx) => run(["check", "--history", "--dir", fx.backlog], fx.dir, fx.env);

// ── the asymmetry is the defect ───────────────────────────────────────────

test("a log left behind while its task was committed FAILS, and names the file", () => {
  const fx = fixture();
  // Exactly the measured situation: the `.md` was added because somebody was
  // thinking about it, the `.jsonl` was not because nobody created it.
  assert.equal(git(fx.dir, ["add", "backlog/tasks", "backlog/config.yaml"]).status, 0);
  assert.equal(git(fx.dir, ["commit", "-q", "-m", "the task, without its log"]).status, 0);

  const r = check(fx);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /NOT tracked/);
  assert.ok(r.stdout.includes(fx.id + ".jsonl"), "the file a person has to add is not named");
});

test("…and the same repository passes once the log is added", () => {
  // The positive control the acceptance criteria ask for by name. Without it
  // the assertion above could be satisfied by a guard that always fails.
  const fx = fixture();
  assert.equal(git(fx.dir, ["add", "backlog/tasks", "backlog/config.yaml"]).status, 0);
  assert.equal(git(fx.dir, ["commit", "-q", "-m", "the task, without its log"]).status, 0);
  assert.equal(check(fx).status, 1, "the control: it was red first");

  assert.equal(git(fx.dir, ["add", "backlog/history"]).status, 0);
  const r = check(fx);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /each one tracked/);
});

test("a backlog nobody has committed yet PASSES — the defect is the asymmetry", () => {
  // Neither the task nor the log is tracked. A guard failing here would make
  // `check` red on a fresh `init`, which is where it has to be trusted most.
  const fx = fixture();
  const r = check(fx);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("the count in the green line says how much was actually looked at", () => {
  // "0 untracked" over 0 logs and "0 untracked" over 157 are the same verdict
  // and completely different evidence.
  const fx = fixture();
  assert.equal(git(fx.dir, ["add", "backlog"]).status, 0);
  const r = check(fx);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /1 log\(s\) checked against git/);
});

// ── outside git ───────────────────────────────────────────────────────────

test("outside a repository it says there is nothing to check, and does not tick", () => {
  const dir = tmp("nogit");
  const backlog = join(dir, "backlog");
  const env = { ...process.env, NO_COLOR: "1" };
  assert.equal(run(["init", "--dir", backlog, "--no-example"], dir, env).status, 0);

  const r = run(["check", "--history", "--dir", backlog], dir, env);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /not a git repository/);
  assert.equal(/each one tracked/.test(r.stdout), false,
    "a tick here would be a claim about versioning made by a run that never looked");
});

test("gitRoot answers null rather than throwing when git is not there", () => {
  const fake = () => ({ status: 128, stdout: "", stderr: "not a git repository" });
  assert.equal(gitRoot("/anywhere", { run: fake }), null);
  assert.equal(gitRoot("/anywhere", { run: () => ({ status: 0, stdout: "/repo\n" }) }), "/repo");
  assert.equal(gitRoot("/anywhere", { run: () => ({ status: 0, stdout: "  \n" }) }), null);
});

// ── an orphan is a different defect ───────────────────────────────────────

test("a log with no task is reported apart from an untracked one", () => {
  const fx = fixture();
  assert.equal(git(fx.dir, ["add", "backlog"]).status, 0);
  assert.equal(git(fx.dir, ["commit", "-q", "-m", "everything"]).status, 0);

  // The task goes to another branch — which is exactly what data travelling
  // with branches means, and is why this must not fail.
  const taskFile = spawnSync("sh", ["-c", "ls backlog/tasks/" + fx.id + "-*.md"],
    { cwd: fx.dir, encoding: "utf8" }).stdout.trim();
  renameSync(join(fx.dir, taskFile), join(fx.dir, "elsewhere.md"));

  const r = check(fx);
  assert.equal(r.status, 0, "an orphan is not a failure — the task is on somebody's branch");
  assert.match(r.stdout, /no task in this tree/);
  assert.ok(r.stdout.includes(fx.id + ".jsonl"));
});

test("the two are never added into one number", () => {
  // PURE, so the shapes can be asserted without building four repositories.
  const audit = auditTracking(
    ["A-1", "A-2"], ["A-1", "A-2", "A-9"],
    () => true,
    (id) => id !== "A-2"
  );
  assert.deepEqual(audit.untracked, ["A-2"]);
  assert.deepEqual(audit.orphans, ["A-9"]);
  assert.equal(audit.checked, 2, "the orphan is not counted among the logs that were judged");
});

test("a log untracked beside a task that is also untracked is nobody's defect", () => {
  const audit = auditTracking(["A-1"], ["A-1"], () => false, () => false);
  assert.deepEqual(audit.untracked, []);
  // The control: the same log with the task committed IS the defect.
  const asymmetric = auditTracking(["A-1"], ["A-1"], () => true, () => false);
  assert.deepEqual(asymmetric.untracked, ["A-1"]);
});

test("a task with no log at all is not reported", () => {
  // `history/` is written on the first CHANGE, so a task created and never
  // touched legitimately has none.
  const audit = auditTracking(["A-1", "A-2"], ["A-1"], () => true, () => true);
  assert.deepEqual(audit.untracked, []);
  assert.deepEqual(audit.orphans, []);
  assert.equal(audit.checked, 1);
});

// ── it is in the default run ──────────────────────────────────────────────

test("a bare `check` runs it — a guard wired to nothing passes every test of its own", () => {
  const fx = fixture();
  assert.equal(git(fx.dir, ["add", "backlog/tasks", "backlog/config.yaml", "backlog/boards.yaml"]).status, 0);
  assert.equal(git(fx.dir, ["commit", "-q", "-m", "the task, without its log"]).status, 0);

  const bare = run(["check", "--dir", fx.backlog], fx.dir, fx.env);
  assert.notEqual(bare.status, 0, "the bare `check` did not run the history guard");
  assert.match(bare.stdout, /NOT tracked/);
});

test("`--history` selects it ALONE", () => {
  const fx = fixture();
  const only = check(fx);
  assert.equal(/id collisions|boards|vocabulary|language/.test(only.stdout), false,
    "the selector ran more than the guard it names:\n" + only.stdout);
});

test("this repository passes its own guard", () => {
  // The one case with real evidentiary weight about THIS tree: 157 logs, and a
  // fixture cannot have the accident this prevents.
  const r = spawnSync(process.execPath, [CLI, "check", "--history"], {
    cwd: join(HERE, "..", ".."), encoding: "utf8", timeout: 60_000,
    env: { ...process.env, NO_COLOR: "1" },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("an unknown argument to the guard is a usage error", () => {
  const r = spawnSync(process.execPath,
    [join(HERE, "..", "check-backlog-history-tracked.mjs"), "--frobnicate"],
    { encoding: "utf8", timeout: 30_000 });
  assert.equal(r.status, 2);
});

test("the guard leaves the repository exactly as it found it", () => {
  // It reads git and must never write to it: a guard that staged a file to make
  // itself pass would be the worst possible fix for this defect.
  const fx = fixture();
  assert.equal(git(fx.dir, ["add", "backlog/tasks"]).status, 0);
  const before = git(fx.dir, ["status", "--porcelain"]).stdout;
  check(fx);
  assert.equal(git(fx.dir, ["status", "--porcelain"]).stdout, before);
  rmSync(fx.dir, { recursive: true, force: true });
});

test("a repository with many logs, one of them left behind, names only that one", () => {
  const fx = fixture();
  const env = fx.env;
  const ids = [fx.id];
  for (let i = 0; i < 3; i++) {
    const created = run(["new", "--dir", fx.backlog, "--title", "Another task " + i], fx.dir, env);
    const id = (created.stdout.match(/([A-Z]+-\d+)/) || [])[1];
    assert.equal(run(["take", id, "--dir", fx.backlog, "--actor", "local:me"], fx.dir, env).status, 0);
    ids.push(id);
  }
  assert.equal(git(fx.dir, ["add", "backlog"]).status, 0);
  assert.equal(git(fx.dir, ["commit", "-q", "-m", "everything"]).status, 0);

  // One log leaves the index, the rest stay.
  const victim = ids[2];
  assert.equal(git(fx.dir, ["rm", "--cached", "-q", "backlog/history/" + victim + ".jsonl"]).status, 0);
  writeFileSync(join(fx.backlog, "history", victim + ".jsonl"),
    '{"id":"01X","ts":"2026-09-02T00:00:00.000Z","task":"' + victim +
    '","field":"status","from":"pending","to":"in_progress","actor":"local:me","source":"take"}\n',
    "utf8");

  const r = check(fx);
  assert.equal(r.status, 1);
  assert.ok(r.stdout.includes(victim + ".jsonl"));
  for (const other of ids.filter((i) => i !== victim)) {
    assert.equal(r.stdout.includes(other + ".jsonl"), false,
      "a log that IS tracked was reported: " + other);
  }
});
