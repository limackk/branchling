/**
 * The GitHub source of `import` (TL-67): reading `gh issue list --json …` into
 * the issue shape `import.mjs` plans and writes.
 *
 * Parsing stays per source; planning, writing and reporting are shared in
 * `import.mjs` since a second source exists (TL-581). The six decisions the
 * command stands on are stated there.
 *
 * This module is PURE: no filesystem, no network, no process state.
 *
 * Tests: `node --test scripts/tests/import-github.test.mjs`
 */

import { renderImportedBody } from "./import-body.mjs";

/** The one line a re-import recognises an issue by. Written into every imported
 *  task by `renderBody()` and read back by `importedSources()` in `import.mjs`. */
export const SOURCE_MARKER = "Imported from GitHub: ";

/**
 * `gh issue list --json …` prints an ARRAY. Anything else is refused here
 * rather than half-imported: the shape of the input is the one thing this
 * command can check before it knows anything about the backlog.
 */
export function parseIssues(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { issues: [], errors: ["the input is not valid JSON: " + e.message] };
  }
  if (!Array.isArray(data)) {
    return { issues: [], errors: ["the input is not a JSON array — `gh issue list --json …` prints one"] };
  }
  const errors = [];
  const issues = [];
  data.forEach((raw, i) => {
    const where = "issue #" + (raw && raw.number !== undefined ? raw.number : "(no number), item " + (i + 1));
    if (!raw || typeof raw !== "object") {
      errors.push("item " + (i + 1) + " is not an object");
      return;
    }
    if (typeof raw.title !== "string" || !raw.title.trim()) {
      errors.push(where + ": no `title` — a task with no title is useless to the next person");
      return;
    }
    const state = String(raw.state || "").toLowerCase();
    if (state !== "open" && state !== "closed") {
      errors.push(where + ": `state: " + (raw.state === undefined ? "(missing)" : raw.state) + "` is neither `OPEN` nor `CLOSED`");
      return;
    }
    if (typeof raw.url !== "string" || !raw.url) {
      // The url is not decoration: it is the identity this command dedupes on.
      // Without it a second run would import the issue again.
      errors.push(where + ": no `url` — that is what a re-import recognises the issue by; add `url` to `--json`");
      return;
    }
    const labels = Array.isArray(raw.labels)
      ? raw.labels.map((l) => (typeof l === "string" ? l : l && typeof l.name === "string" ? l.name : null)).filter(Boolean)
      : [];
    issues.push({
      number: raw.number, ref: "#" + raw.number, title: raw.title.trim(),
      body: typeof raw.body === "string" ? raw.body : "",
      state, url: raw.url, labels,
      // The category `import.mjs` maps onto this project's statuses: an open
      // issue is work not started, a closed one is work that left the queue.
      category: state === "open" ? "new" : "done",
      sourceState: state,
    });
  });
  return { issues, errors };
}

/** The body of an imported GitHub issue — the shared shape with this source's
 *  marker. Kept here so a test of the source needs nothing from the command. */
export function renderBody(issue) {
  return renderImportedBody({ marker: SOURCE_MARKER, text: issue.body, url: issue.url });
}
