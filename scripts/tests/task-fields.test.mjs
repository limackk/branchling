/**
 * The contract for editing a task's fields (BL-1396).
 *
 * Why this test exists in this shape: writing a field rewrites the FILE that is
 * the source of truth of the whole backlog — one swallowed `verification:` block
 * or one lost quotation mark in a title breaks the view build, while in the UI it
 * looks like a successful save. So the assertions are on the resulting text of the
 * file, not on the fact that a function did not throw.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FIELD_SHAPES,
  buildFieldSpecs,
  extractMeta,
  splitFrontmatter,
  fieldSpec,
  normalizeValue,
  serializeField,
  setFrontmatterField,
  yamlScalar,
  diffMeta,
  sameValue,
  formatValue,
} from "../task-fields.mjs";
import { loadConfig } from "../config.mjs";
import { BACKLOG_DIR } from "./_repo.mjs";

// The field specs are built from the CONFIGURATION (BL-1400). The tests run on
// this repository's configuration, because that is what describes the tasks these
const CONFIG = loadConfig(BACKLOG_DIR);
const FIELDS = buildFieldSpecs(CONFIG);
const TASK_STATUSES = CONFIG.statuses;
const EDITABLE_FIELDS = FIELDS;
const ctx = (options) => ({ fields: FIELDS, options });

const FILE = [
  "---",
  "id: BL-1390",
  'title: "Encode the task list filters in the viewer URL"',
  "type: code                         # code | manual",
  "labels: [pre-launch]",
  "board: backlog-project",
  'epic: ""',
  "priority: P2",
  "status: done",
  "owner: claude",
  "estimate: 3h",
  "confidence: high",
  "created: 2026-08-29",
  "updated: 2026-08-29",
  "blocked_by: []",
  "blocks: []",
  "related_docs:",
  "  - backlog/README.md",
  "  - docs/architecture/INDEX.md",
  "verification:",
  '  - bash: "node --test backlog/scripts/tests/viewer-url.test.mjs"',
  '  - manual: "click and see"',
  "---",
  "",
  "## Cel",
  "",
  "The body stays untouched.",
  "",
].join("\n");

const meta = (text) => extractMeta(splitFrontmatter(text).frontmatter);

// ── Parsowanie ────────────────────────────────────────────────────────────

test("extractMeta reads scalars, inline lists and block lists", () => {
  const m = meta(FILE);
  assert.equal(m.id, "BL-1390");
  assert.equal(m.title, "Encode the task list filters in the viewer URL");
  assert.equal(m.type, "code");
  assert.equal(m.status, "done");
  assert.deepEqual(m.labels, ["pre-launch"]);
  assert.deepEqual(m.related_docs, ["backlog/README.md", "docs/architecture/INDEX.md"]);
  assert.deepEqual(m.blocked_by, []);
});

test("a comment after the value does not enter the value, but a # inside quotes stays", () => {
  assert.equal(meta(FILE).type, "code");
  const withHash = FILE.replace('title: "Encode', 'title: "Fix #42 in');
  assert.equal(meta(withHash).title, "Fix #42 in the task list filters in the viewer URL");
});

// ── Validation ────────────────────────────────────────────────────────────

test("an enum accepts only values from the vocabulary", () => {
  assert.equal(normalizeValue("status", "in_progress", ctx()).ok, true);
  const bad = normalizeValue("status", "wontfix", ctx());
  assert.equal(bad.ok, false);
  assert.match(bad.error, /wontfix/);
});

test("every status from the vocabulary passes validation", () => {
  for (const s of TASK_STATUSES) assert.equal(normalizeValue("status", s, ctx()).ok, true, s);
});

test("a non-editable field is rejected (id and updated are not click-to-edit fields)", () => {
  assert.equal(normalizeValue("id", "BL-999", ctx()).ok, false);
  assert.equal(normalizeValue("updated", "2026-01-01", ctx()).ok, false);
  assert.equal(fieldSpec("created", FIELDS), null);
});

test("title: empty and too long are rejected, 60 characters pass", () => {
  assert.equal(normalizeValue("title", "   ", ctx()).ok, false);
  assert.equal(normalizeValue("title", "x".repeat(60), ctx()).ok, true);
  assert.equal(normalizeValue("title", "x".repeat(61), ctx()).ok, false);
});

test("epic, confidence and owner may be cleared; a title may not", () => {
  assert.equal(normalizeValue("epic", "", ctx()).ok, true);
  assert.equal(normalizeValue("confidence", "", ctx()).ok, true);
  // `owner` joined them in TL-99. An unowned task is a real state — it is the
  // ABSENCE of a claim, which is what `handoff` leaves behind and what the
  // dashboard has always grouped under "owner: unassigned" via `!t.owner`. The
  // spec was the last place saying otherwise, and a field a command writes while
  // the validator calls it invalid is two answers to one question.
  //
  // The alternative was writing a word like "unassigned" from the code. That
  // word is one project's: `owners:` is where a project keeps its own, and
  // nothing in it says which entry means nobody (third law).
  assert.equal(normalizeValue("owner", "", ctx()).ok, true);
  // Not everything may be emptied, or the assertions above would be measuring a
  // validator that accepts anything.
  assert.equal(normalizeValue("title", "", ctx()).ok, false);
  assert.equal(normalizeValue("status", "", ctx()).ok, false);
});

test("labels is a CLOSED vocabulary, duplicates collapse", () => {
  // This test used to run on THIS repository's `CONFIG` and typed in one project's
  // labels. Here `labels_closed: false`, so the invariant it asks about is simply
  // switched off — and the test was then measuring
  // somebody else's data, not the mechanism. The configuration is explicit and local (BL-1448).
  const closed = buildFieldSpecs({
    ...CONFIG,
    labels: ["alfa", "beta"],
    labelsClosed: true,
  });
  const cctx = () => ({ fields: closed });
  assert.equal(normalizeValue("labels", ["alfa", "beta"], cctx()).ok, true);
  assert.deepEqual(normalizeValue("labels", ["beta", "beta"], cctx()).value, ["beta"]);
  assert.equal(normalizeValue("labels", ["invented"], cctx()).ok, false);

  // A positive control for the other side of the switch: with `labelsClosed:
  // false` the same value has to PASS. Without this clause the test would be green
  // for code that rejects everything it does not know, whatever the flag says.
  const open = buildFieldSpecs({ ...CONFIG, labels: ["alfa"], labelsClosed: false });
  assert.equal(normalizeValue("labels", ["invented"], { fields: open }).ok, true);
});

test("blocked_by requires the <PREFIX>-NNN format", () => {
  // We take the prefix from THIS backlog's configuration (TL-44): written out it
  // would pin a value that BL-1452 deliberately moved out into the configuration,
  // so the test would fail on every renumbering while nothing in the contract changed.
  const P = CONFIG.taskIdPrefix;
  assert.deepEqual(normalizeValue("blocked_by", `${P}-1, ${P}-22`, ctx()).value, [`${P}-1`, `${P}-22`]);
  assert.equal(normalizeValue("blocked_by", ["1392"], ctx()).ok, false);
});

test("a board with no vocabulary supplied passes (a viewer older than boards.yaml)", () => {
  assert.equal(normalizeValue("board", "new-board", ctx()).ok, true);
  assert.equal(normalizeValue("board", "new-board", ctx({ boards: ["main"] })).ok, false);
  assert.equal(normalizeValue("board", "main", ctx({ boards: ["main"] })).ok, true);
});

test("a newline never enters the frontmatter", () => {
  assert.equal(normalizeValue("title", "a\nb: c", ctx()).ok, false);
  assert.equal(normalizeValue("related_docs", ["a\nb"], ctx()).ok, false);
});

// ── Serializacja ──────────────────────────────────────────────────────────

test("yamlScalar quotes where YAML would come apart", () => {
  assert.equal(yamlScalar("an ordinary title"), "an ordinary title");
  assert.equal(yamlScalar("Napraw: dwukropek"), '"Napraw: dwukropek"');
  assert.equal(yamlScalar(""), '""');
  assert.equal(yamlScalar('a quote "inside"'), '"a quote \\"inside\\""');
  assert.equal(yamlScalar("- a dash at the start"), '"- a dash at the start"');
});

test("serializeField knows two list shapes", () => {
  assert.deepEqual(serializeField("labels", ["a", "b"]), ["labels: [a, b]"]);
  assert.deepEqual(serializeField("related_docs", ["x.md", "y.md"]), ["related_docs:", "  - x.md", "  - y.md"]);
  assert.deepEqual(serializeField("related_docs", []), ["related_docs: []"]);
  assert.deepEqual(serializeField("blocked_by", []), ["blocked_by: []"]);
});

// ── Writing to the file ───────────────────────────────────────────────────

test("changing a scalar does not touch the rest of the file", () => {
  const out = setFrontmatterField(FILE, "status", "in_progress");
  assert.equal(meta(out).status, "in_progress");
  assert.equal(splitFrontmatter(out).body, splitFrontmatter(FILE).body);
  assert.equal(out.split("\n").length, FILE.split("\n").length);
  assert.match(out, /verification:\n {2}- bash:/);
});

test("a comment beside the edited line survives", () => {
  const out = setFrontmatterField(FILE, "type", "manual");
  assert.match(out, /^type: manual\s+# code \| manual$/m);
});

test("a title with a colon is written quoted and comes back without them", () => {
  const out = setFrontmatterField(FILE, "title", "Fix: the plan drifted");
  assert.match(out, /^title: "Fix: the plan drift/m);
  assert.equal(meta(out).title, "Fix: the plan drifted");
});

test("a block list does not swallow the next key (verification survives)", () => {
  const out = setFrontmatterField(FILE, "related_docs", ["a.md"]);
  assert.deepEqual(meta(out).related_docs, ["a.md"]);
  assert.match(out, /verification:/);
  assert.match(out, /- manual: "click and see"/);
});

test("block list → empty → block list again (shape transitions)", () => {
  const empty = setFrontmatterField(FILE, "related_docs", []);
  assert.match(empty, /^related_docs: \[\]$/m);
  assert.deepEqual(meta(empty).related_docs, []);
  const back = setFrontmatterField(empty, "related_docs", ["x.md", "y.md"]);
  assert.deepEqual(meta(back).related_docs, ["x.md", "y.md"]);
  assert.match(back, /verification:/);
});

test("a missing key is inserted in its canonical position, not at the end", () => {
  const without = FILE.replace("confidence: high\n", "");
  assert.equal(meta(without).confidence, null);
  const out = setFrontmatterField(without, "confidence", "low");
  assert.equal(meta(out).confidence, "low");
  const fm = splitFrontmatter(out).frontmatter.split("\n");
  assert.ok(fm.indexOf("confidence: low") > fm.indexOf("estimate: 3h"));
  assert.ok(fm.indexOf("confidence: low") < fm.indexOf("created: 2026-08-29"));
});

test("a file with no frontmatter throws instead of adding one of its own", () => {
  assert.throws(() => setFrontmatterField("## Cel\n\ntekst\n", "status", "done"), /frontmatter/);
});

test("the order of the keys in the file is not rewritten", () => {
  const shuffled = FILE.replace("labels: [pre-launch]\nboard: backlog-project\n", "board: backlog-project\nlabels: [pre-launch]\n");
  const out = setFrontmatterField(shuffled, "labels", ["prod"]);
  const fm = splitFrontmatter(out).frontmatter.split("\n");
  assert.ok(fm.indexOf("board: backlog-project") < fm.indexOf("labels: [prod]"));
});

// ── Diff ──────────────────────────────────────────────────────────────────

test("diffMeta sees a change to a scalar and to a list, and ignores updated", () => {
  const before = meta(FILE);
  let after = setFrontmatterField(FILE, "status", "pending");
  after = setFrontmatterField(after, "labels", ["prod", "post-launch"]);
  after = setFrontmatterField(after, "updated", "2030-01-01");
  const d = diffMeta(before, meta(after));
  assert.deepEqual(d.map((x) => x.field).sort(), ["labels", "status"]);
  const labels = d.find((x) => x.field === "labels");
  assert.deepEqual(labels.from, ["pre-launch"]);
  assert.deepEqual(labels.to, ["prod", "post-launch"]);
});

test("identical metadata give an empty diff (a save with no change writes no entry)", () => {
  assert.deepEqual(diffMeta(meta(FILE), meta(FILE)), []);
});

test("the order inside a list is a change, null and an empty string are not", () => {
  assert.equal(sameValue(["a", "b"], ["b", "a"]), false);
  assert.equal(sameValue(null, ""), true);
  assert.equal(sameValue([], ""), true);
  assert.equal(formatValue(["a", "b"]), "a, b");
});

// ── Spec ──────────────────────────────────────────────────────────────────

test("every editable field has a label and a known kind", () => {
  for (const f of EDITABLE_FIELDS) {
    assert.ok(f.label, f.key + " bez etykiety");
    assert.ok(["text", "enum", "list"].indexOf(f.kind) >= 0, f.key + " ma dziwny kind");
    if (f.kind === "list") assert.ok(["inline", "block"].indexOf(f.style) >= 0, f.key + " bez stylu listy");
    // An enum with no vocabulary and no dynamic set could not be set to
    // anything — buildFieldSpecs turns that shape into text. The one exception
    // is a field that REQUIRES its dictionary (TL-97): there an undeclared
    // vocabulary is an answer, so the enum stays an enum whose only legal value
    // is the empty one. Which is a field with no value at all unless it also
    // allows empty — so that pairing is what this asserts.
    if (f.kind === "enum" && !f.dynamic && !f.dictionaryRequired) {
      assert.ok(f.options && f.options.length, f.key + " enum bez opcji");
    }
    if (f.dictionaryRequired) {
      assert.equal(f.kind, "enum", f.key + ": only an enum can require a dictionary");
      assert.ok(f.allowEmpty, f.key + ": a required dictionary with no empty value can hold nothing");
    }
  }
});

// ── The specs come from the configuration, not from the code (BL-1400) ────

test("a foreign configuration gives foreign vocabularies — the code knows no project's values", () => {
  const other = {
    statuses: ["todo", "doing", "shipped"],
    priorities: ["high", "low"],
    types: ["feature", "bug"],
    labels: ["ui"],
    labelsClosed: false,
    titleMaxLength: 100,
  };
  const fields = buildFieldSpecs(other);
  const c = (options) => ({ fields, options });
  assert.deepEqual(fieldSpec("status", fields).options, ["todo", "doing", "shipped"]);
  assert.equal(normalizeValue("status", "doing", c()).ok, true);
  assert.equal(normalizeValue("status", "in_progress", c()).ok, false);
  assert.equal(normalizeValue("title", "x".repeat(90), c()).ok, true);
  // labels_closed: false → an open vocabulary, a value outside the list passes
  assert.equal(normalizeValue("labels", ["cokolwiek"], c()).ok, true);
});

test("an empty enum vocabulary does not create a field that cannot be set", () => {
  const fields = buildFieldSpecs({ statuses: ["a"], priorities: ["P1"], confidence: [] });
  const conf = fieldSpec("confidence", fields);
  assert.equal(conf.kind, "text");
  assert.equal(normalizeValue("confidence", "cokolwiek", { fields }).ok, true);
});

test("the shape of a field does not depend on the configuration (list style survives a missing spec)", () => {
  assert.deepEqual(serializeField("related_docs", ["a.md"]), ["related_docs:", "  - a.md"]);
  assert.deepEqual(serializeField("labels", ["x"]), ["labels: [x]"]);
  assert.equal(FIELD_SHAPES.every((f) => f.key && f.label && f.kind), true);
});

test("the module has no imports — its source is pasted into the viewer", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../task-fields.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /^\s*import\s/m);
  assert.doesNotMatch(src, /<\/script/i);
});
