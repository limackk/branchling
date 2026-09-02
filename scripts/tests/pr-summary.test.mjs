/**
 * `pr-summary` — the backlog diff a reviewer reads beside the code diff
 * (TL-89).
 *
 * WHAT HAS TO BE PROVED:
 *
 *   1. The tasks come from `git diff`, not from a computed view. Proved by
 *      building a branch and never running `build` on it — on CI nothing has
 *      been rebuilt either, so a view-based answer would be empty there and
 *      correct here, which is the worst possible way for a test to pass.
 *   2. A branch that touched NO task says so. TL-89 asks for this by name: an
 *      empty comment and a job that did not run look identical to a reviewer.
 *   3. A section with no data disappears rather than showing zeros, and
 *      `--cost` never prints a token count, an amount or a model name that
 *      nothing recorded.
 *   4. The markdown is narrow — headings, one table shape, bullets, inline
 *      code. Asserted on the text, because a comment that renders differently
 *      in a GitLab merge request is a comment nobody checked twice.
 *
 * The fixtures are throwaway repositories: a suite that summarised THIS branch
 * would assert against whatever somebody happened to be working on.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  actorShare, addedHistoryEntries, changedTasks, parsePrSummaryArgs,
  renderMarkdown, summarizeTask, transitionLine,
} from "../pr-summary.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

let counter = 0;
function run(dir, args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, cwd: dir, env: { ...process.env, NO_COLOR: "1" },
  });
}

// ── The invocation ────────────────────────────────────────────────────────

test("the base defaults to main, and an unknown flag fails", () => {
  assert.equal(parsePrSummaryArgs([]).base, "main");
  assert.equal(parsePrSummaryArgs(["--base", "develop"]).base, "develop");
  assert.equal(parsePrSummaryArgs([]).cost, false, "cost information must be opt-in");
  assert.throws(() => parsePrSummaryArgs(["--tokens"]), /unknown flag: --tokens/);
  assert.throws(() => parsePrSummaryArgs(["main"]), /unexpected argument/);
});

// ── Reading the range ─────────────────────────────────────────────────────

test("task ids come from the FILENAME, so a deleted task is still reported", () => {
  const lines = [
    "A\tbacklog/tasks/TL-7-a-thing.md",
    "M\tbacklog/tasks/TL-12-another.md",
    "D\tbacklog/tasks/TL-3-gone.md",
    "M\tscripts/cli.mjs",
    "M\tREADME.md",
  ];
  assert.deepEqual(changedTasks(lines.join("\n"), "TL"), [
    { id: "TL-12", change: "changed" },
    { id: "TL-3", change: "removed" },
    { id: "TL-7", change: "added" },
  ]);
});

test("a rename is one row, under the id both names share", () => {
  const line = "R096\tbacklog/tasks/TL-7-old-slug.md\tbacklog/tasks/TL-7-new-slug.md";
  assert.deepEqual(changedTasks(line, "TL"), [{ id: "TL-7", change: "changed" }]);
});

test("another project's prefix is not read as ours", () => {
  assert.deepEqual(changedTasks("M\tbacklog/tasks/BL-7-a.md", "TL"), []);
  assert.deepEqual(changedTasks("M\tbacklog/tasks/BL-7-a.md", "BL"), [{ id: "BL-7", change: "changed" }]);
});

test("only ADDED history lines count — the log is append-only, so those are this branch's", () => {
  const diff = [
    "--- a/backlog/history/TL-7.jsonl",
    "+++ b/backlog/history/TL-7.jsonl",
    '+{"task":"TL-7","field":"status","from":"pending","to":"done","ts":"2026-01-02","actor":"agent:x"}',
    ' {"task":"TL-7","field":"title","to":"old","ts":"2026-01-01","actor":"local:me"}',
    '-{"task":"TL-7","field":"gone","ts":"2026-01-01"}',
    "+not json at all",
  ].join("\n");
  const byTask = addedHistoryEntries(diff);
  assert.equal(byTask.get("TL-7").length, 1);
  assert.equal(byTask.get("TL-7")[0].to, "done");
});

test("the `+++` header line is not read as an entry", () => {
  assert.equal(addedHistoryEntries('+++ b/x\n+{"task":"TL-1","field":"status"}').size, 1);
});

test("who did it is counted by NAMESPACE, not by name", () => {
  const share = actorShare([
    { actor: "agent:claude" }, { actor: "agent:other" }, { actor: "local:me" },
  ]);
  assert.deepEqual(share, [{ namespace: "agent", count: 2 }, { namespace: "local", count: 1 }]);
});

// ── One task's story ──────────────────────────────────────────────────────

test("a task opened on the branch is a different fact from one that moved", () => {
  // `added` comes from git. It matters that this does NOT need a `__created__`
  // entry: `new` writes none, so a summary waiting for one would miss every
  // task somebody opened while working.
  const opened = summarizeTask("TL-1", [], { title: "T", status: "pending" }, "added");
  assert.equal(opened.created, true);
  assert.deepEqual(opened.transitions, []);

  const moved = summarizeTask("TL-2", [
    { field: "status", from: "pending", to: "done", actor: "agent:x", reason: "proven", source: "done" },
  ], { title: "U", status: "done" });
  assert.equal(moved.created, false);
  assert.equal(moved.transitions.length, 1);
});

test("a `manual:` vouch is named, because no command checked it", () => {
  const t = summarizeTask("TL-3", [{ field: "__verified__", to: "the screen looks right", actor: "local:me" }], null);
  assert.deepEqual(t.vouched, [{ command: "the screen looks right", actor: "local:me" }]);
});

test("`unknown` is spelled out two different ways, and the source decides which", () => {
  // The same word means "nobody was there to ask" after a reconcile and "nobody
  // typed a reason" after a command. Rendered identically, one of them libels
  // the tool.
  assert.match(transitionLine({ from: "a", to: "b", reason: "unknown", source: "external" }), /changed outside the tool/);
  assert.match(transitionLine({ from: "a", to: "b", reason: "unknown", source: "take" }), /no reason stated/);
  assert.match(transitionLine({ from: "a", to: "b", reason: "proven", source: "done" }), /verification passed/);
  assert.match(transitionLine({ from: "a", to: "b", reason: "Because.", source: "handoff" }), /Because\./);
  // An unknown source takes the milder reading rather than accusing anybody.
  assert.match(transitionLine({ from: "a", to: "b", reason: "unknown", source: "brand-new" }), /no reason stated/);
});

// ── The comment ───────────────────────────────────────────────────────────

const model = (over = {}) => ({
  scanned: true, reason: "ok", base: "main", engaged: null, cost: null,
  tasks: [summarizeTask("TL-1", [
    { field: "status", from: "pending", to: "done", actor: "agent:x", reason: "proven", source: "done" },
  ], { title: "A task", status: "done", estimate: "2h" })],
  ...over,
});

test("a branch that touched no task says so — an empty comment is not an answer", () => {
  const md = renderMarkdown(model({ tasks: [] }));
  assert.match(md, /No task changed between `main` and this branch\./);
  assert.doesNotMatch(md, /\|---\|/, "an empty summary must not render an empty table");
});

test("a range that could not be read is named, not reported as no changes", () => {
  const md = renderMarkdown(model({ scanned: false, reason: "not a git repository — a branch summary has no range to read", tasks: [] }));
  assert.match(md, /not a git repository/);
  assert.doesNotMatch(md, /No task changed/, "`nobody looked` and `nothing changed` are different answers");
});

test("with no measurement there is no effort section — not a section of zeros", () => {
  const md = renderMarkdown(model());
  assert.doesNotMatch(md, /Measured effort/);
  assert.doesNotMatch(md, /0 min/);
});

test("the effort section appears only with data, and says so when it is unreliable", () => {
  const md = renderMarkdown(model({
    engaged: { tasks: [{ task: "TL-1", minutes: 42 }], unknownRatio: 0.5 },
  }));
  assert.match(md, /Measured effort/);
  assert.match(md, /42 min/);
  assert.match(md, /50% of that time could not be attributed/);
});

test("without --cost there is no token, amount or model anywhere in the output", () => {
  const md = renderMarkdown(model()).toLowerCase();
  for (const word of ["token", "$", "model", "usd"]) {
    assert.ok(!md.includes(word), "`" + word + "` leaked into a comment that did not ask for cost");
  }
});

test("with --cost and nothing recorded, it says so rather than printing a zero", () => {
  const md = renderMarkdown(model({ cost: { reason: "this backlog records no token counts, so there is no cost to report" } }));
  assert.match(md, /### Cost/);
  assert.match(md, /records no token counts/);
  assert.doesNotMatch(md, /\b0 tokens\b/);
});

test("the markdown stays narrow — no HTML block, one table shape, escaped pipes", () => {
  const md = renderMarkdown(model({
    tasks: [summarizeTask("TL-1", [], { title: "A | piped | title", status: "done" })],
  }));
  assert.match(md, /A \\\| piped \\\| title/, "an unescaped pipe breaks the table");
  // `<sub>` is the one tag, and it is inline. Anything block-level renders
  // differently outside GitHub.
  const tags = [...md.matchAll(/<\/?([a-z]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(tags)], ["sub"]);
  for (const line of md.split("\n")) {
    if (line.startsWith("|")) assert.ok(line.endsWith("|"), "a table row without a closing pipe: " + line);
  }
});

// ── A real branch ─────────────────────────────────────────────────────────

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-prsummary-" + counter++ + "-"));
  execFileSync("git", ["init", "-q", "-b", "main", "."], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "t@example.test"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  assert.equal(run(dir, ["init", "--dir", "backlog", "--no-example"]).status, 0);
  commit(dir, "the backlog exists");
  return dir;
}

function commit(dir, message) {
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "--allow-empty", "-m", message], { cwd: dir });
}

function newTask(dir, title) {
  const r = run(dir, ["new", "--dir", "backlog", "--title", title]);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.match(/[A-Z]+-\d+/)[0];
}

test("a real branch: the tasks it touched, with the transitions it made", () => {
  const dir = repo();
  execFileSync("git", ["checkout", "-q", "-b", "work"], { cwd: dir });
  const id = newTask(dir, "Work done on a branch");
  assert.equal(run(dir, ["take", id, "--dir", "backlog", "--actor", "local:me"]).status, 0);
  commit(dir, id + " started");

  // NO `build` is ever run on this branch — the views are whatever `init` left,
  // so an answer read from a view would be wrong here in exactly the way it is
  // wrong on CI.
  const r = run(dir, ["pr-summary", "--dir", "backlog", "--base", "main"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp("`" + id + "`"));
  assert.match(r.stdout, /Work done on a branch/);
  assert.match(r.stdout, /opened on this branch/);
  assert.match(r.stdout, /→ `in_progress`/);
  assert.match(r.stdout, /local:me/);
});

test("a branch that changed only code reports no tasks", () => {
  const dir = repo();
  execFileSync("git", ["checkout", "-q", "-b", "codeonly"], { cwd: dir });
  writeFileSync(join(dir, "app.js"), "// nothing to do with the backlog\n", "utf8");
  commit(dir, "a change with no task");

  const r = run(dir, ["pr-summary", "--dir", "backlog", "--base", "main"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /No task changed between `main` and this branch\./);
});

test("a base this clone does not have is named, not silently reported as empty", () => {
  const dir = repo();
  const r = run(dir, ["pr-summary", "--dir", "backlog", "--base", "no-such-ref"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /is `no-such-ref` a ref this clone has/);
  assert.doesNotMatch(r.stdout, /No task changed/);
});

test("--json carries the same summary, and says whether the range was read", () => {
  const dir = repo();
  execFileSync("git", ["checkout", "-q", "-b", "work"], { cwd: dir });
  const id = newTask(dir, "Visible to a program");
  commit(dir, id + " opened");

  const r = run(dir, ["pr-summary", "--dir", "backlog", "--base", "main", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.kind, "pr-summary");
  assert.equal(doc.scanned, true);
  assert.equal(doc.base, "main");
  assert.deepEqual(doc.tasks.map((t) => t.id), [id]);
  assert.equal(doc.cost, null, "cost must stay absent unless asked for");
});

test("outside git it answers with a complete envelope, not a crash", () => {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-prsummary-nogit-" + counter++ + "-"));
  assert.equal(run(dir, ["init", "--dir", "backlog", "--no-example"]).status, 0);
  const r = run(dir, ["pr-summary", "--dir", "backlog", "--json"]);
  assert.equal(r.status, 0);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.scanned, false);
  assert.match(doc.reason, /not a git repository/);
});

// ── The transport ─────────────────────────────────────────────────────────

test("the example workflow is checkout, run, comment — and keeps the full history", () => {
  const yml = readFileSync(join(HERE, "..", "..", "examples", "pr-summary.yml"), "utf8");
  assert.match(yml, /fetch-depth: 0/, "a shallow checkout has no base to compare against");
  assert.match(yml, /pr-summary/);
  assert.match(yml, /worktrail-pr-summary/, "no marker means a new comment on every push");
  // Only what the job RUNS counts — the file explains `--cost` in a comment on
  // purpose, and a test that could not tell the two apart would forbid
  // documenting the flag at all.
  const commands = yml.split("\n").filter((l) => !l.trim().startsWith("#"));
  assert.ok(!commands.join("\n").includes("--cost"), "cost information must not be on by default in a public place");
});
