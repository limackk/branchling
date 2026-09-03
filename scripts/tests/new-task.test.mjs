/**
 * `branchling new` (BL-1413).
 *
 * The risk in this command is the NUMBER. The rule is "never max+1 from your own
 * tree", because another session holds the next id on its branch before any file
 * exists — two tasks with the same number are a conflict that only surfaces at
 * merge time. Hence:
 *
 *   - the number comes from a scan of ALL branches and worktrees (next-backlog-id),
 *   - when that scan does not work (a fresh backlog with not a single task file, a
 *     directory outside a repository), a local fallback scan takes over — and the
 *     command SAYS it went down that path, because a local max+1 is exactly what
 *     the rule warns against,
 *   - the write is exclusive (`wx`): a collision ends in an error, never an overwrite.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ACTOR_ENV } from "../actor.mjs";
import { FIELD_CREATED, historyPath, readHistory } from "../history.mjs";
import { slugify } from "../new-task.mjs";
import { DEFAULT_TASK_ID_PREFIX as P, taskIdPatterns } from "../task-id.mjs";

import { isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("new-task");

// The patterns come from the tool's own FUNCTIONS, not retyped in the test — a
// bywa cichym „prawie tym samym" (BL-1452).
const PAT = taskIdPatterns(P);

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");

// TWO ACTORS, because one would prove nothing (TL-187). The defect is not only
// a missing entry, it is an entry written LATER by whoever reconciled first —
// under their name. A test running everything as the same actor cannot tell the
// two apart. The variable is named by the tool, not retyped here: `new` has no
// `--actor` flag, and the second link of the chain is where a test may state
// one without demanding a flag the command does not have.
const CREATOR = "local:who-ran-new";
const PROBE = "local:who-ran-take";

function run(args, cwd, env) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 30_000, cwd: cwd || undefined,
    env: env ? Object.assign({}, process.env, env) : process.env,
  });
}

/** A fresh backlog created by `init` — outside a git repository.
 *  `--no-example` (TL-64), because these tests are about NUMBERING and the
 *  frontmatter: the example task would take number 1 and the assertions would be
 *  about it rather than about the write. */
function freshBacklog() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-new-"));
  const r = run(["init", "--dir", dir, "--no-example"]);
  assert.equal(r.status, 0, r.stderr);
  return dir;
}

function tasksIn(dir) {
  return readdirSync(join(dir, "tasks")).filter((f) => PAT.file.test(f));
}

// ── slug (pure) ───────────────────────────────────────────────────────────

test("slug: accented letters fold down to ASCII, they do not disappear", () => {
  // The input is deliberately non-ASCII — that is what this feature exists for.
  // language-guard: allow
  assert.equal(slugify("Zażółć gęślą jaźń"), "zazolc-gesla-jazn");
  assert.equal(slugify("Send the report to the auditor"), "send-the-report-to-the-auditor");
});

test("slug: punctuation and spaces fold down to single dashes", () => {
  assert.equal(slugify("  Fix:  the   thing!!  "), "fix-the-thing");
  assert.equal(slugify("A/B — test (v2)"), "a-b-test-v2");
});

test("slug: it neither ends nor starts with a dash", () => {
  assert.equal(slugify("--- x ---"), "x");
  assert.equal(slugify("!!!"), "", "a title of pure punctuation gives an empty slug, not a dash");
});

test("slug: it is trimmed, but not in the middle of a word", () => {
  const s = slugify("a".repeat(20) + " " + "b".repeat(20) + " " + "c".repeat(20) + " " + "d".repeat(20));
  assert.ok(s.length <= 60, "the slug has " + s.length + " characters");
  assert.ok(!s.endsWith("-"), "the trim left a dash at the end");
});

// ── Tworzenie taska ───────────────────────────────────────────────────────

test("new creates a file with a number, a slug and a filled-in frontmatter", () => {
  const dir = freshBacklog();
  try {
    // language-guard: allow — accented input is the point of the slug test
    const r = run(["new", "--dir", dir, "--title", "Zażółć gęślą jaźń"]);
    assert.equal(r.status, 0, r.stderr);
    const files = tasksIn(dir);
    assert.equal(files.length, 1);
    assert.match(files[0], new RegExp(PAT.fileId.source + "-zazolc-gesla-jazn\\.md$"));

    const text = readFileSync(join(dir, "tasks", files[0]), "utf8");
    const id = files[0].match(PAT.fileId)[1];
    assert.match(text, new RegExp("^id: " + id + "$", "m"), "the id in the file does not match the filename");
    // language-guard: allow
    assert.match(text, /^title: "Zażółć gęślą jaźń"$/m);
    // FRONTMATTER only. The body may legitimately SHOW a date format in prose, and
    // a whole-file assertion would read that as an unfilled field. The placeholders
    // this test is about are frontmatter values `new` is supposed to have replaced.
    const frontmatter = text.split("---")[1];
    assert.ok(!frontmatter.includes(`${P}-NNN`), "a placeholder from the template was left in the file");
    assert.ok(!frontmatter.includes("YYYY-MM-DD"), "the dates were not filled in");
    assert.match(r.stdout, new RegExp(files[0].replace(".", "\\.")), "the command did not say what it created");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("new: the first task in an empty backlog gets number 1 and does not blow up", () => {
  const dir = freshBacklog();
  try {
    const r = run(["new", "--dir", dir, "--title", "First"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(tasksIn(dir)[0], new RegExp("^" + P + "-1-"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("new: a fallback local number is ANNOUNCED, not silent", () => {
  // A local max+1 is exactly what the rule warns against: another branch may
  // already hold that number. Since this cannot be checked, it has to be SAID.
  const dir = freshBacklog();
  try {
    const r = run(["new", "--dir", dir, "--title", "Drugi"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout + r.stderr, /LOCAL/i, "silence about the worse source of the number");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("new: subsequent tasks get subsequent numbers", () => {
  const dir = freshBacklog();
  try {
    run(["new", "--dir", dir, "--title", "Jeden"]);
    run(["new", "--dir", dir, "--title", "Dwa"]);
    const nums = tasksIn(dir).map((f) => parseInt(f.match(PAT.fileNumber)[1], 10)).sort((a, b) => a - b);
    assert.deepEqual(nums, [1, 2]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("new: it does NOT overwrite a file if the number turned out to be taken", () => {
  const dir = freshBacklog();
  try {
    // Number 1 taken by a file with a DIFFERENT slug — a collision of number, not name.
    writeFileSync(join(dir, "tasks", `${P}-1-cudzy.md`), `---
id: ${P}-1
---
`, "utf8");
    run(["new", "--dir", dir, "--title", "Moj"]);
    assert.equal(readFileSync(join(dir, "tasks", `${P}-1-cudzy.md`), "utf8"), `---
id: ${P}-1
---
`,
      "somebody else's task was overwritten");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("new: without --title it FAILS — a task with no title is useless", () => {
  const dir = freshBacklog();
  try {
    const r = run(["new", "--dir", dir]);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /--title/);
    assert.equal(tasksIn(dir).length, 0, "a file was created despite the error");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("new: a title with not one letter FAILS instead of giving a `BL-7-.md`", () => {
  const dir = freshBacklog();
  try {
    const r = run(["new", "--dir", dir, "--title", "!!!"]);
    assert.notEqual(r.status, 0);
    assert.equal(tasksIn(dir).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Validating values against the VOCABULARIES ────────────────────────────

test("new: a priority from outside the configuration FAILS and lists the allowed ones", () => {
  const dir = freshBacklog();
  try {
    const r = run(["new", "--dir", dir, "--title", "X", "--priority", "P9"]);
    assert.notEqual(r.status, 0);
    const out = r.stdout + r.stderr;
    assert.match(out, /P9/);
    assert.match(out, /P0/, "the message does not give the allowed values");
    assert.equal(tasksIn(dir).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("new: a board outside the registry FAILS — the board vocabulary is CLOSED", () => {
  const dir = freshBacklog();
  try {
    const r = run(["new", "--dir", dir, "--title", "X", "--board", "nieistnieje"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /nieistnieje/);
    assert.equal(tasksIn(dir).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("new: with no --board it takes the registry DEFAULT and says so", () => {
  const dir = freshBacklog();
  try {
    const r = run(["new", "--dir", dir, "--title", "X"]);
    assert.equal(r.status, 0, r.stderr);
    const text = readFileSync(join(dir, "tasks", tasksIn(dir)[0]), "utf8");
    assert.match(text, /^board: main$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("new: the values given reach the frontmatter", () => {
  const dir = freshBacklog();
  try {
    const r = run(["new", "--dir", dir, "--title", "X", "--priority", "P0",
      "--estimate", "1d", "--epic", "Jakis epic", "--owner", "unassigned"]);
    assert.equal(r.status, 0, r.stderr);
    const text = readFileSync(join(dir, "tasks", tasksIn(dir)[0]), "utf8");
    assert.match(text, /^priority: P0$/m);
    assert.match(text, /^estimate: 1d$/m);
    assert.match(text, /^epic: "Jakis epic"$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("new: an unknown flag FAILS, as in every other command", () => {
  const dir = freshBacklog();
  try {
    const r = run(["new", "--dir", dir, "--title", "X", "--titel", "Y"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /--titel/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("new: the created task PASSES the guards and enters the views", () => {
  // The strongest assertion: not "the file exists" but "the rest of the tool accepts it".
  const dir = freshBacklog();
  try {
    assert.equal(run(["new", "--dir", dir, "--title", "Cos do zrobienia"]).status, 0);
    // The whole run is in the message. This assertion was one of the two that
    // failed intermittently (TL-163), and `1 !== 0` said nothing about which
    // guard did it — which is how a reproducible cause stayed a guess.
    const guards = run(["check", "--dir", dir]);
    assert.equal(guards.status, 0,
      "the guards rejected a freshly created task\n" + guards.stdout + guards.stderr);
    assert.equal(run(["build", "--dir", dir]).status, 0, "build did not pass");
    assert.ok(existsSync(join(dir, "INDEX.yaml")));
    assert.match(readFileSync(join(dir, "INDEX.yaml"), "utf8"), /Cos do zrobienia/);
    const stats = JSON.parse(run(["stats", "--dir", dir, "--json"]).stdout);
    assert.equal(stats.stats.active, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── the template's banner does not travel into a task (TL-165) ────────────

test("new: the created task does not carry the template's own banner", () => {
  // Reproduced in a fresh backlog, exactly as TL-165 reports it: `init` writes a
  // template whose first lines describe what a template IS, and every task made
  // from it opened by calling itself the file tasks are copied from.
  const dir = freshBacklog();
  try {
    const template = readFileSync(join(dir, "_template.md"), "utf8");
    assert.match(template.split("\n")[1] || "", /^#/,
      "the template `init` wrote has no banner — this case is not being tested");

    assert.equal(run(["new", "--dir", dir, "--title", "Banner probe"]).status, 0);
    const file = join(dir, "tasks", readdirSync(join(dir, "tasks")).find((f) => f.endsWith(".md")));
    const text = readFileSync(file, "utf8");

    assert.equal(text.split("\n")[1], "id: TASK-1", "the banner is still the task's first line");
    assert.equal(text.includes("TASK TEMPLATE"), false);

    // THE POSITIVE CONTROL, and the half that matters: a note beside a FIELD is
    // about that field and belongs in every task. A fix that stripped every
    // comment would pass the assertions above and destroy the annotations.
    assert.match(text, /^blocked_by: \[\][^\n]*#/m,
      "the note beside `blocked_by` was deleted with the banner");

    // And the file is still a task the rest of the tool accepts.
    assert.equal(run(["check", "--dir", dir]).status, 0);
    assert.equal(run(["build", "--dir", dir]).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("new: a template whose values drift from the vocabulary is still REFUSED", () => {
  // `templateDrift()` reads the template before the write, and it reads the file
  // on disk — banner and all. Stripping happens on the copy, so the guard must
  // be untouched by it (TL-69 is what makes this refusal exist at all).
  const dir = freshBacklog();
  try {
    const path = join(dir, "_template.md");
    writeFileSync(path, readFileSync(path, "utf8").replace(/^status: .*$/m, "status: nonsense"), "utf8");
    const r = run(["new", "--dir", dir, "--title", "Drifting"]);
    assert.notEqual(r.status, 0, "a template offering a value outside the vocabulary was accepted");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── the task's birth reaches the history (TL-187) ─────────────────────────

test("new: the creation is recorded in the history, under the actor that created it", () => {
  // TL-182 named this defect and was closed without a line of code changing,
  // because its contract was two suites that pass whether or not `new` records
  // anything — the zero-sample guard CLAUDE.md warns about. This is the
  // assertion that could not have been green then.
  const dir = freshBacklog();
  try {
    const r = run(["new", "--dir", dir, "--title", "Recorded at birth"], null, { [ACTOR_ENV]: CREATOR });
    assert.equal(r.status, 0, r.stderr);
    const id = tasksIn(dir)[0].match(PAT.fileId)[1];

    // MEASURED HERE, judged below. Everything after this line writes to the same
    // log, so the state at the moment `new` returned has to be taken now or not
    // at all.
    const loggedAtBirth = existsSync(historyPath(dir, id));
    const atBirth = readHistory(dir, id);

    // THE POSITIVE CONTROL, and it runs BEFORE the assertions it protects. An
    // empty log is not evidence on its own: a fixture outside a git repository,
    // an isolated home, a `--dir` some writer resolves differently — each
    // produces exactly the silence the defect produces. `take` is a writing
    // command in the same tree, given the same flags; its entries have to be
    // there before the absence of another one means anything.
    const probe = run(["take", id, "--dir", dir], null, { [ACTOR_ENV]: PROBE });
    assert.equal(probe.status, 0, probe.stderr);
    const taken = readHistory(dir, id).find((e) => e.field === "status");
    assert.ok(taken, "no command records history in this fixture — the measurement is broken, not `new`");
    assert.equal(taken.actor, PROBE, "the apparatus does not carry the actor either");

    // And now the thesis.
    assert.ok(loggedAtBirth, "`new` left no history file for the task it had just created");
    const created = atBirth.find((e) => e.field === FIELD_CREATED);
    assert.ok(created, "the task's birth is in no log — whoever reconciles first will sign it");
    // The ACTOR is half the point (TL-182): an entry written later by another
    // tree's reconcile would name that tree, not the person who typed `new`.
    assert.equal(created.actor, CREATOR, "the creation is attributed to somebody who did not create it");
    assert.equal(created.from, "");
    // The shape `seed` and `import` already write for this field, not a new one.
    assert.equal(created.to, "Recorded at birth", "a `__created__` entry carries the task's title");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
