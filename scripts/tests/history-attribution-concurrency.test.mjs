/**
 * One recorded change has ONE first claim, even when claimants race (TL-303).
 *
 * WHAT THIS FILE MEASURES. `--attribute` reads the unclaimed changes, picks the
 * one it was told to claim, and appends an `__attributed__` entry beside it.
 * TL-302 made that selection refuse an ambiguity, but the read and the append
 * stayed two steps: two processes could both see one event as unclaimed and
 * both append a claim for it. `unattributedChanges()` then hides the second —
 * the FIRST claim is the one that counts — so nothing downstream shows it,
 * while the append-only log permanently records two people as the first
 * good-faith claimant of one change. That is not a view that can be rebuilt; it
 * is a sentence in a file nobody may rewrite.
 *
 * WHY THE CLAIMANTS ARE CHILD PROCESSES. The boundary under test is a critical
 * section between OS processes contending for one file. Calling the function
 * twice in one process measures the simulation, not the boundary — the same
 * reasoning as in `concurrent-attribution.test.mjs` (TL-214), whose shape this
 * file follows.
 *
 * WHY THE BARRIER, AND WHY THE OVERLAP IS ASSERTED. Six `node` processes
 * started "at the same time" serialise themselves on their own startup, and
 * then the race never happens: the run is green on a zero sample, which is
 * exactly the shape of a guard with no evidentiary force (AGENTS.md). Each
 * child therefore spins until one shared wall-clock instant, and records the
 * instants around its own claim. The test FAILS when no two of those windows
 * overlap, because then it has measured nothing.
 *
 * THE POSITIVE CONTROLS ARE THE POINT. One claimant alone must succeed — so a
 * red race is not "the fixture was unclaimable". Two claimants one after
 * another must produce one claim and one refusal — so the refusal the race
 * relies on is shown to exist without any timing at all.
 *
 * NOTHING HERE ASSERTS ANOTHER PROJECT'S VALUES: the fixture creates its own
 * task, and the only field it changes is `status`, whose target value is read
 * back from the tool's own configuration rather than typed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { loadConfig } from "../config.mjs";
import { FIELD_ATTRIBUTED, historyPath, readHistory, unattributedChanges } from "../history.mjs";
import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

const CLI = join(SCRIPTS_DIR, "cli.mjs");

isolateHome("history-attribution-concurrency");

/** How many claimants contend for the single unclaimed change. */
const CLAIMANTS = 6;

let counter = 0;

function run(args, env) {
  return spawnSync(process.execPath, [CLI].concat(args), { encoding: "utf8", timeout: 60_000, env });
}

/**
 * A backlog with exactly ONE unclaimed change: a status edit observed by a
 * reconcile that could name no author.
 *
 * The creation is signed (`BACKLOG_ACTOR` is a real actor while the task is
 * created), so the one candidate below is the status change and nothing else —
 * the claimants cannot accidentally claim different events and both be right.
 */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-claim-race-" + (counter++) + "-"));
  const backlog = join(dir, "bl");
  const env = {
    ...process.env,
    BACKLOG_STATE_DIR: join(dir, "state"),
    BACKLOG_ACTOR: "local:creator",
    NO_COLOR: "1",
  };
  delete env.BACKLOG_SESSION;
  delete env.BACKLOG_TASK;

  assert.equal(run(["init", "--dir", backlog, "--no-example"], env).status, 0);
  const created = run(["new", "--dir", backlog, "--title", "One change, many claimants"], env);
  assert.equal(created.status, 0, created.stderr);
  const id = (created.stdout.match(/([A-Z]+-\d+)/) || [])[1];
  assert.ok(id, "the fixture did not learn the new task's identifier: " + created.stdout);
  const file = join(backlog, "tasks",
    readdirSync(join(backlog, "tasks")).find((name) => name.startsWith(id + "-")));

  assert.equal(run(["history", "--dir", backlog, "--file", file, "--actor", "local:creator",
    "--quiet"], env).status, 0);

  // A status this backlog really has, read from its own configuration — the
  // value is DATA, so it is established rather than asserted.
  const cfg = loadConfig(backlog);
  const current = (readFileSync(file, "utf8").match(/^status:\s*(\S+)/m) || [])[1];
  const target = (cfg.statuses || []).find((s) => s !== current);
  assert.ok(target, "the fixture needs a second status to move the task to");
  writeFileSync(file, readFileSync(file, "utf8").replace(/^status: .*$/m, "status: " + target), "utf8");

  // Somebody else's reconcile — the running server's, typically — observes the
  // edit and can name no author. This is the change the claimants compete for.
  assert.equal(run(["history", "--dir", backlog, "--file", file, "--actor", "unknown",
    "--source", "external", "--quiet"], env).status, 0);

  const candidates = unattributedChanges(backlog, { only: [id] });
  assert.equal(candidates.length, 1,
    "the fixture must offer exactly one unclaimed change, or the race is about two different events");
  return { dir, backlog, env, file, id, event: candidates[0].entry.id };
}

/** Every `__attributed__` entry standing for one event. */
function claimsFor(backlog, id, event) {
  return readHistory(backlog, id)
    .filter((e) => e.field === FIELD_ATTRIBUTED && e.attributes === event);
}

/**
 * The child that races at the BOUNDARY the defect lives on: it reads the
 * unclaimed changes BEFORE the barrier and appends its claim after it.
 *
 * WHY THE READ IS OUTSIDE THE BARRIER AND THE CLAIM INSIDE. That is the shape
 * of the defect, stated exactly: every claimant observed the change as
 * unclaimed, and each then acted on a fact that stopped being true. Leaving the
 * read inside the barrier as well would let the processes settle the race by
 * accident of scheduling and produce a green run that proves nothing — a whole
 * `history --attribute` invocation takes long enough that its own reconcile
 * serialises the claimants, which is why the command-level race further down
 * cannot carry this proof on its own. `sawUnclaimed` in the report is what
 * makes this visible to the assertion rather than merely to the reader.
 */
function boundaryChild(dir) {
  const file = join(dir, "boundary-claimant.mjs");
  writeFileSync(file, [
    'import { writeFileSync } from "node:fs";',
    'const [history, backlog, actor, event, at, out] = process.argv.slice(2);',
    'const { attributeChanges, unattributedChanges } = await import(history);',
    '// The stale read: performed before anybody has claimed anything.',
    'const mine = unattributedChanges(backlog).filter(({ entry }) => entry.id === event);',
    '// Spin, do not sleep: the claims have to overlap, not merely follow closely.',
    'while (Date.now() < Number(at)) { /* barrier */ }',
    'const started = Date.now();',
    'let written = [];',
    'let error = "";',
    'try { written = attributeChanges(backlog, mine, { actor, reason: "I made this change" }); }',
    'catch (e) { error = String(e && e.message); }',
    'const ended = Date.now();',
    'writeFileSync(out, JSON.stringify({ actor, started, ended, error,',
    '  sawUnclaimed: mine.length === 1, wrote: written.length }), "utf8");',
  ].join("\n"), "utf8");
  return file;
}

/**
 * The child that performs ONE claim through the documented command: spin to
 * the barrier, run it, and report the window its own attempt occupied.
 */
function claimantChild(dir) {
  const file = join(dir, "claimant.mjs");
  writeFileSync(file, [
    'import { spawnSync } from "node:child_process";',
    'import { writeFileSync } from "node:fs";',
    'const [cli, backlog, task, actor, event, at, out] = process.argv.slice(2);',
    '// Spin, do not sleep: the claims have to overlap, not merely follow closely.',
    'while (Date.now() < Number(at)) { /* barrier */ }',
    'const started = Date.now();',
    'const r = spawnSync(process.execPath, [cli, "history", "--dir", backlog, "--file", task,',
    '  "--attribute", "--event", event, "--actor", actor, "--reason", "I made this change"],',
    '  { encoding: "utf8" });',
    'const ended = Date.now();',
    'writeFileSync(out, JSON.stringify({ actor, started, ended, status: r.status,',
    '  stdout: String(r.stdout), stderr: String(r.stderr) }), "utf8");',
  ].join("\n"), "utf8");
  return file;
}

/** Start every child on one wall-clock instant and wait for all of them. */
async function race(specs) {
  // Enough lead for `node` to start and reach the barrier on a loaded machine.
  // The number is about process startup, not about the defect.
  const at = Date.now() + 1500;
  const children = specs.map((s) =>
    spawn(process.execPath, s.args(at), { stdio: ["ignore", "inherit", "inherit"], env: s.env }));
  await Promise.all(children.map((c) => new Promise((res) => c.on("exit", res))));
}

/** How many of these attempts overlapped in time with at least one other. */
function overlapping(reports) {
  return reports.filter((a) =>
    reports.some((b) => b !== a && a.started <= b.ended && b.started <= a.ended)).length;
}

// ── the positive controls ─────────────────────────────────────────────────

test("POSITIVE CONTROL: one claimant alone claims the change", () => {
  const { dir, backlog, env, file, id, event } = fixture();
  try {
    const r = run(["history", "--dir", backlog, "--file", file, "--attribute", "--event", event,
      "--actor", "local:author", "--reason", "I made this change"], env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /claimed 1 recorded change/);
    assert.equal(claimsFor(backlog, id, event).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POSITIVE CONTROL: a second claimant, one after the other, is refused and appends nothing", () => {
  const { dir, backlog, env, file, id, event } = fixture();
  try {
    const first = run(["history", "--dir", backlog, "--file", file, "--attribute", "--event", event,
      "--actor", "local:first", "--reason", "I made this change"], env);
    assert.equal(first.status, 0, first.stderr);

    const before = readFileSync(historyPath(backlog, id), "utf8");
    const second = run(["history", "--dir", backlog, "--file", file, "--attribute", "--event", event,
      "--actor", "local:second", "--reason", "no, I made this change"], env);
    assert.notEqual(second.status, 0, "a second claim for one change must not succeed");
    assert.equal(readFileSync(historyPath(backlog, id), "utf8"), before,
      "a refused claim appended a history line");
    assert.equal(claimsFor(backlog, id, event).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── the race at the boundary ──────────────────────────────────────────────

test("every claimant saw the change as unclaimed — only one of them may append", async () => {
  const { dir, backlog, env, id, event } = fixture();
  try {
    const child = boundaryChild(dir);
    const history = pathToFileURL(join(SCRIPTS_DIR, "history.mjs")).href;
    const before = readFileSync(historyPath(backlog, id), "utf8");
    const outs = [];
    await race(Array.from({ length: CLAIMANTS }, (_, i) => {
      const out = join(dir, "boundary-" + i + ".json");
      outs.push(out);
      return { env, args: (at) => [child, history, backlog, "agent:b" + i, event, String(at), out] };
    }));

    const reports = outs.map((o) => JSON.parse(readFileSync(o, "utf8")));
    assert.deepEqual(reports.map((r) => r.error).filter(Boolean), [],
      "a claimant failed for a reason other than losing the race");

    // THE RACE HAS TO HAVE HAPPENED, TWICE OVER. Every claimant read the change
    // as unclaimed — so every one of them was about to append a first claim —
    // and their attempts overlapped in time. Without both, a green run would be
    // a zero sample: it would pass against the defect just as well.
    assert.equal(reports.filter((r) => r.sawUnclaimed).length, CLAIMANTS,
      "every claimant must have observed the change as unclaimed, or they were not racing for it");
    assert.ok(overlapping(reports) >= 2,
      "no two claims overlapped in time, so this run measured nothing about concurrency:\n" +
      reports.map((r) => "  " + r.actor + " " + r.started + "–" + r.ended).join("\n"));

    assert.equal(reports.filter((r) => r.wrote === 1).length, 1,
      "exactly one claimant may append; these did:\n" +
      reports.filter((r) => r.wrote).map((r) => "  " + r.actor).join("\n"));
    assert.equal(claimsFor(backlog, id, event).length, 1,
      "one recorded change carries ONE first claim; the log says:\n" +
      claimsFor(backlog, id, event).map((c) => "  " + c.actor + " · " + c.ts).join("\n"));

    const after = readFileSync(historyPath(backlog, id), "utf8");
    assert.equal(after.slice(0, before.length), before, "an earlier history line changed");
    assert.equal(after.slice(before.length).split("\n").filter(Boolean).length, 1,
      "exactly one line was appended by the whole race");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── the same race through the command ─────────────────────────────────────

test("several claimants at once — exactly one claim is appended and every loser is refused", async () => {
  const { dir, backlog, env, file, id, event } = fixture();
  try {
    const child = claimantChild(dir);
    const before = readFileSync(historyPath(backlog, id), "utf8");
    const outs = [];
    await race(Array.from({ length: CLAIMANTS }, (_, i) => {
      const out = join(dir, "claim-" + i + ".json");
      outs.push(out);
      return {
        env,
        args: (at) => [child, CLI, backlog, file, "agent:c" + i, event, String(at), out],
      };
    }));

    const reports = outs.map((o) => JSON.parse(readFileSync(o, "utf8")));
    assert.equal(reports.length, CLAIMANTS, "every claimant reported");

    // THE RACE HAS TO HAVE HAPPENED. Green on claims that never overlapped is a
    // zero sample: it would pass just as well against the defect this guards.
    assert.ok(overlapping(reports) >= 2,
      "no two claims overlapped in time, so this run measured nothing about concurrency:\n" +
      reports.map((r) => "  " + r.actor + " " + r.started + "–" + r.ended).join("\n"));

    const winners = reports.filter((r) => r.status === 0);
    const losers = reports.filter((r) => r.status !== 0);
    assert.equal(winners.length, 1,
      "exactly one claimant may be told it claimed the change; these were:\n" +
      winners.map((r) => "  " + r.actor + ": " + r.stdout.trim()).join("\n"));
    assert.equal(losers.length, CLAIMANTS - 1);

    const claims = claimsFor(backlog, id, event);
    assert.equal(claims.length, 1,
      "one recorded change carries ONE first claim; the log says:\n" +
      claims.map((c) => "  " + c.actor + " · " + c.ts + " · " + (c.reason || "")).join("\n"));
    assert.equal(claims[0].actor, winners[0].actor,
      "the claim in the log must belong to the claimant that was told it won");

    // APPEND-ONLY, AND THE LOSERS WROTE NOTHING: every earlier line is
    // byte-identical and there is exactly ONE more.
    const after = readFileSync(historyPath(backlog, id), "utf8");
    assert.equal(after.slice(0, before.length), before, "an earlier history line changed");
    assert.deepEqual(after.slice(before.length).split("\n").filter(Boolean).length, 1,
      "exactly one line was appended by the whole race");

    for (const loser of losers) {
      assert.match(loser.stderr, new RegExp(event),
        loser.actor + " was refused without being told which change it lost");
    }
    assert.equal(unattributedChanges(backlog, { only: [id] }).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
