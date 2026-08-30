/**
 * `worktrail new` (BL-1413).
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

import { slugify } from "../new-task.mjs";
import { DEFAULT_TASK_ID_PREFIX as P, taskIdPatterns } from "../task-id.mjs";

// The patterns come from the tool's own FUNCTIONS, not retyped in the test — a
// bywa cichym „prawie tym samym" (BL-1452).
const PAT = taskIdPatterns(P);

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");

function run(args, cwd) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 30_000, cwd: cwd || undefined,
  });
}

/** A fresh backlog created by `init` — outside a git repository.
 *  `--no-example` (TL-64), because these tests are about NUMBERING and the
 *  frontmatter: the example task would take number 1 and the assertions would be
 *  about it rather than about the write. */
function freshBacklog() {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-new-"));
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
    assert.equal(run(["check", "--dir", dir]).status, 0, "the guards rejected a freshly created task");
    assert.equal(run(["build", "--dir", dir]).status, 0, "build did not pass");
    assert.ok(existsSync(join(dir, "INDEX.yaml")));
    assert.match(readFileSync(join(dir, "INDEX.yaml"), "utf8"), /Cos do zrobienia/);
    const stats = JSON.parse(run(["stats", "--dir", dir, "--json"]).stdout);
    assert.equal(stats.stats.active, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
