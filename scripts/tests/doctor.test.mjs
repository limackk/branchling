/**
 * `branchling doctor` (TL-62).
 *
 * EVERY ROW HAS ITS OWN POSITIVE CONTROL. A diagnosis that is green on a healthy
 * tree prints nothing but ticks is green with no evidential force — and this is a
 * whose entire value lies in being able to say "no". So for each check there is a
 * scenario here in which it MUST go red, next to a scenario in which it has to
 * stay quiet.
 *
 * THE SECOND ASSERTION, EASY TO MISS: `doctor` fixes nothing. A command that
 * "while it is here" corrects somebody's configuration stops being a diagnosis.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isolateHome } from "./_repo.mjs";
import { followRepair } from "./_follow-repair.mjs";
import { checkTemplate, templateFields } from "../doctor.mjs";
import { HOOK_NAME, COMMIT_MESSAGE_HOOK_NAME, hookBlock, hooksTarget } from "../hooks-command.mjs";
import { BLOCK_OPEN } from "../git-rules.mjs";
import { canonicalPath } from "../canonical-path.mjs";
import { PRODUCT_NAME } from "../product.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("doctor");

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");

function run(cwd, args) {
  return spawnSync(process.execPath, [CLI].concat(args), { cwd, encoding: "utf8", timeout: 60_000 });
}

function repo(initArgs) {
  const dir = fixtureDir(join(tmpdir(), "branchling-doctor-"));
  assert.equal(spawnSync("git", ["init", "-q", "."], { cwd: dir }).status, 0);
  assert.equal(run(dir, ["init", "--dir", "."].concat(initArgs || [])).status, 0);
  return dir;
}

/** The diagnosis rows keyed by `id` — the assertions have to ask about the CHECK, not about the layout of the text. */
function rows(dir) {
  const r = run(dir, ["doctor", "--json"]);
  const parsed = JSON.parse(r.stdout);
  for (const c of parsed.checks) {
    assert.ok(c && typeof c === "object" && typeof c.id === "string" && c.title, "a check row without an id or title: " + JSON.stringify(c));
  }
  const byId = {};
  for (const c of parsed.checks) byId[c.id] = c;
  return { status: r.status, ok: parsed.ok, next: parsed.next, byId, raw: parsed };
}

function newTask(dir, title) {
  const r = run(dir, ["new", "--title", title]);
  assert.equal(r.status, 0, r.stderr);
}

// ── A healthy tree ────────────────────────────────────────────────────────

test("a fresh backlog passes in full", () => {
  const dir = repo();
  const d = rows(dir);
  assert.equal(d.status, 0, "doctor fails on a freshly created backlog");
  assert.equal(d.ok, true);
  const errors = d.raw.checks.filter((c) => c.status === "error");
  assert.deepEqual(errors, [], "errors on a clean tree: " + JSON.stringify(errors));
});

test("an empty backlog points at `new`, a non-empty one at the viewer", () => {
  const dir = repo(["--no-example"]);
  assert.match(rows(dir).next, /new --title/);
  newTask(dir, "Cokolwiek");
  assert.doesNotMatch(rows(dir).next, /new --title/);
});

// ── A positive control for every row ──────────────────────────────────────

test("a broken configuration: the `config` row is red, the rest honestly unchecked", () => {
  const dir = repo();
  appendFileSync(join(dir, "config.yaml"), "statusess: [a]\n", "utf8");
  const d = rows(dir);
  assert.equal(d.status, 1);
  assert.equal(d.byId.config.status, "error");
  assert.match(d.byId.config.detail, /statusess/);
  // Counting under a vocabulary we do not know would answer a different question.
  assert.equal(d.byId.vocabulary.status, "info");
  assert.match(d.byId.vocabulary.detail, /not checked/);
});

test("a value outside the vocabulary: the `vocabulary` row goes red and names the field", () => {
  const dir = repo();
  newTask(dir, "A task");
  const f = join(dir, "tasks", readdirSync(join(dir, "tasks")).filter((f) => f.endsWith(".md"))[0]);
  writeFileSync(f, readFileSync(f, "utf8").replace(/^status: .*$/m, "status: wymyslony"), "utf8");

  const d = rows(dir);
  assert.equal(d.byId.vocabulary.status, "error");
  assert.match(d.byId.vocabulary.detail, /`status`/);
  assert.match(d.byId.vocabulary.detail, /wymyslony/);
  assert.equal(d.status, 1);
});

test("a prefix mismatch: the `prefix` row is red and names migrate-prefix", () => {
  const dir = repo();
  newTask(dir, "A task");
  const p = join(dir, "config.yaml");
  writeFileSync(p, readFileSync(p, "utf8").replace(/^task_id_prefix: .*$/m, "task_id_prefix: INNY"), "utf8");

  const d = rows(dir);
  assert.equal(d.byId.prefix.status, "error");
  assert.match(d.byId.prefix.fix, /migrate-prefix --to INNY/);
});

test("views that are not ignored: the `git-ignore` row is red", () => {
  const dir = fixtureDir(join(tmpdir(), "branchling-doctor-"));
  spawnSync("git", ["init", "-q", "."], { cwd: dir });
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n", "utf8");
  run(dir, ["init", "--dir", ".", "--no-gitignore"]);

  const d = rows(dir);
  assert.equal(d.byId["git-ignore"].status, "error");
  assert.match(d.byId["git-ignore"].detail, /INDEX\.yaml/);
  assert.equal(d.status, 1);
});

test("a view already tracked: a separate row with `git rm --cached`", () => {
  const dir = repo();
  writeFileSync(join(dir, "INDEX.yaml"), "tasks: []\n", "utf8");
  spawnSync("git", ["add", "-f", "INDEX.yaml"], { cwd: dir });
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x"], { cwd: dir });

  const d = rows(dir);
  assert.equal(d.byId["git-tracked"].status, "error");
  assert.match(d.byId["git-tracked"].fix, /git rm --cached/);
});

test("a failing guard: the `guards` row is red", () => {
  const dir = repo();
  newTask(dir, "A task");
  const f = join(dir, "tasks", readdirSync(join(dir, "tasks")).filter((f) => f.endsWith(".md"))[0]);
  // The pattern allows a comment at the end of the line: the template has one, and
  // a test about a DANGLING REFERENCE should not fail because a field's
  // explanation changed.
  writeFileSync(f, readFileSync(f, "utf8").replace(/^blocked_by: \[\].*$/m, "blocked_by: [TASK-999]"), "utf8");

  const d = rows(dir);
  assert.equal(d.byId.guards.status, "error");
  assert.equal(d.status, 1);
});

test("the absence of a git repository is information, not an error", () => {
  const dir = fixtureDir(join(tmpdir(), "branchling-doctor-nogit-"));
  run(dir, ["init", "--dir", "."]);
  const d = rows(dir);
  assert.equal(d.byId["git-repo"].status, "info");
  assert.equal(d.byId["git-hooks"], undefined, "outside a repository there is no gate to report");
  assert.equal(d.status, 0, "the absence of git must not fail — a backlog outside a repository is a supported state");
});

// ── Copied files that lag behind this release (TL-588) ────────────────────

const SHIPPED_TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "_template.md");

/** Drop the named top-level keys from a backlog's template, as an earlier
 *  release that never shipped them would have left it. */
function dropTemplateKeys(dir, keys) {
  const p = join(dir, "_template.md");
  const before = readFileSync(p, "utf8");
  const after = before.split("\n").filter((l) => !keys.some((k) => l.startsWith(k + ":"))).join("\n");
  assert.notEqual(after, before, "the fixture removed nothing — the shipped template no longer has " + keys.join(", "));
  writeFileSync(p, after, "utf8");
}

test("a template missing shipped fields is INFO naming each with its comment, and the command that adds them", () => {
  const dir = repo();
  dropTemplateKeys(dir, ["release", "target"]);
  const d = rows(dir);
  const row = d.byId.template;
  assert.equal(row.status, "info");
  assert.equal(row.title, "task template fields");
  assert.match(row.detail, /^missing `release`: the release it is PLANNED for \(a value from `releases:` in config\.yaml\)\. Empty = none; `target`: the deploy targets in ANOTHER repository [^;]*\. The writing/);
  assert.doesNotMatch(row.detail, /conflict_group|`title`/, "a field the template still has is not missing");
  assert.match(row.detail, /add them on demand/);
  assert.equal(row.fix, PRODUCT_NAME + " template refresh   # inserts those lines and changes none of yours");
  assert.equal(d.status, 0, "a lagging template must not fail doctor");
});

test("one missing field is named in the singular", () => {
  const dir = repo();
  dropTemplateKeys(dir, ["conflict_group"]);
  const row = rows(dir).byId.template;
  assert.match(row.detail, /^missing `conflict_group`: the AREA it touches [^;]*\. The writing commands add it on demand/);
  assert.match(row.fix, / template refresh {3}# inserts that line and changes none of yours$/);
});

test("a missing field without a comment is named bare", () => {
  const dir = repo();
  dropTemplateKeys(dir, ["priority"]);
  assert.match(rows(dir).byId.template.detail, /^missing `priority`\. The writing/);
});

test("a template that cannot be compared says so instead of passing", () => {
  const dir = repo();
  const missingShipped = checkTemplate(dir, { shipped: join(dir, "no-such-template.md") });
  assert.deepEqual([missingShipped.id, missingShipped.status, missingShipped.detail],
    ["template", "info", "not checked — the packaged template is missing: " + join(dir, "no-such-template.md")]);
  rmSync(join(dir, "_template.md"));
  const missingOwn = checkTemplate(dir);
  assert.deepEqual([missingOwn.id, missingOwn.status, missingOwn.detail], ["template", "info", "not checked — this backlog has no _template.md"]);
});

/** The lines of one top-level key in the shipped template, its nested value
 *  included — read here by hand, not with the module under test. */
function shippedBlock(key) {
  const lines = readFileSync(SHIPPED_TEMPLATE, "utf8").split("\n");
  const start = lines.findIndex((l) => l.startsWith(key + ":"));
  assert.ok(start > 0, "the shipped template no longer has " + key);
  let end = start + 1;
  while (/^\s+\S/.test(lines[end])) end++;
  return lines.slice(start, end);
}

test("running the printed fix adds exactly the missing lines, in shipped order, and turns the row OK (TL-595)", () => {
  const dir = repo();
  const p = join(dir, "_template.md");
  const fresh = readFileSync(p, "utf8").split("\n");
  // An earlier release's template, edited by its project: two consecutive
  // fields, one alone, and one with a nested value are gone; a default, a
  // comment and a field of the project's own are not the shipped ones.
  const drop = new Set(["release", "target", "conflict_group", "verification"]);
  const lagging = [];
  let skipping = false;
  for (const line of fresh) {
    const key = /^([a-z_]+):/.exec(line);
    if (key) skipping = drop.has(key[1]);
    else if (!/^\s/.test(line)) skipping = false;
    if (!skipping) lagging.push(line);
  }
  const edited = lagging.map((l) => (l.startsWith("priority:") ? "priority: P3   # OUR default" : l));
  edited.splice(edited.findIndex((l) => l.startsWith("type:")) + 1, 0, "squad: \"\"   # our own field");
  writeFileSync(p, edited.join("\n"), "utf8");

  const before = rows(dir).byId.template;
  assert.equal(before.status, "info");
  assert.match(before.detail, /^missing `release`: [^;]*; `target`: [^;]*; `conflict_group`: [^;]*; `verification`: /);
  const [command, ...args] = before.fix.split("#")[0].trim().split(/\s+/);
  assert.equal(command, PRODUCT_NAME);
  const r = run(dir, args);
  assert.equal(r.status, 0, r.stdout + r.stderr);

  // The expected text, built by inserting each shipped block after the line
  // it must follow — every other line is the edited template's, unchanged.
  const expected = edited.slice();
  const insertAfter = (anchor, lines) => expected.splice(expected.findIndex((l) => l.startsWith(anchor + ":")) + 1, 0, ...lines);
  insertAfter("epic", shippedBlock("release").concat(shippedBlock("target")));
  insertAfter("executor", shippedBlock("conflict_group"));
  insertAfter("related_docs", shippedBlock("verification"));
  assert.equal(shippedBlock("verification").length, 3, "the nested value of verification is part of what is copied");
  assert.equal(readFileSync(p, "utf8"), expected.join("\n"));

  const after = rows(dir).byId.template;
  assert.equal(after.status, "ok", after.detail);
  assert.equal(after.fix, null);
});

// ── A fix printed by `doctor --dir` acts on the backlog doctor examined (TL-615)

/** The diagnosis of `dir`, asked from `cwd` with `--dir` — the case where a fix
 *  without the flag resolves some other backlog, or none. */
function rowsFrom(cwd, dir) {
  const r = run(cwd, ["doctor", "--dir", dir, "--json"]);
  const parsed = JSON.parse(r.stdout);
  return { next: parsed.next, byId: Object.fromEntries(parsed.checks.map((c) => [c.id, c])) };
}

/** A printed fix as an argument vector: the comment dropped, the product name checked and removed. */
function fixArgs(fix) {
  const [command, ...args] = fix.split("#")[0].trim().split(/\s+/);
  assert.equal(command, PRODUCT_NAME, "a fix of ours that does not start with the product name: " + fix);
  return args;
}

test("a fix printed by doctor --dir, run from the same unrelated cwd, repairs the backlog doctor examined", () => {
  const dir = repo();
  dropTemplateKeys(dir, ["release"]);
  // Not a backlog, not inside one and not a repository: from here only --dir finds `dir`.
  const elsewhere = fixtureDir(join(tmpdir(), "branchling-doctor-elsewhere-"));

  const before = rowsFrom(elsewhere, dir).byId.template;
  assert.equal(before.status, "info");
  assert.equal(before.fix, PRODUCT_NAME + " template refresh --dir " + dir + "   # inserts that line and changes none of yours");
  const args = fixArgs(before.fix);

  // CONTROL: the same command without the --dir doctor was given repairs nothing.
  const at = args.indexOf("--dir");
  const bare = args.slice(0, at).concat(args.slice(at + 2));
  assert.deepEqual(bare, ["template", "refresh"]);
  assert.notEqual(run(elsewhere, bare).status, 0, "without --dir the fix found a backlog from an unrelated cwd");
  assert.equal(rowsFrom(elsewhere, dir).byId.template.status, "info", "the fix without --dir changed the backlog doctor examined");

  const r = run(elsewhere, args);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const after = rowsFrom(elsewhere, dir).byId.template;
  assert.equal(after.status, "ok", after.detail);
});

test("doctor --dir puts --dir on its own commands only; a git command or a line to add is printed as it is", () => {
  const dir = repo();
  writeFileSync(join(dir, "INDEX.yaml"), "tasks: []\n", "utf8");
  spawnSync("git", ["add", "-f", "INDEX.yaml"], { cwd: dir });
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x"], { cwd: dir });
  writeFileSync(join(dir, ".gitattributes"), "", "utf8");
  const elsewhere = fixtureDir(join(tmpdir(), "branchling-doctor-elsewhere-"));
  const d = rowsFrom(elsewhere, dir);

  assert.equal(d.byId["git-tracked"].fix, "git rm --cached INDEX.yaml");
  assert.match(d.byId["git-merge"].fix, /^add to \.gitattributes: /);
  assert.doesNotMatch(d.byId["git-merge"].fix, /--dir/);
  assert.equal(d.byId["git-hooks"].fix, PRODUCT_NAME + " hooks print --dir " + dir);
  assert.equal(d.next, PRODUCT_NAME + " doctor --dir " + dir + "   # once it is fixed");

  // Without --dir nothing is added: the fix is run where doctor found the backlog.
  const plain = rows(dir);
  assert.equal(plain.byId["git-hooks"].fix, PRODUCT_NAME + " hooks print");
  assert.equal(plain.next, PRODUCT_NAME + " doctor   # once it is fixed");
});

test("a --dir that needs quoting is printed as one shell word", () => {
  const parent = fixtureDir(join(tmpdir(), "branchling-doctor-"));
  const dir = join(parent, "it's a backlog");
  assert.equal(spawnSync("git", ["init", "-q", dir]).status, 0);
  assert.equal(run(dir, ["init", "--dir", "."]).status, 0);
  dropTemplateKeys(dir, ["release"]);
  const fix = rowsFrom(parent, dir).byId.template.fix;
  assert.equal(fix, PRODUCT_NAME + " template refresh --dir '" + dir.replace(/'/g, "'\\''") + "'   # inserts that line and changes none of yours");
  // The shell reads it back as the one path doctor was given.
  const r = spawnSync("sh", ["-c", "printf '%s' " + fix.split(" --dir ")[1].split("   #")[0]], { encoding: "utf8" });
  assert.equal(r.stdout, dir);
});

test("a template without a closed frontmatter is reported as not checked, not as missing every field", () => {
  const dir = repo();
  writeFileSync(join(dir, "_template.md"), "## Goal\n", "utf8");
  const row = rows(dir).byId.template;
  assert.equal(row.status, "info");
  assert.equal(row.detail, "not checked — the template has no frontmatter: its first line is not `---`");
  assert.match(row.fix, /^make .*_template\.md open and close its frontmatter with `---` lines$/);
});

test("positive control: a fresh template, or one with a field of the project's own, is current", () => {
  const dir = repo();
  assert.equal(rows(dir).byId.template.status, "ok");
  assert.equal(rows(dir).byId.template.detail, "every field this release ships is in _template.md");
  const p = join(dir, "_template.md");
  writeFileSync(p, readFileSync(p, "utf8").replace(/^type: task$/m, "type: task\nsquad: \"\"   # ours"), "utf8");
  const row = rows(dir).byId.template;
  assert.equal(row.status, "ok", "a field the project added is not a lag: " + row.detail);
  assert.equal(row.fix, null);
});

test("templateFields reads top-level keys with their comments, not nested ones", () => {
  const fields = templateFields("---\nid: X   # the id\ntitle: \"a # b\"\nepic: 'c # d'   # free text\n" +
    "board: a#b\nverification:\n  - id: n   # nested\n---\nbody: no\n");
  assert.deepEqual(fields, [
    { key: "id", comment: "the id" },
    { key: "title", comment: "" },
    { key: "epic", comment: "free text" },
    { key: "board", comment: "" },
    { key: "verification", comment: "" },
  ]);
  assert.deepEqual(templateFields("id: X\nkey: y\n"), [], "text without frontmatter has no fields");
  assert.deepEqual(templateFields("--- \nid: X   #tight  \nlabels:   # a list\n--- \nbody: no\n"), [
    { key: "id", comment: "tight" },
    { key: "labels", comment: "a list" },
  ], "markers with trailing spaces, a comment with no space after `#`, a comment as the whole value");
  // The shipped template is the reference every backlog is compared with; an
  // empty reading of it would report nothing and pass every test above.
  const shipped = templateFields(readFileSync(SHIPPED_TEMPLATE, "utf8")).map((f) => f.key);
  for (const key of ["id", "release", "target", "conflict_group", "verification"]) assert.ok(shipped.includes(key), key);
});

function installHooks(dir) {
  const r = run(dir, ["hooks", "install"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
}

function editGate(dir, name, from, to) {
  const p = hooksTarget(dir, name).path;
  const before = readFileSync(p, "utf8");
  assert.ok(before.includes(from), "the fixture's gate line is not in " + name);
  writeFileSync(p, before.replace(from, to), "utf8");
  return p;
}

test("an installed hook block whose text differs from hookBlock() is a WARN naming `hooks install`", () => {
  const dir = repo();
  installHooks(dir);
  editGate(dir, HOOK_NAME, "check || exit 1", "check --old-flag || exit 1");
  const d = rows(dir);
  const row = d.byId["git-hooks-current"];
  assert.equal(row.status, "warn");
  assert.equal(row.title, "git gates are current");
  assert.match(row.detail, /^pre-commit carries a block that differs from the one this release writes — a change to the gate never reached it$/);
  assert.match(row.fix, /^branchling hooks install /);
  assert.equal(d.byId["git-hooks"].status, "ok", "the gate is still installed; only its text lags");
  assert.equal(d.status, 0);

  // The command it names is the repair: afterwards the block is the current one.
  installHooks(dir);
  assert.equal(rows(dir).byId["git-hooks-current"], undefined);
  assert.ok(readFileSync(hooksTarget(dir).path, "utf8").includes(hookBlock(HOOK_NAME)));
});

test("two stale blocks are named in the plural", () => {
  const dir = repo();
  installHooks(dir);
  editGate(dir, HOOK_NAME, "check || exit 1", "check --old || exit 1");
  editGate(dir, COMMIT_MESSAGE_HOOK_NAME, "commit-message", "commit-msg-old");
  const row = rows(dir).byId["git-hooks-current"];
  assert.match(row.detail, /^pre-commit, commit-msg carry blocks that differ from the one this release writes — a change to the gate never reached them$/);
});

test("a stale block beside a hook of the user's own names the paste, since install would refuse", () => {
  const dir = repo();
  installHooks(dir);
  writeFileSync(hooksTarget(dir, HOOK_NAME).path, "#!/bin/sh\nnpm test\n", "utf8");
  editGate(dir, COMMIT_MESSAGE_HOOK_NAME, "commit-message", "commit-msg-old");
  const row = rows(dir).byId["git-hooks-current"];
  assert.equal(row.status, "warn");
  assert.match(row.detail, /^commit-msg carries/);
  assert.equal(rows(dir).byId["git-hooks"].detail,
    "pre-commit (a hook of your own, without ours) — the guards run only when somebody remembers");
  assert.match(row.fix, /^branchling hooks print   # pre-commit is your own hook, so `hooks install` refuses; replace our block in commit-msg by hand$/);
  assert.equal(run(dir, ["hooks", "install"]).status, 1, "the premise: install refuses beside a foreign hook");
});

/** Our block with its closing marker cut off — `hooks install` refuses this
 *  file. Returns the path as doctor spells it: on macOS the temporary directory
 *  is `/var/…` to Node and `/private/var/…` to git. */
function unclose(dir, name) {
  const p = hooksTarget(dir, name).path;
  writeFileSync(p, "#!/bin/sh\n" + hookBlock(name).split("\n").slice(0, -1).join("\n") + "\n", "utf8");
  return canonicalPath(p);
}

/** The span doctor names for an unclosed block written by `unclose()`. */
const SPAN = "lines 2–5 (`" + BLOCK_OPEN + "` through its gate line)";

test("following doctor's repair for an unclosed block keeps the user's lines after it (TL-609)", () => {
  const dir = repo();
  installHooks(dir);
  const p = hooksTarget(dir, HOOK_NAME).path;
  const theirs = "\n# theirs, after the block\nnpm test || exit 1\n./scripts/lint.sh\n";
  const stale = hookBlock(HOOK_NAME).replace("check || exit 1", "check --old || exit 1");
  writeFileSync(p, "#!/bin/sh\n" + stale.split("\n").slice(0, -1).join("\n") + theirs, "utf8");
  const row = rows(dir).byId["git-hooks-current"];
  assert.equal(row.status, "warn");
  assert.equal(run(dir, ["hooks", "install"]).status, 1, "the premise: install refuses an unclosed block");

  writeFileSync(p, followRepair(readFileSync(p, "utf8"), row.fix, hookBlock(HOOK_NAME)), "utf8");
  assert.equal(readFileSync(p, "utf8"), "#!/bin/sh\n" + hookBlock(HOOK_NAME) + theirs,
    "every line of the user's after the block survives the repair");
  assert.equal(rows(dir).byId["git-hooks-current"], undefined, "the repaired block is the current one");
});

test("a marker quoted inside a line reads as a hook of the user's own, the answer install gives", () => {
  const dir = repo();
  const p = hooksTarget(dir, HOOK_NAME).path;
  mkdirSync(dirname(p), { recursive: true });
  const quoted = "#!/bin/sh\necho \"" + BLOCK_OPEN + "\"\nnpm test\n";
  writeFileSync(p, quoted, "utf8");
  const r = run(dir, ["doctor", "--json"]);
  assert.doesNotMatch(r.stderr, /TypeError|\n\s+at /, "a row, not a stack trace");
  const { byId } = rows(dir);
  assert.match(byId["git-hooks"].detail, /^pre-commit \(a hook of your own, without ours\)/);
  assert.equal(byId["git-hooks-current"], undefined, "no block of ours opens here, so none is stale");
  const install = run(dir, ["hooks", "install"]);
  assert.equal(install.status, 1);
  assert.match(install.stderr, /there is already a pre-commit hook here/, "install calls it the user's own hook too");
  assert.equal(readFileSync(p, "utf8"), quoted);
});

test("an unclosed block names the `hooks print` paste and its file, and that repair is callable (TL-600)", () => {
  const dir = repo();
  installHooks(dir);
  const p = unclose(dir, HOOK_NAME);
  const row = rows(dir).byId["git-hooks-current"];
  assert.equal(row.status, "warn");
  assert.match(row.detail, /^pre-commit carries a block that differs/);
  assert.equal(row.fix, "branchling hooks print   # pre-commit opens our block and never closes it, so `hooks install` refuses; " +
    "replace " + SPAN + " in " + p + " by hand; the lines after it are yours and stay");
  assert.equal(run(dir, ["hooks", "install"]).status, 1, "the premise: install refuses an unclosed block");

  // The command it names succeeds and prints the paste; doing what the
  // comment says is the repair, after which the row is gone.
  const printed = run(dir, ["hooks", "print"]);
  assert.equal(printed.status, 0, printed.stderr);
  for (const line of hookBlock(HOOK_NAME).split("\n")) assert.ok(printed.stdout.includes(line), "the paste is printed: " + line);
  writeFileSync(p, followRepair(readFileSync(p, "utf8"), row.fix, hookBlock(HOOK_NAME)), "utf8");
  assert.equal(rows(dir).byId["git-hooks-current"], undefined);
  assert.equal(run(dir, ["hooks", "install"]).status, 0, "once repaired, install no longer refuses");
});

test("two unclosed blocks are named in the plural, each by its file", () => {
  const dir = repo();
  installHooks(dir);
  const pre = unclose(dir, HOOK_NAME);
  const msg = unclose(dir, COMMIT_MESSAGE_HOOK_NAME);
  assert.equal(rows(dir).byId["git-hooks-current"].fix,
    "branchling hooks print   # pre-commit, commit-msg open our block and never close it, so `hooks install` refuses; " +
    "replace " + SPAN + " in " + pre + " and " + SPAN + " in " + msg + " by hand; the lines after each are yours and stay");
});

test("an unclosed block beside a closed stale one names both repairs", () => {
  const dir = repo();
  installHooks(dir);
  const pre = unclose(dir, HOOK_NAME);
  editGate(dir, COMMIT_MESSAGE_HOOK_NAME, "commit-message", "commit-msg-old");
  assert.equal(rows(dir).byId["git-hooks-current"].fix,
    "branchling hooks print   # pre-commit opens our block and never closes it, so `hooks install` refuses; " +
    "replace our block in commit-msg and " + SPAN + " in " + pre + " by hand; the lines after it are yours and stay");
});

test("an unclosed block beside a hook of the user's own names both refusals", () => {
  const dir = repo();
  installHooks(dir);
  writeFileSync(hooksTarget(dir, HOOK_NAME).path, "#!/bin/sh\nnpm test\n", "utf8");
  const msg = unclose(dir, COMMIT_MESSAGE_HOOK_NAME);
  assert.equal(rows(dir).byId["git-hooks-current"].fix,
    "branchling hooks print   # pre-commit is your own hook and commit-msg opens our block and never closes it, so `hooks install` refuses; " +
    "replace " + SPAN + " in " + msg + " by hand; the lines after it are yours and stay");
});

test("positive control: freshly installed hooks carry no stale row", () => {
  const dir = repo();
  const absent = rows(dir).byId["git-hooks"];
  assert.deepEqual([absent.status, absent.title, absent.detail, absent.fix], ["info", "git gates on commit",
    "pre-commit (none), commit-msg (none) — the guards run only when somebody remembers", "branchling hooks print"]);
  installHooks(dir);
  const d = rows(dir);
  assert.deepEqual([d.byId["git-hooks"].status, d.byId["git-hooks"].title, d.byId["git-hooks"].detail],
    ["ok", "git gates on commit", "pre-commit, commit-msg run the guards"]);
  assert.equal(d.byId["git-hooks-current"], undefined);
});

// ── A diagnosis stays a diagnosis ─────────────────────────────────────────

test("doctor changes NOTHING", () => {
  const dir = fixtureDir(join(tmpdir(), "branchling-doctor-"));
  spawnSync("git", ["init", "-q", "."], { cwd: dir });
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n", "utf8");
  run(dir, ["init", "--dir", ".", "--no-gitignore"]);

  const snapshot = () =>
    readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name + ":" + readFileSync(join(dir, e.name), "utf8").length)
      .sort();

  const before = snapshot();
  run(dir, ["doctor"]);
  const after = snapshot();

  assert.deepEqual(after, before, "doctor appended to or created files — that is no longer a diagnosis");
  assert.equal(readFileSync(join(dir, ".gitignore"), "utf8"), "node_modules/\n");
});

// ── The surface of the command ────────────────────────────────────────────

test("--json is pure JSON and nothing besides", () => {
  const dir = repo();
  const r = run(dir, ["doctor", "--json"]);
  assert.doesNotThrow(() => JSON.parse(r.stdout));
  assert.equal(r.stderr, "", "diagnostics on stdout next to the JSON break every consumer at once");
});

test("with no backlog: it points at `init`, exits non-zero, with no stack trace", () => {
  const dir = fixtureDir(join(tmpdir(), "branchling-doctor-empty-"));
  const r = run(dir, ["doctor"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /init --dir/);
  assert.doesNotMatch(r.stderr + r.stdout, /^\s+at .+:\d+:\d+\)?$/m);
});

test("with --dir naming no backlog: the `init` it points at is that directory (TL-615)", () => {
  const parent = fixtureDir(join(tmpdir(), "branchling-doctor-empty-"));
  writeFileSync(join(parent, "notes.txt"), "x\n", "utf8");
  const r = run(tmpdir(), ["doctor", "--dir", parent, "--json"]);
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.checks[0].fix, PRODUCT_NAME + " init --dir " + parent);
  assert.equal(parsed.next, PRODUCT_NAME + " doctor --dir " + parent + "   # once it is fixed");
  // Control: found by nothing at all, it names the conventional place.
  const bare = JSON.parse(run(parent, ["doctor", "--json"]).stdout);
  assert.equal(bare.checks[0].fix, PRODUCT_NAME + " init --dir ./backlog");
});

test("an unknown flag fails with code 2", () => {
  const dir = repo();
  assert.equal(run(dir, ["doctor", "--jsno"]).status, 2);
});

test("--help exits zero and writes to stdout", () => {
  const dir = repo();
  const r = run(dir, ["doctor", "--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /doctor/);
  assert.equal(r.stderr, "");
});
