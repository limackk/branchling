/**
 * Who gets the attribution when several writers race? (TL-214)
 *
 * WHAT THIS FILE MEASURES. Every writing route in this tool ends in the same
 * two steps: append entries to `history/<ID>.jsonl`, then advance
 * `history/.snapshot.json`. The append is an O_APPEND write to a file only that
 * task uses, and it is safe. The snapshot is ONE file for the whole backlog,
 * read into memory, mutated, and written back — a read-modify-write with
 * nothing coordinating it. Two writers that overlap therefore both save a
 * snapshot computed from the same starting point, and whichever renames last
 * decides what the reference point says. The other one's advance is gone.
 *
 * WHY THAT IS NOT MERELY UNTIDY. The snapshot is what the next diff is taken
 * AGAINST, so a lost advance has two consequences in an APPEND-ONLY log:
 *
 *   1. The next change to that field is written with a `from` that names a
 *      value the field no longer held — a transition nobody ever made, in a log
 *      whose entries cannot be corrected afterwards.
 *   2. If the reference point has been rolled back to a value the field is
 *      about to be set to again, the write produces NO DIFFERENCE, so no entry
 *      is written at all, and the snapshot then absorbs it. The change is in
 *      the file, the log has never heard of it, and `--attribute` has nothing
 *      to claim. TL-214's Steps call this out as the one outcome that is not
 *      recoverable.
 *
 * WHY THE WRITERS ARE CHILD PROCESSES RUNNING THE TOOL'S OWN COMMANDS. The
 * race is between OS processes contending for one file; simulating it in one
 * process would be a test of the simulation. No agent CLI and no network is
 * involved, so this runs in CI and fails for the reason it names (TL-214,
 * "the test must not need a vendor").
 *
 * WHY THE BARRIER. Started merely "at the same time", six `node` processes
 * serialise themselves on their own startup and the collision does not happen.
 * Each child therefore spins until one shared wall-clock instant and only then
 * touches the backlog. The barrier makes the overlap reliable; it does not
 * make the defect, which is present at any degree of overlap and was measured
 * by hand on this repository on 2026-09-03 before it was ever provoked here.
 *
 * WHY EACH WRITER'S SEQUENCE RETURNS TO AN EARLIER VALUE. `A B A C A D`, not
 * `A B C D`. Consequence 2 above needs the field to be set to a value the
 * rolled-back reference point already names, and a strictly increasing
 * sequence would only ever show consequence 1. This is the difference between
 * proving the author was lost and proving the CHANGE was.
 *
 * WHY `branchling serve`'S RECONCILER IS NOT ONE OF THE WRITERS. TL-214's
 * Context names three: an unattended run, a session, and the server's timer. A
 * version of this file with a fourth child calling `reconcile(dir, {actor:
 * "unknown", source: "external"})` in a loop beside the writers was measured
 * over seven runs and was red in two of them — WEAKER than the writers on
 * their own, which were red in every run. The reason is worth writing down for
 * whoever chooses the mechanism: a reconciler re-reads the WHOLE tree, so it
 * repairs the very reference point the writers had just corrupted, and it hides
 * the defect more often than it exposes it. A guard that is green two runs in
 * three tells the next hand nothing about whether their fix worked, so the
 * reconciler is left out rather than shipped flaky.
 *
 * That does NOT mean the server is innocent: it is the writer that was
 * observed signing other people's changes on 2026-09-03. But what it adds is a
 * WRONG AUTHOR on a change that is nonetheless present, which TL-130 already
 * decided about (the entry stays and is claimed beside it with `--attribute`).
 * What the writers do to each other here is lose the change altogether, and
 * TL-214's Steps say that is the one outcome nothing can recover.
 *
 * THE POSITIVE CONTROL IS THE POINT (CLAUDE.md). The identical fixture, the
 * identical writes and the identical assertion, performed one writer after
 * another, must be green. Without it a red race would not distinguish "the
 * writers collide" from "the assertion was unsatisfiable" or "the fixture was
 * built wrong".
 *
 * NOTHING HERE ASSERTS ANOTHER PROJECT'S VALUES. Every field's starting value
 * is READ from the fixture's own task file, and the expected chain is built
 * from what the writers were told to write. The field NAMES come from the
 * tool's own `FIELD_SHAPES`, which is shape rather than vocabulary.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { metaFromText } from "../history.mjs";
import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

const CLI = join(SCRIPTS_DIR, "cli.mjs");

// Every row this file writes goes to a throwaway home directory (TL-166).
isolateHome("concurrent-attribution");

/** How many writers contend. Each owns one task and makes `PLAN[i].values.length`
 *  writes to one field of it. */
const WRITERS = 6;

/**
 * One writer, one task, one field — the shape TL-214's Steps describe. The
 * three fields are free text in `FIELD_SHAPES`, so a value can be invented per
 * round without borrowing a project's enum.
 */
const PLAN = [
  { field: "estimate", values: ["1h", "2h", "1h", "3h", "1h", "4h"] },
  { field: "epic", values: ["alpha", "beta", "alpha", "gamma", "alpha", "delta"] },
  { field: "owner", values: ["local:one", "local:two", "local:one", "local:three", "local:one", "local:four"] },
];

let counter = 0;

/** A task's value for one field, as the history mechanism itself reads it. */
function initial(file, field) {
  const value = metaFromText(readFileSync(file, "utf8"))[field];
  return value == null ? "" : String(value);
}

function run(args, env) {
  return spawnSync(process.execPath, [CLI].concat(args), { encoding: "utf8", timeout: 60_000, env });
}

/**
 * A backlog of `WRITERS` tasks with a reference point already established.
 *
 * THE SEED IS PART OF THE FIXTURE, not part of the race. A tree with no
 * snapshot has no reference point at all, so a first reconcile writes one and
 * records nothing by design — every writer would then be honestly silent and
 * the run would prove nothing about concurrency (that is TL-185's territory,
 * not this one).
 */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-race-" + (counter++) + "-"));
  const backlog = join(dir, "bl");
  const env = { ...process.env, BACKLOG_STATE_DIR: join(dir, "state"), NO_COLOR: "1" };
  delete env.BACKLOG_SESSION;
  delete env.BACKLOG_TASK;

  assert.equal(run(["init", "--dir", backlog, "--no-example"], env).status, 0);
  const tasksDir = join(backlog, "tasks");
  const writers = [];
  for (let i = 0; i < WRITERS; i++) {
    const created = run(["new", "--dir", backlog, "--title", "Task number " + (i + 1)], env);
    assert.equal(created.status, 0, created.stderr);
    const id = (created.stdout.match(/([A-Z]+-\d+)/) || [])[1];
    assert.ok(id, "the fixture did not learn the new task's identifier: " + created.stdout);
    const file = join(tasksDir, readdirSync(tasksDir).find((f) => f.startsWith(id + "-")));
    const plan = PLAN[i % PLAN.length];
    writers.push({
      id, file, actor: "agent:w" + i, field: plan.field, values: plan.values,
      // READ, never assumed: this is the fixture's own starting value, and it
      // is read with the tool's OWN parser. A regexp over the line returns the
      // trailing template comment as part of the value, which would make the
      // expected chain disagree with a correctly written log.
      before: initial(file, plan.field),
    });
  }
  const seeded = run(["history", "--dir", backlog, "--actor", "local:seed"], env);
  assert.equal(seeded.status, 0, seeded.stderr);
  assert.match(seeded.stdout, /reference point/,
    "the fixture must start from an established reference point, or the race proves nothing");
  return { dir, backlog, env, writers };
}

/** The chain a writer's field MUST show: one entry per write, in order, signed. */
function expectedChain(w) {
  const chain = [];
  let from = w.before;
  for (const to of w.values) {
    chain.push({ from, to, actor: w.actor });
    from = to;
  }
  return chain;
}

/** What the log actually says about that writer's field, in the order written. */
function actualChain(backlog, w) {
  const file = join(backlog, "history", w.id + ".jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .filter((e) => e.field === w.field)
    .map((e) => ({ from: e.from, to: e.to, actor: e.actor }));
}

/** The child that performs one writer's whole sequence: edit the file by hand,
 *  then record it the documented way (`history --file --actor`). */
function writerChild(dir) {
  const file = join(dir, "writer.mjs");
  writeFileSync(file, [
    'import { spawnSync } from "node:child_process";',
    'import { readFileSync, writeFileSync } from "node:fs";',
    'const [cli, backlog, task, actor, field, at, values] = process.argv.slice(2);',
    '// Spin, do not sleep: the point is that all of them are inside the',
    '// read-modify-write of the snapshot at once.',
    'while (Date.now() < Number(at)) { /* barrier */ }',
    'for (const value of JSON.parse(values)) {',
    '  const text = readFileSync(task, "utf8");',
    '  writeFileSync(task, text.replace(new RegExp("^" + field + ": .*$", "m"), field + ": " + value), "utf8");',
    '  const r = spawnSync(process.execPath, [cli, "history", "--dir", backlog, "--file", task,',
    '    "--actor", actor, "--source", "manual", "--reason", "one write of the race fixture"],',
    '    { encoding: "utf8" });',
    '  if (r.status !== 0) { process.stderr.write(String(r.stderr)); process.exit(1); }',
    '}',
  ].join("\n"), "utf8");
  return file;
}

/** Start every child on one wall-clock instant and wait for all of them. */
async function race(specs) {
  // Enough lead for `node` to reach the barrier on a loaded machine. Too short
  // and the children merely queue up; the number is about process startup, not
  // about the defect.
  const at = Date.now() + 1500;
  const children = specs.map((s) => spawn(process.execPath, s.args(at), { stdio: ["ignore", "inherit", "inherit"], env: s.env }));
  return Promise.all(children.map((c) => new Promise((res) => c.on("exit", (code) => res(code)))));
}

// ── the positive control ──────────────────────────────────────────────────

test("POSITIVE CONTROL: one writer after another — every change is recorded once, in order, signed", () => {
  const { backlog, env, writers } = fixture();
  for (const w of writers) {
    for (const value of w.values) {
      const text = readFileSync(w.file, "utf8");
      writeFileSync(w.file, text.replace(new RegExp("^" + w.field + ": .*$", "m"), w.field + ": " + value), "utf8");
      const r = run(["history", "--dir", backlog, "--file", w.file, "--actor", w.actor,
        "--source", "manual", "--reason", "one write of the race fixture"], env);
      assert.equal(r.status, 0, r.stderr);
    }
  }
  for (const w of writers) {
    assert.deepEqual(actualChain(backlog, w), expectedChain(w),
      "with nobody to collide with, " + w.actor + "'s writes to " + w.id + "." + w.field +
        " must be exactly what it wrote — this is the assertion the race case uses, " +
        "shown to be satisfiable and to have force");
  }
});

// ── the race itself ───────────────────────────────────────────────────────

test("several writers at once — every change is recorded exactly once, under its author", async () => {
  const { dir, backlog, env, writers } = fixture();
  const child = writerChild(dir);
  const codes = await race(writers.map((w) => ({
    env,
    args: (at) => [child, CLI, backlog, w.file, w.actor, w.field, String(at), JSON.stringify(w.values)],
  })));
  assert.deepEqual(codes, writers.map(() => 0), "every writer's own commands succeeded");

  // Reported per writer rather than at the first failure: which writers lost and
  // how is the finding, and a bare "not deepEqual" on one of them hides it.
  const damage = writers
    .map((w) => ({ w, actual: actualChain(backlog, w), expected: expectedChain(w) }))
    .filter((r) => JSON.stringify(r.actual) !== JSON.stringify(r.expected));

  assert.deepEqual(damage.map((r) => r.w.id + "." + r.w.field), [],
    "these writers made changes the log does not describe. Nothing external ran: the only\n" +
    "other processes were the other writers, each recording its OWN task through the\n" +
    "documented route. Detail:\n" +
    damage.map((r) => "  " + r.w.id + "." + r.w.field + " by " + r.w.actor +
      "\n    written:  " + JSON.stringify(r.expected.map((e) => e.to)) +
      "\n    recorded: " + JSON.stringify(r.actual.map((e) => e.to)) +
      "\n    chain:    " + JSON.stringify(r.actual)).join("\n"));
});
