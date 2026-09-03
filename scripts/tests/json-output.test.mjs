/**
 * `--json` on every reading command — Law 4, as a rule rather than a description (TL-57).
 *
 * WHY THE CONSTRAINT IS "STDOUT AND NOTHING ELSE" AND NOT "STDOUT CONTAINS
 * JSON". A heading, a `✓`, a warning added for one release — each of them breaks
 * every consumer at once, and none of them breaks anything the author will see,
 * because the author reads the terminal. So the assertion here is that
 * `JSON.parse` succeeds on the WHOLE of stdout, for every command, on an empty
 * backlog and a populated one. Nothing weaker would catch the failure this is
 * written for.
 *
 * AND ON AN EMPTY BACKLOG SPECIFICALLY, because that is where a command is most
 * likely to take a different path — an early return with a friendly sentence, a
 * "nothing to do" printed before the JSON branch is reached. A suite that only
 * ever ran against a populated tree would be green through all of it.
 *
 * THE EXIT CODE IS TESTED SEPARATELY FROM THE DOCUMENT. `check --json` that
 * found a violation still fails: JSON describes the result, it does not replace
 * it. A consumer that read `ok: false` and got exit 0 would have two answers and
 * no rule about which wins.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CHECK_GUARDS, parseCheckArgs } from "../cli.mjs";
import { KINDS } from "../json-envelope.mjs";

import { isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("json-output");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

let counter = 0;
function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), "branchling-" + prefix + "-" + (counter++) + "-"));
}

function run(args, cwd, env) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, input: "", cwd,
    env: env || { ...process.env, NO_COLOR: "1" },
  });
}

/** A repository with a backlog, and `tasks` tasks in it. */
function fixture(tasks = 0) {
  const dir = tmp("json");
  const backlog = join(dir, "backlog");
  const env = { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(dir, "state") };
  assert.equal(spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir }).status, 0);
  assert.equal(run(["init", "--dir", backlog, "--no-example"], dir, env).status, 0);
  const ids = [];
  for (let i = 0; i < tasks; i++) {
    const r = run(["new", "--dir", backlog, "--title", "Task number " + (i + 1)], dir, env);
    assert.equal(r.status, 0, r.stderr);
    ids.push((r.stdout.match(/([A-Z]+-\d+)/) || [])[1]);
  }
  return { dir, backlog, env, ids };
}

/** Parse the WHOLE of stdout, and say what was on it when that fails. */
function parsed(result, label) {
  assert.notEqual(result.status, null, label + " did not run");
  try {
    return JSON.parse(result.stdout);
  } catch (e) {
    assert.fail(label + ": stdout is not one JSON document — " + e.message +
      "\n--- stdout ---\n" + result.stdout + "\n--- stderr ---\n" + result.stderr);
  }
}

// ── every reading command, on both shapes of backlog ──────────────────────

test("every reading command answers with JSON and nothing else, empty or populated", () => {
  for (const tasks of [0, 3]) {
    const fx = fixture(tasks);
    const label = tasks === 0 ? " (empty backlog)" : " (populated backlog)";
    const calls = [
      ["query", "--json", "--dir", fx.backlog],
      ["stats", "--json", "--dir", fx.backlog],
      ["doctor", "--json", "--dir", fx.backlog],
      ["next-id", "--json", "--dir", fx.backlog],
      ["plan", "--json", "--dir", fx.backlog],
      ["time", "--json", "--dir", fx.backlog],
      ["check", "--json", "--dir", fx.backlog],
      ["instructions", "overview", "--json"],
    ];
    for (const args of calls) {
      const answer = parsed(run(args, fx.dir, fx.env), args[0] + label);
      assert.equal(answer.schemaVersion, 1, args[0] + label + ": no schemaVersion");
      assert.ok(KINDS[answer.kind], args[0] + label + ": undeclared kind `" + answer.kind + "`");
      for (const key of Object.keys(KINDS[answer.kind])) {
        assert.ok(key in answer, args[0] + label + ": the key `" + key + "` is missing");
      }
    }
  }
});

test("`board --json` answers about a file, and only in JSON", () => {
  const fx = fixture(1);
  const file = spawnSync("sh", ["-c", "ls backlog/tasks/" + fx.ids[0] + "-*.md"],
    { cwd: fx.dir, encoding: "utf8" }).stdout.trim();
  const answer = parsed(run(["board", file, "--json", "--dir", fx.backlog], fx.dir, fx.env), "board");
  assert.equal(answer.kind, "board");
  assert.equal(typeof answer.isDefault, "boolean");
  // The rule that decided, not only the answer: a consumer that has to guess why
  // a board was chosen would re-implement the rules to check them.
  assert.ok("rule" in answer && "reason" in answer);
});

// ── check --json ──────────────────────────────────────────────────────────

test("`check --json` names every guard it ran, and the ones that failed", () => {
  const fx = fixture(2);
  const answer = parsed(run(["check", "--json", "--dir", fx.backlog], fx.dir, fx.env), "check");
  assert.equal(answer.ok, true);
  assert.deepEqual(answer.failed, []);
  assert.deepEqual(answer.guards.map((g) => g.name).sort(),
    CHECK_GUARDS.filter((g) => !g.optIn).map((g) => g.name).sort(),
    "a bare `check --json` did not run the same set the text mode runs");
  for (const guard of answer.guards) {
    assert.equal(typeof guard.output, "string");
    assert.equal(guard.exit, 0);
  }
});

test("a failing guard is NAMED in `failed`, not left to be filtered out of `guards`", () => {
  const fx = fixture(1);
  mkdirSync(join(fx.dir, "docs"), { recursive: true });
  writeFileSync(join(fx.dir, "docs", "broken.md"), "[x](nowhere.md)\n", "utf8");

  const r = run(["check", "--json", "--dir", fx.backlog], fx.dir, fx.env);
  const answer = parsed(r, "check with a dead link");
  assert.equal(answer.ok, false);
  assert.deepEqual(answer.failed, ["docs"]);
  // THE EXIT CODE IS UNCHANGED. Two answers with no rule about which wins is
  // worse than one.
  assert.notEqual(r.status, 0, "`check --json` found a violation and still exited 0");
});

test("a selector runs exactly the guards it names, in JSON as in text", () => {
  const fx = fixture(1);
  const answer = parsed(run(["check", "--json", "--refs", "--plan", "--dir", fx.backlog], fx.dir, fx.env),
    "check --refs --plan");
  assert.deepEqual(answer.guards.map((g) => g.name), ["refs", "plan"]);
});

test("the guard table is the one source both modes read", () => {
  // PURE. Two lists of eleven guards would differ the first time somebody added
  // a twelfth to one of them — silently, because a JSON consumer has no way to
  // notice a guard that is not there.
  const plan = parseCheckArgs([]);
  for (const guard of CHECK_GUARDS) {
    if (guard.optIn) {
      assert.equal(plan[guard.want], false, "`" + guard.name + "` joined the default run");
      continue;
    }
    assert.equal(plan[guard.want], true, "`" + guard.name + "` is not in the default run");
  }
  // The exception is ONE guard, named here on purpose (TL-147): a bare `check`
  // that re-ran other tasks' contracts would take minutes instead of a second,
  // and — since a contract in this backlog runs `check` — would call itself. A
  // second opt-in guard is a decision somebody has to come here to make.
  assert.deepEqual(CHECK_GUARDS.filter((g) => g.optIn).map((g) => g.name), ["proofs"]);
  // …and it is still reachable, which is what makes the exception an exception
  // rather than a guard wired to nothing.
  assert.equal(parseCheckArgs(["--proofs"]).wantProofs, true);
  assert.equal(parseCheckArgs(["--proofs"]).wantIds, false, "asking for one guard ran them all");

  const narrowed = parseCheckArgs(["--refs"]);
  assert.deepEqual(CHECK_GUARDS.filter((g) => narrowed[g.want]).map((g) => g.name), ["refs"]);
});

test("`check --json` prints nothing on stdout when the configuration cannot be read", () => {
  // The one path that returns before any guard runs. A friendly sentence there
  // would be the exact failure this file exists to prevent — and the caller
  // still has to be told, so it goes to stderr.
  const fx = fixture();
  writeFileSync(join(fx.backlog, "config.yaml"), "statusesss: [a]\n", "utf8");
  const r = run(["check", "--json", "--dir", fx.backlog], fx.dir, fx.env);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "", "stdout carried prose: " + r.stdout);
  assert.match(r.stderr, /statusesss|unknown key/);
});

// ── the workaround this task removes ──────────────────────────────────────

test("`new` takes the number from a FIELD, not from the last line of stdout", () => {
  // The workaround was in the tool's own code: the last line of stdout, tested
  // against a regex so that a scanner printing anything unexpected could not
  // produce a `TASK-NaN-*.md`. That regex was the only thing standing between
  // the two.
  const source = spawnSync("node", ["-e",
    "process.stdout.write(require('fs').readFileSync('" + join(HERE, "..", "new-task.mjs") + "', 'utf8'))"],
    { encoding: "utf8" }).stdout;
  assert.match(source, /next-backlog-id\.mjs".*"--json"|"--json"/s,
    "`new` no longer asks for JSON");
  assert.equal(/split\("\\n"\)\.pop\(\)/.test(source), false,
    "`new` still parses the last line of stdout");
});

test("`new` still allocates a working number end to end", () => {
  // The positive control for the change above: reading a field is only better
  // if it still produces a task.
  const fx = fixture(2);
  const r = run(["new", "--dir", fx.backlog, "--title", "One more task"], fx.dir, fx.env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /TASK-3-/);
  assert.equal(/NaN/.test(r.stdout), false);
});

// ── the flags are declared ────────────────────────────────────────────────

test("`--json` is in the allow-list, and an unknown flag still fails", () => {
  const fx = fixture();
  assert.equal(run(["check", "--json", "--dir", fx.backlog], fx.dir, fx.env).status, 0);
  const bad = run(["check", "--jsonn", "--dir", fx.backlog], fx.dir, fx.env);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--json/, "the error does not name the flag that exists");
});

test("`check --help` documents `--json`", () => {
  const help = run(["check", "--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--json/);
  assert.match(help.stdout, /exit code is unchanged/i);
});
