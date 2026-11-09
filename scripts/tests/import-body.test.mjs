/**
 * An imported description cannot pose as the task's own sections (TL-640).
 *
 * WHAT HAS TO BE PROVED, and the control each claim needs:
 *
 *   1. **The task's sections are the importer's, for both sources.** A ticket
 *      carrying `## Acceptance criteria`, `## Notes` and `## Steps` is imported
 *      through the real command, and the file it writes is read back: its
 *      second-level headings are exactly `Goal` and `Notes`, and the criteria
 *      parser finds no contract. The positive control is the same description
 *      with no import in between — the parser DOES find a criterion in it, so
 *      "no criteria section" is not the parser failing to read anything.
 *   2. **The description survives.** Demoting a heading must not drop it, nor
 *      the text under it: a fix that deleted the collision would pass (1).
 *   3. **The criteria parser reads the section level only.** `## Acceptance
 *      criteria` is still the contract; `### Acceptance criteria` is not.
 *
 * Every backlog lives in a temporary directory.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseCriteria } from "../criteria.mjs";
import { demoteHeadings, renderImportedBody } from "../import-body.mjs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { isolateHome } from "./_repo.mjs";

isolateHome("import-body");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

let counter = 0;
function run(args, input) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, input: input === undefined ? "" : input,
    env: { ...process.env, NO_COLOR: "1" },
  });
}

function backlog() {
  const dir = fixtureDir(join(tmpdir(), "branchling-import-body-" + counter++ + "-"));
  const r = run(["init", "--dir", dir, "--no-example"]);
  assert.equal(r.status, 0, "init failed: " + r.stderr);
  return dir;
}

/** The body of the single task an import wrote: everything after the frontmatter. */
function importedBody(dir) {
  const files = readdirSync(join(dir, "tasks")).filter((f) => f.endsWith(".md"));
  assert.equal(files.length, 1, "expected exactly one imported task, found " + files.length);
  const text = readFileSync(join(dir, "tasks", files[0]), "utf8");
  const end = text.indexOf("\n---\n", 4);
  assert.ok(text.startsWith("---\n") && end > 0, "the task file has no frontmatter");
  return text.slice(end + 5);
}

const sections = (body) => body.split("\n").filter((l) => /^##[ \t]/.test(l)).map((l) => l.replace(/^##[ \t]+/, "").trim());

/** The description both sources carry, in GitHub's markdown. */
const DESCRIPTION = [
  "The export drops the last row.",
  "",
  "## Acceptance criteria",
  "",
  "- [ ] the last row is exported",
  "",
  "## Steps",
  "",
  "1. Export a sheet",
  "",
  "## Notes",
  "",
  "Seen since the March release.",
].join("\n");

/** The same description as a Jira ADF document. */
const text = (s) => ({ type: "text", text: s });
const para = (s) => ({ type: "paragraph", content: [text(s)] });
const heading = (s) => ({ type: "heading", attrs: { level: 2 }, content: [text(s)] });
const ADF = {
  type: "doc", version: 1,
  content: [
    para("The export drops the last row."),
    heading("Acceptance criteria"),
    { type: "bulletList", content: [{ type: "listItem", content: [para("[ ] the last row is exported")] }] },
    heading("Steps"),
    { type: "orderedList", content: [{ type: "listItem", content: [para("Export a sheet")] }] },
    heading("Notes"),
    para("Seen since the March release."),
  ],
};

function assertOwnSections(body, source) {
  assert.deepEqual(sections(body), ["Goal", "Notes"], source + ": the task's own sections are the importer's, and only those");
  assert.equal(parseCriteria(body).present, false, source + ": the ticket's criteria became the task's contract");
  for (const kept of ["### Acceptance criteria", "- [ ] the last row is exported", "### Steps", "1. Export a sheet", "### Notes", "Seen since the March release."]) {
    assert.ok(body.includes(kept), source + ": the description lost `" + kept + "`");
  }
}

test("the control: un-imported, this description DOES read as a criteria section", () => {
  const parsed = parseCriteria(DESCRIPTION);
  assert.equal(parsed.present, true);
  assert.deepEqual(parsed.items.map((i) => i.text), ["the last row is exported"]);
});

test("a GitHub description's headings sit below the task's own sections", () => {
  const dir = backlog();
  const issues = [{ number: 7, title: "Export drops a row", body: DESCRIPTION, state: "OPEN", labels: [], url: "https://github.com/acme/app/issues/7" }];
  const r = run(["import", "--from", "github", "--dir", dir], JSON.stringify(issues));
  assert.equal(r.status, 0, r.stderr);
  assertOwnSections(importedBody(dir), "github");
});

test("a Jira description's headings sit below the task's own sections", () => {
  const dir = backlog();
  const ticket = {
    id: "10007", key: "APP-7", self: "https://acme.atlassian.net/rest/api/3/issue/10007",
    fields: { summary: "Export drops a row", status: { name: "To Do", statusCategory: { key: "new" } }, labels: [], description: ADF },
  };
  const r = run(["import", "--from", "jira", "--dir", dir], JSON.stringify({ issues: [ticket] }));
  assert.equal(r.status, 0, r.stderr);
  assertOwnSections(importedBody(dir), "jira");
});

test("the description is shifted as a whole, so its own hierarchy survives", () => {
  assert.equal(demoteHeadings("# Title\n\n## Part\n\n### Detail"), "### Title\n\n#### Part\n\n##### Detail");
  assert.equal(demoteHeadings("### Already deep\n\n#### Deeper"), "### Already deep\n\n#### Deeper", "an issue form's headings do not move");
  assert.equal(demoteHeadings("# A\n\n###### F"), "### A\n\n###### F", "nothing exists below level six");
  assert.equal(demoteHeadings("   ## Indented\n##\n#hashtag\n####### seven"), "   ### Indented\n###\n#hashtag\n####### seven",
    "headings as CommonMark reads them, and nothing that is not one");
  assert.equal(demoteHeadings("no headings\nat all"), "no headings\nat all");
  assert.equal(demoteHeadings(undefined), "");
  assert.equal(demoteHeadings("C# and F# compile\n\n## Real"), "C# and F# compile\n\n### Real",
    "a `#` inside a line is not a heading, whatever follows it");
});

test("a line inside a fenced code block is code, not a heading", () => {
  const fenced = "## Real\n\n```md\n## Acceptance criteria\n```\n\n~~~~\n# not a heading\n~~~\n~~~~\n\n# After";
  assert.equal(demoteHeadings(fenced), "#### Real\n\n```md\n## Acceptance criteria\n```\n\n~~~~\n# not a heading\n~~~\n~~~~\n\n### After");
});

test("a fence closes only on its own character, at no shorter length, with nothing after it", () => {
  // Each fence below stays OPEN past the line that looks like a closing one, so
  // the heading after it is code and keeps its level; the final real heading
  // proves the rule is applied at all.
  const cases = [
    "```\n~~~\n# code\n```",          // the other character
    "````\n```\n# code\n````",        // shorter
    "```\n```js\n# code\n```",        // text after the fence
  ];
  for (const c of cases) {
    assert.equal(demoteHeadings(c + "\n# After"), c + "\n### After", JSON.stringify(c));
  }
  assert.equal(demoteHeadings("```\n```   \n# After"), "```\n```   \n### After", "trailing spaces still close a fence");
  assert.equal(demoteHeadings("run ``` inline\n# After"), "run ``` inline\n### After", "backticks inside a line open no fence");
});

test("the rendered body: the description trimmed and demoted, then the shared Notes", () => {
  const body = renderImportedBody({ marker: "Imported from X: ", text: "  \n# Title\n\nprose\n  ", url: "https://x.test/1", notes: ["A source note."] });
  assert.equal(body, [
    "## Goal", "",
    "### Title", "", "prose", "",
    "## Notes", "",
    "Imported from X: https://x.test/1", "",
    "Comments, attachments and status history were NOT brought over — they are the",
    "conversation around the task, not the task. They stay at the link above.", "",
    "A source note.", "",
    "This task has no `verification:` yet, so it cannot be closed. No tracker has",
    "that field; it is written by whoever picks the task up.", "",
  ].join("\n"));
  // No text and no notes: the placeholder sentence, and not one line more.
  assert.match(renderImportedBody({ marker: "M: ", url: "u" }),
    /^## Goal\n\nThe source issue had no description\.\n\n## Notes\n\nM: u\n\n[^\n]+\n[^\n]+\n\nThis task has no `verification:`/);
});

test("the criteria section is a second-level heading, and only that", () => {
  assert.equal(parseCriteria("## Acceptance criteria\n\n- [ ] one").present, true);
  assert.equal(parseCriteria("##\tAcceptance criteria\n\n- [ ] one").present, true);
  assert.equal(parseCriteria("##   Acceptance criteria  \n\n- [ ] one").present, true);
  assert.equal(parseCriteria("## Acceptance criteria of the old system\n\n- [ ] one").present, false);
  assert.equal(parseCriteria("### Acceptance criteria\n\n- [ ] one").present, false);
  assert.equal(parseCriteria("#### Acceptance criteria\n\n- [ ] one").present, false);
});
