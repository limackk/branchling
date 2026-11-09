/**
 * The Release view of the viewer — tasks by deployment stage (TL-504).
 *
 * WHAT IT DRAWS. One lane per deploy target, one column per step of its
 * promotion (closed but not merged, the trunk, then each declared stage), a
 * card in the column of the last step the task has fully reached, a PARTIAL
 * marker on a card whose next stage holds some of it — some of its commits, or
 * one of several parallel refs — and a panel of the gaps `check --release`
 * reports. The data is computed at build time by `release-view.mjs`; this file
 * narrows it to what the page's filters select and turns it into HTML.
 *
 * WHY A MODULE AND NOT A TEMPLATE STRING. The same reason `viewer-plan.mjs`
 * gives: this file is inlined into the page BY SOURCE, so the browser and
 * `node --test` run the same model. It is also kept out of build-viewer.mjs so
 * that branches changing that file absorb a small conflict, not this view.
 *
 * A TASK IS NOT AN ENVIRONMENT. A `board:` partitions the backlog; a task moves
 * through environments without belonging to one. So the board scope and the
 * filters NARROW the cards here exactly as they narrow the list, and the
 * columns are never boards.
 *
 * A TARGET IN ANOTHER REPOSITORY (TL-507) is a lane of one column, "Unobservable
 * here", naming the repository its code lives in. Its cards are the tasks that
 * name it in `target:`; none is drawn in a stage, because none of its stages can be
 * read from this repository, and an empty stage column there would read as
 * "nothing deployed".
 *
 * WHAT MAY BE IMPORTED. Only a module pasted BEFORE this one in the page:
 * `viewer-url.mjs`, for the link format.
 *
 * Tests: `node --test scripts/tests/viewer-release.test.mjs`
 */

import { encodeTasksHash, TASKS_HASH_ROUTE } from "./viewer-url.mjs";

/** The column keys that are not a stage name; a stage column is keyed by its
 *  name. Shared with `release-view.mjs`, which builds the columns. */
export const CLOSED_COLUMN = "closed-off-trunk";
export const TRUNK_COLUMN = "trunk";
/** The single column of a target in another repository (TL-507). */
export const UNOBSERVABLE_COLUMN = "unobservable";

/** The hash route of this view: `#release?board=…&epic=…`. */
export const RELEASE_HASH_ROUTE = "release";

/** A column with more cards than this is folded behind a disclosure: the last
 *  stage grows with the project's whole history. */
export const RELEASE_FOLD_AT = 12;

/** HTML escaping, local on purpose: see WHAT MAY BE IMPORTED above. */
function relEsc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Escaped text whose `backtick spans` render as code, as in the terminal. */
function relCodeSpans(s) {
  return relEsc(s).replace(/`([^`]+)`/g, "<code>$1</code>");
}

function relShort(sha) {
  return sha ? String(sha).slice(0, 12) : null;
}

/**
 * The link to this view. The filters, the search and the board travel exactly
 * as they do for the tasks view — the same parameters, so one set of filters
 * means the same thing on both tabs. Sorting and the selected task do not:
 * columns have a fixed order and select nothing.
 */
export function encodeReleaseHash(view) {
  const tasks = encodeTasksHash({ board: view.board, filters: view.filters, search: view.search, sortBy: null, selectedId: null });
  return RELEASE_HASH_ROUTE + tasks.slice(TASKS_HASH_ROUTE.length);
}

/** Whether this hash (the part before "?") addresses the Release view. */
export function isReleaseHash(route) {
  return route === RELEASE_HASH_ROUTE;
}

// ── The PLANNED release facet (TL-511) ──────────────────────────────────
//
// Deployment is observed in git; the release a task is PLANNED for is intent,
// typed into `release:` from the closed `releases:` list in config.yaml
// (TL-505, `docs/release-tracking.md` §1). The filter bar narrows by it, and
// since this view is narrowed by the same filters, "what of release 2.0 has
// reached production" is one facet away. The facet lives here, not in the
// page template, so that `node --test` runs the options and the predicate the
// browser runs.

/** The facet's name in the link: `#tasks?release=…`, `#release?release=…`. */
export const RELEASE_FILTER_PARAM = "release";

/** The value of the "planned for no release" option. A declared release is a
 *  slug that starts with a letter or a digit (`config.mjs` refuses any other),
 *  so this can never be one of them. */
export const NO_RELEASE = "__none__";
export const NO_RELEASE_LABEL = "(no release)";

/**
 * The facet's options: the declared releases in their declared order, then
 * the tasks planned for none. A project that declares no releases gets NONE —
 * not a lone "(no release)" that every task would match — and the filter bar
 * drops a facet with no options, so the facet is not drawn at all.
 *
 * @param {string[]} releases  `releases:` from config.yaml
 * @returns {Array<{value: string, label: string}>}
 */
export function releaseFacetOptions(releases) {
  const declared = Array.isArray(releases) ? releases : [];
  if (!declared.length) return [];
  return declared.map((value) => ({ value, label: value })).concat([{ value: NO_RELEASE, label: NO_RELEASE_LABEL }]);
}

/** Whether a task is planned for this facet value. */
export function releaseFacetMatch(task, value) {
  const planned = String((task && task.release) || "").trim();
  return value === NO_RELEASE ? !planned : planned === value;
}

/** How long ago the view was built, in the largest whole unit. */
export function releaseAgeLabel(ms) {
  if (!Number.isFinite(ms) || ms < 60_000) return "less than a minute ago";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return min + (min === 1 ? " minute ago" : " minutes ago");
  const h = Math.floor(min / 60);
  if (h < 48) return h + (h === 1 ? " hour ago" : " hours ago");
  return Math.floor(h / 24) + " days ago";
}

function heldText(r) {
  if (r.state === "full") return r.spec;
  if (r.state === "partial") return r.spec + " (" + r.held + " of " + r.of + " commits)";
  return null;
}

/**
 * The marker a card carries, or null.
 *
 * PARTIAL means the next stage holds some of the task and not all of it: some
 * commits, or — in a stage of parallel refs — one region, tenant or release
 * line and not another. It names which refs hold it, because "production" while
 * one region still runs the old code is the gap this view exists to show.
 * UNKNOWN means a ref of the next stage did not resolve, so whether it holds
 * the task cannot be said.
 *
 * @returns {null | {kind: "partial"|"unknown", stage: string, holders: string[], missing: string[], text: string}}
 */
export function releaseMarker(card) {
  if (!card || !card.next) return null;
  if (card.state === "unknown") {
    const missing = (card.refs || []).filter((r) => r.state === "unknown").map((r) => r.spec);
    return { kind: "unknown", stage: card.next, holders: [], missing, text: "unknown in " + card.next + " — " + missing.join(", ") + " does not resolve" };
  }
  if (card.state !== "partial") return null;
  const refs = card.refs || [];
  const holders = refs.map(heldText).filter(Boolean);
  const missing = refs.filter((r) => r.state !== "full").map((r) => r.spec);
  let text;
  if (refs.length > 1) {
    const absent = refs.filter((r) => r.state === "absent").map((r) => r.spec);
    text = "partial in " + card.next + " — held by " + holders.join(", ") +
      (absent.length ? "; missing from " + absent.join(", ") : "");
  } else {
    const r = refs[0] || { held: 0, of: 0 };
    text = "partial in " + card.next + " — " + r.held + " of " + r.of + " commits";
  }
  return { kind: "partial", stage: card.next, holders, missing, text };
}

function columnLabel(col) {
  if (col.key === UNOBSERVABLE_COLUMN) return "Unobservable here";
  if (col.key === CLOSED_COLUMN) return "Closed, not merged";
  if (col.key === TRUNK_COLUMN) return "On the trunk";
  return col.stage;
}

function columnHint(col, lastStage) {
  if (col.key === UNOBSERVABLE_COLUMN) return "tasks naming this target in `target:`; its commits and stages live in another repository";
  if (col.key === CLOSED_COLUMN) return "closed, with commits only on a branch the trunk never received";
  if (col.key === TRUNK_COLUMN) return "merged, not yet in full in the first stage";
  if (col.stage === lastStage) return "reached the last stage";
  return "in full here, not yet in full in the next stage";
}

/**
 * PURE — the view model.
 *
 * @param {object} data  what `releaseViewData()` embedded at build time
 * @param {object} [opts]
 * @param {object[]} [opts.tasks]  every task the page holds, for titles and statuses
 * @param {Set<string>|null} [opts.visible]  the ids the filters and the board
 *        select, or null when nothing narrows the page — then a card whose id
 *        has no task file is shown too, because hiding it would hide the gap
 * @param {string} [opts.search]  the search the page applies; this view has no
 *        search field of its own, so a link that carries one must say so
 * @param {string[]} [opts.planned]  the planned-release facet values selected
 *        (TL-511); the cards are already narrowed by them through `visible`,
 *        and the heading names them, because "planned for 2.0" is the question
 *        the reader asked and "the filters above" does not repeat it
 * @param {number} [opts.now]
 */
export function releaseViewModel(data, opts = {}) {
  const byId = new Map((opts.tasks || []).map((t) => [t.id, t]));
  const visible = opts.visible || null;
  const now = opts.now === undefined ? Date.now() : opts.now;
  const builtMs = Date.parse(data && data.builtAt);
  const vm = {
    available: !!(data && data.available),
    reason: (data && data.reason) || null,
    explanation: (data && data.explanation) || null,
    builtAt: (data && data.builtAt) || null,
    age: Number.isFinite(builtMs) ? releaseAgeLabel(now - builtMs) : null,
    trunk: data && data.trunk ? {
      spec: data.trunk.spec, sha: data.trunk.sha, short: relShort(data.trunk.sha),
      source: data.trunk.sourceText || data.trunk.source,
    } : null,
    refs: ((data && data.refs) || []).map((r) => ({ ...r, short: relShort(r.sha) })),
    narrowed: visible !== null,
    search: opts.search || "",
    planned: (opts.planned || []).map((v) => (v === NO_RELEASE ? NO_RELEASE_LABEL : v)),
    lanes: [],
    unplaced: (data && data.unplaced) || { count: 0, ids: [] },
    gaps: null,
  };
  for (const lane of (data && data.lanes) || []) {
    const stages = lane.columns.filter((c) => c.stage !== null).map((c) => c.stage);
    const lastStage = stages[stages.length - 1];
    vm.lanes.push({
      target: lane.target,
      repository: lane.repository || null,
      columns: lane.columns.map((col) => {
        const shown = col.cards.filter((c) => (visible ? visible.has(c.id) : true));
        return {
          key: col.key,
          label: columnLabel(col),
          hint: columnHint(col, lastStage),
          refs: col.refs.map((r) => ({ ...r, short: relShort(r.sha) })),
          unknown: col.unknown,
          unknownRefs: col.unknownRefs,
          total: col.cards.length,
          hidden: col.cards.length - shown.length,
          folded: shown.length > RELEASE_FOLD_AT,
          cards: shown.map((c) => {
            const t = byId.get(c.id);
            return {
              id: c.id,
              title: t ? t.title : null,
              status: t ? t.status : null,
              known: !!t,
              waitedDays: c.waitedDays,
              marker: releaseMarker(c),
            };
          }),
        };
      }),
    });
  }
  const g = data && data.gaps;
  if (g) {
    vm.gaps = {
      mode: g.mode,
      fails: g.exit !== 0,
      explanation: g.explanation,
      excluded: g.excludedBeforeAdoption,
      unknownRefs: g.unknownRefs || [],
      blocking: (g.items || []).filter((x) => !x.accepted),
      accepted: (g.items || []).filter((x) => x.accepted),
      currentRelease: g.currentRelease === undefined ? null : g.currentRelease,
      currentReleaseText: g.currentReleaseText || null,
    };
  }
  return vm;
}

function renderCard(card) {
  const cls = "rel-card" + (card.marker ? " is-" + card.marker.kind : "");
  const status = card.status
    ? '<span class="badge badge-status-' + relEsc(String(card.status).replace(/[^A-Za-z0-9_-]/g, "-")) + '">' + relEsc(card.status) + "</span>"
    : '<span class="rel-nofile">no task file</span>';
  const waited = card.waitedDays === null || card.waitedDays === undefined ? "" : '<span class="rel-waited">waiting ' + card.waitedDays + "d</span>";
  const marker = card.marker
    ? '<div class="rel-marker" title="' + relEsc(card.marker.text) + '"><strong>' +
      (card.marker.kind === "partial" ? "PARTIAL" : "UNKNOWN") + "</strong> " + relEsc(card.marker.text.replace(/^\S+ /, "")) + "</div>"
    : "";
  const id = card.known ? '<a class="rel-id" href="#' + relEsc(card.id) + '">' + relEsc(card.id) + "</a>" : '<span class="rel-id">' + relEsc(card.id) + "</span>";
  return '<li class="' + cls + '" data-release-card="' + relEsc(card.id) + '">' +
    '<div class="rel-card-head">' + id + " " + status + " " + waited + "</div>" +
    (card.title ? '<div class="rel-title">' + relEsc(card.title) + "</div>" : "") + marker + "</li>";
}

function renderColumn(col) {
  const refs = col.refs.map((r) =>
    '<div class="rel-ref"><code>' + relEsc(r.spec) + "</code> " +
    (r.short ? '<code class="rel-sha">' + relEsc(r.short) + "</code>" : '<span class="rel-unknown">unknown — ' + relEsc(r.why || "does not resolve") + "</span>") +
    "</div>").join("");
  const unknown = col.unknown
    ? '<div class="rel-unknown">unknown — ' + relEsc(col.unknownRefs.join(", ")) + " does not resolve, so no task can be placed past it</div>"
    : "";
  const cards = col.cards.map(renderCard).join("");
  const list = col.cards.length
    ? (col.folded
      ? '<details class="rel-fold"><summary>Show all ' + col.cards.length + "</summary><ul class=\"rel-cards\">" + cards + "</ul></details>"
      : '<ul class="rel-cards">' + cards + "</ul>")
    : '<p class="rel-empty">' + (col.hidden ? "nothing the filters select" : "nothing here") + "</p>";
  const hidden = col.hidden ? '<div class="rel-hidden">' + col.hidden + " more outside the filters</div>" : "";
  return '<section class="rel-col' + (col.unknown ? " is-unknown" : "") + '" data-release-column="' + relEsc(col.key) + '">' +
    '<header class="rel-col-head"><h4>' + relEsc(col.label) + ' <span class="rel-count">' + col.cards.length + "</span></h4>" +
    '<div class="rel-hint">' + relEsc(col.hint) + "</div>" + refs + unknown + "</header>" + list + hidden + "</section>";
}

function renderGaps(g) {
  if (!g) return "";
  // The detail is written for the terminal by release-gaps.mjs and marks values
  // with backticks; rendering the spans keeps one wording for both readers.
  const row = (x) => '<li class="rel-gap"><code>' + relEsc(x.gap) + "</code> <strong>" + relEsc(x.subject.length === 40 ? x.subject.slice(0, 12) : x.subject) +
    "</strong> — " + relCodeSpans(x.detail) + (x.where.length ? ' <span class="rel-where">(' + relEsc(x.where.join(", ")) + ")</span>" : "") + "</li>";
  const verdict = g.mode === "require"
    ? (g.fails ? "The release gate fails on these (release_gate: require)." : "The release gate passes (release_gate: require).")
    : "The release gate reports these and does not fail (release_gate: " + relEsc(g.mode) + ").";
  const parts = ['<section class="rel-gaps"><h3>Gaps <code>check --release</code> reports</h3>', "<p>" + verdict + "</p>"];
  if (g.explanation) parts.push('<p class="rel-unknown">' + relEsc(g.explanation) + "</p>");
  // Which release's plan was judged, as `check --release` prints it (TL-519):
  // without it an absent `planned-blocker-open` cannot be told from "no release
  // was judged at all".
  if (g.currentReleaseText) parts.push('<p class="rel-current-release">' + relCodeSpans(g.currentReleaseText) + "</p>");
  if (g.unknownRefs.length) {
    parts.push('<p class="rel-unknown">Unknown, never empty: ' + relEsc(g.unknownRefs.map((r) => r.target + "/" + r.stage + " " + r.spec).join(", ")) + " did not resolve.</p>");
  }
  parts.push(g.blocking.length ? '<ul class="rel-gap-list">' + g.blocking.map(row).join("") + "</ul>" : "<p>No gap — every deployed change names a finished task, and every finished task reached the trunk.</p>");
  if (g.accepted.length) {
    parts.push('<details><summary>' + g.accepted.length + " accepted in release_gate_accept</summary><ul class=\"rel-gap-list\">" + g.accepted.map(row).join("") + "</ul></details>");
  }
  if (g.excluded) parts.push('<p class="rel-hint">' + g.excluded + " trunk commits older than the first one naming a task are not judged.</p>");
  parts.push("</section>");
  return parts.join("");
}

/**
 * What the reader can do about an empty view, by the reason it is empty, or
 * null. The hint is keyed by reason because the page is reachable for every
 * reason but one: the tab is hidden only for `no-targets`, so a sentence
 * telling the reader to declare targets would almost always be shown to a
 * project that has declared them. A reason with no action the reader can
 * take here (a git failure) gets the explanation alone.
 */
export function releaseEmptyHint(reason) {
  if (reason === "no-targets") {
    return "Declare the deploy targets and their stages under <code>deploy_targets:</code> in config.yaml; each stage is a git ref, so this view fills itself in on the next build.";
  }
  if (reason === "no-task-ids-in-commits") {
    return "A task is placed in a stage by the commits whose title starts with its id. Start the title of each commit that does its work with the task id, then rebuild.";
  }
  if (reason === "no-trunk") return "Commit to the trunk, then rebuild.";
  return null;
}

/** PURE — the HTML of the view. */
export function renderRelease(vm) {
  if (!vm.available) {
    const hint = releaseEmptyHint(vm.reason);
    return '<div class="rel-empty-state"><h2>No deployment state</h2><p>' + relEsc(vm.explanation || "nothing to show") +
      "</p>" + (hint ? '<p class="rel-hint">' + hint + "</p>" : "") + "</div>";
  }
  const head = ['<div class="rel-head"><h2>Release</h2>',
    '<p class="rel-built">Built ' + relEsc(vm.builtAt) + " (" + relEsc(vm.age) + "). Refs move without this page knowing — rebuild to see where they are now.</p>"];
  if (vm.explanation) head.push('<p class="rel-unknown">' + relEsc(vm.explanation) + "</p>");
  if (vm.trunk) {
    head.push('<p class="rel-trunk">Trunk <code>' + relEsc(vm.trunk.spec) + "</code> " +
      (vm.trunk.short ? '<code class="rel-sha">' + relEsc(vm.trunk.short) + "</code>" : "unresolved") + " — " + relCodeSpans(vm.trunk.source) + "</p>");
  }
  if (vm.planned.length) {
    head.push('<p class="rel-hint" data-release-planned>Planned for ' + vm.planned.map((r) => "<strong>" + relEsc(r) + "</strong>").join(" or ") +
      " — where the tasks planned for it stand now.</p>");
  }
  if (vm.narrowed) {
    head.push('<p class="rel-hint">Narrowed by the board and the filters above' +
      (vm.search ? ", and by the search \u201c" + relEsc(vm.search) + "\u201d from the Tasks tab" : "") + ".</p>");
  }
  head.push("</div>");
  const lanes = vm.lanes.map((lane) =>
    '<section class="rel-lane" data-release-lane="' + relEsc(lane.target) + '"><h3>' + relEsc(lane.target) + "</h3>" +
    (lane.repository
      ? '<p class="rel-hint" data-release-repository="' + relEsc(lane.repository) + '">Deployed from the repository <code>' + relEsc(lane.repository) +
        "</code>. Its commits and refs are not read here, so its tasks are unobservable — never undeployed — and no gap is reported on its account.</p>"
      : "") +
    '<div class="rel-columns">' + lane.columns.map(renderColumn).join("") + "</div></section>").join("");
  const unplaced = vm.unplaced.count
    ? '<p class="rel-hint">' + vm.unplaced.count + " closed task(s) are named by no commit on any ref, so no target can be given to them.</p>"
    : "";
  return head.join("") + lanes + unplaced + renderGaps(vm.gaps);
}

/**
 * The view's stylesheet, injected by build-viewer.mjs into the page's
 * `<style>`. Kept here with the markup it styles. Every colour is a token the
 * page defines in both its light and its dark block, so dark mode needs no
 * rule of its own. The columns wrap on a narrow screen by the grid alone —
 * no script measures anything.
 */
export const RELEASE_CSS = `
  /* ─── Release (tasks by deployment stage, TL-504) ───────────────── */
  .release-view { display: none; }
  body.view-release main.app-main { display: none; }
  body.view-release .stats { display: none; }
  body.view-release .release-view {
    display: block;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 20px 24px 64px;
  }
  .rel-head h2 { margin: 0 0 4px; font-size: 16px; }
  .rel-built, .rel-trunk, .rel-hint { font-size: 12px; color: var(--fg-muted); margin: 2px 0; }
  .rel-sha { font-variant-numeric: tabular-nums; }
  .rel-lane { margin: 18px 0; }
  .rel-lane h3 { font-size: 14px; margin: 0 0 8px; }
  .rel-columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 10px;
  }
  .rel-col {
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-card);
    padding: 8px 10px 10px;
    min-width: 0;
  }
  .rel-col.is-unknown { border-style: dashed; border-color: var(--foreign-border); }
  .rel-col-head h4 { margin: 0; font-size: 13px; }
  .rel-count { color: var(--fg-muted); font-weight: 400; font-variant-numeric: tabular-nums; }
  .rel-hint { overflow-wrap: anywhere; }
  .rel-ref { font-size: 11px; color: var(--fg-muted); overflow-wrap: anywhere; }
  .rel-unknown { font-size: 12px; color: var(--foreign-border); }
  .rel-cards { list-style: none; margin: 8px 0 0; padding: 0; }
  .rel-card {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 8px;
    margin-bottom: 6px;
    background: var(--bg);
  }
  .rel-card.is-partial, .rel-card.is-unknown {
    border-color: var(--foreign-border);
    background: var(--foreign-bg);
    box-shadow: inset 3px 0 0 0 var(--foreign-border);
  }
  .rel-card-head { font-size: 11px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .rel-id { font-weight: 600; color: var(--fg); }
  .rel-title { font-size: 12px; margin-top: 2px; }
  .rel-waited, .rel-nofile, .rel-hidden, .rel-empty, .rel-where { font-size: 11px; color: var(--fg-muted); }
  .rel-marker { font-size: 11px; margin-top: 4px; color: var(--fg); overflow-wrap: anywhere; }
  .rel-marker strong { color: var(--foreign-border); letter-spacing: .04em; }
  .rel-gaps {
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-card);
    padding: 10px 14px;
    margin-top: 18px;
    max-width: 110ch;
  }
  .rel-gaps h3 { font-size: 14px; margin: 0 0 6px; }
  .rel-gaps p { font-size: 12px; margin: 4px 0; }
  .rel-gap-list { font-size: 12px; padding-left: 18px; }
  .rel-gap { margin: 3px 0; overflow-wrap: anywhere; }
  .rel-empty-state { max-width: 70ch; }
  .rel-empty-state h2 { font-size: 16px; margin: 0 0 8px; }
  .rel-empty-state p { color: var(--fg-muted); font-size: 13px; }
`;
