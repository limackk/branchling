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
