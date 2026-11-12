/**
 * `jira-proof` — a merged task's proof, as a comment on its Jira ticket
 * (TL-582).
 *
 * WHAT HAS TO BE PROVED:
 *
 *   1. The command reports EXACTLY the Jira-linked tasks that entered the
 *      closed status in the range: a Jira-linked task moved to a status that is
 *      not closed is not reported, and a closed task with no Jira marker is
 *      counted as skipped rather than dropped. Proved over a throwaway
 *      repository whose tasks were closed by `done`, so the closing record is
 *      the real one and not a hand-written line.
 *   2. Each comment carries the verification contract with what every check
 *      proves, and the record that closed the task — in Atlassian Document
 *      Format and in plain text, rendered from one model.
 *   3. An empty range is a complete envelope with nothing to post.
 *   4. The CI job is a caller: its invocation passes this command's own parser,
 *      its credentials come from secrets, and its posting script — executed
 *      here against a fake Jira — posts one comment per ticket and nothing on a
 *      re-run.
 *
 * WHAT NO LOCAL RUN CAN PROVE: that Jira Cloud accepts the ADF as posted. The
 * shape follows the v3 comment endpoint's documented body; the first push of a
 * repository that installs the job is where that claim meets Jira.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildProof, closingRecord, closingSentence, commentBlocks, commentMarker, compareTaskIds,
  jiraTicketOf, main, normalizeSite, parseJiraProofArgs, proofComment, renderAdf, renderReport,
} from "../jira-proof.mjs";
import { isBacklogDirRefusal } from "../paths.mjs";
import { loadConfig } from "../config.mjs";
import { BLOCK_MARKER_NAME, PRODUCT_NAME } from "../product.mjs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { isolateHome } from "./_repo.mjs";

isolateHome("jira-proof");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");
const EXAMPLE = join(HERE, "..", "..", "examples", "jira-proof.yml");
let counter = 0;

function run(dir, args, input) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, cwd: dir, input, env: { ...process.env, NO_COLOR: "1" },
  });
}

// ── The invocation ────────────────────────────────────────────────────────

test("--base is required, --site is normalised, and an unknown flag fails", () => {
  assert.throws(() => parseJiraProofArgs([]), /--base <ref>` is required/);
  assert.equal(parseJiraProofArgs(["--base", "abc"]).base, "abc");
  assert.equal(parseJiraProofArgs(["--base", "abc"]).site, null);
  assert.equal(parseJiraProofArgs(["--base", "a", "--site", "https://acme.atlassian.net/"]).site, "https://acme.atlassian.net");
  assert.throws(() => parseJiraProofArgs(["--base", "a", "--site", "acme"]), /^Error: `--site acme` is not an http\(s\) URL of a Jira site$/);
  assert.throws(() => parseJiraProofArgs(["--base"]), /^Error: `--base` with no ref$/);
  assert.throws(() => parseJiraProofArgs(["--base", "a", "--site"]), /^Error: `--site` with no URL$/);
  assert.throws(() => parseJiraProofArgs(["--base", "a", "--transition"]), /^Error: unknown flag: --transition$/);
  assert.equal(parseJiraProofArgs(["--base", "a"]).json, false);
  assert.equal(parseJiraProofArgs(["--json", "--base", "a"]).json, true);
  assert.throws(() => parseJiraProofArgs(["--base", "a", "main"]), /unexpected argument/);
  // The base reaches `git diff` as its own argument; a dash would make it an option.
  assert.throws(() => parseJiraProofArgs(["--base", "--output=x"]), /^Error: `--base --output=x` is not a ref$/);
});

test("the CLI refuses a missing --base with exit 2 and names what it accepts", () => {
  const r = run(tmpdir(), ["jira-proof"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, new RegExp(PRODUCT_NAME + " jira-proof: `--base <ref>` is required"));
  assert.match(r.stderr, /available: --base <ref> --site <url> --json --dir <path>/);
});

test("a directory that is not a backlog is refused in the command's own kind", () => {
  const dir = fixtureDir(join(tmpdir(), "branchling-jiraproof-notbacklog-" + counter++ + "-"));
  const r = run(dir, ["jira-proof", "--base", "HEAD", "--dir", dir, "--json"]);
  assert.equal(r.status, 1, r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.kind, "jira-proof");
  assert.equal(doc.ok, false);
  assert.equal(doc.refusalKind, "no-backlog");
  const text = run(dir, ["jira-proof", "--base", "HEAD", "--dir", dir]);
  assert.equal(text.status, 1);
  assert.match(text.stderr, new RegExp(PRODUCT_NAME + " jira-proof: That directory does not look like a backlog"));
  assert.match(text.stderr, new RegExp(PRODUCT_NAME + " jira-proof --dir <path>"));
});

test("an error that is not a backlog refusal propagates instead of being answered as one", () => {
  // `resolveBacklogDir` reads the working directory before any source, and a
  // removed working directory makes that read throw ENOENT: a failure of the
  // process, not a verdict about a directory. Answering it as "no backlog"
  // would exit 1 with a refusal that names the wrong cause.
  const gone = fixtureDir(join(tmpdir(), "branchling-jiraproof-gonecwd-" + counter++ + "-"));
  const before = process.cwd();
  const stderr = process.stderr.write;
  let printed = "";
  process.chdir(gone);
  rmSync(gone, { recursive: true, force: true });
  process.stderr.write = (chunk) => { printed += chunk; return true; };
  try {
    assert.throws(() => main(["--base", "HEAD"]), (e) => e.code === "ENOENT" && !isBacklogDirRefusal(e));
  } finally {
    process.stderr.write = stderr;
    process.chdir(before);
  }
  assert.equal(printed, "", "nothing is reported as a refusal");
});

// ── Reading one task ──────────────────────────────────────────────────────

test("the ticket comes from the marker line import --from jira writes", () => {
  const body = "## Notes\n\nImported from Jira: https://acme.atlassian.net/jira/browse/APP-12\n";
  assert.deepEqual(jiraTicketOf(body), {
    ok: true, url: "https://acme.atlassian.net/jira/browse/APP-12", site: "https://acme.atlassian.net/jira", key: "APP-12",
  });
  assert.deepEqual(jiraTicketOf("Imported from GitHub: https://github.com/o/r/issues/1\n"), { ok: false, reason: "no-jira-marker" });
  // Mentioned in prose is not the marker: it has to be the whole line.
  assert.equal(jiraTicketOf("see Imported from Jira: https://acme.atlassian.net/browse/APP-1\n").ok, false);
  assert.deepEqual(jiraTicketOf("Imported from Jira: https://acme.atlassian.net/issues/APP-1\n"), { ok: false, reason: "malformed-jira-marker" });
  // A key is what the job puts into an API path, so anything else is refused.
  assert.equal(jiraTicketOf("Imported from Jira: https://acme.atlassian.net/browse/APP-1/../x\n").ok, false);
  assert.equal(jiraTicketOf("Imported from Jira: ftp://acme/browse/APP-1\n").ok, false);
  assert.deepEqual(jiraTicketOf("Imported from Jira: https://acme.atlassian.net/browse/xAPP-1\n"), { ok: false, reason: "malformed-jira-marker" });
  assert.deepEqual(jiraTicketOf("Imported from Jira: https://acme.atlassian.net/browse/APP-0\n"), { ok: false, reason: "malformed-jira-marker" });
  assert.deepEqual(jiraTicketOf("Imported from Jira: https://acme.atlassian.net/browse/APP-1x\n"), { ok: false, reason: "malformed-jira-marker" });
  assert.deepEqual(jiraTicketOf("Imported from Jira: /browse/APP-1\n"), { ok: false, reason: "malformed-jira-marker" });
  // Dropping the `^` of the browse pattern is an equivalent mutant (TL-694):
  // the URL is the marker's `\S+` capture, so it holds no line break, and a
  // match found from any later position also exists from position 0, where
  // `[^/]+$` leaves the greedy `(.+)` exactly one split to choose.
});

test("the LAST status record of the range decides whether the task closed", () => {
  const closed = ["done"];
  const close = { field: "status", from: "in_progress", to: "done" };
  assert.equal(closingRecord([{ field: "status", to: "in_progress" }, close], closed), close);
  assert.equal(closingRecord([close, { field: "status", from: "done", to: "in_progress" }], closed), null,
    "closed and reopened within one push has no standing proof");
  assert.equal(closingRecord([{ field: "status", to: "cancelled" }], closed), null);
  assert.equal(closingRecord([{ field: "owner", to: "done" }], closed), null);
  assert.equal(closingRecord([], closed), null);
});

test("the marker is keyed on the frozen name, and one id's marker is not a prefix of another's", () => {
  assert.equal(commentMarker("TL-58"), "[" + BLOCK_MARKER_NAME + "-proof:TL-58]");  // renumber: allow
  assert.ok(!commentMarker("TL-582").includes(commentMarker("TL-58")));  // renumber: allow
});

// ── The comment ───────────────────────────────────────────────────────────

test("ids sort by NUMBER, so -2 comes before -10", () => {
  assert.deepEqual(["T-10", "T-2", "T-1"].sort(compareTaskIds), ["T-1", "T-2", "T-10"]);
  assert.deepEqual(["B-1", "A-1"].sort(compareTaskIds), ["A-1", "B-1"]);
  assert.ok(compareTaskIds("T-3", "T-12") < 0);
  assert.ok(compareTaskIds("T-12", "T-3") > 0);
});

const COMMAND = { id: "unit", bash: "node --test x.test.mjs", manual: null, criteria: [] };
const BY_HAND = { id: "eyes", bash: null, manual: "the page looks right", criteria: [] };

test("the closing sentence claims a run only for a proven closing", () => {
  assert.equal(closingSentence({ reason: "proven", source: "done" }, [COMMAND]), "every check below ran and passed.");
  assert.equal(closingSentence({ reason: "unknown", source: "external" }, [COMMAND]),
    "the status was changed outside the tool, so no run of the checks below is recorded.");
  assert.equal(closingSentence({ reason: "", source: "boot" }, [COMMAND]),
    "the status was changed outside the tool, so no run of the checks below is recorded.");
  assert.equal(closingSentence({ reason: "unknown", source: "set" }, [COMMAND]),
    "no reason was stated, and no run of the checks below is recorded.");
  assert.equal(closingSentence({ source: "done" }, [COMMAND]),
    "no reason was stated, and no run of the checks below is recorded.");
  assert.equal(closingSentence({ reason: "shipped by hand", source: "set" }, [COMMAND]),
    "the stated reason is \u201cshipped by hand\u201d; no run of the checks below is recorded.");
});

// `done` records `proven` also when it closes a task whose `manual:` entries
// were vouched for, so the record alone cannot say that every check RAN.
test("a proven closing claims a run only for the checks that are commands", () => {
  const proven = { reason: "proven", source: "done" };
  assert.equal(closingSentence(proven, [COMMAND, { ...COMMAND, id: "lint", bash: "make lint" }]),
    "every check below ran and passed.", "only commands: every one ran");
  assert.equal(closingSentence(proven, [COMMAND, BY_HAND]),
    "every command check below ran and passed; the ones checked by a person were vouched for, not run.");
  assert.equal(closingSentence(proven, [BY_HAND, COMMAND]),
    "every command check below ran and passed; the ones checked by a person were vouched for, not run.",
    "the order of the entries does not decide it");
  assert.equal(closingSentence(proven, [BY_HAND]),
    "the checks below were vouched for by a person; none of them is a command, so none was run.");
  assert.equal(closingSentence(proven, [BY_HAND, { ...BY_HAND, id: "feel" }]),
    "the checks below were vouched for by a person; none of them is a command, so none was run.");
  assert.equal(closingSentence(proven, []),
    "the closing is recorded as proven, but no check is declared, so nothing was run.");
  for (const v of [[BY_HAND], []]) {
    assert.doesNotMatch(closingSentence(proven, v), /ran and passed/, "no command entry: nothing is said to have run");
  }
});

function sampleComment(overrides = {}) {
  return proofComment({
    id: "TASK-1",
    title: "A thing",
    ticket: { ok: true, url: "https://acme.atlassian.net/browse/APP-1", site: "https://acme.atlassian.net", key: "APP-1" },
    closing: {
      ts: "2026-11-07T10:00:00.000Z", field: "status", from: "in_progress", to: "done", actor: "agent:ci", source: "done",
      reason: "proven", contractCapability: { verdict: "capable", statement: "the run executed a file this task changed" },
    },
    contract: {
      verification: [
        { id: "unit", bash: "node --test x.test.mjs", manual: null, criteria: [{ text: "It parses", checked: true }] },
        { id: "eyes", bash: null, manual: "the page looks right", criteria: [] },
      ],
      verificationProblems: [],
    },
    vouched: [],
    ...overrides,
  });
}

test("a comment names the task, every check with what it proves, and the closing record", () => {
  const c = sampleComment();
  assert.match(c.text, /^Backlog task TASK-1 was closed in the repository: A thing/);
  assert.match(c.text, /Closed by agent:ci at 2026-11-07T10:00:00\.000Z, `in_progress` → `done`: every command check below ran and passed; the ones checked by a person were vouched for, not run\./);
  assert.doesNotMatch(c.text, /every check below ran and passed/, "the `eyes` check did not run, so not every check ran");
  assert.match(c.text, /Contract capability: capable — the run executed a file this task changed\./);
  assert.match(c.text, /- `unit`: `node --test x\.test\.mjs` — proves: It parses/);
  assert.match(c.text, /- `eyes`: checked by a person, not run: the page looks right — no acceptance criterion names this check/);
  assert.match(c.text, /\n\nVerification\n\n- `unit`: [^\n]*\n- `eyes`: /, "one list, one line per check");
  assert.ok(c.text.trimEnd().endsWith(c.marker), "the marker is the comment's last line");
  assert.equal(c.key, "APP-1");
});

test("a closing that recorded no run does not claim the checks ran", () => {
  const c = sampleComment({
    closing: { field: "status", from: "in_progress", to: "done", actor: "local:me", source: "manual", reason: "unknown" },
  });
  assert.doesNotMatch(c.text, /ran and passed/);
  assert.match(c.text, /changed outside the tool, so no run of the checks below is recorded/);
  assert.doesNotMatch(c.text, /Contract capability/);
});

test("the ADF says what the text says, as v1 nodes with no empty text", () => {
  const c = sampleComment();
  assert.equal(c.adf.type, "doc");
  assert.equal(c.adf.version, 1);
  const types = c.adf.content.map((n) => n.type);
  assert.deepEqual(types, ["paragraph", "paragraph", "paragraph", "paragraph", "bulletList", "paragraph"]);
  const texts = [];
  (function walk(n) {
    if (n.type === "text") {
      assert.ok(n.text.length > 0, "an empty text node is invalid ADF");
      texts.push(n.text);
    }
    for (const k of n.content || []) walk(k);
  })(c.adf);
  assert.ok(texts.includes("node --test x.test.mjs"));
  assert.ok(texts.includes(c.marker), "the marker is ONE text node, so a search of the stored body finds it whole");
  const list = c.adf.content[4];
  assert.equal(list.content.length, 2);
  assert.deepEqual(list.content.map((i) => i.type), ["listItem", "listItem"]);
  assert.deepEqual(list.content[0].content.map((n) => n.type), ["paragraph"]);
  assert.deepEqual(c.adf.content[2].content[1], { type: "text", text: "capable", marks: [{ type: "strong" }] });
  assert.deepEqual(c.adf.content[3].content, [{ type: "text", text: "Verification", marks: [{ type: "strong" }] }]);
  assert.deepEqual(list.content[0].content[0].content[0].marks, [{ type: "code" }]);
  // One block model behind both renderings.
  assert.deepEqual(renderAdf(commentBlocks(c)), c.adf);
});

test("a sparse record still reads as a sentence: no title, a first status, a vouch", () => {
  const c = sampleComment({
    title: "",
    closing: { ts: "T", field: "status", from: "", to: "done", actor: "local:me", source: "done", reason: "proven",
      contractCapability: { verdict: "undetermined" } },
    contract: { verification: [{ id: null, bash: "make", manual: null, criteria: [] }], verificationProblems: ["x"] },
    vouched: [{ command: "manual: looked at it", actor: "user:ann" }],
  });
  assert.equal(c.text, [
    "Backlog task TASK-1 was closed in the repository: (no title)",
    "",
    "Closed by local:me at T, `(new)` → `done`: every check below ran and passed.",
    "",
    "Contract capability: undetermined.",
    "",
    "Verification",
    "",
    "- `(no id)`: `make` — no acceptance criterion names this check",
    "",
    "Vouched for by user:ann: `manual: looked at it` — a person stood behind this; no command checked it.",
    "",
    c.marker,
    "",
  ].join("\n"));
  assert.equal(c.title, null);
  assert.deepEqual(c.verificationProblems, ["x"]);
  assert.equal(c.site, "https://acme.atlassian.net");
  assert.equal(c.url, "https://acme.atlassian.net/browse/APP-1");
  // Bold and code are marks in ADF, not characters.
  const first = c.adf.content[0].content;
  assert.deepEqual(first[1], { type: "text", text: "TASK-1", marks: [{ type: "strong" }] });
  assert.deepEqual(first[0], { type: "text", text: "Backlog task " });
  const vouch = c.adf.content[c.adf.content.length - 2].content;
  assert.deepEqual(vouch[1], { type: "text", text: "manual: looked at it", marks: [{ type: "code" }] });
});

test("several criteria on one check are joined, and an empty value never becomes an empty ADF node", () => {
  const c = sampleComment({
    contract: { verification: [{ id: "u", bash: "t", manual: null, criteria: [{ text: "A" }, { text: "B" }] }], verificationProblems: [] },
    vouched: [{ command: "", actor: "user:ann" }],
  });
  assert.match(c.text, /- `u`: `t` — proves: A; B\n/);
  const empty = [];
  (function walk(n) {
    if (n.type === "text" && !n.text) empty.push(n);
    for (const k of n.content || []) walk(k);
  })(c.adf);
  assert.deepEqual(empty, []);
});

test("a comment whose only checks are by hand says none of them ran", () => {
  const c = sampleComment({ contract: { verification: [BY_HAND], verificationProblems: [] } });
  assert.match(c.text, /`done`: the checks below were vouched for by a person; none of them is a command, so none was run\./);
  assert.match(c.text, /- `eyes`: checked by a person, not run: the page looks right/);
  assert.doesNotMatch(c.text, /ran and passed/);
});

test("a capability verdict with no verdict is left out rather than printed empty", () => {
  const c = sampleComment({
    closing: { ts: "T", from: "a", to: "done", actor: "x:y", source: "done", reason: "proven", contractCapability: {} },
  });
  assert.doesNotMatch(c.text, /Contract capability/);
});

test("the person's report: each comment under its ticket, then the skipped ones counted", () => {
  const c = sampleComment();
  assert.equal(renderReport({ scanned: false, reason: "no range" }), "no range\n");
  assert.equal(renderReport({ scanned: true, base: "b", comments: [], skipped: [] }),
    "Nothing to post: no Jira-linked task entered the closed status between `b` and HEAD.\n");
  assert.equal(
    renderReport({ scanned: true, base: "b", comments: [c], skipped: [
      { task: "TASK-2", reason: "no-jira-marker" }, { task: "TASK-3", reason: "malformed-jira-marker" },
      { task: "TASK-4", reason: "no-task-file" }, { task: "TASK-5", reason: "other-site" },
    ] }),
    "── TASK-1 → APP-1  https://acme.atlassian.net/browse/APP-1\n\n" + c.text + "\n" +
    "skipped 4 closed tasks:\n" +
    "  TASK-2  no `Imported from Jira:` line\n" +
    "  TASK-3  its Jira line is not a browse URL\n" +
    "  TASK-4  its task file is not in this tree\n" +
    "  TASK-5  its ticket is on another Jira site\n",
  );
  // One skipped task is counted in the singular: the plural above leaves the
  // singular word unasserted.
  assert.equal(
    renderReport({ scanned: true, base: "b", comments: [c], skipped: [{ task: "TASK-2", reason: "no-jira-marker" }] }),
    "── TASK-1 → APP-1  https://acme.atlassian.net/browse/APP-1\n\n" + c.text + "\n" +
    "skipped 1 closed task:\n" +
    "  TASK-2  no `Imported from Jira:` line\n",
  );
});

test("a task with no verification says so instead of an empty list", () => {
  const c = sampleComment({ contract: { verification: [], verificationProblems: [] } });
  assert.match(c.text, /This task declares no verification\./);
  assert.match(c.text, /`done`: the closing is recorded as proven, but no check is declared, so nothing was run\./);
  assert.ok(!c.adf.content.some((n) => n.type === "bulletList"));
});

test("normalizeSite compares sites without a trailing slash, and refuses a query", () => {
  assert.equal(normalizeSite("https://a.atlassian.net///"), "https://a.atlassian.net");
  assert.equal(normalizeSite("https://a.atlassian.net/?x=1"), null);
  assert.equal(normalizeSite("not a url"), null);
  // A self-hosted Jira on plain http is still a site; any other scheme is not.
  assert.equal(normalizeSite("http://jira.internal:8080/jira/"), "http://jira.internal:8080/jira");
  assert.equal(normalizeSite("file:///etc/jira"), null);
});

// ── A real repository ─────────────────────────────────────────────────────

function git(dir, args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}
function commit(dir, message) {
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "--allow-empty", "-m", message]);
  return git(dir, ["rev-parse", "HEAD"]);
}
function repo() {
  const dir = fixtureDir(join(tmpdir(), "branchling-jiraproof-" + counter++ + "-"));
  git(dir, ["init", "-q", "-b", "main", "."]);
  git(dir, ["config", "user.email", "t@example.test"]);
  git(dir, ["config", "user.name", "Test"]);
  assert.equal(run(dir, ["init", "--dir", "backlog", "--no-example"]).status, 0);
  commit(dir, "the backlog exists");
  return dir;
}
function newTask(dir, title, context) {
  const doc = {
    goal: "Do " + title.toLowerCase(),
    context,
    verification: [{ id: "always", bash: "true", proves: "The outcome of " + title.toLowerCase() + " holds" }],
  };
  const r = run(dir, ["new", "--dir", "backlog", "--title", title, "--json"], JSON.stringify(doc));
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).id;
}
function take(dir, id) {
  const r = run(dir, ["take", id, "--dir", "backlog", "--actor", "local:me"]);
  assert.equal(r.status, 0, r.stderr);
}
function done(dir, id) {
  const r = run(dir, ["done", id, "--dir", "backlog", "--actor", "local:me"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
const jira = (site, key) => "Imported from Jira: " + site + "/browse/" + key;

test("over a range: exactly the Jira-linked closings, the rest counted as skipped", () => {
  const dir = repo();
  const SITE = "https://acme.atlassian.net";
  const linked = newTask(dir, "Linked and closed", jira(SITE, "APP-1"));
  const moved = newTask(dir, "Linked and only started", jira(SITE, "APP-2"));
  const plain = newTask(dir, "Closed with no ticket", "Written here, never in Jira.");
  const elsewhere = newTask(dir, "Linked to another site", jira("https://other.atlassian.net", "OPS-9"));
  const base = commit(dir, "four tasks exist");

  take(dir, linked); done(dir, linked);
  take(dir, moved);
  take(dir, plain); done(dir, plain);
  take(dir, elsewhere); done(dir, elsewhere);
  commit(dir, "the work is done");

  // No `build` is ever run: on CI nothing has been rebuilt either.
  const r = run(dir, ["jira-proof", "--dir", "backlog", "--base", base, "--site", SITE + "/", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.kind, "jira-proof");
  assert.equal(doc.scanned, true);
  assert.equal(doc.site, SITE);
  assert.deepEqual(doc.closedStatuses, ["done"]);

  assert.deepEqual(doc.comments.map((c) => c.task), [linked], "only the Jira-linked task that CLOSED is reported");
  const c = doc.comments[0];
  assert.equal(c.key, "APP-1");
  assert.equal(c.url, SITE + "/browse/APP-1");
  assert.equal(c.title, "Linked and closed");
  assert.deepEqual(c.verification.map((v) => [v.id, v.bash, v.criteria.map((x) => x.text)]),
    [["always", "true", ["The outcome of linked and closed holds"]]]);
  // The record `done` wrote, not one reconstructed from the task file.
  assert.equal(c.closing.to, "done");
  assert.equal(c.closing.reason, "proven");
  assert.equal(c.closing.source, "done");
  assert.equal(c.closing.actor, "local:me");
  assert.ok(c.closing.contractCapability && c.closing.contractCapability.verdict, "the closing run's verdict travels with it");
  assert.match(c.text, /every check below ran and passed/);
  assert.equal(c.marker, commentMarker(linked));

  assert.deepEqual(doc.skipped, [
    { task: plain, reason: "no-jira-marker" },
    { task: elsewhere, reason: "other-site", site: "https://other.atlassian.net" },
  ]);
  assert.ok(!doc.skipped.some((s) => s.task === moved), "a task that did not close is neither posted nor skipped");

  // The person's view says the same, with the count.
  const text = run(dir, ["jira-proof", "--dir", "backlog", "--base", base, "--site", SITE]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, new RegExp(linked + " → APP-1"));
  assert.match(text.stdout, /skipped 2 closed tasks:/);
  assert.match(text.stdout, new RegExp(plain + "\\s+no `Imported from Jira:` line"));

  // Without `--site`, the other site's task is a comment like any other.
  const all = JSON.parse(run(dir, ["jira-proof", "--dir", "backlog", "--base", base, "--json"]).stdout);
  assert.deepEqual(all.comments.map((x) => x.task), [linked, elsewhere]);
  assert.deepEqual(all.skipped, [{ task: plain, reason: "no-jira-marker" }]);
});

// Every other fixture test starts the CLI inside the repository, so a git
// runner that dropped its `cwd` would still read the right one (TL-642).
test("the range is read in the repository --dir names, not where the command was started", () => {
  const dir = repo();
  const SITE = "https://acme.atlassian.net";
  const linked = newTask(dir, "Linked and closed", jira(SITE, "APP-1"));
  const base = commit(dir, "a linked task exists");
  take(dir, linked); done(dir, linked);
  commit(dir, "the work is done");

  const elsewhere = fixtureDir(join(tmpdir(), "branchling-jiraproof-elsewhere-" + counter++ + "-"));
  const r = run(elsewhere, ["jira-proof", "--dir", join(dir, "backlog"), "--base", base, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.scanned, true, doc.reason);
  assert.deepEqual(doc.comments.map((c) => [c.task, c.key]), [[linked, "APP-1"]]);
});

test("in process: the diff is read over the history directory, in id order, a vouch kept", () => {
  const dir = repo();
  const linked = newTask(dir, "Linked", jira("https://acme.atlassian.net", "APP-1"));
  const plain = newTask(dir, "Plain", "No ticket.");
  commit(dir, "two tasks");
  const closed = (task) => JSON.stringify({ task, field: "status", from: "in_progress", to: "done", ts: "T", actor: "local:me", source: "done", reason: "proven" });
  const diff = [
    "+++ b/backlog/history/x.jsonl",
    "+" + closed("TASK-10"),
    "+" + closed(plain),
    "+" + JSON.stringify({ task: linked, field: "__verified__", to: "manual: read it", ts: "S", actor: "user:ann" }),
    "+" + closed(linked),
  ].join("\n");
  const calls = [];
  const fake = (cwd, args) => { calls.push(args); return { status: 0, stdout: diff }; };
  const root = join(dir, "backlog");
  const model = buildProof({ root, config: loadConfig(root), base: "BASE", run: fake });
  assert.deepEqual(calls, [["diff", "--unified=0", "BASE", "HEAD", "--", "backlog/history"]]);
  assert.equal(model.scanned, true);
  assert.equal(model.site, null);
  assert.deepEqual(model.comments.map((c) => c.task), [linked]);
  assert.deepEqual(model.comments[0].vouched, [{ command: "manual: read it", actor: "user:ann" }]);
  assert.equal(model.comments[0].title, "Linked");
  assert.deepEqual(model.skipped, [{ task: plain, reason: "no-jira-marker" }, { task: "TASK-10", reason: "no-task-file" }]);

  const failed = buildProof({ root, config: loadConfig(root), base: "BASE", run: () => ({ status: 128, stdout: "" }) });
  assert.equal(failed.scanned, false);
  assert.equal(failed.reason, "`git diff BASE HEAD` failed — is `BASE` a commit this clone has? On CI a shallow checkout often does not.");
  assert.deepEqual(failed.comments, []);
  assert.deepEqual(failed.skipped, []);
  assert.deepEqual(failed.closedStatuses, ["done"]);
});

test("outside git it answers that there is no range, not that nothing closed", () => {
  const dir = fixtureDir(join(tmpdir(), "branchling-jiraproof-nogit-" + counter++ + "-"));
  assert.equal(run(dir, ["init", "--dir", "backlog", "--no-example"]).status, 0);
  const root = join(dir, "backlog");
  const model = buildProof({ root, config: loadConfig(root), base: "HEAD", run: () => assert.fail("git was run outside a repository") });
  assert.equal(model.scanned, false);
  assert.equal(model.reason, "not a git repository — there is no range to read closings from");
});

test("an empty range is a complete envelope with nothing to post", () => {
  const dir = repo();
  newTask(dir, "Linked", jira("https://acme.atlassian.net", "APP-1"));
  commit(dir, "a task exists");
  const r = run(dir, ["jira-proof", "--dir", "backlog", "--base", "HEAD", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.scanned, true);
  assert.equal(doc.reason, "ok");
  assert.deepEqual(doc.comments, []);
  assert.deepEqual(doc.skipped, []);
  for (const key of ["base", "site", "scanned", "reason", "closedStatuses", "comments", "skipped", "ok"]) {
    assert.ok(key in doc, "the envelope lacks `" + key + "`");
  }
  const text = run(dir, ["jira-proof", "--dir", "backlog", "--base", "HEAD"]);
  assert.match(text.stdout, /^Nothing to post: no Jira-linked task entered the closed status between `HEAD` and HEAD\./);
});

test("a base this clone does not have is named, not reported as an empty range", () => {
  const dir = repo();
  const r = run(dir, ["jira-proof", "--dir", "backlog", "--base", "no-such-ref", "--json"]);
  assert.equal(r.status, 0);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.scanned, false);
  assert.match(doc.reason, /is `no-such-ref` a commit this clone has/);
});

// ── The CI job ────────────────────────────────────────────────────────────

const yml = readFileSync(EXAMPLE, "utf8");

/** Every `<key>: |` block, dedented — the same narrow reading
 *  `pr-summary-workflow.test.mjs` uses; this package has no YAML parser. */
function blocksUnder(text, key) {
  const lines = text.split("\n");
  const re = new RegExp("^\\s*" + key + ":\\s*\\|\\s*$");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i])) continue;
    const indent = lines[i].match(/^\s*/)[0].length;
    const body = [];
    for (const line of lines.slice(i + 1)) {
      if (line.trim() && line.match(/^\s*/)[0].length <= indent) break;
      body.push(line.slice(indent + 2));
    }
    out.push(body.join("\n"));
  }
  return out;
}

test("the job's invocation is one this command's own parser accepts", () => {
  const runs = blocksUnder(yml, "run");
  assert.equal(runs.length, 1, "one `run:` block: the invocation, and nothing that reads the backlog itself");
  const line = runs[0].replace(/\\\n\s*/g, " ").replace(/>\s*\S+\s*$/, "").trim();
  const tokens = line.replace(/\$\{\{[^}]*\}\}/g, "EXPRESSION").replace(/["']/g, "").split(/\s+/);
  const at = tokens.indexOf("jira-proof");
  assert.equal(tokens.slice(0, at).join(" "), "npx --yes " + PRODUCT_NAME);
  const parsed = parseJiraProofArgs(tokens.slice(at + 1).map((t) => (t === "$JIRA_SITE" ? "https://site.example" : t)));
  assert.equal(parsed.json, true, "the job reads the comments as data");
  assert.match(runs[0], /--base "\$\{\{ github\.event\.before \}\}"/, "the range starts at the commit before the push");
  assert.match(runs[0], /--site "\$JIRA_SITE"/, "the command filters to the site the job holds credentials for");
  assert.match(yml, /fetch-depth: 0/);
  assert.match(yml, /branches: \[main\]/);
});

test("the Jira credentials come from CI secrets and nowhere else", () => {
  for (const name of ["JIRA_SITE", "JIRA_EMAIL", "JIRA_API_TOKEN"]) {
    assert.match(yml, new RegExp(name + ": \\$\\{\\{ secrets\\." + name + " \\}\\}"), name + " is not read from secrets");
  }
  assert.doesNotMatch(yml, /atlassian\.net\/rest/, "no site is written into the job");
});

/** A fake Jira: comments per issue key, paged by `maxResults`. */
function fakeJira(site, pageSize = 2) {
  const issues = new Map();
  const calls = [];
  async function fetch(url, init = {}) {
    calls.push({ url, method: init.method || "GET" });
    const u = new URL(url);
    assert.equal(u.origin, new URL(site).origin, "the job called a host other than JIRA_SITE");
    assert.match(init.headers.Authorization, /^Basic /);
    const m = u.pathname.match(/^\/rest\/api\/3\/issue\/([^/]+)\/comment$/);
    assert.ok(m, "an endpoint the job has no business calling: " + u.pathname);
    const key = decodeURIComponent(m[1]);
    if (!issues.has(key)) issues.set(key, []);
    const list = issues.get(key);
    if ((init.method || "GET") === "POST") {
      const body = JSON.parse(init.body).body;
      assert.equal(body.type, "doc");
      list.push({ id: String(list.length + 1), body });
      return { ok: true, status: 201, json: async () => ({}), text: async () => "" };
    }
    const startAt = Number(u.searchParams.get("startAt") || 0);
    const comments = list.slice(startAt, startAt + pageSize);
    return { ok: true, status: 200, json: async () => ({ startAt, total: list.length, comments }), text: async () => "" };
  }
  return { fetch, issues, calls };
}

async function post(doc, jiraApi) {
  const script = blocksUnder(yml, "script")[0];
  assert.ok(script, "no `script: |` block in the job");
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const failed = [];
  const fs = { readFileSync: (path) => { assert.equal(path, "jira-proof.json"); return JSON.stringify(doc); } };
  const core = { info() {}, setFailed: (m) => failed.push(m) };
  const env = { JIRA_SITE: "https://acme.atlassian.net/", JIRA_EMAIL: "ci@example.test", JIRA_API_TOKEN: "t0ken" };
  const fn = new AsyncFunction("require", "core", "fetch", "process", "Buffer", script);
  await fn((name) => { assert.equal(name, "node:fs"); return fs; }, core, jiraApi.fetch, { env }, Buffer);
  return failed;
}

test("the posting step posts one comment per ticket, and nothing on a re-run", async () => {
  const jiraApi = fakeJira("https://acme.atlassian.net");
  // Two unrelated comments already on the ticket push the marker search onto a
  // second page the first time round — a job that read one page would repost.
  jiraApi.issues.set("APP-1", [{ id: "a", body: { type: "doc", content: [] } }, { id: "b", body: { type: "doc", content: [] } }]);
  const doc = {
    scanned: true, reason: "ok", skipped: [{ task: "TASK-3", reason: "no-jira-marker" }],
    comments: [sampleComment(), { ...sampleComment(), task: "TASK-2", key: "APP-7", marker: commentMarker("TASK-2") }],
  };
  doc.comments[1].adf = renderAdf(commentBlocks(doc.comments[1]));

  assert.deepEqual(await post(doc, jiraApi), []);
  assert.equal(jiraApi.issues.get("APP-1").length, 3);
  assert.equal(jiraApi.issues.get("APP-7").length, 1);
  assert.ok(JSON.stringify(jiraApi.issues.get("APP-1")[2].body).includes(commentMarker("TASK-1")));

  // The marker is now on the second page of APP-1's comments.
  assert.deepEqual(await post(doc, jiraApi), []);
  assert.equal(jiraApi.issues.get("APP-1").length, 3, "a re-run posted a second comment for the same task");
  assert.equal(jiraApi.issues.get("APP-7").length, 1, "a re-run posted a second comment for the same task");
});

test("the posting step fails when the range could not be read, and posts nothing", async () => {
  const jiraApi = fakeJira("https://acme.atlassian.net");
  const failed = await post({ scanned: false, reason: "no base", comments: [], skipped: [] }, jiraApi);
  assert.deepEqual(failed, ["no base"]);
  assert.equal(jiraApi.calls.length, 0);
});
