/**
 * A mutation run leaves no hook or server process behind (TL-646).
 *
 * WHAT WAS OBSERVED. On 2026-11-07 a run left six processes alive for hours:
 * git hooks reparented to PID 1, each running the sandbox's `cli.mjs` with no
 * subcommand, which is the server, which never exits. A mutant had dropped the
 * subcommand the hook passes; the test's `spawnSync("git", …, { timeout })`
 * then killed git, and git's hook children were orphaned outside the reach of
 * a kill aimed at the test process. Nothing reported it.
 *
 * THE FIXTURE reproduces that chain without the rest of this repository: a
 * test makes a commit through a `commit-msg` hook that runs the fixture's
 * `cli.mjs`; `cli.mjs` exits when `lib.mjs` says so and otherwise starts a
 * server and waits forever. Every mutant of `lib.mjs` takes the second path,
 * the commit times out, git is killed, and the hook, the CLI and the server
 * are orphaned. Each CLI records the three pids, so the assertions below judge
 * processes that demonstrably existed, not an empty sample.
 *
 * TWO DEFENCES, judged apart. `mutation-contain.mjs` runs each test command
 * as the leader of a process group and kills what is left in it; the first
 * test below fails if the end-of-run sweep in `mutation-run.mjs` had to step
 * in, so it judges the containment alone. The sweep is judged by the tests
 * after it, on processes started for the purpose.
 *
 * Outside the default glob for the reason `subprocess-kill.test.mjs` gives: it
 * runs StrykerJS, a devDependency. Run it by name:
 *
 *   node --test scripts/tests/mutation/no-orphan-processes.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { fixtureDir } from "../_fixture-dir.mjs";
import { SCRIPTS_DIR, isolateHome } from "../_repo.mjs";
import { leftoverProcesses, sweepLeftovers } from "../../mutation-run.mjs";

isolateHome("mutation-orphans");
const ENTRY = join(SCRIPTS_DIR, "mutation-run.mjs");
const POSIX = process.platform !== "win32";

function sh(cwd, cmd, args) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, cmd + " " + args.join(" ") + ": " + r.stderr);
}

function write(root, rel, text) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

/** Every process whose command line names `marker`, this one excluded. */
function namedProcesses(marker) {
  const r = spawnSync("ps", ["-A", "-ww", "-o", "pid=,args="], { encoding: "utf8" });
  assert.equal(r.status, 0, "ps failed: " + r.stderr);
  return r.stdout.split("\n")
    .map((l) => l.trim())
    .filter((l) => l.includes(marker))
    .map((l) => ({ pid: Number(l.split(/\s+/)[0]), args: l.replace(/^\d+\s+/, "") }))
    .filter((p) => p.pid !== process.pid);
}

function killAll(pids) {
  for (const pid of pids) {
    try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
  }
}

const LIB = `export function verb() {
  return "quit";
}
`;

function cli(root) {
  return `import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { verb } from "./lib.mjs";

if (verb() !== "quit") {
  const server = spawn(process.execPath, [fileURLToPath(new URL("./server.mjs", import.meta.url)), ${JSON.stringify(root)}], { stdio: "ignore" });
  writeFileSync(${JSON.stringify(join(root, "pids"))} + "/" + process.pid,
    JSON.stringify({ hook: process.ppid, cli: process.pid, server: server.pid }));
  setInterval(() => {}, 1000);
}
`;
}

const SERVER = "setInterval(() => {}, 1000);\n";

function hookTest(root) {
  return `import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../cli.mjs", import.meta.url));
const ROOT = ${JSON.stringify(root)};
const ENV = { ...process.env,
  GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.com" };

test("the commit-msg hook lets a commit through", () => {
  const repo = join(ROOT, "repos", process.pid + "-" + Date.now());
  mkdirSync(join(repo, "hooks"), { recursive: true });
  try {
    const git = (args, timeout = 10000) => spawnSync("git", args, { cwd: repo, env: ENV, encoding: "utf8", timeout });
    assert.equal(git(["init", "-q"]).status, 0);
    writeFileSync(join(repo, "hooks", "commit-msg"),
      "#!/bin/sh\\n" + JSON.stringify(process.execPath) + " " + JSON.stringify(CLI) + " " + JSON.stringify(ROOT) + " || exit 1\\n");
    chmodSync(join(repo, "hooks", "commit-msg"), 0o755);
    assert.equal(git(["config", "core.hooksPath", join(repo, "hooks")]).status, 0);
    const r = git(["commit", "-q", "--allow-empty", "-m", "x"], 3000);
    assert.equal(r.status, 0, "the commit did not go through: " + (r.error || r.stderr));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
`;
}

test("a timed-out hook in a mutation run leaves no hook, CLI or server process behind", { skip: !POSIX && "process groups are POSIX", timeout: 600_000 }, () => {
  const root = fixtureDir(join(tmpdir(), "branchling-test-mutation-orphans-"));
  const recorded = [];
  try {
    mkdirSync(join(root, "pids"));
    write(root, "scripts/cli.mjs", cli(root));
    write(root, "scripts/server.mjs", SERVER);
    write(root, "scripts/tests/hook.test.mjs", hookTest(root));
    write(root, "scripts/lib.mjs", "export function verb() {}\n");
    write(root, ".gitignore", "pids/\nrepos/\n");
    sh(root, "git", ["init", "-q", "-b", "main"]);
    sh(root, "git", ["add", "-A"]);
    sh(root, "git", ["-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-q", "-m", "base"]);
    sh(root, "git", ["switch", "-q", "-c", "feature"]);
    write(root, "scripts/lib.mjs", LIB);

    // `--tests`, because selection is not under test here: the fixture's
    // `cli.mjs` has no command table, so no rule would pick the hook test.
    const r = spawnSync(process.execPath, [ENTRY, "--base", "main", "--json", "--concurrency", "2",
      "--tests", "scripts/tests/hook.test.mjs"], {
      cwd: root,
      encoding: "utf8",
    });
    for (const f of existsSync(join(root, "pids")) ? readdirSync(join(root, "pids")) : []) {
      const p = JSON.parse(readFileSync(join(root, "pids", f), "utf8"));
      recorded.push({ role: "hook", pid: p.hook }, { role: "cli", pid: p.cli }, { role: "server", pid: p.server });
    }
    assert.equal(r.status, 0, "the run did not complete: " + r.stdout + r.stderr.slice(-3000));
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.tests.map((t) => t.file), ["scripts/tests/hook.test.mjs"]);
    assert.ok(out.files["scripts/lib.mjs"].Killed > 0, "no mutant was killed, so no hook hung: " + r.stdout);
    // The contained group is the first line of defence and the end-of-run
    // sweep the second; a sweep that found something means the first failed,
    // and orphans pile up for the whole run in between.
    assert.doesNotMatch(r.stderr, /outlived the run/, "the end-of-run sweep had to kill what the contained group left");

    // POSITIVE CONTROL: a hung hook really ran, and named its processes.
    assert.ok(recorded.length > 0, "no CLI recorded its pids — the fixture never reached the hanging path");
    const survivors = recorded.filter((p) => alive(p.pid));
    assert.deepEqual(survivors, [], "processes outlived the mutation run");
    assert.deepEqual(namedProcesses(root), [], "a process naming the fixture outlived the mutation run");
  } finally {
    killAll(recorded.map((p) => p.pid));
    killAll(namedProcesses(root).map((p) => p.pid));
    rmSync(root, { recursive: true, force: true });
  }
});

test("the sweep kills a leftover that escaped its group, and the group it leads", { skip: !POSIX && "process groups are POSIX" }, async () => {
  const marker = fixtureDir(join(tmpdir(), "branchling-test-mutation-sweep-"));
  // A detached shell leads its own group, as a test child does once its
  // contained group is gone; the sleep inside it does NOT name the marker, the
  // way a git hook's `/bin/sh .git/hooks/commit-msg` names no sandbox path.
  const leader = spawn("/bin/sh", ["-c", "sleep 300 & wait", marker], { detached: true, stdio: "ignore" });
  leader.unref();
  await new Promise((done) => setTimeout(done, 300));
  const group = spawnSync("ps", ["-A", "-o", "pid=,pgid="], { encoding: "utf8" }).stdout.split("\n")
    .map((l) => l.trim().split(/\s+/).map(Number))
    .filter(([, pgid]) => pgid === leader.pid)
    .map(([pid]) => pid);
  try {
    assert.ok(group.length >= 2, "the fixture group has no member besides its leader: " + JSON.stringify(group));
    assert.ok(leftoverProcesses(marker).some((p) => p.pid === leader.pid), "the leader is not seen as a leftover");

    const swept = sweepLeftovers(marker);
    assert.ok(swept.some((p) => p.pid === leader.pid), "the sweep did not report the leader: " + JSON.stringify(swept));
    await new Promise((done) => setTimeout(done, 300));
    assert.deepEqual(group.filter(alive), [], "a member of the leftover's group outlived the sweep");
  } finally {
    killAll(group);
  }
});

// A group the sweeping process shares is never killed whole: that group holds
// the sweeper and whatever started it, and under `node --test` that is the
// developer's whole test job. So the sweep runs in a detached helper that leads
// a group of its own, never in this process's group; a regression kills the
// helper by SIGKILL, which this test reports, instead of the test runner.
const HELPER = `import { spawn } from "node:child_process";
import { sweepLeftovers } from ${JSON.stringify(pathToFileURL(ENTRY).href)};

const marker = process.env.SWEEP_MARKER;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
// Neither child is detached, so both share this helper's group. Only the shell
// names the marker; the sibling stands for the rest of the group.
const named = spawn("/bin/sh", ["-c", "sleep 300 & wait", marker], { stdio: "ignore" });
const sibling = spawn("/bin/sh", ["-c", "sleep 300"], { stdio: "ignore" });
named.unref();
sibling.unref();
await new Promise((done) => setTimeout(done, 300));
const swept = sweepLeftovers(marker);
await new Promise((done) => setTimeout(done, 300));
process.stdout.write(JSON.stringify({ self: process.pid, named: named.pid, sibling: sibling.pid,
  swept, siblingAlive: alive(sibling.pid) }));
`;

test("a leftover in the sweeper's own group is killed by its pid, and the group survives", { skip: !POSIX && "process groups are POSIX" }, async () => {
  const marker = "branchling-test-sweep-own-group-" + process.pid + "-" + Date.now();
  // The marker travels in the environment, so the helper's own command line
  // does not name it.
  const helper = spawn(process.execPath, ["--input-type=module", "-e", HELPER], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, SWEEP_MARKER: marker },
  });
  let stdout = "";
  let stderr = "";
  helper.stdout.on("data", (d) => { stdout += d; });
  helper.stderr.on("data", (d) => { stderr += d; });
  // `close`, not `exit`: it carries the same status and comes after the output.
  const [code, signal] = await new Promise((done) => helper.on("close", (c, s) => done([c, s])));
  let out = null;
  try {
    assert.equal(signal, null, "the helper was killed by " + signal + ": the sweep killed the group it runs in");
    assert.equal(code, 0, "the helper failed: " + stderr);
    out = JSON.parse(stdout);
    // POSITIVE CONTROL: the leftover really shares the sweeper's group, so the
    // guard is what decided, not an empty sample or a foreign group.
    const hit = out.swept.find((p) => p.pid === out.named);
    assert.ok(hit, "the sweep did not find the process naming the marker: " + stdout);
    assert.equal(hit.pgid, out.self, "the leftover is not in the helper's group: " + stdout);
    assert.equal(out.siblingAlive, true, "the sweep killed a group member that does not name the marker");
    let named = true;
    for (let i = 0; i < 20 && (named = alive(out.named)); i++) await new Promise((done) => setTimeout(done, 100));
    assert.equal(named, false, "the process naming the marker outlived the sweep");
  } finally {
    // The helper's group still holds the sibling and the shell's sleep.
    try { process.kill(-helper.pid, "SIGKILL"); } catch { /* the group is already gone */ }
  }
});

test("the sweep never matches the process that runs it", () => {
  // `ps` shows the command line as typed: `node`, not the resolved execPath,
  // the execArgv flags, and a relative script path where `process.argv` holds
  // an absolute one. The script's own filename is in both.
  const marker = basename(process.argv[1]);
  assert.ok(leftoverProcesses(marker, null, -1).some((p) => p.pid === process.pid),
    "the marker does not match this process, so the exclusion below would hold on an empty sample");
  assert.ok(!leftoverProcesses(marker).some((p) => p.pid === process.pid));
});
