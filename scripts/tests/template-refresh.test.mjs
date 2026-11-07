/**
 * `template refresh` (TL-595): the fields a backlog's `_template.md` lacks are
 * inserted from the packaged template, and no line already there changes.
 *
 * Every expected text below is written out IN FULL rather than derived with
 * the module's own reader, because a fixture built by the code under test
 * shares every assumption the test exists to question. Each case that says
 * "goes after X" has a neighbour case where the same lines go somewhere else.
 *
 * The doctor row that names this command, and the run of the printed fix, are
 * in `doctor.test.mjs`.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";
import { plain } from "../ui.mjs";
import { frontmatterFields, planRefresh, refreshTemplate, renderRefresh, templateFields } from "../template-command.mjs";

isolateHome("template-refresh");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
// Real path: the tool reports resolved paths, and the temporary directory is a
// symlink on macOS.
const BASE = realpathSync(fixtureDir(join(tmpdir(), "branchling-template-refresh-")));
after(() => rmSync(BASE, { recursive: true, force: true }));

let counter = 0;
function backlog() {
  const dir = join(BASE, "b" + counter++);
  const r = run(BASE, ["init", "--dir", dir, "--no-example", "--no-nudge"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return dir;
}

function run(cwd, args) {
  return spawnSync(process.execPath, [CLI].concat(args), { cwd, encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1" } });
}

const SHIPPED = [
  "---",
  "# the header",
  "id: X-NNN   # the id",
  "title: \"\"",
  "epic: \"\"   # free text",
  "release: \"\"   # the release",
  "target: []   # the targets",
  "priority: P1",
  "verification:   # how",
  "  - id: n",
  "    bash: \"cmd\"",
  "---",
  "",
  "## Goal",
  "",
].join("\n");

// ── The planner ──────────────────────────────────────────────────────────

test("missing keys go after their nearest preceding shipped key, in shipped order", () => {
  const own = "---\n# OUR header\ntitle: \"\"\nepic: \"x\"   # ours\npriority: P3\nsquad: a   # our field\n---\n\nbody\n";
  const plan = planRefresh(own, SHIPPED);
  assert.equal(plan.ok, true);
  assert.equal(plan.text,
    "---\n# OUR header\ntitle: \"\"\nepic: \"x\"   # ours\n" +
    "release: \"\"   # the release\ntarget: []   # the targets\n" +
    "priority: P3\n" +
    "verification:   # how\n  - id: n\n    bash: \"cmd\"\n" +
    "squad: a   # our field\n" +
    "id: X-NNN   # the id\n" +
    "---\n\nbody\n");
  assert.deepEqual(plan.added.map((a) => [a.key, a.after, a.comment]), [
    ["id", null, "the id"],
    ["release", "epic", "the release"],
    ["target", "release", "the targets"],
    ["verification", "priority", "how"],
  ]);
  assert.deepEqual(plan.added[3].lines, ["verification:   # how", "  - id: n", "    bash: \"cmd\""]);
});

test("a leading key goes after anchored keys that also land on the closing marker", () => {
  const plan = planRefresh("---\na: 1\n---\nbody\n", "---\nid: X   # c\na: 1\nb: 2\n---\n");
  assert.equal(plan.text, "---\na: 1\nb: 2\nid: X   # c\n---\nbody\n");
  assert.deepEqual(plan.added.map((a) => a.after), [null, "a"]);
});

test("an insertion follows the WHOLE value of its anchor, but not a comment or blank that leads to the next key", () => {
  const own = "---\nverification:\n  - id: a\n\n# inside\n  - id: b\n# about c\n\nc: 1\n---\n";
  const plan = planRefresh(own, "---\nverification:\n  - x\nnew: 1   # n\nc: 1\n---\n");
  assert.equal(plan.text, "---\nverification:\n  - id: a\n\n# inside\n  - id: b\nnew: 1   # n\n# about c\n\nc: 1\n---\n");
});

test("a block sequence written at column 0 belongs to the key above it", () => {
  const plan = planRefresh("---\nlabels:\n- a\n-\nz: 1\n---\n", "---\nlabels: []\nm: 2\nz: 1\n---\n");
  assert.equal(plan.text, "---\nlabels:\n- a\n-\nm: 2\nz: 1\n---\n");
});

test("a whitespace-only line does not extend a value", () => {
  const plan = planRefresh("---\na: 1\n   \nz: 1\n---\n", "---\na: 1\nm: 2\n---\n");
  assert.equal(plan.text, "---\na: 1\nm: 2\n   \nz: 1\n---\n");
});

test("a CRLF template keeps its line ending on every inserted line", () => {
  const plan = planRefresh("---\r\na: 1\r\n---\r\nbody\r\n", "---\nb: 0\na: 1\nc: 2\n---\n");
  assert.equal(plan.text, "---\r\na: 1\r\nc: 2\r\nb: 0\r\n---\r\nbody\r\n");
  assert.deepEqual(planRefresh("---\na: 1\n---\n", "---\r\na: 1\r\nc: 2\r\n---\r\n").text, "---\na: 1\nc: 2\n---\n",
    "a CRLF packaged template does not carry its carriage returns into an LF file");
});

test("a key twice in either template is placed by its first occurrence and inserted once", () => {
  assert.equal(planRefresh("---\na: 1\nz: 0\na: 2\n---\n", "---\na: 1\nb: 1\n---\n").text, "---\na: 1\nb: 1\nz: 0\na: 2\n---\n");
  const twice = planRefresh("---\na: 1\n---\n", "---\na: 1\nb: 2\nb: 3\n---\n");
  assert.equal(twice.text, "---\na: 1\nb: 2\n---\n");
  assert.deepEqual(twice.added.map((a) => a.key), ["b"]);
});

test("positive control: a current template, or one with fields and values of its own, is left as it is", () => {
  const own = "---\nid: Y   # ours\nsquad: q\ntitle: \"t\"\nepic: \"\"\nrelease: \"v\"\ntarget: [a]\npriority: P9\nverification:\n  - bash: x\n---\n";
  const plan = planRefresh(own, SHIPPED);
  assert.deepEqual(plan, { ok: true, added: [], text: own });
});

test("a template without a closed frontmatter is refused, not guessed at", () => {
  for (const own of ["id: X\n", "", "# notes\n---\nid: X\n---\n"]) {
    const plan = planRefresh(own, SHIPPED);
    assert.deepEqual([plan.ok, plan.kind], [false, "no-frontmatter"], JSON.stringify(own));
    assert.match(plan.message, /first line is not `---`/);
  }
  const open = planRefresh("---\nid: X\n", SHIPPED);
  assert.deepEqual([open.ok, open.kind], [false, "no-frontmatter"]);
  assert.match(open.message, /never closes/);
});

test("frontmatterFields gives each key the range its value occupies", () => {
  const { close, fields, framed } = frontmatterFields(["---", "a: 1", "b:", "  - x", "", "c: 2", "---", "d: 3"]);
  assert.equal(framed, true);
  assert.equal(close, 6);
  assert.deepEqual(fields.map((f) => [f.key, f.start, f.end]), [["a", 1, 2], ["b", 2, 4], ["c", 5, 6]]);
  assert.deepEqual(frontmatterFields([]), { close: -1, fields: [], framed: false });
});

test("a value ends where a line that is neither a continuation nor a comment at column 0 begins", () => {
  const m = "---\na: 1\nm: 2\n---\n";
  // A `- ` inside a comment is not a block sequence item.
  assert.equal(planRefresh("---\na: 1\n# x - y\nz: 1\n---\n", m).text, "---\na: 1\nm: 2\n# x - y\nz: 1\n---\n");
  // A `#` that does not start the line does not make it a comment.
  assert.equal(planRefresh("---\na: 1\nfoo # c\n  - y\nz: 1\n---\n", m).text, "---\na: 1\nm: 2\nfoo # c\n  - y\nz: 1\n---\n");
  // A whitespace-only line inside a nested value does not end it.
  assert.equal(planRefresh("---\na:\n  - x\n   \n  - y\nz: 1\n---\n", m).text, "---\na:\n  - x\n   \n  - y\nm: 2\nz: 1\n---\n");
});

test("templateFields reads each key's comment, not a `#` inside a quoted value", () => {
  assert.deepEqual(templateFields("--- \nid: X   #tight  \ntitle: \"a # b\"\nepic: 'c # d'   # free\nbare: 1\n--- \n"), [
    { key: "id", comment: "tight" },
    { key: "title", comment: "" },
    { key: "epic", comment: "free" },
    { key: "bare", comment: "" },
  ]);
  assert.deepEqual(frontmatterFields(["--- ", "a: 1", "--- "]).close, 2, "a marker with trailing spaces closes");
});

// ── The file ─────────────────────────────────────────────────────────────

function fixtureFiles(own) {
  const dir = fixtureDir(join(BASE, "f-"));
  writeFileSync(join(dir, "_template.md"), own, "utf8");
  writeFileSync(join(dir, "shipped.md"), SHIPPED, "utf8");
  return { dir, own: join(dir, "_template.md"), shipped: join(dir, "shipped.md") };
}

test("refreshTemplate writes the planned text, and --dry-run writes nothing", () => {
  const f = fixtureFiles("---\ntitle: \"\"\n---\n");
  const dry = refreshTemplate(f.dir, { shipped: f.shipped, dryRun: true });
  assert.deepEqual([dry.ok, dry.changed, dry.dryRun, dry.path, dry.shipped], [true, true, true, f.own, f.shipped]);
  assert.equal(readFileSync(f.own, "utf8"), "---\ntitle: \"\"\n---\n", "a dry run wrote");
  const wet = refreshTemplate(f.dir, { shipped: f.shipped });
  assert.deepEqual([wet.changed, wet.dryRun], [true, false]);
  assert.deepEqual(wet.added.map((a) => a.key), ["id", "epic", "release", "target", "priority", "verification"]);
  assert.equal(readFileSync(f.own, "utf8"), planRefresh("---\ntitle: \"\"\n---\n", SHIPPED).text);
  const again = refreshTemplate(f.dir, { shipped: f.shipped });
  assert.deepEqual([again.ok, again.changed, again.added], [true, false, []], "a second refresh finds nothing to add");
});

test("refreshTemplate refuses what it cannot refresh and writes nothing", () => {
  const f = fixtureFiles("no frontmatter\n");
  const bad = refreshTemplate(f.dir, { shipped: f.shipped });
  assert.deepEqual([bad.ok, bad.kind], [false, "no-frontmatter"]);
  assert.ok(bad.message.endsWith(" — " + f.own), bad.message);
  assert.deepEqual(bad.details, ["Nothing was written."]);
  assert.equal(readFileSync(f.own, "utf8"), "no frontmatter\n");
  const noShipped = refreshTemplate(f.dir, { shipped: join(f.dir, "absent.md") });
  assert.deepEqual([noShipped.ok, noShipped.kind, noShipped.message], [false, "no-shipped-template", "the packaged template is missing: " + join(f.dir, "absent.md")]);
  assert.deepEqual(noShipped.details, ["A tarball built without `_template.md` in `files` produces exactly this."]);
  rmSync(f.own);
  const none = refreshTemplate(f.dir, { shipped: f.shipped });
  assert.deepEqual([none.ok, none.kind, none.message], [false, "no-template", "this backlog has no _template.md: " + f.own]);
  assert.match(none.details[0], /copy .*shipped\.md there/);
});

test("renderRefresh names each added key and where it went", () => {
  const added = [{ key: "id", after: null }, { key: "release", after: "epic" }];
  assert.equal(renderRefresh({ path: "/p/_template.md", dryRun: false, added }, { color: plain }), [
    "✓ template: added 2 field(s) → /p/_template.md",
    "    id       at the end of the frontmatter",
    "    release  after `epic`",
    "  Every line that was already there is unchanged. A field you removed on purpose is back: delete its line again.",
  ].join("\n"));
  assert.match(renderRefresh({ path: "/p", dryRun: true, added }, { color: plain }), /^✓ template: would add 2 field\(s\)/);
  assert.equal(renderRefresh({ path: "/p", dryRun: false, added: [] }, { color: plain }),
    "· template: every field this release ships is already in /p — nothing changed");
});

// ── The command ──────────────────────────────────────────────────────────

test("the command refreshes a lagging template and says what it added", () => {
  const dir = backlog();
  const p = join(dir, "_template.md");
  const fresh = readFileSync(p, "utf8");
  const lagging = fresh.split("\n").filter((l) => !/^(release|target):/.test(l)).join("\n");
  assert.notEqual(lagging, fresh, "the fixture removed nothing");
  writeFileSync(p, lagging, "utf8");

  const dry = run(dir, ["template", "refresh", "--dry-run"]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /would add 2 field\(s\)/);
  assert.equal(readFileSync(p, "utf8"), lagging, "--dry-run wrote");

  const r = run(dir, ["template", "refresh"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /added 2 field\(s\) → .*_template\.md\n {4}release {2}after `epic`\n {4}target {3}after `release`/);
  assert.equal(readFileSync(p, "utf8"), fresh, "the refreshed template is the one init wrote");

  const twice = run(dir, ["template", "refresh"]);
  assert.equal(twice.status, 0);
  assert.match(twice.stdout, /nothing changed/);
});

test("--json answers one template-refresh envelope", () => {
  const dir = backlog();
  const p = join(dir, "_template.md");
  writeFileSync(p, readFileSync(p, "utf8").replace(/^epic:.*\n/m, ""), "utf8");
  const r = run(dir, ["template", "refresh", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const answer = JSON.parse(r.stdout);
  assert.equal(answer.kind, "template-refresh");
  assert.deepEqual([answer.ok, answer.changed, answer.dryRun, answer.path], [true, true, false, p]);
  assert.deepEqual(answer.added.map((a) => [a.key, a.after]), [["epic", "board"]]);
  assert.match(answer.added[0].comment, /free text/);
});

test("a template it cannot refresh exits 1 with the reason, in both shapes", () => {
  const dir = backlog();
  const p = join(dir, "_template.md");
  writeFileSync(p, "not a template\n", "utf8");
  const human = run(dir, ["template", "refresh"]);
  assert.equal(human.status, 1);
  assert.match(human.stderr, /template refresh: the template has no frontmatter/);
  assert.match(human.stderr, /Nothing was written\./);
  const json = run(dir, ["template", "refresh", "--json"]);
  assert.equal(json.status, 1);
  const answer = JSON.parse(json.stdout);
  assert.deepEqual([answer.ok, answer.refusalKind, answer.path], [false, "no-frontmatter", p]);
  assert.deepEqual(answer.details, ["Nothing was written."]);
  assert.equal(readFileSync(p, "utf8"), "not a template\n");
});

test("a wrong invocation exits 2 and names what is accepted", () => {
  const dir = backlog();
  for (const [args, problem] of [
    [["template"], /no subcommand/],
    [["template", "rewrite"], /unknown subcommand: rewrite/],
    [["template", "refresh", "--force", "--quiet"], /unknown flag: --force --quiet\n/],
    [["template", "refresh", "extra"], /unexpected argument: extra/],
  ]) {
    const r = run(dir, args);
    assert.equal(r.status, 2, args.join(" ") + ": " + r.stdout + r.stderr);
    assert.match(r.stderr, problem);
    assert.match(r.stderr, args.length === 2 && args[1] === "refresh" || args.length > 2
      ? /template refresh: .*\n {2}available: --dry-run --json --dir\n/
      : /template: .*\n {2}available: refresh\n/);
  }
});

test("--dir names the backlog from anywhere", () => {
  const dir = backlog();
  const p = join(dir, "_template.md");
  writeFileSync(p, readFileSync(p, "utf8").replace(/^epic:.*\n/m, ""), "utf8");
  const elsewhere = fixtureDir(join(BASE, "cwd-"));
  const r = run(elsewhere, ["template", "refresh", "--dir", dir]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /added 1 field\(s\) → .*[\\/]_template\.md\n {4}epic {2}after `board`/);
});

test("outside a backlog it refuses with exit 1, in an envelope under --json", () => {
  const dir = fixtureDir(join(BASE, "nowhere-"));
  spawnSync("git", ["init", "-q", "."], { cwd: dir });
  const human = run(dir, ["template", "refresh"]);
  assert.equal(human.status, 1);
  assert.match(human.stderr, /template refresh: .*no backlog here/);
  const json = run(dir, ["template", "refresh", "--json"]);
  assert.equal(json.status, 1);
  assert.deepEqual([JSON.parse(json.stdout).kind, JSON.parse(json.stdout).refusalKind], ["template-refresh", "no-backlog"]);
});
