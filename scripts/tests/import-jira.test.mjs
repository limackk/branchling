/**
 * `import --from jira` — Jira Cloud issues, brought over from stdin the way
 * GitHub issues are (TL-581).
 *
 * WHAT HAS TO BE PROVED, beyond what the GitHub suite already proves for the
 * shared planner and writer:
 *
 *   1. **The description is converted, and nothing in it vanishes.** Each known
 *      ADF node is asserted by the markdown it becomes; an unknown node is
 *      asserted twice — its text is in the body AND it is counted — because a
 *      converter that dropped it would pass either check alone.
 *   2. **Status by category, or by name when told.** Asserted against a
 *      vocabulary that is not ours (`icebox | doing | shipped`), so a mapping
 *      onto literals cannot pass.
 *   3. **The browse URL is the identity.** A re-run creates nothing, controlled
 *      by a ticket that DOES land on the third run.
 *   4. **Malformed input is refused with every complaint at once**, and nothing
 *      is written.
 *
 * The fixture (`fixtures/jira-search.json`) follows the shape of a Jira Cloud
 * REST API v3 `search/jql` response with `fields=summary,description,status,
 * labels,priority`. This repository does not use Jira, so dogfooding will never
 * exercise that shape; the fixture is the only place it is pinned.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../config.mjs";
import { importedSources, parseImportArgs, planImport } from "../import.mjs";
import { SOURCE_MARKER, adfToMarkdown, browseUrl, parseJiraIssues, renderBody } from "../import-jira.mjs";
import { SOURCE_MARKER as GITHUB_MARKER } from "../import-github.mjs";

import { isolateHome, sourceRoot } from "./_repo.mjs";

isolateHome("import-jira");

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, "..");
const CLI = join(SCRIPTS, "cli.mjs");
const FIXTURE = join(HERE, "fixtures", "jira-search.json");
const GH_FIXTURE = join(HERE, "fixtures", "gh-issues.json");

let counter = 0;
function tmp(prefix) {
  return fixtureDir(join(tmpdir(), "branchling-import-jira-" + prefix + "-" + counter++ + "-"));
}

function run(args, input) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, input: input === undefined ? "" : input,
    env: { ...process.env, NO_COLOR: "1" },
  });
}

function backlog(prefix) {
  const dir = tmp(prefix);
  const r = run(["init", "--dir", dir, "--no-example"]);
  assert.equal(r.status, 0, "init failed: " + r.stderr);
  return dir;
}

function taskFiles(dir) {
  const tasks = join(dir, "tasks");
  return existsSync(tasks) ? readdirSync(tasks).filter((f) => f.endsWith(".md")) : [];
}

function tasksByMarker(dir) {
  const out = new Map();
  for (const f of taskFiles(dir)) {
    const text = readFileSync(join(dir, "tasks", f), "utf8");
    const m = text.match(/^Imported from Jira: (\S+)$/m);
    if (m) out.set(m[1], text);
  }
  return out;
}

function field(text, key) {
  const m = text.match(new RegExp("^" + key + ": (.*)$", "m"));
  return m ? m[1].replace(/\s+#.*$/, "").trim() : null;
}

const search = () => readFileSync(FIXTURE, "utf8");
const BROWSE = (key) => "https://acme.atlassian.net/browse/" + key;

function importInto(dir, extra = [], input) {
  return run(["import", "--from", "jira", "--dir", dir].concat(extra), input === undefined ? search() : input);
}

/** One ticket in the fixture's shape, for inputs the fixture does not hold. */
function ticket(key, { summary = "A ticket " + key, category = "new", name = "To Do", description = null } = {}) {
  return {
    id: "1" + key.replace(/\D/g, ""), key, self: "https://acme.atlassian.net/rest/api/3/issue/1" + key.replace(/\D/g, ""),
    fields: { summary, status: { name, statusCategory: { key: category } }, labels: [], description },
  };
}

// ── The invocation ────────────────────────────────────────────────────────

test("jira is a known source, and --status takes from=to", () => {
  const opts = parseImportArgs(["--from", "jira", "--status", "In Review=in_progress", "--status", "Won't Do=cancelled"]);
  assert.equal(opts.from, "jira");
  assert.equal(opts.statusMap.get("In Review"), "in_progress");
  assert.equal(opts.statusMap.get("Won't Do"), "cancelled");
  assert.throws(() => parseImportArgs(["--from", "jira", "--status", "In Review"]), /is not a mapping/);
  assert.throws(() => parseImportArgs(["--from", "jira", "--status", "In Review="]), /is not a mapping/);
  assert.throws(() => parseImportArgs(["--from", "jira", "--status"]), /with no mapping/);
});

test("--status is refused for GitHub rather than ignored", () => {
  assert.throws(() => parseImportArgs(["--from", "github", "--status", "open=pending"]), /maps a Jira workflow status/);
  const r = run(["import", "--from", "github", "--status", "open=pending"], "[]");
  assert.equal(r.status, 2, r.stdout + r.stderr);
});

test("--priority takes from=to, and is refused for GitHub rather than ignored", () => {
  const opts = parseImportArgs(["--from", "jira", "--priority", "High=P1", "--priority", "Lowest=P3"]);
  assert.equal(opts.priorityMap.get("High"), "P1");
  assert.equal(opts.priorityMap.get("Lowest"), "P3");
  assert.equal(parseImportArgs(["--from", "jira"]).priorityMap.size, 0);
  assert.throws(
    () => parseImportArgs(["--from", "jira", "--priority", "High"]),
    /`--priority High` is not a mapping\nit takes `<from>=<to>`: a Jira priority name, and one of this project's priorities/
  );
  // The refusal of an unknown flag names every accepted one, `--priority` among them.
  assert.throws(
    () => parseImportArgs(["--from", "jira", "--priorty", "High=P1"]),
    (e) => e.message === "unknown flag: --priorty\navailable: --from --dry-run --json --actor --reason --label --label-map --status --priority"
  );
  assert.throws(() => parseImportArgs(["--from", "jira", "--priority", "High="]), /is not a mapping/);
  assert.throws(() => parseImportArgs(["--from", "jira", "--priority"]), /`--priority` with no mapping/);
  assert.throws(() => parseImportArgs(["--from", "github", "--priority", "High=P1"]), /`--priority` maps a Jira priority/);
  const r = run(["import", "--from", "github", "--priority", "High=P1"], "[]");
  assert.equal(r.status, 2, r.stdout + r.stderr);
});

test("the help shows the Jira pipeline against the paged search endpoint", () => {
  const r = run(["import", "--help"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--from jira/);
  assert.match(r.stdout, /\/rest\/api\/3\/search\/jql/);
  assert.match(r.stdout, /nextPageToken/);
  assert.match(r.stdout, /--status <from>=<to>/);
  assert.match(r.stdout, /--priority <from>=<to>/);
});

// ── Atlassian Document Format ─────────────────────────────────────────────

const doc = (...content) => ({ type: "doc", version: 1, content });
const p = (...content) => ({ type: "paragraph", content });
const t = (text, ...marks) => ({ type: "text", text, ...(marks.length ? { marks } : {}) });

test("every known node becomes the markdown a reader expects", () => {
  const { markdown, unknown } = adfToMarkdown(doc(
    { type: "heading", attrs: { level: 3 }, content: [t("Title")] },
    p(t("a "), t("b", { type: "strong" }), t(" "), t("c", { type: "em" }), t(" "), t("d", { type: "code" }), t(" "),
      t("e", { type: "link", attrs: { href: "https://x.test" } }), { type: "hardBreak" }, t("f")),
    { type: "bulletList", content: [
      { type: "listItem", content: [p(t("one")), { type: "bulletList", content: [{ type: "listItem", content: [p(t("nested"))] }] }] },
      { type: "listItem", content: [p(t("two"))] },
    ] },
    { type: "orderedList", attrs: { order: 3 }, content: [
      { type: "listItem", content: [p(t("third"))] }, { type: "listItem", content: [p(t("fourth"))] },
    ] },
    { type: "codeBlock", attrs: { language: "js" }, content: [t("let x = 1;\nx++;")] },
    { type: "blockquote", content: [p(t("quoted")), p(t("twice"))] },
    { type: "rule" },
  ));
  assert.equal(markdown, [
    "### Title",
    "",
    "a **b** *c* `d` [e](https://x.test)\\",
    "f",
    "",
    "- one",
    "  - nested",
    "- two",
    "",
    "3. third",
    "4. fourth",
    "",
    "```js",
    "let x = 1;",
    "x++;",
    "```",
    "",
    "> quoted",
    ">",
    "> twice",
    "",
    "---",
  ].join("\n"));
  assert.equal(unknown.size, 0, "a known node was counted as unknown: " + [...unknown.keys()].join(", "));
});

test("an unknown node keeps its text AND is counted — neither alone would prove it", () => {
  const { markdown, unknown } = adfToMarkdown(doc(
    { type: "panel", attrs: { panelType: "info" }, content: [p(t("inside a panel"))] },
    p(t("hi "), { type: "mention", attrs: { id: "x", text: "@Sam" } }, t(" "), t("under", { type: "underline" })),
    { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [p(t("cell text"))] }] }] },
  ));
  assert.match(markdown, /inside a panel/);
  assert.match(markdown, /hi @Sam under/);
  assert.match(markdown, /cell text/);
  assert.deepEqual(Object.fromEntries(unknown), {
    panel: 1, mention: 1, "mark:underline": 1, table: 1, tableRow: 1, tableCell: 1,
  });
});

test("marks combine, attributes have defaults, and a repeated unknown node is counted each time", () => {
  const { markdown, unknown } = adfToMarkdown(doc(
    p(t("both", { type: "strong" }, { type: "em" }), t(" "), t("plain link", { type: "link", attrs: {} })),
    { type: "heading", content: [t("no level")] },
    { type: "heading", attrs: { level: 9 }, content: [t("too deep")] },
    { type: "codeBlock", content: [t("x")] },
    { type: "panel", content: [p(t("one"))] },
    { type: "panel", content: [p(t("two"))] },
    p({ type: "emoji", attrs: { shortName: ":tada:" } }, t(" "), { type: "inlineCard", attrs: { url: "https://card.test" } }),
  ));
  assert.equal(markdown, [
    "***both*** plain link",
    "",
    "# no level",
    "",
    "###### too deep",
    "",
    "```",
    "x",
    "```",
    "",
    "one",
    "",
    "two",
    "",
    ":tada: https://card.test",
  ].join("\n"));
  assert.deepEqual(Object.fromEntries(unknown), { panel: 2, emoji: 1, inlineCard: 1 });
});

test("no description is an empty body, not an error", () => {
  assert.equal(adfToMarkdown(null).markdown, "");
});

test("the browse URL comes from self and key, keeping a context path", () => {
  assert.equal(browseUrl("https://acme.atlassian.net/rest/api/3/issue/10101", "APP-101"), BROWSE("APP-101"));
  assert.equal(browseUrl("https://jira.example.test/jira/rest/api/3/issue/7", "OPS-7"), "https://jira.example.test/jira/browse/OPS-7");
  assert.equal(browseUrl("https://acme.atlassian.net/browse/APP-1", "APP-1"), null, "a URL that is not the REST API");
  assert.equal(browseUrl("not a url", "APP-1"), null);
  assert.equal(browseUrl("ftp://acme.test/rest/api/3/issue/1", "APP-1"), null, "only http(s) is a site anybody browses");
  assert.equal(browseUrl(undefined, "APP-1"), null);
  assert.equal(browseUrl("https://acme.atlassian.net/rest/api/3/issue/1", ""), null);
});

// ── Reading the search response ───────────────────────────────────────────

test("one page and an array of pages are both read", () => {
  const one = parseJiraIssues(search());
  assert.deepEqual(one.errors, []);
  assert.deepEqual(one.issues.map((i) => i.ref), ["APP-101", "APP-102", "APP-103"]);

  const page = JSON.parse(search());
  const pages = [{ issues: page.issues.slice(0, 2), nextPageToken: "t1", isLast: false }, { issues: page.issues.slice(2), isLast: true }];
  const many = parseJiraIssues(JSON.stringify(pages));
  assert.deepEqual(many.errors, []);
  assert.deepEqual(many.issues.map((i) => i.ref), ["APP-101", "APP-102", "APP-103"]);
  assert.equal(many.issues[0].url, BROWSE("APP-101"));
  assert.equal(many.issues[0].priority, "High");
  assert.deepEqual(many.issues[0].labels, ["backend", "needs-triage"]);
});

test("malformed input is refused with every complaint at once, and nothing is kept", () => {
  assert.match(parseJiraIssues("not json").errors[0], /not valid JSON/);
  assert.match(parseJiraIssues(JSON.stringify(ticket("APP-1"))).errors[0], /looks like ONE issue/);

  const bad = {
    issues: [
      ticket("APP-1"), // valid, and still not imported once anything else is wrong
      { key: "APP-2", self: "https://acme.atlassian.net/rest/api/3/issue/2", fields: { summary: "", status: { statusCategory: { key: "weird" } } } },
      { ...ticket("APP-3"), fields: { ...ticket("APP-3").fields, description: "h2. Wiki markup" } },
      { self: "https://acme.atlassian.net/rest/api/3/issue/4", fields: { summary: "no key" } },
      { key: "APP-5", self: "https://acme.atlassian.net/rest/api/3/issue/5" },
      ticket("APP-1"),
    ],
  };
  const { issues, errors } = parseJiraIssues(JSON.stringify(bad));
  assert.equal(issues.length, 0, "a refusal must not hand back a partial list to write");
  const all = errors.join("\n");
  assert.match(all, /issue APP-2: no `fields\.summary`/);
  assert.match(all, /issue APP-2: `fields\.status\.statusCategory\.key: weird`/);
  assert.match(all, /issue APP-3: .*wiki markup.*\/rest\/api\/3\/search\/jql/);
  assert.match(all, /issue 4 \(no `key`\): no `key`/);
  assert.match(all, /issue APP-5: no `fields`/);
  assert.match(all, /issue APP-1: appears more than once in the input \(also at the input, issue 1\) — the pages overlap/);
  assert.equal(errors.length, 7, "one line per complaint:\n" + all);
});

test("every field the parser reads is checked for its shape, and each refusal says what it saw", () => {
  const base = ticket("APP-9");
  const with_ = (fields) => ({ ...base, fields: { ...base.fields, ...fields } });
  const { errors } = parseJiraIssues(JSON.stringify([
    null,
    [],
    {},
    { issues: [null, 7, { ...base, key: "APP-10", self: undefined }, { ...base, key: "APP-11", fields: "summary" }] },
    { issues: [
      with_({ summary: "   " }),
      { ...with_({ summary: 42 }), key: "APP-18" },
      { ...with_({ status: {} }), key: "APP-12" },
      { ...with_({ description: { type: "paragraph" } }), key: "APP-13" },
      { ...with_({ description: 5 }), key: "APP-14" },
      { ...with_({ labels: "backend" }), key: "APP-15" },
      { ...with_({ labels: ["ok", 3] }), key: "APP-16" },
      { ...base, key: "APP-17", self: "https://acme.atlassian.net/browse/APP-17" },
    ] },
  ]));
  const all = errors.join("\n");
  assert.match(all, /^page 1 is not a search response object$/m);
  assert.match(all, /^page 2 is not a search response object$/m);
  assert.match(all, /^page 3 has no `issues` array/m);
  assert.doesNotMatch(all, /page 3 .*ONE issue/, "a page with no key is not mistaken for an issue");
  assert.match(all, /^page 4, issue 1 is not an object$/m);
  assert.match(all, /^page 4, issue 2 is not an object$/m);
  assert.match(all, /issue APP-10: `self: \(missing\)` is not a Jira REST URL/);
  assert.match(all, /issue APP-11: no `fields`/);
  assert.match(all, /issue APP-9: no `fields\.summary`/);
  assert.match(all, /issue APP-18: no `fields\.summary`/, "a summary that is not a string is no title either");
  assert.match(all, /issue APP-12: `fields\.status\.statusCategory\.key: \(missing\)` is none of new \| indeterminate \| done/);
  assert.match(all, /issue APP-13: `fields\.description` is not an Atlassian Document Format `doc` node/);
  assert.match(all, /issue APP-14: `fields\.description` is not an Atlassian Document Format `doc` node/);
  assert.match(all, /issue APP-15: `fields\.labels` is not an array of strings/);
  assert.match(all, /issue APP-16: `fields\.labels` is not an array of strings/);
  assert.match(all, /issue APP-17: `self: https:\/\/acme\.atlassian\.net\/browse\/APP-17` is not a Jira REST URL/);
  assert.equal(errors.length, 15, all);
});

test("what an issue is read as: trimmed, defaulted, and nothing invented", () => {
  const bare = { ...ticket(" APP-20 ", { summary: "  Padded title  " }), self: "https://acme.atlassian.net/rest/api/3/issue/20" };
  delete bare.fields.status.name;
  bare.fields.labels = null;
  const { issues, errors } = parseJiraIssues(JSON.stringify({ issues: [bare] }));
  assert.deepEqual(errors, []);
  const [issue] = issues;
  assert.equal(issue.ref, "APP-20");
  assert.equal(issue.url, BROWSE("APP-20"));
  assert.equal(issue.title, "Padded title");
  assert.deepEqual(issue.labels, []);
  assert.equal(issue.statusName, "", "a status with no name cannot be matched by --status");
  assert.equal(issue.sourceState, "new", "with no name, the category is the state reported");
  assert.equal(issue.priority, "");
  assert.equal(issue.body, "");
  const body = renderBody(issue);
  assert.doesNotMatch(body, /Jira priority|converter does not know/, "a note about nothing was written");
});

// ── The plan, against a project's vocabulary ──────────────────────────────

const CONFIG = (over = {}) => ({
  statuses: ["icebox", "doing", "review", "shipped"],
  archivedStatuses: ["shipped"],
  inProgressStatus: "doing",
  labels: [],
  labelsClosed: false,
  ...over,
});

test("a status maps by its category onto THIS project's statuses", () => {
  const { issues } = parseJiraIssues(search());
  const plan = planImport({ issues, config: CONFIG(), labelMap: new Map(), alreadyImported: new Set() });
  assert.deepEqual(plan.items.map((i) => i.status), ["icebox", "shipped", "doing"]);

  // A project with no in-progress status keeps work under way in the queue.
  const flat = planImport({ issues, config: CONFIG({ inProgressStatus: null }), labelMap: new Map(), alreadyImported: new Set() });
  assert.equal(flat.items[2].status, "icebox");
});

test("--status names a status more precisely than its category, and must name one of ours", () => {
  const { issues } = parseJiraIssues(search());
  const plan = planImport({
    issues, config: CONFIG(), labelMap: new Map(), statusMap: new Map([["In Review", "review"]]), alreadyImported: new Set(),
  });
  assert.deepEqual(plan.items.map((i) => i.status), ["icebox", "shipped", "review"]);

  const wrong = planImport({
    issues, config: CONFIG(), labelMap: new Map(), statusMap: new Map([["In Review", "qa"]]), alreadyImported: new Set(),
  });
  assert.equal(wrong.items.length, 0);
  assert.match(wrong.errors.join("\n"), /`qa` is not one of this project's statuses/);
});

test("--priority maps a named Jira priority onto ONE of ours, and only that one", () => {
  const { issues } = parseJiraIssues(search());
  const config = CONFIG({ priorities: ["urgent", "normal", "someday"] });
  const plan = planImport({
    issues, config, labelMap: new Map(), priorityMap: new Map([["High", "urgent"]]), alreadyImported: new Set(),
  });
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.items.map((i) => i.priority), ["urgent", null, null], "Medium was not named, so it is not mapped");

  const none = planImport({ issues, config, labelMap: new Map(), alreadyImported: new Set() });
  assert.deepEqual(none.items.map((i) => i.priority), [null, null, null]);

  const wrong = planImport({
    issues, config, labelMap: new Map(),
    statusMap: new Map([["In Review", "qa"]]),
    priorityMap: new Map([["High", "P1"], ["Medium", "normal"], ["Low", "later"]]),
    alreadyImported: new Set(),
  });
  assert.equal(wrong.items.length, 0, "a refused plan hands back nothing to write");
  const all = wrong.errors.join("\n");
  assert.match(all, /`--priority High=P1`: `P1` is not one of this project's priorities \(urgent \| normal \| someday\)/);
  assert.match(all, /`--priority Low=later`: `later` is not one of this project's priorities/);
  assert.doesNotMatch(all, /Medium=normal/, "a valid target is not a complaint");
  assert.match(all, /`qa` is not one of this project's statuses/, "every complaint at once");
  assert.match(all, /a priority onto one of `priorities:`/);

  const undeclared = planImport({
    issues, config: CONFIG(), labelMap: new Map(), priorityMap: new Map([["High", "P1"]]), alreadyImported: new Set(),
  });
  assert.match(undeclared.errors.join("\n"), /\(none declared\)/);
});

test("a mapped priority's note names both sides; an unmapped one keeps the old note", () => {
  const { issues } = parseJiraIssues(search());
  const mapped = renderBody(issues[0], { priority: "P1" });
  assert.ok(mapped.includes("Jira priority: High — mapped onto `P1`."));
  assert.doesNotMatch(mapped, /not mapped onto this project's priorities/);
  assert.ok(renderBody(issues[0], { priority: null }).includes("Jira priority: High — not mapped onto this project's priorities."));
});

test("the body carries the converted description, the browse link, and what was not mapped", () => {
  const { issues } = parseJiraIssues(search());
  const body = renderBody(issues[0]);
  assert.ok(body.includes(SOURCE_MARKER + BROWSE("APP-101")));
  assert.match(body, /## What happens/);
  assert.match(body, /The login form \*\*reloads\*\* instead of \*redirecting\*/);
  assert.match(body, /Reported by @Dana Reyes\./);
  assert.match(body, /Affects every customer on SSO\./, "the panel's text was dropped");
  assert.ok(body.includes("Jira priority: High — not mapped onto this project's priorities."));
  assert.ok(body.includes(
    "The description held content the converter does not know (mention ×1, panel ×1); its text was kept, its formatting was not."
  ));
  assert.match(body, /Comments, attachments and status history were NOT brought over/);
  assert.match(renderBody(issues[1]), /The source issue had no description\./);
});

// ── The command, end to end ───────────────────────────────────────────────

test("an import writes local ids, mapped statuses, the browse marker and an EMPTY contract", () => {
  const dir = backlog("write");
  const r = importInto(dir, ["--json"]);
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.withoutVerification, 3);
  assert.deepEqual(report.unknownNodes.sort(), ["mark:underline ×1", "mention ×1", "panel ×1"]);
  const bySource = new Map(report.created.map((c) => [c.source, c]));
  assert.equal(bySource.get(BROWSE("APP-103")).sourceState, "In Review");

  const config = loadConfig(dir);
  const tasks = tasksByMarker(dir);
  assert.equal(tasks.size, 3);
  for (const text of tasks.values()) {
    assert.match(field(text, "id"), new RegExp("^" + config.taskIdPrefix + "-\\d+$"));
    assert.ok(!/^id: \S*-(101|102|103)$/m.test(text), "a Jira number was reused as a task id");
    assert.equal(field(text, "verification"), "[]");
  }
  assert.equal(field(tasks.get(BROWSE("APP-101")), "status"), config.statuses[0]);
  assert.equal(field(tasks.get(BROWSE("APP-102")), "status"), config.archivedStatuses[0]);
  assert.equal(field(tasks.get(BROWSE("APP-103")), "status"), config.inProgressStatus);
  assert.match(tasks.get(BROWSE("APP-101")), /```shell\ncurl -i https:\/\/app\.example\.test\/login\nHTTP\/1\.1 302\n```/);
});

test("the text report names the unknown nodes and points at no retirement", () => {
  const dir = backlog("report");
  const r = importInto(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /3 tasks from jira/);
  assert.match(r.stdout, /formatting not converted: .*panel ×1/);
  assert.match(r.stderr, /3 of them have no `verification:`/);
  assert.doesNotMatch(r.stdout + r.stderr, /RETIRING THE SOURCE ISSUES|still OPEN/, "a Jira ticket stays open by design");
});

test("--status reaches the written task", () => {
  const dir = backlog("override");
  const r = importInto(dir, ["--status", "In Review=blocked"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(field(tasksByMarker(dir).get(BROWSE("APP-103")), "status"), "blocked");

  const refused = importInto(backlog("override-bad"), ["--status", "In Review=qa"]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /`qa` is not one of this project's statuses/);
});

test("--priority reaches the written task; without it the template's default stays", () => {
  const dir = backlog("priority");
  const config = loadConfig(dir);
  // A target that is not the template's default, so a write that ignored the
  // flag cannot pass by coincidence.
  const templateDefault = field(readFileSync(join(dir, "_template.md"), "utf8"), "priority");
  const target = config.priorities.find((p) => p !== templateDefault);
  assert.ok(target && templateDefault, "the fixture needs a priority other than the template's");

  const r = importInto(dir, ["--priority", "High=" + target, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const tasks = tasksByMarker(dir);
  assert.equal(field(tasks.get(BROWSE("APP-101")), "priority"), target);
  assert.ok(tasks.get(BROWSE("APP-101")).includes("Jira priority: High — mapped onto `" + target + "`."));
  assert.equal(field(tasks.get(BROWSE("APP-102")), "priority"), templateDefault, "Medium was not named");
  assert.ok(tasks.get(BROWSE("APP-102")).includes("Jira priority: Medium — not mapped onto this project's priorities."));
  assert.equal(run(["check", "--dir", dir]).status, 0, "the mapped tree is a valid tree");

  const plain = backlog("priority-none");
  assert.equal(importInto(plain).status, 0);
  for (const text of tasksByMarker(plain).values()) assert.equal(field(text, "priority"), templateDefault);

  const dry = importInto(backlog("priority-dry"), ["--priority", "High=" + target, "--dry-run", "--json"]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.deepEqual(JSON.parse(dry.stdout).wouldCreate.map((w) => w.priority), [target, null, null]);
  const dryText = importInto(backlog("priority-dry-text"), ["--priority", "High=" + target, "--dry-run"]);
  assert.equal(dryText.status, 0, dryText.stderr);
  assert.ok(dryText.stdout.includes("  APP-101  " + config.statuses[0] + "  " + target + "  "), "the mapped priority is in the plan:\n" + dryText.stdout);
  const unmapped = parseJiraIssues(search()).issues[1];
  assert.ok(
    dryText.stdout.split("\n").includes("  APP-102  " + config.archivedStatuses[0] + "  " + unmapped.title),
    "an unmapped ticket's line carries no priority column:\n" + dryText.stdout
  );

  const refusedDir = backlog("priority-bad");
  const refused = importInto(refusedDir, ["--priority", "High=nonesuch"]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /`nonesuch` is not one of this project's priorities/);
  assert.equal(taskFiles(refusedDir).length, 0, "an unknown target is refused before anything is written");
});

test("--dry-run writes nothing — and the same input then does write", () => {
  const dir = backlog("dry");
  const dry = importInto(dir, ["--dry-run"]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /APP-101/);
  assert.match(dry.stdout, /nothing was written/);
  assert.equal(taskFiles(dir).length, 0);

  const real = importInto(dir);
  assert.equal(real.status, 0, real.stderr);
  assert.equal(taskFiles(dir).length, 3);
});

test("a re-run creates nothing — and a new ticket still lands", () => {
  const dir = backlog("again");
  assert.equal(importInto(dir).status, 0);
  assert.equal(taskFiles(dir).length, 3);

  const second = importInto(dir);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(taskFiles(dir).length, 3, "the second import duplicated tasks");
  assert.match(second.stdout, /3 issues skipped/);

  // The control: deduplication is by the browse URL, not a refusal to write.
  const grown = JSON.parse(search());
  grown.issues.push(ticket("APP-104", { summary: "A ticket nobody has imported yet" }));
  const third = importInto(dir, [], JSON.stringify(grown));
  assert.equal(third.status, 0, third.stderr);
  assert.equal(taskFiles(dir).length, 4);
  assert.ok(tasksByMarker(dir).has(BROWSE("APP-104")));
});

test("both sources' markers are read back, so neither re-imports what the other wrote", () => {
  const dir = backlog("both");
  assert.equal(importInto(dir).status, 0);
  const gh = run(["import", "--from", "github", "--dir", dir], readFileSync(GH_FIXTURE, "utf8"));
  assert.equal(gh.status, 0, gh.stderr);
  const seen = importedSources(join(dir, "tasks"));
  assert.equal(seen.size, 6);
  assert.ok(seen.has(BROWSE("APP-102")));
  assert.ok(seen.has("https://github.com/acme/app/issues/12"));
  assert.notEqual(SOURCE_MARKER, GITHUB_MARKER);
});

test("malformed input stops the command before a single file is written", () => {
  const dir = backlog("malformed");
  const input = JSON.stringify({ issues: [ticket("APP-1"), { ...ticket("APP-2"), fields: { ...ticket("APP-2").fields, description: "*wiki*" } }] });
  const r = importInto(dir, ["--json"], input);
  assert.equal(r.status, 1);
  assert.equal(taskFiles(dir).length, 0);
  const report = JSON.parse(r.stdout);
  assert.equal(report.ok, false);
  assert.match(report.errors.join("\n"), /APP-2: .*wiki markup/);
});

test("check passes on the tree the import produced", () => {
  const dir = backlog("check");
  assert.equal(importInto(dir).status, 0);
  const r = run(["check", "--dir", dir]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("the Jira source is reached from the command and reaches no network module", () => {
  const seen = new Set();
  const forbidden = ["node:http", "node:https", "node:net", "node:tls", "node:dgram", "http", "https", "net", "tls"];
  const sources = join(sourceRoot(), "scripts");
  const stack = [join(sources, "import.mjs")];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/^import[^"']*["']([^"']+)["']/gm)) {
      const spec = m[1];
      assert.ok(forbidden.indexOf(spec) < 0, file + " imports " + spec + " — the importer must make no network request");
      if (spec.startsWith(".")) stack.push(join(dirname(file), spec));
    }
  }
  assert.ok(seen.has(join(sources, "import-jira.mjs")), "the walk never reached the Jira source — it proved nothing about it");
});
