/**
 * `next --plan` says a wave waits on claims or a merge, not that nothing is
 * left (TL-683).
 *
 * WHAT WAS MEASURED. In the supervised-loop runs of 2026-11-05 to 2026-11-09,
 * `next --plan` answered `nothing-to-take` (exit 3) more than forty times while
 * the active wave still had work: its last open task was claimed in another
 * worktree, or closed on a branch nobody had merged yet. The sentence said so;
 * the refusal kind was the one an exhausted backlog gets, so a supervisor could
 * not tell "retry after the merge" from "stop".
 *
 * WHAT EACH CASE PROVES:
 *
 *   claimed on a branch   — the wave's only open task is in progress on another
 *                           branch: `wave-claimed-elsewhere`, the id named.
 *   closed on a branch    — it is done on another branch: `wave-awaits-merge`.
 *   claimed here          — in progress in THIS tree: claimed as well.
 *   behind a claim        — a task blocked only by the claimed one waits with it.
 *   the controls          — a finished plan, and a wave whose open task is held
 *                           back for a reason waiting will not cure, both stay
 *                           `nothing-to-take`; a free task is still handed out.
 *                           Without them every assertion above would be green
 *                           against a `next` that calls every refusal waiting.
 *   --spill               — draws from the next wave while the active one is
 *                           waiting, never past a blocker or a conflict group
 *                           that is in progress, and is refused without --plan.
 *
 * Every fixture puts the other branch's status there by committing the file,
 * never by `take`: a reservation would refuse on its own and the scan would
 * not be what the test proves (the rule of next-cross-branch.test.mjs).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fixtureDir } from "./_fixture-dir.mjs";
import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";
import { acquireLock } from "../lock.mjs";
import { waveWaiting } from "../next-task.mjs";
import { spillWave } from "../plan.mjs";

isolateHome("next-plan-waiting");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
let counter = 0;

function cli(args, env) {
  const r = spawnSync(process.execPath, [CLI].concat(args), { encoding: "utf8", timeout: 60_000, env });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

function vcs(cwd, args) {
  return execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false"].concat(args),
    { cwd, encoding: "utf8" }
  );
}

function commit(cwd, message) {
  vcs(cwd, ["add", "-A"]);
  vcs(cwd, ["commit", "-qm", message]);
}

function taskPath(backlog, id) {
  const file = readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-"));
  assert.ok(file, "no file for " + id);
  return join(backlog, "tasks", file);
}

function setField(backlog, id, field, value) {
  const path = taskPath(backlog, id);
  const text = readFileSync(path, "utf8");
  const next = text.replace(new RegExp("^" + field + ":.*$", "m"), field + ": " + value);
  assert.notEqual(next, text, "the fixture has no `" + field + ":` line to set");
  writeFileSync(path, next, "utf8");
}

/**
 * A repository on `main` with tasks a, b, c, d and a plan of two waves:
 * wave 1 [a, b], wave 2 [c, d]. `b` starts closed, so wave 1's only open task is
 * `a` unless a case reopens `b`. `setup(f)` edits the tree before the seed
 * commit; `feature(f)` edits it on the `feature` branch, which is committed and
 * left, so the checkout is `main` again. `third` adds task e in a third wave;
 * `first` names the keys of wave 1 instead, and wave 2 holds the rest.
 */
function tree({ setup, feature, third, first = ["a", "b"] } = {}) {
  const dir = fixtureDir(join(tmpdir(), "branchling-plan-waiting-" + counter++ + "-"));
  const repoRoot = join(dir, "repo");
  mkdirSync(repoRoot, { recursive: true });
  const backlog = join(repoRoot, "backlog");
  const env = { ...process.env, BACKLOG_STATE_DIR: join(dir, "state"), NO_COLOR: "1" };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env).code, 0);
  const ids = {};
  for (const key of third ? ["a", "b", "c", "d", "e"] : ["a", "b", "c", "d"]) {
    const r = cli(["new", "--dir", backlog, "--title", "Fixture task " + key], env);
    assert.equal(r.code, 0, r.err);
    ids[key] = (r.out.match(/([A-Z]+-\d+)/) || [])[1];
    assert.ok(ids[key], "the fixture task got no id: " + r.out);
  }
  writeFileSync(join(backlog, "plan.yaml"), [
    "updated: 2026-11-11", 'rationale: "fixture"', "waves:",
    '  - name: "First"', "    tasks: [" + first.map((k) => ids[k]).join(", ") + "]",
    '  - name: "Second"', "    tasks: [" + ["a", "b", "c", "d"].filter((k) => !first.includes(k)).map((k) => ids[k]).join(", ") + "]",
  ].concat(third ? ['  - name: "Third"', "    tasks: [" + ids.e + "]"] : [], [""]).join("\n"), "utf8");
  const f = { dir, repoRoot, backlog, env, ids };
  setField(backlog, ids.b, "status", "done");
  if (setup) setup(f);
  vcs(repoRoot, ["init", "-q", "-b", "main"]);
  commit(repoRoot, "seed");
  if (feature) {
    vcs(repoRoot, ["checkout", "-q", "-b", "feature"]);
    feature(f);
    commit(repoRoot, "feature work");
    vcs(repoRoot, ["checkout", "-q", "main"]);
  }
  return f;
}

function next(f, extra = []) {
  const r = cli(["next", "--dir", f.backlog, "--actor", "agent:test", "--plan", "--json"].concat(extra), f.env);
  let out = null;
  try { out = JSON.parse(r.out); } catch { /* asserted by the caller */ }
  return { ...r, json: out };
}

// ── The two waiting kinds ──────────────────────────────────────────────────

test("the wave's last task in progress on another branch is a wave waiting on a claim", () => {
  const f = tree({ feature: (t) => setField(t.backlog, t.ids.a, "status", "in_progress") });
  const r = next(f);
  assert.equal(r.code, 3, r.err);
  assert.equal(r.json.refusalKind, "wave-claimed-elsewhere");
  assert.deepEqual(r.json.plan.claimedElsewhere, [f.ids.a]);
  assert.deepEqual(r.json.plan.awaitingMerge, []);
  assert.equal(r.json.plan.wave, 1);
  assert.equal(r.json.ok, false);
  assert.equal(r.json.taken, false);
  assert.equal(r.json.refusal, "nothing to take now — plan wave 1 is waiting on claims held in another tree or session");
  assert.deepEqual(r.json.details.slice(0, 2), [
    "claimed in another tree or session: " + f.ids.a,
    "ask again when those claims are closed and merged — `--spill` draws from the next wave meanwhile",
  ]);

  const human = cli(["next", "--dir", f.backlog, "--actor", "agent:test", "--plan"], f.env);
  assert.equal(human.code, 3);
  assert.match(human.out, /^\S+ nothing to take now — plan wave 1 is waiting on claims/m);
  assert.match(human.out, new RegExp("claimed in another tree or session: " + f.ids.a));
  assert.match(human.out, /--spill/);
});

test("the wave's last task closed on an unmerged branch is a wave waiting on a merge", () => {
  const f = tree({ feature: (t) => setField(t.backlog, t.ids.a, "status", "done") });
  const r = next(f);
  assert.equal(r.code, 3, r.err);
  assert.equal(r.json.refusalKind, "wave-awaits-merge");
  assert.deepEqual(r.json.plan.awaitingMerge, [f.ids.a]);
  assert.deepEqual(r.json.plan.claimedElsewhere, []);
  assert.equal(r.json.refusal, "nothing to take now — plan wave 1 is waiting on a merge");
  assert.deepEqual(r.json.details.slice(0, 2), [
    "closed on a branch not merged here: " + f.ids.a,
    "ask again after the merge",
  ]);
});

test("a claim in this tree and a merge elsewhere: the claim decides the kind", () => {
  const f = tree({
    setup: (t) => {
      setField(t.backlog, t.ids.b, "status", "pending");
      setField(t.backlog, t.ids.a, "status", "in_progress");
      setField(t.backlog, t.ids.a, "owner", "agent:other");
    },
    feature: (t) => setField(t.backlog, t.ids.b, "status", "done"),
  });
  const r = next(f);
  assert.equal(r.code, 3, r.err);
  assert.equal(r.json.refusalKind, "wave-claimed-elsewhere");
  assert.deepEqual(r.json.plan.claimedElsewhere, [f.ids.a]);
  assert.deepEqual(r.json.plan.awaitingMerge, [f.ids.b]);
  assert.deepEqual(r.json.details.slice(0, 2), [
    "claimed in another tree or session: " + f.ids.a,
    "closed on a branch not merged here: " + f.ids.b,
  ]);
});

test("a task blocked only by the claimed one waits with it", () => {
  const f = tree({
    setup: (t) => {
      setField(t.backlog, t.ids.b, "status", "pending");
      setField(t.backlog, t.ids.b, "blocked_by", "[" + t.ids.a + "]");
    },
    feature: (t) => setField(t.backlog, t.ids.a, "status", "in_progress"),
  });
  const r = next(f);
  assert.equal(r.code, 3, r.err);
  assert.equal(r.json.refusalKind, "wave-claimed-elsewhere");
  assert.deepEqual(r.json.plan.waitingBehind, [f.ids.b]);
  assert.deepEqual(r.json.details.slice(0, 2), [
    "claimed in another tree or session: " + f.ids.a,
    "blocked only by those: " + f.ids.b,
  ]);
});

test("every id of each kind is named, not only the first", () => {
  const f = tree({
    first: ["a", "b", "c", "d"].slice(0, 3),
    setup: (t) => {
      setField(t.backlog, t.ids.b, "status", "pending");
      setField(t.backlog, t.ids.b, "blocked_by", "[" + t.ids.a + "]");
      setField(t.backlog, t.ids.c, "blocked_by", "[" + t.ids.a + "]");
    },
    feature: (t) => setField(t.backlog, t.ids.a, "status", "in_progress"),
  });
  const r = next(f);
  assert.equal(r.code, 3, r.err);
  assert.equal(r.json.details[1], "blocked only by those: " + f.ids.b + ", " + f.ids.c);

  const g = tree({ feature: (t) => {
    setField(t.backlog, t.ids.a, "status", "in_progress");
    setField(t.backlog, t.ids.b, "status", "in_progress");
  }, setup: (t) => setField(t.backlog, t.ids.b, "status", "pending") });
  assert.equal(next(g).json.details[0], "claimed in another tree or session: " + g.ids.a + ", " + g.ids.b);

  const h = tree({ feature: (t) => {
    setField(t.backlog, t.ids.a, "status", "done");
    setField(t.backlog, t.ids.b, "status", "done");
  }, setup: (t) => setField(t.backlog, t.ids.b, "status", "pending") });
  assert.equal(next(h).json.details[0], "closed on a branch not merged here: " + h.ids.a + ", " + h.ids.b);
});

test("a reservation another session holds on the wave's last task is a claim", () => {
  // No other branch says anything: the only evidence is the reservation, which
  // `next` meets as a candidate it passes over.
  const f = tree();
  const held = acquireLock({ root: f.backlog, taskId: f.ids.a, actor: "agent:other", env: f.env });
  assert.equal(held.ok, true, "the fixture reservation was not taken");
  const r = next(f);
  assert.equal(r.code, 3, r.err);
  assert.equal(r.json.passedOver.length, 1, "the reservation was not met: " + r.out);
  assert.equal(r.json.refusalKind, "wave-claimed-elsewhere");
  assert.deepEqual(r.json.plan.claimedElsewhere, [f.ids.a]);
});

// ── The controls ───────────────────────────────────────────────────────────

test("control: a finished plan is still nothing to take", () => {
  const f = tree({
    setup: (t) => {
      for (const k of ["a", "c", "d"]) setField(t.backlog, t.ids[k], "status", "done");
    },
  });
  const r = next(f);
  assert.equal(r.code, 3, r.err);
  assert.equal(r.json.refusalKind, "nothing-to-take");
  assert.equal(r.json.refusal, "nothing to take");
});

test("control: a wave held back by something waiting cannot cure stays nothing to take", () => {
  // `b` is protected (`blocked` with no `blocked_by`): no merge or released
  // claim will ever hand it out, so the wave is not waiting on other trees.
  const f = tree({
    setup: (t) => setField(t.backlog, t.ids.b, "status", "blocked"),
    feature: (t) => setField(t.backlog, t.ids.a, "status", "in_progress"),
  });
  const r = next(f);
  assert.equal(r.code, 3, r.err);
  assert.equal(r.json.refusalKind, "nothing-to-take");
});

test("control: a free task in the wave is still handed out", () => {
  const f = tree();
  const r = next(f);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.id, f.ids.a);
  assert.equal(r.json.taken, true);
});

// ── --spill ────────────────────────────────────────────────────────────────

test("--spill hands out the next wave's work while the active wave is claimed", () => {
  const f = tree({ feature: (t) => setField(t.backlog, t.ids.a, "status", "in_progress") });
  const r = next(f, ["--spill", "--dry-run"]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.id, f.ids.c);
  assert.deepEqual(r.json.plan.spill, {
    from: 1, fromName: "First", refusalKind: "wave-claimed-elsewhere",
    claimedElsewhere: [f.ids.a], awaitingMerge: [], wave: 2, name: "Second",
  });
  assert.equal(r.json.plan.wave, 2);

  const human = cli(["next", "--dir", f.backlog, "--actor", "agent:test", "--plan", "--spill", "--dry-run"], f.env);
  assert.equal(human.code, 0, human.err);
  assert.match(human.out, /plan wave 1 \(First\) is waiting on claims .* spilled into wave 2/);
});

test("--spill skips a later wave that is already closed", () => {
  const f = tree({
    third: true,
    setup: (t) => {
      setField(t.backlog, t.ids.c, "status", "done");
      setField(t.backlog, t.ids.d, "status", "done");
    },
    feature: (t) => setField(t.backlog, t.ids.a, "status", "in_progress"),
  });
  const r = next(f, ["--spill", "--dry-run"]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.id, f.ids.e);
  assert.equal(r.json.plan.spill.wave, 3);
  assert.equal(r.json.plan.spill.name, "Third");
});

test("--spill with no later open wave still answers the waiting kind", () => {
  const f = tree({
    setup: (t) => {
      setField(t.backlog, t.ids.c, "status", "done");
      setField(t.backlog, t.ids.d, "status", "done");
    },
    feature: (t) => setField(t.backlog, t.ids.a, "status", "in_progress"),
  });
  const r = next(f, ["--spill"]);
  assert.equal(r.code, 3, r.err);
  assert.equal(r.json.refusalKind, "wave-claimed-elsewhere");
  assert.deepEqual(r.json.plan.spill, {
    from: 1, fromName: "First", refusalKind: "wave-claimed-elsewhere",
    claimedElsewhere: [f.ids.a], awaitingMerge: [], wave: null, name: "",
  });
  // Under --spill the hint to use it is not repeated.
  assert.equal(r.json.details[1], "ask again when those claims are closed and merged");
  const human = cli(["next", "--dir", f.backlog, "--actor", "agent:test", "--plan", "--spill"], f.env);
  assert.equal(human.code, 3);
  assert.doesNotMatch(human.out, /spilled/);
});

test("--spill does not look past a wave held for a reason waiting will not cure", () => {
  const f = tree({
    setup: (t) => setField(t.backlog, t.ids.a, "status", "blocked"),
  });
  const r = next(f, ["--spill"]);
  assert.equal(r.code, 3, r.err);
  assert.equal(r.json.refusalKind, "nothing-to-take");
  assert.equal(r.json.plan.spill, null);
  assert.equal(r.json.plan.wave, 1);
});

test("--spill passes over a next-wave task blocked by the waiting wave or sharing its conflict group", () => {
  const f = tree({
    setup: (t) => {
      setField(t.backlog, t.ids.c, "blocked_by", "[" + t.ids.a + "]");
      setField(t.backlog, t.ids.a, "conflict_group", "[core]");
      setField(t.backlog, t.ids.d, "conflict_group", "[core]");
    },
    feature: (t) => setField(t.backlog, t.ids.a, "status", "in_progress"),
  });
  const r = next(f, ["--spill"]);
  assert.equal(r.code, 3, r.err);
  // The ACTIVE wave is still the one being waited for.
  assert.equal(r.json.refusalKind, "wave-claimed-elsewhere");
  assert.equal(r.json.plan.spill.wave, 2);
  assert.deepEqual(r.json.skippedConflict.map((s) => s.id), [f.ids.d]);
});

test("--spill does nothing to a wave that is not waiting", () => {
  const f = tree();
  const r = next(f, ["--spill", "--dry-run"]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.id, f.ids.a);
  assert.equal(r.json.plan.spill, null);
  const human = cli(["next", "--dir", f.backlog, "--actor", "agent:test", "--plan", "--spill", "--dry-run"], f.env);
  assert.equal(human.code, 0, human.err);
  assert.doesNotMatch(human.out, /spilled/);
});

test("--spill without --plan is a usage error", () => {
  const f = tree();
  const r = cli(["next", "--dir", f.backlog, "--actor", "agent:test", "--spill"], f.env);
  assert.equal(r.code, 2);
  assert.match(r.err, /`--spill` with no `--plan`/);
  assert.match(r.err, /It lets `--plan` draw from the next wave while the active one waits on other/);
  assert.match(r.err, /trees; on its own there is no wave to spill out of\./);
});

// ── The pure judgement ─────────────────────────────────────────────────────

const CONFIG = { archivedStatuses: ["done", "cancelled"], inProgressStatus: "in_progress" };
const NONE = { kind: null, claimed: [], awaitingMerge: [], behind: [] };

test("waveWaiting: a reservation held during the call counts as a claim", () => {
  // `X-1` carries no `elsewhere` at all: a record read without the scan.
  const records = [{ id: "X-1", status: "pending" }, { id: "X-2", status: "done" }];
  assert.deepEqual(waveWaiting(["X-1", "X-2"], records, CONFIG, []), NONE);
  assert.deepEqual(waveWaiting(["x-1", "X-2"], records, CONFIG, ["x-1"]), {
    kind: "wave-claimed-elsewhere", claimed: ["X-1"], awaitingMerge: [], behind: [],
  });
  assert.deepEqual(waveWaiting([], records, CONFIG, []), NONE);
  assert.deepEqual(waveWaiting(["X-2", "X-9"], records, CONFIG, []), NONE, "closed and unknown ids wait on nothing");
});

test("waveWaiting: a chain behind a claim waits, in any order; a second, free blocker does not", () => {
  const claim = { id: "X-1", status: "in_progress" };
  // Listed before the task it waits on, so one pass cannot settle it.
  const last = { id: "X-3", status: "pending", blocked_by: ["x-2"] };
  const middle = { id: "X-2", status: "pending", blocked_by: ["x-1"] };
  assert.deepEqual(waveWaiting(["X-3", "X-2", "X-1"], [last, middle, claim], CONFIG, []), {
    kind: "wave-claimed-elsewhere", claimed: ["X-1"], awaitingMerge: [], behind: ["X-2", "X-3"],
  });
  const free = { id: "X-4", status: "pending" };
  const both = { id: "X-5", status: "pending", blocked_by: ["X-1", "X-4"] };
  assert.deepEqual(waveWaiting(["X-1", "X-5"], [claim, free, both], CONFIG, []), NONE);
});

test("spillWave: the first LATER wave with open work, or null", () => {
  const plan = { waves: [
    { name: "One", tasks: ["X-1"], together: [] },
    { name: "Two", tasks: ["X-2"], together: [] },
    { name: "Three", tasks: ["X-3"], together: [] },
  ] };
  const tasks = (statuses) => statuses.map((status, i) => ({ id: "X-" + (i + 1), status, blocked_by: [] }));
  assert.deepEqual(spillWave(plan, tasks(["pending", "done", "pending"]), CONFIG),
    { index: 2, name: "Three", ids: ["X-3"], open: 1 });
  assert.equal(spillWave(plan, tasks(["pending", "done", "done"]), CONFIG), null);
  assert.equal(spillWave(plan, tasks(["done", "done", "done"]), CONFIG), null);
});
