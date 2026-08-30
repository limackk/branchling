/**
 * The card of a task that another tree sees differently must not read as free
 * work (TL-124).
 *
 * Shape of this test, and why. The card is built by code inside the page's one
 * template literal, which cannot be executed from here — `assert.match(html,
 * /elsewhere/)` would pass for a rule that never fires. So the DECISION lives in
 * scripts/elsewhere.mjs and runs here for real, while the page gets that
 * module's source pasted in; the last test enforces that link, because a green
 * module the page never calls is a green test with no evidence in it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ELSEWHERE_HINT, describeElsewhere, elsewhereCardAttrs } from "../elsewhere.mjs";
import { describeDivergence } from "../branch-scan.mjs";
import { buildHtml, computeStats } from "../build-viewer.mjs";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..");

test("a task seen differently elsewhere gets marked", () => {
  const attrs = elsewhereCardAttrs({ elsewhere: [{ source: "feature/x", status: "in_progress" }] });
  assert.equal(attrs.className, "elsewhere");
  assert.match(attrs.title, /feature\/x: in_progress/, "the title does not name where the task is seen differently");
  assert.ok(attrs.title.startsWith(ELSEWHERE_HINT), "the card says it in words other than the badge does");
});

test("negative control: a task nobody disagrees about is not marked", () => {
  // Without this the rule could return "elsewhere" for everything and every
  // other assertion here would still pass — a mark on every card is no mark.
  assert.deepEqual(elsewhereCardAttrs({ elsewhere: [] }), { className: "", title: "" });
  assert.deepEqual(elsewhereCardAttrs({}), { className: "", title: "" });
  assert.deepEqual(elsewhereCardAttrs(null), { className: "", title: "" });
});

test("the trigger is the divergence itself, not a status name from config.yaml", () => {
  // A project whose statuses are `todo`/`doing` is the normal case, not an edge
  // one (third law). A rule written around `pending`/`in_progress` would simply
  // never fire there — silently, which is what this whole signal exists against.
  const attrs = elsewhereCardAttrs({ elsewhere: [{ source: "wt/2", status: "doing" }] });
  assert.equal(attrs.className, "elsewhere");
  assert.match(attrs.title, /wt\/2: doing/);
});

test("every source is named, not just the first", () => {
  const attrs = elsewhereCardAttrs({
    elsewhere: [{ source: "a", status: "doing" }, { source: "b", status: "done" }],
  });
  assert.match(attrs.title, /a: doing/);
  assert.match(attrs.title, /b: done/);
});

test("the terminal and the page name a divergence with the same words", () => {
  const d = { source: "feature/x", status: "in_progress" };
  assert.equal(describeDivergence(d), describeElsewhere(d));
});

test("viewer: the page carries the source of elsewhere.mjs and calls it on every card", () => {
  const tasks = [{
    id: "BL-1", title: "A", board: "main", labels: [], blocked_by: [], blocks: [],
    related_docs: [], epic: "", status: "pending", priority: "P1", type: "code", bodyHtml: "",
    elsewhere: [],
  }];
  const html = buildHtml(tasks, computeStats(tasks));

  const src = readFileSync(join(SCRIPTS, "elsewhere.mjs"), "utf8");
  const marker = "export function elsewhereCardAttrs";
  assert.ok(src.includes(marker), "the module changed shape — fix the marker in this test");
  assert.ok(html.includes(marker.replace("export ", "")), "the source of elsewhere.mjs did not reach the page");

  assert.match(html, /elsewhereCardAttrs\(t\)/, "the card renderer never asks whether anybody disagrees");
  assert.match(html, /\.task-card\.elsewhere\s*\{/, "the marked card has no style, so the mark is invisible");
  assert.match(html, /border-style:\s*dashed/, "the mark is carried by colour alone");
  assert.match(html, /\.task-card\.elsewhere\.active\s*\{/, "dimming is not lifted for the selected card");
});
