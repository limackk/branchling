/**
 * `query --env`, `--not-env` and `--json` count deployment from the same trunk
 * as `show` and `deploy status` (TL-517).
 *
 * WHAT HAS TO BE PROVED, against a real fixture repository on a feature
 * branch, because the defect only exists where `HEAD` and the remote's default
 * branch differ:
 *
 *   1. A task whose only commit sits on the unmerged feature branch gets the
 *      same deployment answer from `query` and from `show`: no commit on the
 *      trunk names it, so it matches neither `--env` nor `--not-env`.
 *   2. `query` names the trunk it used and where that trunk came from, in the
 *      text output and in the `--json` envelope.
 *   3. POSITIVE CONTROL: with no `origin/HEAD` both fall back to `HEAD`, and
 *      the same task then DOES match `--not-env` — so the first answer is the
 *      trunk's doing, not a filter that never matches anything.
 *
 * Stage names and paths are the fixture's own, declared in its config.yaml.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { SCRIPTS_DIR, isolateHome, isolateState } from "./_repo.mjs";

isolateHome("query-trunk");
isolateState("query-trunk");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const STAGE = "test";

function git(dir, ...args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

function run(dir, args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, cwd: dir, env: { ...process.env, NO_COLOR: "1" },
  });
}

function commit(dir, message, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(path)), { recursive: true });
    writeFileSync(join(dir, path), content, "utf8");
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", message);
}

function newTask(dir, title) {
  const r = run(dir, ["new", "--dir", "backlog", "--title", title]);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.match(/[A-Z]+-\d+/)[0];
}

/**
 * `main` holds a merged task; the checked-out `feature` branch holds one more
 * commit naming a second task. `origin/HEAD` points at `origin/main`, which is
 * `main` — the clone's record of the line everybody merges into.
 */
function fixture() {
  const dir = fixtureDir(join(tmpdir(), "branchling-query-trunk-"));
  git(dir, "init", "-q", "-b", "main", ".");
  assert.equal(run(dir, ["init", "--dir", "backlog", "--no-example"]).status, 0);
  const merged = newTask(dir, "Merged into main");
  const unmerged = newTask(dir, "Worked on a feature branch");
  appendFileSync(join(dir, "backlog", "config.yaml"), `
deploy_targets:
  - name: app
    paths: [src/]
    stages:
      - { name: ${STAGE}, ref: main }
`);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "the backlog");
  commit(dir, merged + " it ships", { "src/a.js": "a\n" });
  git(dir, "update-ref", "refs/remotes/origin/main", "main");
  git(dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  git(dir, "checkout", "-q", "-b", "feature");
  commit(dir, unmerged + " it is not merged", { "src/b.js": "b\n" });
  return { dir, merged, unmerged };
}

function ids(dir, ...args) {
  const r = run(dir, ["query", "--dir", "backlog", "--json", ...args]);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).tasks.map((t) => t.id).sort();
}

function queryJson(dir) {
  const r = run(dir, ["query", "--dir", "backlog", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

function showJson(dir, id) {
  const r = run(dir, ["show", "--dir", "backlog", id, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).deploy;
}

/** The task's own answer, in the shape both commands share. */
function answer(d) {
  return { commits: d.commits, untargeted: d.untargeted, unobservable: d.unobservable, targets: d.targets };
}

test("on a feature branch query and show give the same deployment state, and query names its trunk", () => {
  const { dir, merged, unmerged } = fixture();
  const trunkSha = git(dir, "rev-parse", "main");

  // The unmerged task: no trunk commit names it, so it matches neither filter.
  assert.deepEqual(ids(dir, "--env", STAGE), [merged]);
  assert.deepEqual(ids(dir, "--not-env", STAGE), []);

  const q = queryJson(dir);
  assert.deepEqual(q.deploy.trunk, { spec: "refs/remotes/origin/main", sha: trunkSha, source: "remote-default" });
  for (const id of [merged, unmerged]) {
    const s = showJson(dir, id);
    assert.deepEqual(s.trunk, q.deploy.trunk, "show and query read different trunks for " + id);
    assert.deepEqual(answer(q.tasks.find((t) => t.id === id).deploy), answer(s), "show and query disagree about " + id);
  }
  assert.equal(showJson(dir, unmerged).commits, 0);

  const text = run(dir, ["query", "--dir", "backlog", "--env", STAGE]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, new RegExp(
    "^# deployment counted from trunk refs/remotes/origin/main " + trunkSha.slice(0, 12) + " \\(the remote's default branch\\)$", "m"));

  // `--count` keeps stdout a number and names the trunk on stderr.
  const count = run(dir, ["query", "--dir", "backlog", "--not-env", STAGE, "--count"]);
  assert.equal(count.status, 0, count.stderr);
  assert.equal(count.stdout.trim(), "0");
  assert.match(count.stderr, /^# deployment counted from trunk refs\/remotes\/origin\/main /m);

  // Without a deployment filter the text output shows no deployment, so it
  // names no trunk either.
  const plain = run(dir, ["query", "--dir", "backlog"]);
  assert.equal(plain.status, 0, plain.stderr);
  assert.doesNotMatch(plain.stdout, /deployment counted from trunk/);
});

test("positive control: with no origin/HEAD both fall back to HEAD, and the feature branch's task counts", () => {
  const { dir, merged, unmerged } = fixture();
  git(dir, "symbolic-ref", "--delete", "refs/remotes/origin/HEAD");
  const headSha = git(dir, "rev-parse", "HEAD");

  // `main` (the stage's ref) does not hold the feature commit, which HEAD does.
  assert.deepEqual(ids(dir, "--env", STAGE), [merged]);
  assert.deepEqual(ids(dir, "--not-env", STAGE), [unmerged]);

  const q = queryJson(dir);
  assert.deepEqual(q.deploy.trunk, { spec: "HEAD", sha: headSha, source: "head" });
  const s = showJson(dir, unmerged);
  assert.deepEqual(s.trunk, q.deploy.trunk);
  assert.deepEqual(answer(q.tasks.find((t) => t.id === unmerged).deploy), answer(s));
  assert.equal(s.commits, 1);

  const text = run(dir, ["query", "--dir", "backlog", "--not-env", STAGE]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, new RegExp(
    "^# deployment counted from trunk HEAD " + headSha.slice(0, 12) + " \\(HEAD — this clone has no `origin/HEAD`\\)$", "m"));
});
