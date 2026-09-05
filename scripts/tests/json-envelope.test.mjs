/**
 * The JSON envelope on every command that answers in it (TL-72).
 *
 * WHAT HAS TO BE PROVED, and why each part needs its own control:
 *
 *   1. EVERY such command answers in the envelope — not only the one that was
 *      changed first. The two tables below are checked against `KINDS`, so a kind
 *      declared without a command exercising it fails here instead of shipping
 *      untested. There are two because `seed` WRITES (TL-94): it cannot be
 *      asked twice of one tree, since the second answer would be about a tree the
 *      first call changed.
 *   2. Every key DECLARED for a kind is PRESENT. `assert.ok(value)` would pass on
 *      a missing key as happily as on a null, so the assertions ask `key in obj`
 *      — the promise is "never a missing key", and that is the thing to measure.
 *   3. A ZERO SAMPLE MUST NOT MAKE THIS GREEN. Every command is run twice: on an
 *      empty backlog and on one with three tasks and a routing rule. An envelope
 *      is asserted in both, and the payloads are asserted to DIFFER — a run over
 *      an empty tree could otherwise satisfy every shape assertion while the
 *      commands read nothing at all.
 *   4. The version lives in ONE place. A second `schemaVersion` literal anywhere
 *      in `scripts/` means two answers to "which contract is this", so the test
 *      reads the source, not the output.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { KINDS, SCHEMA_VERSION, envelope } from "../json-envelope.mjs";
import { isolateHome, REPO_ROOT, SCRIPTS_DIR, plainOutput } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("json-envelope");
// Assert against plain text, not against the observer's terminal (TL-238).
plainOutput();


const CLI = join(SCRIPTS_DIR, "cli.mjs");

let counter = 0;
function run(args, cwd, input) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    cwd, input, encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1" },
  });
}

/**
 * A backlog inside a real git repository — `next-id` scans branches and
 * worktrees, and outside a repository it takes a narrower path with a warning.
 * The point here is the ordinary path.
 */
function backlog({ tasks = 0, rule = false } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "branchling-envelope-" + counter++ + "-"));
  execFileSync("git", ["init", "-q", "-b", "main", "."], { cwd: repo, stdio: "ignore" });
  const dir = join(repo, "backlog");
  assert.equal(run(["init", "--dir", dir, "--no-example"]).status, 0, "init failed");
  for (let i = 0; i < tasks; i++) {
    const r = run(["new", "--dir", dir, "--title", "Task number " + (i + 1), "--priority", "P1"]);
    assert.equal(r.status, 0, r.stderr);
  }
  if (rule) {
    // A second board WITH a paths rule, so `board` has something to match. The
    // template ships only the default board, and against that one every answer
    // is the fallback — which would make the `board` assertions untestable.
    const boards = join(dir, "boards.yaml");
    writeFileSync(boards, readFileSync(boards, "utf8") +
      '\n  - slug: docs\n    name: "Docs"\n    paths:\n      - "docs/**"\n', "utf8");
  }
  return { repo, dir };
}

/** The reading commands, one per declared kind. */
const READING = {
  "task-list": ["query", "--json"],
  stats: ["stats", "--json"],
  doctor: ["doctor", "--json"],
  // The guards, as one document (TL-57). A NARROW selector on purpose: the
  // default run reads this installation's whole source, which is a second of
  // wall clock per fixture and answers nothing this test asks.
  check: ["check", "--json", "--refs"],
  board: ["board", "--json", "--paths", "docs/guide.md"],
  "next-id": ["next-id", "--json"],
  // A topic is named on purpose: without one the payload carries the listing and
  // no `text`, and the key that matters most would go unexercised.
  instructions: ["instructions", "overview", "--json"],
  // The fixtures carry no `plan.yaml`, so this exercises the answer a backlog
  // without an execution order gives — which is the one that has to stay a
  // complete envelope rather than an error.
  plan: ["plan", "--json"],
  // A backlog with no `activity/` at all: the answer has to stay a complete
  // envelope, with zero counted rather than a section missing (TL-27).
  time: ["time", "--json"],
  // The input surface of ONE command, for a program to read before it calls it
  // (TL-83). `new` is the one whose flags draw on the most vocabularies, so a
  // fixture answering it exercises the part that varies per project.
  "command-help": ["new", "--help", "--json"],
  // The fixtures are not git repositories, so this exercises the answer a
  // command with no range to read gives (TL-89) — which has to stay a complete
  // envelope saying `scanned: false`, not an error and not an empty list.
  "pr-summary": ["pr-summary", "--json"],
  // A backlog with no history at all (TL-90): every detector has nothing to
  // find, and the envelope still has to carry every key rather than dropping
  // the sections that came back empty.
  audit: ["audit", "--json"],
  // A repository with no `docs/` at all (TL-100): zero documents still has to be
  // a complete envelope. `flagged` and `tooLittle` come back as empty LISTS, and
  // `seeded` as null — the command wrote nothing, which is a different answer
  // from having written nothing useful.
  "docs-drift": ["docs-drift", "--json"],
  // A backlog with no heartbeats (TL-92): zero sessions still has to be a
  // complete envelope, `correlation` included — that key states a limit of the
  // ANSWER, so dropping it when the list is empty would drop the caveat with it.
  sessions: ["sessions", "--json"],
  // Asking about a session the fixture does not have: "not found" is an ANSWER
  // and still an envelope, with `session: null` and a non-zero exit. A consumer
  // must not have to parse stderr to learn that.
  session: ["session", "no-such-session", "--json"],
  // A forecast on a backlog whose bucket is empty (TL-88): "not enough data" is
  // an ANSWER and still a complete envelope with `insufficient: true`. The
  // fixture's own first task is quoted, because the id has to exist — a missing
  // task exits 1 and would exercise the refusal instead.
  quote: ["quote", "TL-1", "--json"],
  // `resume` composes reads and writes nothing (TL-151), so it belongs in THIS
  // table and not beside `seed`: asking it twice of one tree is safe, and
  // `scripts/tests/resume-briefing.test.mjs` proves the tree is byte-identical
  // afterwards. The id EXISTS on the populated fixture and not on the empty
  // one, so the row exercises a briefing on one and the "no such task" refusal
  // on the other. Each is a complete envelope, with a non-zero exit
  // reserved for the refusal, and neither of which is a usage error.
  // (The literal id here is the defect TL-273 covers for the whole table; it is
  // written the way its neighbours are so that one fix covers all of them.)
  // `--no-verify` because this file asks about the ENVELOPE. Left out, the row
  // would run the fixture task's `verification:` command, and the shape of the
  // answer would start depending on the observer's shell.
  resume: ["resume", "TASK-1", "--actor", "agent:test", "--no-verify", "--json"],
};

/**
 * The writing commands, one per declared kind. `seed` is the first writing
 * command in the envelope — the three older ones (`take`, `next`, `done`) still
 * answer with a bare object and move separately, so they have no kind to check.
 */
const WRITING = {
  // The writing commands (TL-119). `take` and `next` share ONE kind, so the
  // table names it once and the completeness check below is satisfied by either
  // — here it is exercised by `next`, and the refusal test after this one
  // covers `take`.
  "task-take": { args: ["next", "--actor", "agent:test", "--json"] },
  // A handoff of a task nobody holds: a REFUSAL, and refusals are the path most
  // easily left without an envelope. `--reason` is required before the refusal
  // is even reached, so it is given.
  "task-handoff": {
    args: ["handoff", "TASK-404", "--to-owner", "unassigned", "--reason", "a fixture", "--actor", "agent:test", "--json"],
    refuses: true,
  },
  // A task that is not there: same reason as above — the refusal path.
  "verification-run": { args: ["done", "TASK-404", "--json"], refuses: true },
  // A question about a task that is not there (TL-148): the refusal path again,
  // and `--question` is required before the refusal is reached, so it is given.
  "task-ask": {
    args: ["ask", "TASK-404", "--question", "which of the two?", "--actor", "agent:test", "--json"],
    refuses: true,
  },
  seed: {
    args: ["seed", "--json"],
    input: JSON.stringify({
      tasks: [{
        plan_id: "first", title: "A seeded task", goal: "Something is true afterwards.",
        verification: [{ id: "it-runs", bash: "true", proves: "The check runs." }],
      }],
    }),
  },
};

function ask(kind, dir) {
  const spec = READING[kind] ? { args: READING[kind] } : WRITING[kind];
  const r = run(spec.args.concat(["--dir", dir]), undefined, spec.input);
  // A REFUSAL still has to be an envelope, so a non-zero exit is not a failure
  // here — only a usage error is, and only for the kinds that are not testing a
  // refusal on purpose.
  if (!spec.refuses) assert.notEqual(r.status, 2, kind + ": a usage error — " + r.stderr);
  let parsed;
  assert.doesNotThrow(() => { parsed = JSON.parse(r.stdout); },
    kind + ": the output does not parse as JSON: " + r.stdout.slice(0, 200));
  return parsed;
}

// ── The envelope itself ───────────────────────────────────────────────────

test("positive control: there are kinds to check, and a command for each", () => {
  // Every loop below iterates over KINDS. An empty table would make all of them
  // green without asking anything.
  assert.ok(Object.keys(KINDS).length >= 5, "expecting a kind per command that answers in the envelope");
  assert.deepEqual(Object.keys(READING).concat(Object.keys(WRITING)).sort(), Object.keys(KINDS).sort(),
    "a kind with no command exercising it, or a command with no kind");
  assert.deepEqual(Object.keys(READING).filter((k) => k in WRITING), [],
    "a kind claimed by both tables — one command, one route");
});

test("the envelope always carries the version and the kind", () => {
  for (const kind of Object.keys(KINDS)) {
    const e = envelope(kind, {});
    assert.equal(e.schemaVersion, SCHEMA_VERSION);
    assert.equal(e.kind, kind);
  }
});

test("a declared key is never MISSING — an absent scalar is null, an absent collection is []", () => {
  for (const [kind, shape] of Object.entries(KINDS)) {
    const e = envelope(kind, {});
    for (const [key, empty] of Object.entries(shape)) {
      assert.ok(key in e, kind + ": the key `" + key + "` is missing, not empty");
      assert.deepEqual(e[key], empty, kind + "." + key + ": the wrong empty value");
      assert.ok(empty === null || Array.isArray(empty),
        kind + "." + key + ": an empty value that is neither null nor [] states no rule");
    }
  }
});

test("`undefined` is treated as absent, never dropped from the output", () => {
  // JSON.stringify DELETES a key whose value is undefined. That is exactly the
  // shape the contract promises never to produce, so it cannot depend on the
  // caller remembering to pass null.
  const e = envelope("task-list", { total: undefined, tasks: undefined });
  assert.ok("total" in JSON.parse(JSON.stringify(e)), "an undefined key vanished from the JSON");
  assert.deepEqual(e.tasks, []);
});

test("an unknown kind and an unknown key both THROW", () => {
  assert.throws(() => envelope("no-such-kind", {}), /unknown JSON kind/);
  assert.throws(() => envelope("task-list", { taks: [] }), /unknown key/,
    "a typo would quietly become part of the contract");
  assert.throws(() => envelope("task-list", { kind: "other" }), /belongs to the envelope/);
});

// ── One version, one builder ──────────────────────────────────────────────

test("the version number lives in exactly one file", () => {
  // `schemaVersion` names ONE contract: the envelope's. A second use of the word
  // anywhere in scripts/ — even for a different document, such as the plan `seed`
  // reads — gives a reader two answers to "which contract is this", which is why
  // that one is called `planVersion` (TL-94).
  // A deliberate mention — prose explaining why something else is NOT called this
  // — is marked on its own line, the same way the language and product-name
  // guards take their exceptions. A marker per line, never per file.
  const files = readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith(".mjs"));
  // POSITIVE CONTROL: the guard reads real files, and the word is really in the
  // one file that owns it. Without this, a broken listing would report "no
  // offenders" — green, with nothing measured.
  assert.ok(files.length > 20, "the scan found almost no source files");
  assert.ok(readFileSync(join(SCRIPTS_DIR, "json-envelope.mjs"), "utf8").includes("schemaVersion"));

  const offenders = files
    .filter((f) => f !== "json-envelope.mjs")
    .filter((f) => readFileSync(join(SCRIPTS_DIR, f), "utf8")
      .split("\n")
      .some((line) => line.includes("schemaVersion") && !line.includes("envelope-version: allow")));
  assert.deepEqual(offenders, [], "a second answer to `which contract is this`");
});

test("no reading command builds an envelope of its own", () => {
  for (const file of ["query.mjs", "stats-report.mjs", "doctor.mjs", "suggest-board.mjs", "next-backlog-id.mjs", "instructions.mjs"]) {
    const src = readFileSync(join(SCRIPTS_DIR, file), "utf8");
    assert.match(src, /json-envelope\.mjs/, file + ": emits --json without the shared envelope");
  }
});

test("the manual documents every kind the code can emit", () => {
  // The contract is a promise to somebody outside this repository, and a kind
  // nobody wrote down is a promise nobody can rely on. Reading the source of the
  // document rather than trusting a habit is what keeps the two from drifting.
  //
  // IT READS THE MANUAL, NOT THE README (TL-154). The `--json` contract moved
  // there when the README became a front door, and this assertion was pointed
  // at a heading that no longer exists — so it failed on the ABSENCE of the
  // section and stopped comparing anything at all. That is the worse of the two
  // failure modes: a red test nobody has to act on trains people to ignore it,
  // and it was checking nothing the whole time it was red.
  const manual = readFileSync(join(REPO_ROOT, "docs", "manual.md"), "utf8");
  const at = manual.indexOf("## The `--json` contract");
  assert.notEqual(at, -1, "the manual has no `--json` contract section to check");
  const section = manual.slice(at);
  assert.ok(section.length > 500, "the `--json` contract section is too short to be one");
  for (const kind of Object.keys(KINDS)) {
    assert.ok(section.includes("`" + kind + "`"), "the manual does not document the kind `" + kind + "`");
  }
});

/**
 * The keys the manual's table promises for one kind. PURE (TL-155).
 *
 * IT READS THE ROW, NOT THE SECTION, and that is the whole difficulty. Half the
 * key names are ordinary words — `ok`, `id`, `root`, `text` — which occur all
 * over the surrounding prose, so "the section mentions it" is satisfied by a
 * table that says nothing. The row for a kind is the only place the promise is
 * actually made.
 *
 * EVERY BACKTICKED IDENTIFIER IN THE ROW IS A KEY, which is a rule about how the
 * table is written and not only about how it is read: a flag (`--limit`) and a
 * field name with a colon (`verification:`) are not identifiers and fall out on
 * their own, but a word like `next` or `from` used as prose has to lose its
 * backticks. That cost is worth paying — the alternative is a checker that
 * guesses which backticks were meant, and it would guess wrong silently.
 */
export function keysInManualRow(section, kind) {
  const row = section.split("\n").find((l) => l.startsWith("|") && l.includes("| `" + kind + "` |"));
  if (!row) return null;
  // Columns are: command | kind | keys. The rest is joined back because the key
  // cell is prose and may itself contain a pipe one day.
  const cell = row.split("|").slice(3).join("|");
  return new Set([...cell.matchAll(/`([A-Za-z_][A-Za-z0-9_]*)`/g)].map((m) => m[1]));
}

test("the manual's key list matches KINDS, in BOTH directions", () => {
  // A key in the code and not in the row is an undocumented promise; a key in
  // the row and not in the code is a promise the tool does not keep. Neither is
  // detectable by hand, because the table is long and the code is elsewhere.
  const manual = readFileSync(join(REPO_ROOT, "docs", "manual.md"), "utf8");
  const section = manual.slice(manual.indexOf("## The `--json` contract"));
  const problems = [];
  for (const kind of Object.keys(KINDS)) {
    const listed = keysInManualRow(section, kind);
    if (!listed) { problems.push(kind + ": no row in the table"); continue; }
    for (const key of Object.keys(KINDS[kind])) {
      if (!listed.has(key)) problems.push(kind + ": the manual does not list `" + key + "`");
    }
    for (const key of listed) {
      if (!(key in KINDS[kind])) problems.push(kind + ": the manual lists `" + key + "`, which nothing emits");
    }
  }
  assert.deepEqual(problems, []);
});

test("POSITIVE CONTROL: one misspelled key in the table is caught, twice over", () => {
  // Without this the check above passes just as well against a row parser that
  // returns nothing — every "the document mentions it" test's failure mode. The
  // manual is not touched: the row is misspelled in a COPY of the text.
  const manual = readFileSync(join(REPO_ROOT, "docs", "manual.md"), "utf8");
  const section = manual.slice(manual.indexOf("## The `--json` contract"));
  const [kind] = Object.keys(KINDS);
  const [key] = Object.keys(KINDS[kind]);
  const broken = section.replace("`" + key + "`", "`" + key + "X`");
  const listed = keysInManualRow(broken, kind);
  assert.ok(!listed.has(key), "misspelling a key did not remove it from the row");
  assert.ok(listed.has(key + "X"), "the parser ignored the row and answered from somewhere else");

  // And the words that are NOT keys stay out: the row for `task-take` carries
  // the command name `next` in prose, and the parser must not read it as a key.
  const takeRow = keysInManualRow(section, "task-take");
  assert.ok(takeRow.has("passedOver"), "the row parser found nothing at all");
  assert.ok(!takeRow.has("next"), "a command name in the prose was read as a payload key");
});

// ── Every reading command, end to end ─────────────────────────────────────

test("every command with a kind answers in the envelope — on an empty backlog and on a full one", () => {
  const empty = backlog({ tasks: 0, rule: true });
  const full = backlog({ tasks: 3, rule: true });

  for (const kind of Object.keys(KINDS)) {
    for (const [label, fx] of [["empty", empty], ["populated", full]]) {
      // A writing kind gets a tree of its own: asked twice of the shared fixture,
      // the second answer would be about what the first call wrote.
      const dir = WRITING[kind] ? backlog({ tasks: label === "empty" ? 0 : 3, rule: true }).dir : fx.dir;
      const answer = ask(kind, dir);
      const where = kind + " (" + label + " backlog)";
      assert.equal(answer.schemaVersion, SCHEMA_VERSION, where + ": no schemaVersion");
      assert.equal(answer.kind, kind, where + ": the wrong kind");
      for (const key of Object.keys(KINDS[kind])) {
        assert.ok(key in answer, where + ": the key `" + key + "` is missing");
      }
    }
  }
});

test("the answers DIFFER between an empty backlog and a populated one", () => {
  // Without this the whole suite could run against zero tasks and stay green:
  // every shape assertion is satisfied by an empty answer.
  const empty = backlog({ tasks: 0, rule: true });
  const full = backlog({ tasks: 3, rule: true });

  const emptyList = ask("task-list", empty.dir);
  const fullList = ask("task-list", full.dir);
  assert.deepEqual(emptyList.tasks, []);
  assert.equal(emptyList.total, 0);
  assert.equal(fullList.tasks.length, 3, "the populated fixture did not produce tasks");
  assert.equal(fullList.total, 3);

  assert.equal(ask("stats", empty.dir).stats.total, 0);
  assert.equal(ask("stats", full.dir).stats.total, 3);

  assert.equal(ask("next-id", empty.dir).nextId, 1);
  assert.equal(ask("next-id", empty.dir).max, null, "an empty union must report null, not a number");
  assert.equal(ask("next-id", full.dir).nextId, 4);
  assert.equal(ask("next-id", full.dir).known, 3);

  assert.ok(ask("doctor", full.dir).checks.length > 0, "a diagnosis with no rows proves nothing");
});

test("query --json says how many matched, not just how many it shows", () => {
  // A slice with no `total` reads exactly like a complete answer — the same
  // defect a silent cap in a report is.
  const { dir } = backlog({ tasks: 3 });
  const answer = ask("task-list", dir);
  assert.equal(answer.limit, null, "no --limit means null, not a missing key");

  const limited = JSON.parse(run(["query", "--dir", dir, "--json", "--limit", "1"]).stdout);
  assert.equal(limited.tasks.length, 1);
  assert.equal(limited.total, 3, "the cut is invisible to a machine");
  assert.equal(limited.limit, 1);
});

test("board --json names the rule that decided, and says when nothing did", () => {
  const { dir } = backlog({ tasks: 0, rule: true });
  const matched = JSON.parse(run(["board", "--dir", dir, "--json", "--paths", "docs/guide.md"]).stdout);
  assert.equal(matched.board, "docs");
  assert.equal(matched.isDefault, false);
  assert.equal(matched.rule, "docs/**");
  assert.equal(matched.matched, "docs/guide.md");

  const fallback = JSON.parse(run(["board", "--dir", dir, "--json", "--paths", "src/app.js"]).stdout);
  assert.equal(fallback.board, "main");
  assert.equal(fallback.isDefault, true);
  assert.equal(fallback.rule, null, "a fallback that names a rule invents a decision");
  assert.equal(fallback.matched, null);
});

test("the text output of the single-value commands is unchanged", () => {
  // `next-id` and `board` print one value on the first line so they drop into
  // `$(…)`. The envelope is an ADDITION for machines, not a replacement.
  const { dir } = backlog({ tasks: 2 });
  assert.equal(run(["next-id", "--dir", dir]).stdout.trim(), "3");
  assert.equal(run(["board", "--dir", dir, "--paths", "src/app.js"]).stdout.split("\n")[0], "main");
});

// ── The refusal path (TL-119) ─────────────────────────────────────────────
//
// The path most easily left without an envelope, because it is the one nobody
// tries by hand. A consumer that has to parse stderr to learn WHY it was refused
// has no contract at all — which is the state `take`, `next`, `handoff` and
// `done` were in until this task.

test("a refusal is an envelope too, with the reason in `refusalKind`", () => {
  const { dir } = backlog({ tasks: 0, rule: true });

  const take = run(["take", "NOPE-1", "--actor", "agent:test", "--json", "--dir", dir]);
  const takeOut = JSON.parse(take.stdout);
  assert.equal(takeOut.schemaVersion, 1);
  assert.equal(takeOut.kind, "task-take", "a refusal keeps the kind of the question it answers");
  assert.equal(takeOut.ok, false);
  assert.equal(takeOut.refusalKind, "not-found");
  assert.ok(takeOut.refusal, "the refusal has to carry its own sentence, not only an exit code");
  // The emptiness rule holds on a refusal as well: every key of the kind is
  // present, so a consumer never has to tell "no value" from "old tool".
  for (const key of Object.keys(KINDS["task-take"])) {
    assert.ok(key in takeOut, "missing key on a refusal: " + key);
  }

  const done_ = run(["done", "NOPE-1", "--json", "--dir", dir]);
  const doneOut = JSON.parse(done_.stdout);
  assert.equal(doneOut.kind, "verification-run");
  assert.equal(doneOut.ok, false);
  assert.equal(doneOut.refusalKind, "no-such-task");
  assert.deepEqual(doneOut.entries, [], "nothing ran, and the key is still there");
});

test("an empty queue is an ANSWER in the envelope, not an error and not a bare object", () => {
  const { dir } = backlog({ tasks: 0, rule: true });
  const r = run(["next", "--actor", "agent:test", "--json", "--dir", dir]);
  assert.equal(r.status, 3, "3 is `nothing to take` — neither a refusal nor a usage error");
  const out = JSON.parse(r.stdout);
  assert.equal(out.kind, "task-take");
  assert.equal(out.refusalKind, "nothing-to-take");
  // The distinction a loop cannot make from prose: nothing there, versus
  // something there it was not allowed to take.
  assert.deepEqual(out.passedOver, []);
  assert.ok(Array.isArray(out.searchedStatuses) && out.searchedStatuses.length);
});
