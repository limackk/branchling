/**
 * The viewer's planned-release facet (TL-511).
 *
 * WHAT HAS TO BE PROVED:
 *
 *   1. The facet offers the releases `config.yaml` declares, in their order,
 *      plus one entry for the tasks planned for none — and selecting one
 *      selects exactly the tasks whose `release:` names it.
 *   2. The facet travels in the link, on the Tasks tab and the Release tab
 *      alike, and reads back into the same selection.
 *   3. The Release view honours it: the cards are narrowed and the heading
 *      names the planned release the reader asked about.
 *   4. A project that declares no releases gets no facet (the positive
 *      control for 1: the same page code, a different config).
 *
 * The facet is checked in the page AS BUILT: the `FILTER_SPECS` block is cut
 * out of the generated script and evaluated against the generated `CONFIG`, so
 * the test fails if the page stops wiring the facet, not only if the module
 * changes. The release values are this fixture's, written into a fixture
 * config — no value here comes from this repository's backlog.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";

import { buildHtml, computeStats, readTasks } from "../build-viewer.mjs";
import { loadConfig } from "../config.mjs";
import * as releaseModule from "../viewer-release.mjs";
import {
  NO_RELEASE, NO_RELEASE_LABEL, RELEASE_FILTER_PARAM, encodeReleaseHash,
  releaseFacetMatch, releaseFacetOptions, releaseViewModel, renderRelease,
} from "../viewer-release.mjs";
import { encodeTasksHash, parseTasksHash } from "../viewer-url.mjs";

import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("viewer-release-filter");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
let counter = 0;

function run(dir, args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, cwd: dir, env: { ...process.env, NO_COLOR: "1" },
  });
}

function newTask(dir, title, release) {
  const args = ["new", "--dir", "backlog", "--title", title];
  if (release) args.push("--release", release);
  const r = run(dir, args);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.match(/[A-Z]+-\d+/)[0];
}

/** A backlog whose config declares `releases` (or none, when it is empty). */
function fixture(releases) {
  const dir = mkdtempSync(join(tmpdir(), "branchling-viewer-release-filter-" + counter++ + "-"));
  execFileSync("git", ["init", "-q", "-b", "main", "."], { cwd: dir });
  assert.equal(run(dir, ["init", "--dir", "backlog", "--no-example"]).status, 0);
  if (releases.length) appendFileSync(join(dir, "backlog", "config.yaml"), "\nreleases: [" + releases.join(", ") + "]\n");
  return dir;
}

/** The page's facet definitions, evaluated against the page's own CONFIG. */
function pageFacets(backlog) {
  const config = loadConfig(backlog);
  const tasks = readTasks(backlog, config);
  const html = buildHtml(tasks, computeStats(tasks), config, {});
  const configLine = html.split("\n").find((l) => l.startsWith("const CONFIG = "));
  assert.ok(configLine, "the page embeds its CONFIG");
  const block = html.match(/\nconst FILTER_SPECS = \[[\s\S]*?\n\];\n/);
  assert.ok(block, "the page defines FILTER_SPECS");
  const context = vm.createContext({
    ...releaseModule,
    TASKS: tasks,
    NO_EPIC: "__none__", ENV_NEUTRAL: "n/a",
    labelTitle: (v) => v,
  });
  vm.runInContext(configLine + "\nconst EPIC_NONE_LABEL = '(no epic)';" + block[0] + "\nglobalThis.SPECS = FILTER_SPECS;", context);
  // renderFilters() draws only the facets that have options; mirror that rule.
  const drawn = context.SPECS.filter((s) => s.options().length > 0);
  return { html, tasks, specs: context.SPECS, drawn };
}

// ── 1. Options and predicate ─────────────────────────────────────────────

test("the facet offers the declared releases in order, then the tasks planned for none", () => {
  assert.deepEqual(releaseFacetOptions(["beta", "alpha"]), [
    { value: "beta", label: "beta" },
    { value: "alpha", label: "alpha" },
    { value: NO_RELEASE, label: NO_RELEASE_LABEL },
  ]);
  assert.equal(releaseFacetMatch({ release: "beta" }, "beta"), true);
  assert.equal(releaseFacetMatch({ release: "beta" }, "alpha"), false);
  assert.equal(releaseFacetMatch({ release: "" }, NO_RELEASE), true);
  assert.equal(releaseFacetMatch({}, NO_RELEASE), true);
  assert.equal(releaseFacetMatch({ release: "beta" }, NO_RELEASE), false);
});

test("the built page filters a fixture backlog by planned release", () => {
  const dir = fixture(["r1", "r2"]);
  const ids = {
    one: newTask(dir, "Planned for one", "r1"),
    two: newTask(dir, "Planned for two", "r2"),
    none: newTask(dir, "Planned for none"),
  };
  const { tasks, drawn } = pageFacets(join(dir, "backlog"));
  const facet = drawn.find((s) => s.param === RELEASE_FILTER_PARAM);
  assert.ok(facet, "the release facet is drawn");
  assert.equal(facet.label, "Release");
  assert.deepEqual([...facet.options().map((o) => o.value)], ["r1", "r2", NO_RELEASE]);
  const select = (values) => tasks.filter((t) => values.some((v) => facet.match(t, v))).map((t) => t.id).sort();
  assert.deepEqual(select(["r1"]), [ids.one]);
  assert.deepEqual(select([NO_RELEASE]), [ids.none]);
  assert.deepEqual(select(["r1", "r2"]), [ids.one, ids.two].sort());
});

// ── 2. The link ──────────────────────────────────────────────────────────

test("the facet travels in the link of both tabs and reads back", () => {
  const filters = [{ param: RELEASE_FILTER_PARAM, values: ["r1", NO_RELEASE] }];
  const tasksHash = encodeTasksHash({ board: "main", filters, search: "", sortBy: "priority", selectedId: null });
  assert.equal(tasksHash, "tasks?board=main&release=r1&release=" + NO_RELEASE);
  const releaseHash = encodeReleaseHash({ board: "main", filters, search: "" });
  assert.equal(releaseHash, "release?board=main&release=r1&release=" + NO_RELEASE);
  for (const hash of [tasksHash, releaseHash]) {
    const back = parseTasksHash(hash.split("?")[1], ["status", RELEASE_FILTER_PARAM]);
    assert.deepEqual(back.filters, { status: [], [RELEASE_FILTER_PARAM]: ["r1", NO_RELEASE] });
  }
  // A link without the parameter clears the recipient's release filter.
  const cleared = parseTasksHash("board=main", [RELEASE_FILTER_PARAM]);
  assert.deepEqual(cleared.filters, { [RELEASE_FILTER_PARAM]: [] });
});

test("the page carries the facet into the link by its param", () => {
  const dir = fixture(["r1"]);
  const { html, specs } = pageFacets(join(dir, "backlog"));
  // The page builds its link from FILTER_SPECS' params, so the facet is in it.
  assert.ok(specs.some((s) => s.param === RELEASE_FILTER_PARAM && s.key === "filterRelease"));
  assert.match(html, /filterRelease: new Set\(\)/);
  assert.match(html, /planned: \[\.\.\.state\.filterRelease\]/);
  for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(m[1]);
});

// ── 3. The Release view ──────────────────────────────────────────────────

test("the Release view narrows to the planned release and names it", () => {
  const data = {
    available: true, builtAt: new Date().toISOString(), trunk: null, refs: [], unplaced: { count: 0, ids: [] }, gaps: null,
    lanes: [{ target: "web", columns: [
      { key: "trunk", stage: null, refs: [], unknown: false, unknownRefs: [], cards: [{ id: "X-1", next: null }, { id: "X-2", next: null }] },
    ] }],
  };
  const tasks = [{ id: "X-1", title: "one", status: "done", release: "r1" }, { id: "X-2", title: "two", status: "done", release: "" }];
  const visible = new Set(tasks.filter((t) => releaseFacetMatch(t, "r1")).map((t) => t.id));
  const model = releaseViewModel(data, { tasks, visible, planned: ["r1"] });
  assert.deepEqual(model.lanes[0].columns[0].cards.map((c) => c.id), ["X-1"]);
  assert.equal(model.lanes[0].columns[0].hidden, 1);
  assert.match(renderRelease(model), /data-release-planned>Planned for <strong>r1<\/strong>/);
  const none = releaseViewModel(data, { tasks, visible, planned: [NO_RELEASE] });
  assert.match(renderRelease(none), /Planned for <strong>\(no release\)<\/strong>/);
  // Positive control: no planned release selected, no such heading.
  assert.doesNotMatch(renderRelease(releaseViewModel(data, { tasks })), /data-release-planned/);
});

// ── 4. No releases, no facet ─────────────────────────────────────────────

test("a project that declares no releases shows no release facet", () => {
  assert.deepEqual(releaseFacetOptions([]), []);
  assert.deepEqual(releaseFacetOptions(undefined), []);
  const dir = fixture([]);
  newTask(dir, "A task");
  const { specs, drawn } = pageFacets(join(dir, "backlog"));
  // The spec exists in the page; it is the empty option list that hides it.
  assert.ok(specs.some((s) => s.param === RELEASE_FILTER_PARAM));
  assert.ok(!drawn.some((s) => s.param === RELEASE_FILTER_PARAM));
  // Positive control: the page still draws facets, so "none drawn" is not the reason.
  assert.ok(drawn.some((s) => s.param === "status"));
});
