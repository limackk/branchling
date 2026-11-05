/**
 * A `check --proofs` started from inside a proofs run re-runs nothing (TL-565).
 *
 * THE HAZARD. A closed task whose contract holds `check --proofs` ("every
 * earlier contract still passes") closes fine, because while `done` runs it the
 * task is still open and the inner run skips it. From then on every proofs run
 * re-runs that contract, which starts another proofs run, which re-runs it
 * again — without end. The enclosing run already re-runs every closed contract,
 * so the nested one has nothing to add: it says so, exits 0, and the enclosing
 * run names the entry that hit the guard, so an entry whose only effect was the
 * nested call does not read as a pass that proved something.
 *
 * WHY THE TIME LIMIT KILLS BY PARENT PID. Every contract entry is started as the
 * leader of its own process group, so a nested run is a session leader and a
 * kill of the outermost group leaves it recursing. A red run of this file must
 * not leave a process behind: every descendant is frozen first, collected by
 * parent pid until no new one appears, and only then killed.
 *
 * THE POSITIVE CONTROL is in the same fixture: a second closed task whose
 * contract is made to fail is still reported as broken by the very run whose
 * nested entry passed. Without it, a guard that silenced the whole run would
 * pass the first half of this file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PROOFS_RUN_ENV, nestedRun } from "../check-backlog-proofs.mjs";

import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("proofs-reentrance");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const LIMIT_MS = 60_000;

/** The environment of every command here: no colour, and no mark inherited
 *  from a proofs run that happens to be running this suite. */
function env() {
  const e = { ...process.env, NO_COLOR: "1" };
  delete e.FORCE_COLOR;
  delete e[PROOFS_RUN_ENV];
  return e;
}

function task(id, title, entryId, command) {
  return [
    "---", "id: " + id, 'title: "' + title + '"', "type: task", "labels: []", "board: main",
    'epic: ""', "priority: P1", "status: in_progress", "owner: local:test", "estimate: 1h",
    "created: 2026-11-05", "updated: 2026-11-05", "blocked_by: []", "blocks: []",
    "verification:", "  - id: " + entryId, "    bash: " + JSON.stringify(command), "---", "",
    "## Goal", "", title + ".", "",
    "## Acceptance criteria", "", "- [ ] It holds [proof: " + entryId + "]", "",
  ].join("\n");
}

function done(dir, id) {
  const r = spawnSync(process.execPath, [CLI, "done", id, "--dir", dir, "--actor", "local:closer"],
    { encoding: "utf8", input: "", env: env() });
  assert.equal(r.status, 0, "closing " + id + " failed: " + (r.stdout || "") + (r.stderr || ""));
}

/** Every live descendant of `root`, read from the process table by parent pid. */
function descendants(root) {
  const r = spawnSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" });
  const children = new Map();
  for (const line of String(r.stdout || "").split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!pid) continue;
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(pid);
  }
  const out = [];
  const queue = [root];
  while (queue.length) {
    for (const c of children.get(queue.shift()) || []) { out.push(c); queue.push(c); }
  }
  return out;
}

const signal = (pid, sig) => { try { process.kill(pid, sig); } catch { /* already gone */ } };

/** Freeze the whole tree before killing any of it, so that nothing it is
 *  spawning at that moment escapes the collection. */
function stopTree(root) {
  const frozen = new Set([root]);
  signal(root, "SIGSTOP");
  for (;;) {
    const fresh = descendants(root).filter((p) => !frozen.has(p));
    if (!fresh.length) break;
    for (const p of fresh) { frozen.add(p); signal(p, "SIGSTOP"); }
  }
  for (const p of frozen) signal(p, "SIGKILL");
}

/** `check --proofs` over `dir`, with a time limit that stops every descendant. */
function proofs(dir) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, "check", "--proofs", "--dir", dir], { env: env() });
    let out = "";
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { out += c; });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; stopTree(child.pid); }, LIMIT_MS);
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, timedOut });
    });
  });
}

test("a closed contract holding `check --proofs` does not make a proofs run recurse", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "branchling-reentrance-")));
  try {
    const init = spawnSync(process.execPath, [CLI, "init", "--dir", dir, "--no-example"], { encoding: "utf8", env: env() });
    assert.equal(init.status, 0, init.stderr);
    const marker = join(dir, "broken");
    // TASK-1 is the positive control's subject: green while the marker is absent.
    writeFileSync(join(dir, "tasks", "TASK-1-a-plain-contract.md"),
      task("TASK-1", "A plain contract", "still-holds", "test ! -e " + marker), "utf8");
    // TASK-2 says "every earlier contract still passes" in the shape a consumer writes.
    writeFileSync(join(dir, "tasks", "TASK-2-earlier-proofs-hold.md"),
      task("TASK-2", "Earlier proofs hold", "earlier-proofs-hold",
        JSON.stringify(process.execPath) + " " + JSON.stringify(CLI) + " check --proofs --dir " + JSON.stringify(dir)),
      "utf8");
    done(dir, "TASK-1");
    // Closing works without the guard as well: the task is still open while
    // `done` runs it, so the inner run does not re-run it. The hang comes after.
    done(dir, "TASK-2");

    const green = await proofs(dir);
    assert.equal(green.timedOut, false, "the proofs run recursed until the time limit: " + green.out);
    assert.equal(green.code, 0, green.out);
    assert.match(green.out, /nested `check --proofs`/, "the nested entry was not named: " + green.out);
    assert.match(green.out, /TASK-2: earlier-proofs-hold/);

    writeFileSync(marker, "", "utf8");
    const red = await proofs(dir);
    assert.equal(red.timedOut, false, "the proofs run recursed until the time limit: " + red.out);
    assert.equal(red.code, 1, "a broken contract beside the nested entry passed: " + red.out);
    assert.match(red.out, /TASK-1 by local:closer/, "the broken contract was not reported: " + red.out);
    assert.match(red.out, /TASK-2: earlier-proofs-hold/, "the nested entry was not named beside it: " + red.out);
    assert.doesNotMatch(red.out, /- TASK-2 by/, "the nested entry was reported as a broken proof: " + red.out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the mark stops only a run over a backlog the enclosing chain already covers", () => {
  // A proofs run of THIS repository runs its own suite, and that suite starts
  // proofs runs over temporary fixtures. Those are different backlogs whose
  // contracts the enclosing run does not cover, so they must run for real.
  const mark = JSON.stringify({ roots: ["/a/backlog"], report: "/tmp/x", entry: "TASK-2: e" });
  assert.equal(nestedRun({ [PROOFS_RUN_ENV]: mark }, "/a/backlog").entry, "TASK-2: e");
  assert.equal(nestedRun({ [PROOFS_RUN_ENV]: mark }, "/b/backlog"), null);
  assert.equal(nestedRun({}, "/a/backlog"), null);
  // A malformed mark is no mark: running for real is the reading that cannot
  // silently skip a proof.
  assert.equal(nestedRun({ [PROOFS_RUN_ENV]: "not json" }, "/a/backlog"), null);
  assert.equal(nestedRun({ [PROOFS_RUN_ENV]: JSON.stringify({ roots: "/a/backlog" }) }, "/a/backlog"), null);
});
