/**
 * The divergence between this tree's status and what another branch or worktree
 * says (TL-73) — how it is WORDED and how it is MARKED.
 *
 * Why a module of its own, for three lines. The terminal, the badge in the page
 * and the card that carries the badge all speak about one situation, and until
 * TL-124 each of them spelled it out where it was rendered. Three copies of one
 * sentence read as three different situations the moment one of them is edited:
 * a reader comparing the list with `query` cannot tell whether the wordings
 * differ because the STATES differ.
 *
 * This file has no imports on purpose — it is pasted verbatim into the generated
 * page (`readModuleSource` in build-viewer.mjs), the same way viewer-url.mjs and
 * estimate.mjs are. The browser has no copy of these rules of its own.
 *
 * Tests: `node --test scripts/tests/viewer-elsewhere-card.test.mjs`
 */

/** The one sentence for "the value beside this is not the whole truth". */
export const ELSEWHERE_HINT = "This status differs from the one in the checked-out tree";

/** One observation rendered for a human: `feature/x: in_progress`. */
export function describeElsewhere(d) {
  return d.source + ": " + (d.status || "—");
}

/**
 * How a task's CARD is marked when something elsewhere disagrees with it.
 *
 * The trigger is the EXISTENCE of a divergence, never a particular status.
 * `pending` and `in_progress` are values out of a project's config.yaml (third
 * law), so a rule naming them would simply not fire in a repository with another
 * vocabulary — and would fail silently, which is the failure mode this whole
 * signal exists to remove.
 *
 * @param {{elsewhere?: Array<{source: string, status: string}>}} task
 * @returns {{className: string, title: string}} empty strings when nothing disagrees
 */
export function elsewhereCardAttrs(task) {
  const list = (task && task.elsewhere) || [];
  if (!list.length) return { className: "", title: "" };
  return {
    className: "elsewhere",
    title: ELSEWHERE_HINT + " — " + list.map(describeElsewhere).join(", "),
  };
}

/**
 * The observation that says this task is being WORKED ON somewhere else.
 *
 * WHY THIS ONE NAMES A STATUS while `elsewhereCardAttrs()` above refuses to.
 * The two answer different questions. "Something disagrees with this value" is
 * true of any difference, so it must not name one. "Somebody is working on it
 * right now" is a claim about ONE status, and the caller supplies which — from
 * `in_progress_status` in the project's config.yaml, never from a literal here.
 * With no such status configured the answer is simply "nobody", which is the
 * honest reading of a vocabulary that does not distinguish work in flight.
 *
 * @param {{elsewhere?: Array<{status: string, source: string, kind?: string, since?: string|null}>}} task
 * @param {string} inProgressStatus the project's value
 * @returns {object|null} the first such observation, or null
 */
export function runningElsewhere(task, inProgressStatus) {
  if (!inProgressStatus) return null;
  const list = (task && task.elsewhere) || [];
  for (const o of list) {
    if (o && String(o.status || "") === String(inProgressStatus)) return o;
  }
  return null;
}

/**
 * The source shortened to what fits on a card.
 *
 * A worktree is named by an absolute path, and the path is mostly somebody's
 * home directory: the DIRECTORY NAME is the part that identifies the tree, and
 * it is what the person running the session sees in their prompt. A branch name
 * is left whole — it is already short, and it contains slashes of its own, so
 * cutting at the last one would turn `feature/x` into `x`.
 *
 * The full value never disappears: the caller keeps it in the title, the way the
 * Tasks view already does.
 */
export function elsewhereSourceLabel(observation) {
  const source = String((observation && observation.source) || "");
  if (!observation || observation.kind !== "worktree") return source;
  const name = source.replace(/[/\\]+$/, "").split(/[/\\]/).pop();
  return name || source;
}
