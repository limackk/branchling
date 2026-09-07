/**
 * Dispatcher CLI (BL-1411).
 *
 * The defect this fixes: `serve-backlog.mjs` read only the flags it knew and
 * IGNORED the rest. `branchling query --status blocked` went through without a trace,
 * after which the server opened a browser tab — a silent no-op with a side effect,
 * which is worse than an error, because it looks like the tool working.
 *
 * Resolving a command is PURE (`resolveCommand`), so that it can be tested without
 * starting servers; separately, a few tests run a real process, because a command
 * table consistent with itself does not prove that `query` really asks rather than
 * serves.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { COMMANDS, helpText, resolveCommand } from "../cli.mjs";
import { STDIN_WAIT_MS } from "../regen-hook.mjs";

import { isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("cli");

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");

function run(args, opts) {
  return spawnSync(process.execPath, [CLI].concat(args), Object.assign({ encoding: "utf8" }, opts || {}));
}

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-cli-"));
  mkdirSync(join(dir, "tasks"));
  writeFileSync(join(dir, "_template.md"), "---\nid: BL-NNN\n---\n", "utf8");
  // The board guard requires a registry — without it `board:` has no vocabulary.
  writeFileSync(join(dir, "boards.yaml"), "default: main\nboards:\n  - slug: main\n    name: \"Main\"\n", "utf8");
  writeFileSync(
    join(dir, "tasks", "BL-900-zrob-rzecz.md"),
    ["---", "id: BL-900", 'title: "Do the thing"', "type: task", "labels: [pre-launch]", "board: main",
      'epic: ""', "priority: P1", "status: blocked", "owner: unassigned", "estimate: 2h",
      "confidence: high", "created: 2026-08-01", "updated: 2026-08-01", "blocked_by: []", "blocks: []",
      "---", "", "## Goal", "", "The body.", ""].join("\n"),
    "utf8"
  );
  return dir;
}

// ── Resolving the command (pure) ──────────────────────────────────────────

test("no arguments means the server — the `branchling` habit is untouched", () => {
  assert.equal(resolveCommand([]).name, "serve");
});

test("a subcommand picks the script, the remaining arguments go on", () => {
  const r = resolveCommand(["query", "--status", "blocked"]);
  assert.equal(r.name, "query");
  assert.deepEqual(r.args, ["--status", "blocked"]);
});

test("the server flags with no subcommand still work", () => {
  // `branchling --port 4400` meant "start the server" and has to keep meaning it.
  const r = resolveCommand(["--port", "4400", "--no-open"]);
  assert.equal(r.name, "serve");
  assert.deepEqual(r.args, ["--port", "4400", "--no-open"]);
});

test("an unknown COMMAND is an error, not a silent fall-through to the server", () => {
  // This is the reported bug: `branchling query …` used to open a page.
  assert.throws(() => resolveCommand(["frobnicate"]), /frobnicate/);
  assert.throws(() => resolveCommand(["frobnicate"]), /query|build|check/);
});

test("a word that looks like a command is NOT taken for a server flag", () => {
  assert.throws(() => resolveCommand(["querry", "--status", "blocked"]), /querry/);
});

test("the help lists every command from the table — no hand-written, drifting list", () => {
  const text = helpText();
  for (const name of Object.keys(COMMANDS)) {
    assert.ok(text.includes(name), "the help does not mention the command " + name);
  }
});

test("every command in the table has a description and an EXISTING script", () => {
  // Not "the field is non-empty" but "the file is on disk" — a typo in the table
  // would only show when a user ran the command.
  const scriptsDir = join(dirname(fileURLToPath(import.meta.url)), "..");
  for (const [name, spec] of Object.entries(COMMANDS)) {
    assert.ok(spec.summary && spec.summary.length > 5, name + " has no summary");
    const scripts = spec.composite || [spec.script];
    assert.ok(scripts.length && scripts[0], name + " points at no script");
    for (const f of scripts) {
      assert.ok(existsSync(join(scriptsDir, f)), name + " points at a non-existent " + f);
    }
  }
});

// ── Real runs ─────────────────────────────────────────────────────────────

test("`query` really asks about tasks rather than starting the server", () => {
  const dir = sandbox();
  try {
    const r = run(["query", "--dir", dir, "--status", "blocked"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /BL-900/);
    assert.ok(!/127\.0\.0\.1|http:\/\//.test(r.stdout), "that was the server's answer, not the query's");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unknown command ends in an error and does NOT open a browser", () => {
  const r = run(["frobnicate"]);
  assert.notEqual(r.status, 0);
  const out = (r.stdout || "") + (r.stderr || "");
  assert.match(out, /frobnicate/);
  assert.ok(!/127\.0\.0\.1/.test(out), "the dispatcher went to the server instead of reporting an error");
});

test("a subcommand's exit code is PROPAGATED, not swallowed", () => {
  // query.mjs fails (2) on a typo in a flag — the dispatcher must not soften that.
  const dir = sandbox();
  try {
    const r = run(["query", "--dir", dir, "--prioryty", "P0"]);
    assert.notEqual(r.status, 0, "a typo in a flag went through as success");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--help exits zero and lists the commands", () => {
  const r = run(["--help"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /query/);
  assert.match(r.stdout, /serve/);
});

test("the server rejects an UNKNOWN flag instead of ignoring it and starting", () => {
  // The heart of the report: an ignored argument ended in an open tab.
  // A timeout, because a regression in validation means a started server means a hung suite.
  const r = run(["serve", "--frobnicate", "--no-open"], { timeout: 10_000 });
  assert.notEqual(r.status, 0, "the server started despite an unknown flag");
  const out = (r.stdout || "") + (r.stderr || "");
  assert.match(out, /frobnicate/);
});

test("`check` with no arguments checks the REAL tasks, not zero of them", () => {
  // The second trap of the same class: check-backlog-boards.mjs without --all
  // finished green on "0 tasks checked".
  const dir = sandbox();
  try {
    const r = run(["check", "--dir", dir]);
    assert.equal(r.status, 0, r.stderr);
    const out = r.stdout + r.stderr;
    assert.ok(!/0 task/.test(out), "the guard reported zero tasks checked: " + out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── `check`: guard selection, flag validation, exit code (BL-1450) ────────
//
// The order of the tests is not accidental. Flag validation comes FIRST, because
// without it the next two tests are unmeasurable: on code that ignores an unknown
// flag, `check --id-collisions` also "passes" — by running both guards. The
// selector test would then be green with zero evidential force.

/**
 * The trace in the output by which we recognise that a given guard REALLY ran.
 *
 * The patterns are deliberately narrow: the first version of this test looked for
 * words that also appear in `check`'s HELP TEXT. It then reported a guard as having
 * run where the help alone had been printed.
 */
const RAN_IDS = /tasks, each BL-/;
const RAN_BOARDS = /checked, each with a board/;

test("`check` REJECTS an unknown flag instead of ignoring it and running the guards", () => {
  const dir = sandbox();
  try {
    const r = run(["check", "--dir", dir, "--frobnicate"]);
    assert.equal(r.status, 2, "an unknown flag went through: " + (r.stdout + r.stderr));
    const out = r.stdout + r.stderr;
    assert.match(out, /frobnicate/);
    assert.ok(!RAN_IDS.test(out), "a guard ran despite a usage error: " + out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("`check --help` prints the usage and does NOT run the guards", () => {
  const r = run(["check", "--help"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--id-collisions/);
  assert.match(r.stdout, /--boards/);
  assert.ok(!RAN_IDS.test(r.stdout), "the help ran the collision guard");
});

test("`check --id-collisions` runs ONLY the collision guard", () => {
  const dir = sandbox();
  try {
    const r = run(["check", "--dir", dir, "--id-collisions"]);
    assert.equal(r.status, 0, r.stderr);
    const out = r.stdout + r.stderr;
    assert.ok(RAN_IDS.test(out), "the collision guard did not run: " + out);
    assert.ok(!RAN_BOARDS.test(out), "the board guard ran too: " + out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("`check --boards <file>` judges the NAMED file, not the whole tree", () => {
  const dir = sandbox();
  try {
    // A second task with a board outside the registry. If the file selector did not
    // work and the guard read the whole tree, that file would fail it — so a green
    // result on the first file is PROOF of narrowing here, not a coincidence.
    writeFileSync(
      join(dir, "tasks", "BL-901-zly-board.md"),
      ["---", "id: BL-901", 'title: "Bad board"', "type: task", "labels: []",
        "board: no-such-board", 'epic: ""', "priority: P1", "status: pending",
        "owner: unassigned", "estimate: 2h", "confidence: high", "created: 2026-08-01",
        "updated: 2026-08-01", "blocked_by: []", "blocks: []", "---", "", "## Cel", "", "x", ""].join("\n"),
      "utf8"
    );
    const ok = run(["check", "--dir", dir, "--boards", join(dir, "tasks", "BL-900-zrob-rzecz.md")]);
    assert.equal(ok.status, 0, "the good file failed: " + ok.stdout + ok.stderr);

    // A positive control: the same mode on the bad file MUST fail. Without it the
    // green pass above would describe a guard that checks nothing.
    const bad = run(["check", "--dir", dir, "--boards", join(dir, "tasks", "BL-901-zly-board.md")]);
    assert.notEqual(bad.status, 0, "a task with a board outside the registry went through");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("with no selector `check` runs BOTH guards and returns the WORSE code", () => {
  const dir = sandbox();
  try {
    writeFileSync(
      join(dir, "tasks", "BL-901-zly-board.md"),
      ["---", "id: BL-901", 'title: "Bad board"', "type: task", "labels: []",
        "board: no-such-board", 'epic: ""', "priority: P1", "status: pending",
        "owner: unassigned", "estimate: 2h", "confidence: high", "created: 2026-08-01",
        "updated: 2026-08-01", "blocked_by: []", "blocks: []", "---", "", "## Cel", "", "x", ""].join("\n"),
      "utf8"
    );
    // Collisions: green. Boards: red. The total has to be red — "last wins" and
    // "first wins" would give different, half-false results here.
    const r = run(["check", "--dir", dir]);
    assert.notEqual(r.status, 0, "a red guard was covered by a green one");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── `regen-hook`: the entry point for an editor hook (BL-1450) ────────────

test("`regen-hook` rebuilds the views from the hook JSON on stdin", () => {
  const dir = sandbox();
  try {
    const file = join(dir, "tasks", "BL-900-zrob-rzecz.md");
    assert.ok(!existsSync(join(dir, "INDEX.yaml")), "the view existed before the test");
    const r = run(["regen-hook"], { input: JSON.stringify({ tool_input: { file_path: file } }) });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(dir, "INDEX.yaml")), "the views were not rebuilt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("`regen-hook` fails loudly when history recording fails after rebuilding", () => {
  const dir = sandbox();
  const stateFile = join(dir, "state-file");
  try {
    const file = join(dir, "tasks", "BL-900-zrob-rzecz.md");
    // history-record creates its cross-worktree mutex below BACKLOG_STATE_DIR.
    // A file at that path makes that operation fail while build remains able to
    // regenerate the repository-local views.
    writeFileSync(stateFile, "not a directory", "utf8");
    const r = run(["regen-hook"], {
      input: JSON.stringify({ tool_input: { file_path: file } }),
      env: Object.assign({}, process.env, { BACKLOG_STATE_DIR: stateFile }),
    });
    assert.notEqual(r.status, 0, "a missing history record must fail the hook");
    assert.ok(existsSync(join(dir, "INDEX.yaml")), "the views were not rebuilt first");
    assert.match(r.stderr, /history could not be recorded/i);
    assert.match(r.stderr, /history-record/i, "the failing child was not named");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("`regen-hook` on a file outside tasks/ is SILENT and exits zero", () => {
  const dir = sandbox();
  try {
    const r = run(["regen-hook"], { input: JSON.stringify({ tool_input: { file_path: join(dir, "README.md") } }) });
    assert.equal(r.status, 0, r.stderr);
    assert.equal((r.stdout || "").trim(), "", "the hook spoke up about a file that does not concern it");
    assert.ok(!existsSync(join(dir, "INDEX.yaml")), "the hook rebuilt the views for a foreign file");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("`regen-hook` gives up on a stdin nobody closes instead of waiting forever",
  async () => {
  // THE DEFECT (TL-224). The payload was read with `readFileSync(0)`, which
  // reads to EOF. An editor pipes its JSON and closes, so the command was only
  // ever exercised on the one input shape that ends by itself. A terminal does
  // not end, and neither does a parent that leaves stdin inherited: the hook
  // waited for an EOF that was never coming — no output, no prompt, nothing to
  // tell it apart from slow work. Measured before the fix: `( sleep 4 ) |
  // regen-hook` took the whole four seconds, and a terminal took forever.
  //
  // THE PIPE HAS TO BE HELD OPEN BY THIS TEST. `spawnSync` with no `input`
  // closes the child's stdin immediately, so a test written that way passes
  // against the BROKEN code — it is the one arrangement the defect never had.
  // Here the parent keeps the writable and never ends it.
  const child = spawn(process.execPath, [CLI, "regen-hook"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const started = Date.now();

  const outcome = await new Promise((resolve) => {
    // The backstop: without it, a regression does not fail this test, it hangs
    // the suite — which reads as infrastructure trouble rather than as this bug.
    const killer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve("still blocking");
    }, 15000);
    child.on("exit", () => {
      clearTimeout(killer);
      resolve("exited");
    });
  });
  const elapsed = Date.now() - started;
  child.stdin.destroy();

  assert.equal(outcome, "exited", `the hook never returned (${elapsed}ms)`);
  assert.ok(
    elapsed < STDIN_WAIT_MS * 3,
    `the hook waited ${elapsed}ms on a stdin nobody closes (bound is ` +
      `${STDIN_WAIT_MS}ms) — it is blocking again`
  );
});

test("`regen-hook` still reads a payload that arrives late", () => {
  // The positive control for the test above, and the reason the wait is bounded
  // rather than abolished. Without it, "returns quickly" would also be satisfied
  // by a hook that stopped reading stdin altogether — which passes every timing
  // assertion and does nothing for anybody.
  const dir = sandbox();
  try {
    const file = join(dir, "tasks", "BL-900-zrob-rzecz.md");
    const r = run(["regen-hook"], {
      input: JSON.stringify({ tool_input: { file_path: file } }),
    });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(dir, "INDEX.yaml")), "the views were not rebuilt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a payload that arrives WITHOUT the writer closing is still honoured",
  async () => {
  // The other half of the bound: a caller that writes its JSON and then holds
  // the pipe open has told the hook everything it needs. Discarding that at the
  // deadline would be the same mistake pointing the other way.
  const dir = sandbox();
  try {
    const file = join(dir, "tasks", "BL-900-zrob-rzecz.md");
    const child = spawn(process.execPath, [CLI, "regen-hook"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.write(JSON.stringify({ tool_input: { file_path: file } }));
    // Deliberately no `end()`.
    //
    // The same backstop as the test above, for the same reason: against the
    // pre-fix read this child never exits, and an unguarded `await` on its exit
    // hangs the whole suite instead of failing this one case. Measured while
    // writing it — the run sat for five minutes and reported nothing.
    const exited = await new Promise((resolve) => {
      const killer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve(false);
      }, 15000);
      child.on("exit", () => {
        clearTimeout(killer);
        resolve(true);
      });
    });
    child.stdin.destroy();
    assert.ok(exited, "the hook never returned on a payload whose writer stayed open");
    assert.ok(
      existsSync(join(dir, "INDEX.yaml")),
      "a payload that arrived was thrown away because its writer stayed open"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("`regen-hook` takes the backlog directory FROM THE FILE, not from cwd", () => {
  // The heart of portability: a hook installed in node_modules has no neighbours,
  // and cwd can be anything. The task's path IS the pointer to the data directory.
  const dir = sandbox();
  const elsewhere = mkdtempSync(join(tmpdir(), "branchling-cwd-"));
  try {
    const file = join(dir, "tasks", "BL-900-zrob-rzecz.md");
    const r = run(["regen-hook"], {
      input: JSON.stringify({ tool_input: { file_path: file } }),
      cwd: elsewhere,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(dir, "INDEX.yaml")), "the views were not created under a foreign cwd");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
});
