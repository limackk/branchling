/**
 * The state of the "Tasks" view in the URL — the only place that knows how a
 * filtered list turns into a link and back (BL-1390).
 *
 * Why a file of its own rather than another function in the viewer template: the
 * page lives in build-viewer.mjs as a single string, so nothing inside it can be
 * executed in a test. This module is imported by `node --test` AND pasted into
 * the page at build time — the browser and the test run the same code, not two
 * copies that will drift apart.
 *
 * The link contract (do not rename parameters without a reason — links already
 * sent would stop reproducing the same set):
 *
 *   #tasks?board=main&status=blocked&status=on_hold&epic=Legal%20compliance&q=sync&sort=id_desc&id=BL-1390
 *
 * Two rules the rest follows from:
 *   1. A parameter omitted from the link means "the default value", NOT "leave
 *      whatever the recipient has". Otherwise the link would be narrowed by the
 *      remains of somebody else's state and would show a different set of tasks
 *      than the sender saw.
 *   2. Anything with a second source outside the URL (the board scope also lives
 *      in localStorage) travels in the link ALWAYS — even when it is the default.
 */

/** The hash prefix of the tasks view — tells it apart from `#dashboard` and from
 *  a bare `#BL-NNN`. */
export const TASKS_HASH_ROUTE = "tasks";

/** The list orderings that can be clicked in the sort bar. */
export const SORT_KEYS = ["priority", "id_asc", "id_desc"];
export const SORT_DEFAULT = "priority";

/**
 * @param {{board: string, filters: Array<{param: string, values: string[]}>,
 *          search: string, sortBy: string, selectedId: ?string}} view
 * @returns {string} e.g. "tasks?board=main&status=blocked"
 */
export function encodeTasksHash(view) {
  const p = new URLSearchParams();
  p.set("board", view.board || "");
  for (const f of view.filters || []) {
    // One occurrence of the key per value, never a list joined by commas: epic
    // names are free text, and an epic containing a comma would fall apart into
    // two filters, neither of which matches anything.
    for (const value of f.values || []) p.append(f.param, value);
  }
  if (view.search) p.set("q", view.search);
  if (view.sortBy && view.sortBy !== SORT_DEFAULT) p.set("sort", view.sortBy);
  if (view.selectedId) p.set("id", view.selectedId);
  return TASKS_HASH_ROUTE + "?" + p.toString();
}

/**
 * @param {string} query    the part of the hash after "?"
 * @param {string[]} paramNames  the filter parameter names (order does not matter)
 * @returns {{board: ?string, filters: Object<string, string[]>, search: string,
 *            sortBy: string, selectedId: ?string}}
 */
export function parseTasksHash(query, paramNames) {
  const p = new URLSearchParams(query || "");
  const filters = {};
  // A key for EVERY filter, including an empty one: the caller resets from this
  // map, so a missing key would quietly leave the recipient's old filter on.
  for (const name of paramNames || []) filters[name] = p.getAll(name);
  const sort = p.get("sort");
  return {
    // null is not "": no `board=` at all (a hand-written link) leaves the scope
    // alone, while a board that is given replaces it.
    board: p.has("board") ? p.get("board") : null,
    filters,
    search: p.get("q") || "",
    // An unknown ordering would sort the list in a way no button displays.
    sortBy: SORT_KEYS.indexOf(sort) >= 0 ? sort : SORT_DEFAULT,
    selectedId: p.get("id") || null,
  };
}

/** Whether this hash (the part before "?") addresses the tasks view. */
export function isTasksHash(route) {
  return route === TASKS_HASH_ROUTE;
}

// ──────────────────────────────────────────────────────────────────────────
// The SUBJECT of the page: which worktree (TL-188)
// ──────────────────────────────────────────────────────────────────────────
//
// IN THE QUERY STRING, NOT THE HASH, and that is the whole reason this lives
// beside the hash contract rather than inside it. The hash is per-VIEW —
// `#tasks`, `#dashboard`, `#execution` — so a subject encoded there would be
// dropped the moment somebody clicked a tab. The worktree is not part of a view;
// it is what every view is a view OF, and `?worktree=` survives all of them.
//
// It is also the half of the link that a server has to read before the page
// exists, which a fragment can never be: the browser does not send a hash.

/** The parameter name. Renaming it breaks links already sent. */
export const WORKTREE_PARAM = "worktree";

/** The worktree a URL names, or null for the default (the served tree). */
export function readWorktreeParam(search) {
  return new URLSearchParams(search || "").get(WORKTREE_PARAM) || null;
}

/**
 * This same page, pointed at another worktree.
 *
 * THE HASH IS CARRIED OVER. Switching trees is not a reason to also throw away
 * the filters, the sort and the open task — the reader asked "show me this, over
 * there", and losing half the question would make the switcher something people
 * use once.
 *
 * THE DEFAULT IS SPELLED BY ABSENCE. The served tree gets no parameter at all,
 * so there is ONE link for that view rather than two that look different and are
 * not. Every other query parameter is preserved: the address may carry things
 * this module knows nothing about.
 *
 * @param {{pathname: string, search: string, hash: string}} location
 * @param {?string} key       the worktree to point at
 * @param {?string} selfKey   the served tree, which needs no parameter
 */
export function withWorktree(location, key, selfKey) {
  const loc = location || {};
  const params = new URLSearchParams(loc.search || "");
  if (!key || key === selfKey) params.delete(WORKTREE_PARAM);
  else params.set(WORKTREE_PARAM, key);
  const query = params.toString();
  return (loc.pathname || "") + (query ? "?" + query : "") + (loc.hash || "");
}
