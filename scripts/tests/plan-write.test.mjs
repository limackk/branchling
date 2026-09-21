/**
 * `plan.yaml` is written by the tool, and the argument in it survives (TL-213).
 *
 * WHAT IS BEING PROVED. Scheduling a task into a wave is ONE act performed by
 * the tool — `new --wave "<name>"` creates and schedules in the same write,
 * `plan add | move | remove` reorders afterwards — and every one of those edits
 * keeps the file's COMMENTS, which are the plan's whole argument. Measured on
 * 2026-09-03: a session created TL-212 and hand-edited `plan.yaml` on the same
 * shell line, the plan edit failed, the commit ran anyway, and the task landed
 * in the backlog scheduled nowhere. Two steps that can end in the middle.
 *
 * THE SPLIT, and why it is the same one `plan-command.test.mjs` draws:
 *
 *   `editPlanText`  — PURE, text in and text out, so comment preservation is
 *                     asserted against literal fixtures rather than through a
 *                     command's output. It is the one place that decides what
 *                     an edit is allowed to destroy.
 *   the COMMANDS    — spawned, because a refusal's exit code, the stream it
 *                     lands on, and the fact that the file on DISK did not move
 *                     are the actual promise. A refusal printed on stdout with
 *                     status 0 is not a refusal, and a refusal that already
 *                     wrote half the change is the defect this task exists for.
 *
 * WHY A NEW MODULE AND NOT `plan.mjs`. That module's header states its subject:
 * ONE parser, plus the validation computed from it. A writer works on the TEXT
 * and never on the parse — rebuilding the file from `parsePlanYaml` would drop
 * every comment, which is exactly the failure the positive control below
 * demonstrates — so it is a different subject and gets a different file:
 * `scripts/plan-write.mjs`, which this test names.
 *
 * WHAT THE TOOL MAY WRITE AND WHAT IT MAY NOT. Membership is mechanical: an id
 * belongs to a wave and waves are ordered. The RATIONALE is a person's, so the
 * tool never composes one — a NEW wave therefore REQUIRES a `--why` written by
 * the caller, refused when empty for the same reason `reason_required_statuses`
 * refuses a status change with no sentence. `--why` means "create a wave" and
 * nothing else; offered for a wave that already exists it is refused, so the
 * flag cannot quietly append the caller's prose to somebody else's paragraph.
 *
 * NOTHING IS WRITTEN TO `backlog/history/` BY A PLAN EDIT. Decided in this task
 * on 2026-09-04 (`backlog/history/TL-213.jsonl`): the log is keyed by a task
 * and holds facts about that task's own life, while scheduling is a fact about
 * the ORDER — a `__planned__` event would force one subject into another's
 * shape. The record of a scheduling change is the git diff of one file plus the
 * `--why` the writer preserves in it. The test below asserts that against a
 * sandbox in which history is demonstrably live, so the silence means something.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isolateHome, SCRIPTS_DIR, plainOutput } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("plan-write");
// Assert against plain text, not against the observer's terminal (TL-238).
plainOutput();

import { parsePlanYaml, validatePlan } from "../plan.mjs";

const CLI = join(SCRIPTS_DIR, "cli.mjs");

/**
 * The module under test, or null when it does not exist yet.
 *
 * A bare top-level import would make the WHOLE file fail to load, and one
 * "cannot find module" says nothing about the eleven separate promises below.
 * Only a MISSING module is tolerated here: a syntax error inside a module that
 * does exist is thrown on, because that is a defect and not an absence.
 */
async function loadWriter() {
  try {
    return await import("../plan-write.mjs");
  } catch (err) {
    if (err && (err.code === "ERR_MODULE_NOT_FOUND" || err.code === "MODULE_NOT_FOUND")) return null;
    throw err;
  }
}

const writer = await loadWriter();

/** Every test in the pure half asks for it by name, so the reason a case failed
 *  is the missing writer and not an incidental `undefined is not a function`. */
function edit(text, spec) {
  assert.ok(
    writer && typeof writer.editPlanText === "function",
    "scripts/plan-write.mjs must export `editPlanText(text, { op, id, wave, why, today })` " +
      "— pure: it returns { text, problems }, never touches the disk, and returns the " +
      "text it was given, unchanged, whenever `problems` is non-empty",
  );
  return writer.editPlanText(text, spec);
}

/**
 * Every comment in the file, in order, as written.
 *
 * From the first `#` to the end of the line, so a comment ABOVE a wave and a
 * comment BESIDE an id are both caught and both compared with their text
 * intact. The fixtures deliberately carry no `#` inside a quoted value, which
 * is the one case this would misread — a writer's job is judged on comments,
 * and a helper that had to parse YAML to find them would be the thing under
 * test twice.
 */
function comments(text) {
  const out = [];
  for (const line of String(text).split("\n")) {
    const i = line.indexOf("#");
    if (i >= 0) out.push(line.slice(i).trimEnd());
  }
  return out;
}

/** The plan, parsed, with the text itself asserted readable first: a case that
 *  measured an unparseable result would be measuring its own fixture. */
function parsed(text, why = "the result does not parse") {
  const { plan, problems } = parsePlanYaml(text);
  assert.deepEqual(problems, [], why + ":\n" + text);
  return plan;
}

const ids = (plan) => plan.waves.map((w) => w.tasks);
const names = (plan) => plan.waves.map((w) => w.name);

// ──────────────────────────────────────────────────────────────────────────
// The fixture: a comment in every position the format allows
// ──────────────────────────────────────────────────────────────────────────

const PLAN = [
  "# The execution ORDER, and the argument for it — the part nothing recomputes.",
  "# A second header line, so this is a block and not one stray sentence.",
  "updated: 2026-09-01",
  "# Between two top-level keys.",
  'rationale: "first the parser, then the consumers that read it"',
  "waves:",
  "  # Above a wave: why this one stands first.",
  '  - name: "Foundation"',
  "    tasks:",
  "      - TL-1   # beside an id: the parser, and nothing else",
  "      - TL-2",
  "    # Below the list, still inside the wave: the paragraph a person wrote and",
  "    # a program could not have.",
  "",
  '  - name: "Consumers"',
  "    tasks: [TL-3, TL-4]",
  "    together: [[TL-3, TL-4]]",
  "    # One act, or it is not a group.",
  "",
  "# At the end of the file, belonging to no wave at all.",
  "",
].join("\n");

test("the fixture itself is a real plan with comments in every position", () => {
  // Half of a positive control: the assertions below compare comment lists, and
  // an empty list compares equal to an empty list without proving anything.
  const plan = parsed(PLAN, "the fixture does not parse");
  assert.deepEqual(names(plan), ["Foundation", "Consumers"]);
  assert.deepEqual(ids(plan), [["TL-1", "TL-2"], ["TL-3", "TL-4"]]);
  assert.deepEqual(plan.waves[1].together, [["TL-3", "TL-4"]]);
  assert.equal(comments(PLAN).length, 9, comments(PLAN).join("\n"));
  // Both list forms appear, because a writer that only handles one of them
  // passes every case written against the other.
  assert.match(PLAN, /^ {6}- TL-1/m);
  assert.match(PLAN, /^ {4}tasks: \[TL-3, TL-4\]$/m);
});

test("POSITIVE CONTROL: rebuilding the file from the parse destroys the argument, and is CAUGHT", () => {
  // The whole file rests on `comments(before) === comments(after)`. This is the
  // proof that the comparison can fail — and, more to the point, that the weaker
  // check somebody would reach for first (does the result still parse? does it
  // hold the same ids?) is passed without trouble by a writer that has
  // deleted every sentence in the file.
  const plan = parsed(PLAN);
  const naive =
    [
      "updated: " + plan.updated,
      'rationale: "' + plan.rationale + '"',
      "waves:",
    ]
      .concat(
        plan.waves.flatMap((w) => [
          '  - name: "' + w.name + '"',
          "    tasks: [" + w.tasks.join(", ") + "]",
        ]),
      )
      .join("\n") + "\n";

  assert.deepEqual(ids(parsed(naive)), ids(plan), "the naive rewrite keeps the membership");
  assert.deepEqual(comments(naive), [], "and loses every comment");
  assert.notDeepEqual(comments(naive), comments(PLAN), "which the comparison used below detects");
});

// ──────────────────────────────────────────────────────────────────────────
// `editPlanText` — the pure writer
// ──────────────────────────────────────────────────────────────────────────

test("add: an id joins a wave written as a BLOCK list, and every comment stays", () => {
  const r = edit(PLAN, { op: "add", id: "TL-5", wave: "Foundation", today: "2026-09-04" });
  assert.deepEqual(r.problems, [], "the edit was refused");
  assert.deepEqual(ids(parsed(r.text)), [["TL-1", "TL-2", "TL-5"], ["TL-3", "TL-4"]]);
  assert.deepEqual(comments(r.text), comments(PLAN));
  // The wave keeps the form it was written in; a writer that normalises the
  // file rewrites lines nobody asked it to touch, and the diff stops being
  // reviewable — which is the whole reason the plan is one file.
  assert.match(r.text, /^ {6}- TL-5$/m);
  assert.match(r.text, /^ {4}tasks: \[TL-3, TL-4\]$/m);
});

test("add: an id joins a wave written as an INLINE list, in that form", () => {
  const r = edit(PLAN, { op: "add", id: "TL-5", wave: "Consumers", today: "2026-09-04" });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(ids(parsed(r.text)), [["TL-1", "TL-2"], ["TL-3", "TL-4", "TL-5"]]);
  assert.deepEqual(comments(r.text), comments(PLAN));
  assert.match(r.text, /^ {4}tasks: \[TL-3, TL-4, TL-5\]$/m);
  assert.match(r.text, /^ {6}- TL-1 {3}# beside an id/m, "the other wave was not rewritten");
});

test("a successful edit moves `updated:` to the day it was made", () => {
  const r = edit(PLAN, { op: "add", id: "TL-5", wave: "Foundation", today: "2026-09-04" });
  assert.equal(parsed(r.text).updated, "2026-09-04");
  assert.equal(parsed(PLAN).updated, "2026-09-01", "and the input was not mutated");
});

test("a plan carrying no `updated:` does not gain one", () => {
  // The key says when a person last revised the order. Inventing it on a file
  // that never had it is the tool asserting something nobody claimed.
  const bare = ["waves:", '  - name: "Only"', "    tasks: [TL-1]", ""].join("\n");
  const r = edit(bare, { op: "add", id: "TL-2", wave: "Only", today: "2026-09-04" });
  assert.deepEqual(r.problems, []);
  assert.equal(parsed(r.text).updated, "");
  assert.ok(!/^updated:/m.test(r.text), r.text);
});

test("move: an id leaves one wave for another, and the comments of both stay", () => {
  const r = edit(PLAN, { op: "move", id: "TL-1", wave: "Consumers", today: "2026-09-04" });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(ids(parsed(r.text)), [["TL-2"], ["TL-3", "TL-4", "TL-1"]]);
  assert.deepEqual(comments(r.text), comments(PLAN));
});

test("remove: an id leaves the plan, and nothing else does", () => {
  const r = edit(PLAN, { op: "remove", id: "TL-2", today: "2026-09-04" });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(ids(parsed(r.text)), [["TL-1"], ["TL-3", "TL-4"]]);
  assert.deepEqual(comments(r.text), comments(PLAN));
});

test("a refused edit returns the file it was given, byte for byte", () => {
  // Refusal has to be total. A writer that returns a half-applied text and a
  // problem beside it hands the caller the 2026-09-03 defect in a new place.
  for (const spec of [
    // A deliberate typo, which is the whole case.
    { op: "add", id: "TL-5", wave: "Fondation" },
    { op: "add", id: "TL-1", wave: "Consumers" },          // already scheduled
    { op: "move", id: "TL-9", wave: "Consumers" },         // not in the plan at all
    { op: "remove", id: "TL-9" },
    { op: "add", id: "TL-5", wave: "Writers", why: "   " },
  ]) {
    const r = edit(PLAN, { ...spec, today: "2026-09-04" });
    assert.ok(r.problems.length, "expected a refusal for " + JSON.stringify(spec));
    assert.equal(r.text, PLAN, "the text was changed by a refused " + spec.op);
  }
});

test("add: an unknown wave is refused and the existing ones are NAMED", () => {
  // A wave created by a typo is worse than no wave: it schedules the task
  // nowhere anybody is reading, and looks like it worked.
  const r = edit(PLAN, { op: "add", id: "TL-5", wave: "Fondation", today: "2026-09-04" });
  const said = r.problems.join("\n");
  assert.match(said, /Fondation/);
  assert.match(said, /Foundation/);
  assert.match(said, /Consumers/);
});

test("add: an id already in the plan is refused, naming the wave that holds it", () => {
  const r = edit(PLAN, { op: "add", id: "TL-3", wave: "Foundation", today: "2026-09-04" });
  assert.ok(r.problems.length);
  assert.match(r.problems.join("\n"), /TL-3/);
  assert.match(r.problems.join("\n"), /Consumers/);
  // The rule is not new: `validatePlan` already calls an id in two waves an
  // error. It is refused BEFORE the write rather than reported afterwards.
});

test("a new wave REQUIRES a `--why`, and the why is written as the caller wrote it", () => {
  const why = "the consumers cannot be measured until the writer exists";
  const r = edit(PLAN, { op: "add", id: "TL-5", wave: "Writers", why, today: "2026-09-04" });
  assert.deepEqual(r.problems, [], "a wave with a why is created");

  const plan = parsed(r.text);
  assert.deepEqual(names(plan), ["Foundation", "Consumers", "Writers"], "appended at the end");
  assert.deepEqual(plan.waves[2].tasks, ["TL-5"]);

  // Every comment that was there is still there, in order, and the caller's
  // sentence is added after them rather than instead of one of them.
  const after = comments(r.text);
  assert.deepEqual(after.slice(0, comments(PLAN).length), comments(PLAN));
  assert.ok(after.length > comments(PLAN).length, "the why was not written at all");
  assert.ok(
    after.slice(comments(PLAN).length).join(" ").includes(why),
    "the why must appear as the caller wrote it, not reworded: " + after.join("\n"),
  );
});

test("a new wave with an empty `--why` is refused, exactly as a status with no reason is", () => {
  for (const why of ["", "   ", undefined]) {
    const r = edit(PLAN, { op: "add", id: "TL-5", wave: "Writers", why, today: "2026-09-04" });
    assert.ok(r.problems.length, "an empty why created a wave: " + JSON.stringify(why));
    assert.equal(r.text, PLAN);
  }
});

test("`why` is for a NEW wave only — offered for one that exists, it is refused", () => {
  // One meaning for one flag. The alternative is a tool that appends the
  // caller's prose to a paragraph somebody else wrote, or silently drops it.
  const r = edit(PLAN, {
    op: "add", id: "TL-5", wave: "Foundation", why: "because it belongs here", today: "2026-09-04",
  });
  assert.ok(r.problems.length);
  assert.match(r.problems.join("\n"), /Foundation/);
  assert.equal(r.text, PLAN);
});

test("an id named by a `together` group cannot be removed or moved out from under it", () => {
  // `validatePlan` calls a group split across waves an error and a group naming
  // an unscheduled id an error. Both can be refused from the text alone, so they
  // are refused here — before the write, not by the guard after it.
  const gone = edit(PLAN, { op: "remove", id: "TL-3", today: "2026-09-04" });
  assert.ok(gone.problems.length, "TL-3 was removed while a group still names it");
  assert.match(gone.problems.join("\n"), /together/);
  assert.equal(gone.text, PLAN);

  const moved = edit(PLAN, { op: "move", id: "TL-3", wave: "Foundation", today: "2026-09-04" });
  assert.ok(moved.problems.length, "half a group was moved into another wave");
  assert.match(moved.problems.join("\n"), /together/);
  assert.equal(moved.text, PLAN);
});

// ──────────────────────────────────────────────────────────────────────────
// The commands — exit codes, streams, and what is on disk afterwards
// ──────────────────────────────────────────────────────────────────────────

function run(args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

function task(dir, id, { blocked_by = [], status = "pending" } = {}) {
  writeFileSync(
    join(dir, "tasks", `${id}-x.md`),
    [
      "---", `id: ${id}`, 'title: "T"', "type: task", "labels: []", "board: main",
      'epic: ""', "priority: P1", `status: ${status}`, "owner: unassigned",
      "estimate: 2h", "created: 2026-08-01", "updated: 2026-08-01",
      `blocked_by: [${blocked_by.join(", ")}]`, "blocks: []", "---", "", "## Goal", "", "x", "",
    ].join("\n"),
    "utf8",
  );
}

function withSandbox(fn, build = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), "branchling-plan-write-"));
  mkdirSync(join(dir, "tasks"));
  writeFileSync(join(dir, "_template.md"), readFileSync(join(SCRIPTS_DIR, "..", "_template.md"), "utf8"), "utf8");
  writeFileSync(join(dir, "config.yaml"), "task_id_prefix: TL\n", "utf8");
  writeFileSync(join(dir, "boards.yaml"), 'default: main\nboards:\n  - slug: main\n    name: "Main"\n', "utf8");
  writeFileSync(join(dir, "plan.yaml"), PLAN, "utf8");
  for (const id of ["TL-1", "TL-2", "TL-3", "TL-4"]) task(dir, id);
  build(dir);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const planOf = (dir) => readFileSync(join(dir, "plan.yaml"), "utf8");
const taskFiles = (dir) => readdirSync(join(dir, "tasks")).sort();
const historyLines = (dir) => {
  const h = join(dir, "history");
  if (!existsSync(h)) return [];
  return readdirSync(h)
    .sort()
    .flatMap((f) => readFileSync(join(h, f), "utf8").split("\n").filter(Boolean).map((l) => f + " " + l));
};

test("`plan add` schedules a task, keeps the argument, and leaves the plan executable", () =>
  withSandbox((dir) => {
    task(dir, "TL-5");
    const before = planOf(dir);
    const r = run(["plan", "add", "TL-5", "--wave", "Consumers", "--dir", dir]);
    assert.equal(r.code, 0, r.out + r.err);

    const after = planOf(dir);
    assert.notEqual(after, before, "nothing was written");
    assert.deepEqual(ids(parsed(after)), [["TL-1", "TL-2"], ["TL-3", "TL-4", "TL-5"]]);
    assert.deepEqual(comments(after), comments(before));
    assert.equal(run(["check", "--plan", "--dir", dir]).code, 0);
  }));

test("`plan move` and `plan remove` change the order and nothing else", () =>
  withSandbox((dir) => {
    const before = planOf(dir);
    assert.equal(run(["plan", "move", "TL-1", "--wave", "Consumers", "--dir", dir]).code, 0);
    assert.deepEqual(ids(parsed(planOf(dir))), [["TL-2"], ["TL-3", "TL-4", "TL-1"]]);

    assert.equal(run(["plan", "remove", "TL-2", "--dir", dir]).code, 0);
    assert.deepEqual(ids(parsed(planOf(dir))), [[], ["TL-3", "TL-4", "TL-1"]]);
    assert.deepEqual(comments(planOf(dir)), comments(before));
  }));

test("an unknown wave is a usage error, the file is untouched, and stdout stays empty", () =>
  withSandbox((dir) => {
    task(dir, "TL-5");
    const before = planOf(dir);
    // Exit 2: a wave name is a value out of this file's vocabulary, which is
    // what `new --priority ZZ` already answers 2 to.
    const r = run(["plan", "add", "TL-5", "--wave", "Consumres", "--dir", dir]);
    assert.equal(r.code, 2, r.out + r.err);
    assert.equal(r.out, "", "a refusal does not belong on stdout");
    assert.match(r.err, /Consumres/);
    assert.match(r.err, /Foundation/);
    assert.match(r.err, /Consumers/);
    assert.equal(planOf(dir), before, "a refused command wrote to the file anyway");
  }));

test("a change the plan guard would reject is refused BEFORE the write", () =>
  withSandbox((dir) => {
    // TL-5 waits on TL-6, and the plan already puts TL-6 in the later wave.
    // Adding TL-5 to the first one is an order nobody can execute, and
    // `validatePlan` says so — so the write never happens.
    task(dir, "TL-5", { blocked_by: ["TL-6"] });
    task(dir, "TL-6");
    writeFileSync(
      join(dir, "plan.yaml"),
      planOf(dir).replace("    tasks: [TL-3, TL-4]", "    tasks: [TL-3, TL-4, TL-6]"),
      "utf8",
    );
    const before = planOf(dir);

    const r = run(["plan", "add", "TL-5", "--wave", "Foundation", "--dir", dir]);
    assert.equal(r.code, 1, r.out + r.err);
    assert.equal(r.out, "");
    assert.match(r.err, /TL-5/);
    assert.match(r.err, /TL-6/);
    assert.equal(planOf(dir), before);

    // The control: the same command against the wave that CAN hold it works, so
    // the refusal above is about the order and not about the command being dead.
    const ok = run(["plan", "add", "TL-5", "--wave", "Consumers", "--dir", dir]);
    assert.equal(ok.code, 0, ok.out + ok.err);
    assert.equal(run(["check", "--plan", "--dir", dir]).code, 0);
  }));

test("an id that is not a task in this backlog is refused, not scheduled", () =>
  withSandbox((dir) => {
    const before = planOf(dir);
    const r = run(["plan", "add", "TL-99", "--wave", "Consumers", "--dir", dir]);
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.err, /TL-99/);
    assert.equal(planOf(dir), before);
  }));

test("`new --wave` is ONE act: the task file and the schedule, or neither", () =>
  withSandbox((dir) => {
    const beforeFiles = taskFiles(dir);
    const beforePlan = planOf(dir);

    const r = run(["new", "--title", "the writer preserves comments", "--wave", "Foundation", "--dir", dir]);
    assert.equal(r.code, 0, r.out + r.err);

    const created = taskFiles(dir).filter((f) => !beforeFiles.includes(f));
    assert.equal(created.length, 1, "expected exactly one new task file: " + created.join(", "));
    const id = created[0].split("-").slice(0, 2).join("-");

    const plan = parsed(planOf(dir));
    assert.deepEqual(plan.waves[0].tasks, ["TL-1", "TL-2", id], "the new task was not scheduled");
    assert.deepEqual(comments(planOf(dir)), comments(beforePlan));
    assert.equal(run(["check", "--plan", "--dir", dir]).code, 0);
  }));

test("`new --wave <typo>` creates NOTHING — not the task, not the wave", () =>
  withSandbox((dir) => {
    // This is the 2026-09-03 half-completion, stated as a test: the wave is
    // checked before a number is reserved, so a refusal leaves a tree that
    // looks exactly like the one before the command was run.
    const beforeFiles = taskFiles(dir);
    const beforePlan = planOf(dir);
    const beforeHistory = historyLines(dir);

    const r = run(["new", "--title", "scheduled nowhere", "--wave", "Foundatoin", "--dir", dir]);
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.err, /Foundatoin/);
    assert.match(r.err, /Foundation/, "the waves that exist are named, so the typo is visible");
    assert.deepEqual(taskFiles(dir), beforeFiles, "a task was created for a wave that does not exist");
    assert.equal(planOf(dir), beforePlan);
    assert.deepEqual(historyLines(dir), beforeHistory);
  }));

test("a plan edit writes no record in backlog/history/, and history is live in this sandbox", () =>
  withSandbox((dir) => {
    task(dir, "TL-5");

    // THE POSITIVE CONTROL, and it has to come first: `new` writes a
    // `__created__` record here, so the silence asserted below is the writer
    // choosing not to log rather than a sandbox in which nothing logs at all.
    assert.deepEqual(historyLines(dir), [], "the sandbox starts with no history");
    assert.equal(run(["new", "--title", "a task that is logged", "--dir", dir]).code, 0);
    const afterNew = historyLines(dir);
    assert.equal(afterNew.length, 1, afterNew.join("\n"));
    assert.match(afterNew[0], /__created__/);

    assert.equal(run(["plan", "add", "TL-5", "--wave", "Consumers", "--dir", dir]).code, 0);
    assert.equal(run(["plan", "move", "TL-5", "--wave", "Foundation", "--dir", dir]).code, 0);
    assert.equal(run(["plan", "remove", "TL-5", "--dir", dir]).code, 0);
    assert.deepEqual(historyLines(dir), afterNew, "a plan edit wrote to the task-keyed log");
  }));

test("the READING form of `plan` still answers, and an unknown subcommand still fails", () =>
  withSandbox((dir) => {
    const report = run(["plan", "--dir", dir]);
    assert.equal(report.code, 0, report.out + report.err);
    assert.match(report.out, /Foundation/);

    // An unknown word after `plan` FAILS — a silent no-op looks like it worked.
    const stray = run(["plan", "schedule", "TL-1", "--dir", dir]);
    assert.equal(stray.code, 2, stray.out + stray.err);
    assert.match(stray.err, /schedule/);
  }));

test("the plan guard agrees with the writer about what it just wrote", () =>
  withSandbox((dir) => {
    // The two halves of TL-213 meeting: whatever `plan add` writes, the
    // validation that already existed has to accept without a second opinion.
    task(dir, "TL-5");
    assert.equal(run(["plan", "add", "TL-5", "--wave", "Consumers", "--dir", dir]).code, 0);

    const plan = parsed(planOf(dir));
    const tasks = ["TL-1", "TL-2", "TL-3", "TL-4", "TL-5"].map((id) => ({
      id, status: "pending", blocked_by: [],
    }));
    const verdict = validatePlan(plan, tasks, { archivedStatuses: ["done", "cancelled"] });
    assert.deepEqual(verdict.errors, []);
    assert.equal(verdict.planned, 5);
  }));

// ── a value that begins with a dash, after `--` (TL-248) ──────────────────
//
// The same defect TL-58 removed from `new`, in the one parser that still
// carried the line. `--why` takes a SENTENCE, and this project's sentences are
// about flags, so a reason that opens with a dash was simply unwritable.
// MEASURED ON 2026-09-21, before a line of the parser changed:
//   $ branchling plan add TL-2 --wave "Flags" --why -- "--json is not free"
//   branchling plan add: --why requires a value
//
// `--dir` is passed BEFORE the separator throughout: `takeDirFlag()` strips it
// from anywhere on the line, separator or not, which is TL-247's subject and
// not this one.

/** The wave of that name, or undefined — asserted on rather than an index, so a
 *  case that appended in the wrong place says so instead of reading a neighbour. */
const waveNamed = (text, name) => parsed(text).waves.find((w) => w.name === name);

test("`plan add`: after the separator a `--why` value beginning with a dash is written as typed", () =>
  withSandbox((dir) => {
    task(dir, "TL-5");
    task(dir, "TL-6");

    // THE POSITIVE CONTROL, and it runs first: an ordinary sentence creates a
    // wave in this fixture. Without it every assertion below could fail because
    // `plan add` writes nothing here at all, which has nothing to do with a dash.
    const ordinary = run(["plan", "add", "TL-6", "--dir", dir, "--wave", "Control", "--why", "an ordinary sentence"]);
    assert.equal(ordinary.code, 0, ordinary.out + ordinary.err);
    assert.deepEqual(waveNamed(planOf(dir), "Control")?.tasks, ["TL-6"],
      "`plan add` creates no wave in this fixture — the measurement is broken, not the parser");

    const why = "--json is not free, and the wave says why";
    const r = run(["plan", "add", "TL-5", "--dir", dir, "--wave", "Flags", "--why", "--", why]);
    assert.equal(r.code, 0, "a why after the separator was refused: " + r.err);

    const after = planOf(dir);
    assert.deepEqual(waveNamed(after, "Flags")?.tasks, ["TL-5"], "the wave was not created");
    assert.ok(comments(after).some((c) => c.includes(why)),
      "the sentence is not in the file as it was typed: " + comments(after).join("\n"));
    assert.equal(run(["check", "--plan", "--dir", dir]).code, 0, "the plan the writer produced does not pass the guard");
  }));

test("`plan add`: after the separator even a KNOWN flag is the value, and sets no other field", () =>
  withSandbox((dir) => {
    // The half that makes the separator worth having: after `--` NOTHING is
    // read as a flag. A parser that merely tolerated a leading dash would write
    // the reason AND take the word after it as a wave name.
    task(dir, "TL-5");
    const r = run(["plan", "add", "TL-5", "--dir", dir, "--wave", "Flags", "--why", "--", "--wave"]);
    assert.equal(r.code, 0, "a why that is itself a flag name was refused: " + r.err);

    const after = planOf(dir);
    assert.deepEqual(waveNamed(after, "Flags")?.tasks, ["TL-5"],
      "the word past the separator was consumed as a flag as well as a value");
    assert.ok(comments(after).some((c) => c.includes("--wave")),
      "the reason was dropped: " + comments(after).join("\n"));
  }));

test("`plan add`: WITHOUT the separator, `--why --wave` still fails and writes nothing", () =>
  withSandbox((dir) => {
    // The protection this task must not remove, and it is green today. A flag
    // name where a value belongs is overwhelmingly a mistake, and a wave
    // introduced by the paragraph "--wave" is the silent no-op it guards.
    task(dir, "TL-5");
    const before = planOf(dir);
    const r = run(["plan", "add", "TL-5", "--dir", dir, "--why", "--wave", "Flags"]);
    assert.equal(r.code, 2, "the un-separated form was accepted");
    assert.equal(r.out, "", "a refusal does not belong on stdout");
    assert.match(r.err, /--why/);
    assert.equal(planOf(dir), before, "a refused command wrote to the file anyway");
  }));

test("`plan add`: `--why --` with nothing after the separator fails", () =>
  withSandbox((dir) => {
    // The separator is not itself a value.
    task(dir, "TL-5");
    const before = planOf(dir);
    const r = run(["plan", "add", "TL-5", "--dir", dir, "--wave", "Flags", "--why", "--"]);
    assert.equal(r.code, 2, "`--` was stored as the reason");
    assert.equal(planOf(dir), before);
  }));

test("`plan add`: an argument past the separator's value is refused by name, not collected as an id", () =>
  withSandbox((dir) => {
    // DECIDED HERE, because `parseEditArgs` collects positional ids and `new`
    // does not: the separator stops FLAG reading, it does not open a second
    // place to name a task. A leftover is refused BY NAME — swallowed as an id
    // it would turn into "one task id, and this names 2", a message about the
    // wrong mistake.
    task(dir, "TL-5");
    task(dir, "TL-6");
    const before = planOf(dir);
    const r = run(["plan", "add", "TL-5", "--dir", dir, "--wave", "Flags", "--why", "--", "a reason", "TL-6"]);
    assert.equal(r.code, 2, "the argument past the value was swallowed in silence");
    assert.match(r.err, /TL-6/, "the message does not name the argument that was refused");
    assert.equal(planOf(dir), before, "a refused command wrote to the file anyway");
  }));
