/**
 * `worktrail init` i `worktrail stats` (BL-1412).
 *
 * Two commands with opposite risks, so the assertions are opposite too:
 *
 *   init  — it WRITES into somebody else's directory. The most dangerous defect is
 *           overwriting an existing backlog, so there are more tests here for "it
 *           did not touch it" than for "it created it".
 *   stats — it COUNTS. The most dangerous defect is a number that looks right and
 *           is untrue, so every sum has a test with a hand-computed expectation,
 *           and an unparseable estimate MUST be visible instead of quietly falling
 *           into a zero.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { estimateHours, hoursLabel, sumHours } from "../estimate.mjs";
import { summarize } from "../stats.mjs";
import { DEFAULT_TASK_ID_PREFIX as P } from "../task-id.mjs";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");

function run(args) {
  return spawnSync(process.execPath, [CLI].concat(args), { encoding: "utf8", timeout: 30_000 });
}

function emptyDir() {
  return mkdtempSync(join(tmpdir(), "worktrail-init-"));
}

function task(over) {
  return Object.assign(
    { id: "BL-1", status: "pending", priority: "P1", type: "code", board: "main",
      epic: "", labels: ["pre-launch"], estimate: "2h", blocked_by: [] },
    over || {}
  );
}

// ── Estymaty (pure) ───────────────────────────────────────────────────────

test("estimate: the units convert to hours", () => {
  assert.equal(estimateHours("30m"), 0.5);
  assert.equal(estimateHours("2h"), 2);
  assert.equal(estimateHours("1d"), 8);
  assert.equal(estimateHours("1w"), 40);
  assert.equal(estimateHours("1mo"), 160);
  assert.equal(estimateHours("0,5d"), 4, "a decimal comma, as some locales write it");
});

test("estimate: an unparseable one gives null, NEVER zero", () => {
  // Zero would shrink the queue silently — a typo would look like work that is
  // not there.
  for (const bad of ["", null, undefined, "a few days", "2 hours", "2hh", "h"]) {
    assert.equal(estimateHours(bad), null, JSON.stringify(bad) + " must not produce a number");
  }
});

test("estimate: the sum REPORTS how many tasks it could not count", () => {
  const r = sumHours([task({ estimate: "2h" }), task({ estimate: "1d" }), task({ estimate: "someday" })]);
  assert.equal(r.hours, 10);
  assert.equal(r.unknown, 1, "without that number the sum pretends to be complete");
});

test("estimate: the label converts to working days only above one day", () => {
  assert.match(hoursLabel(4), /^4 h$/);
  assert.match(hoursLabel(40), /working days/);
});

// ── Podsumowanie (pure) ───────────────────────────────────────────────────

const CFG = {
  statuses: ["pending", "in_progress", "blocked", "done"],
  archivedStatuses: ["done"],
  priorities: ["P0", "P1", "P2"],
};

test("stats: it splits active from archived BY THE CONFIGURATION, not by name", () => {
  const s = summarize([task({ status: "pending" }), task({ status: "done" }), task({ status: "blocked" })], CFG);
  assert.equal(s.total, 3);
  assert.equal(s.active, 2);
  assert.equal(s.archived, 1);
});

test("stats: the status and priority counts match a hand computation", () => {
  const s = summarize(
    [task({ status: "pending", priority: "P0" }), task({ status: "pending", priority: "P1" }),
      task({ status: "blocked", priority: "P0" }), task({ status: "done", priority: "P2" })],
    CFG
  );
  assert.equal(s.byStatus.pending, 2);
  assert.equal(s.byStatus.blocked, 1);
  assert.equal(s.byPriority.P0, 2, "priorities counted over the ACTIVE ones — archived work says nothing about the queue");
  assert.equal(s.byPriority.P2, undefined, "a done task must not be in the queue");
});

test("stats: a status from the configuration that nobody used gets a zero — it does not vanish", () => {
  // A missing row reads as "I did not check", a zero as "I did".
  const s = summarize([task({ status: "pending" })], CFG);
  assert.equal(s.byStatus.in_progress, 0);
});

test("stats: hours counted ONLY from active tasks", () => {
  const s = summarize([task({ status: "pending", estimate: "1d" }), task({ status: "done", estimate: "1w" })], CFG);
  assert.equal(s.openHours.hours, 8, "closed work is not work to be done");
});

test("stats: blockers are active tasks with a non-empty blocked_by", () => {
  const s = summarize(
    [task({ status: "blocked", blocked_by: ["BL-9"] }), task({ status: "pending", blocked_by: [] }),
      task({ status: "done", blocked_by: ["BL-9"] })],
    CFG
  );
  assert.equal(s.blocked, 1);
});

test("stats: an empty backlog does not blow up and says zero", () => {
  const s = summarize([], CFG);
  assert.equal(s.total, 0);
  assert.equal(s.active, 0);
  assert.equal(s.openHours.hours, 0);
});

// ── init ──────────────────────────────────────────────────────────────────

test("init creates a complete, WORKING backlog", () => {
  const dir = emptyDir();
  try {
    const r = run(["init", "--dir", dir]);
    assert.equal(r.status, 0, r.stderr);
    for (const f of ["config.yaml", "boards.yaml", "_template.md", ".gitignore", ".gitattributes"]) {
      assert.ok(existsSync(join(dir, f)), "missing " + f);
    }
    assert.ok(existsSync(join(dir, "tasks")), "no tasks/ directory");
    // Proof that these are not just files: the other commands have to work on them.
    assert.equal(run(["build", "--dir", dir]).status, 0, "build did not pass on a fresh backlog");
    assert.equal(run(["check", "--dir", dir]).status, 0, "the guards did not pass on a fresh backlog");
    assert.equal(run(["stats", "--dir", dir]).status, 0, "stats did not pass on a fresh backlog");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("init does NOT overwrite an existing file — and says what it left alone", () => {
  const dir = emptyDir();
  try {
    writeFileSync(join(dir, "config.yaml"), "project_name: \"Moje\"\n", "utf8");
    const r = run(["init", "--dir", dir]);
    assert.equal(r.status, 0, "an existing file is not an error, it is a reason to leave it alone");
    assert.equal(readFileSync(join(dir, "config.yaml"), "utf8"), "project_name: \"Moje\"\n",
      "init overwrote somebody else's configuration");
    assert.match(r.stdout + r.stderr, /config\.yaml/, "silence about a skipped file reads like a write");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("init does NOT touch existing tasks", () => {
  const dir = emptyDir();
  try {
    mkdirSync(join(dir, "tasks"));
    writeFileSync(join(dir, "tasks", `${P}-1-mine.md`), `---\nid: ${P}-1\n---\n`, "utf8");
    assert.equal(run(["init", "--dir", dir]).status, 0);
    assert.ok(existsSync(join(dir, "tasks", `${P}-1-mine.md`)), "init deleted an existing task");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("init twice in a row is a no-op, not a doubling", () => {
  const dir = emptyDir();
  try {
    run(["init", "--dir", dir]);
    const before = readFileSync(join(dir, "config.yaml"), "utf8");
    const second = run(["init", "--dir", dir]);
    assert.equal(second.status, 0);
    assert.equal(readFileSync(join(dir, "config.yaml"), "utf8"), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("init WITHOUT --dir does not guess the directory — writing to the wrong place is irreversible", () => {
  const dir = emptyDir();
  const r = spawnSync(process.execPath, [CLI, "init"], { encoding: "utf8", cwd: dir, timeout: 30_000 });
  try {
    assert.notEqual(r.status, 0, "init started with no target named");
    assert.match(r.stdout + r.stderr, /--dir/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the configuration from init is GENERIC — no project's vocabulary", () => {
  const dir = emptyDir();
  try {
    run(["init", "--dir", dir]);
    const text = readFileSync(join(dir, "config.yaml"), "utf8") + readFileSync(join(dir, "boards.yaml"), "utf8");
    for (const word of ["the origin project", "origin", "pre-launch", "backlog-project", "founder", "data-gated"]) {
      assert.ok(!text.includes(word), "the template carries this repo's vocabulary: " + word);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── stats (prawdziwe uruchomienie) ────────────────────────────────────────

test("stats counts real tasks and gives a sum of hours", () => {
  const dir = emptyDir();
  try {
    // `--no-example` (TL-64): this test has a hand-computed expectation, so a
    // third task from the template would change the result while checking nothing.
    run(["init", "--dir", dir, "--no-example"]);
    writeFileSync(join(dir, "tasks", `${P}-1-a.md`),
      `---\nid: ${P}-1\ntitle: "A"\nstatus: pending\npriority: P0\nboard: main\nestimate: 1d\n---\n\n## Cel\n\nx\n`, "utf8");
    writeFileSync(join(dir, "tasks", `${P}-2-b.md`),
      `---\nid: ${P}-2\ntitle: "B"\nstatus: done\npriority: P1\nboard: main\nestimate: 1w\n---\n\n## Cel\n\nx\n`, "utf8");
    const r = run(["stats", "--dir", dir]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\b2\b/, "the sum of tasks is not visible");
    assert.match(r.stdout, /8 h/, "hours counted from active tasks: 1d = 8 h, `done` does not count");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stats --json gives machine output, not a table", () => {
  const dir = emptyDir();
  try {
    run(["init", "--dir", dir, "--no-example"]);
    const r = run(["stats", "--dir", dir, "--json"]);
    assert.equal(r.status, 0, r.stderr);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.kind, "stats", "the answer is not in the shared envelope (TL-72)");
    assert.equal(parsed.stats.total, 0);
    assert.ok(parsed.stats.byStatus, "no breakdown by status");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stats: an unknown flag FAILS, as in every other command", () => {
  const dir = emptyDir();
  try {
    run(["init", "--dir", dir]);
    const r = run(["stats", "--dir", dir, "--jsn"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /--jsn/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── init: the example task (TL-64) ──────────────────────────────────────

test("init creates EXACTLY one example task, and a working one", () => {
  const dir = emptyDir();
  try {
    const r = run(["init", "--dir", dir]);
    assert.equal(r.status, 0, r.stderr);
    const tasks = readdirSync(join(dir, "tasks")).filter((f) => f.endsWith(".md"));
    assert.equal(tasks.length, 1, "there are " + tasks.length + " examples");

    const text = readFileSync(join(dir, "tasks", tasks[0]), "utf8");
    // An example with a placeholder in `verification` would teach that the field is
    // decorative — while it is the only line of defence against a "done" that is not.
    assert.doesNotMatch(text, /command to run/, "verification was left as the template placeholder");
    assert.match(text, /- id: doctor-clean\n\s+bash: "worktrail doctor"/, "the verification is not runnable");
    // Since TL-86 the example also has to demonstrate the LINK: a criterion
    // that names the entry proving it. An example carrying two unlinked lists
    // teaches the very redundancy that mechanism removes.
    assert.match(text, /\[proof: doctor-clean\]/, "the example does not link a criterion to its proof");
    assert.match(text, /delete/i, "the example does not say of itself that it can be deleted");

    assert.equal(run(["check", "--dir", dir]).status, 0, "the example does not pass the guards");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("after init `stats` shows a non-zero number with no further commands", () => {
  // `init` builds the views itself — otherwise the first user judges the tool on an
  // empty screen and has a step to perform that the tool can do by itself.
  const dir = emptyDir();
  try {
    run(["init", "--dir", dir]);
    assert.ok(existsSync(join(dir, "INDEX.yaml")), "init did not build the views");
    const r = run(["stats", "--dir", dir]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /tasks in total\s+1/, "stats shows zero right after init");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--no-example gives today's empty behaviour", () => {
  const dir = emptyDir();
  try {
    assert.equal(run(["init", "--dir", dir, "--no-example"]).status, 0);
    assert.equal(readdirSync(join(dir, "tasks")).filter((f) => f.endsWith(".md")).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the example goes ONLY into an empty tree", () => {
  // A backlog that already has tasks is not new. Adding an example to it would be
  // the same surprise as overwriting an existing file.
  const dir = emptyDir();
  try {
    mkdirSync(join(dir, "tasks"), { recursive: true });
    writeFileSync(join(dir, "tasks", `${P}-7-mine.md`), `---\nid: ${P}-7\ntitle: "Mine"\nstatus: pending\nboard: main\n---\n`, "utf8");
    assert.equal(run(["init", "--dir", dir]).status, 0);
    const tasks = readdirSync(join(dir, "tasks")).filter((f) => f.endsWith(".md"));
    assert.deepEqual(tasks, [`${P}-7-mine.md`], "init added an example to a non-empty backlog");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the example carries no existing project's vocabulary", () => {
  const dir = emptyDir();
  try {
    run(["init", "--dir", dir]);
    const tasks = readdirSync(join(dir, "tasks")).filter((f) => f.endsWith(".md"));
    const text = readFileSync(join(dir, "tasks", tasks[0]), "utf8");
    assert.doesNotMatch(text, /origin|sync-layer|supabase|railway|founder/i, "the example carries a foreign context");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
