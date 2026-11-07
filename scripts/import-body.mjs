/**
 * The body of an imported task, shared by every `import` source (TL-581).
 * A source supplies its own marker line and any notes about what it read and
 * did not map; the rest — what was left behind, and why the contract is empty
 * — is the same promise whichever tracker the task came from.
 */

/**
 * The body every source writes. The issue's own text goes in whole; what did
 * NOT come over is named out loud, because a reader who cannot see the omission
 * assumes there was nothing to omit. `notes` are a source's own lines about
 * what it read and did not map.
 */
export function renderImportedBody({ marker, text, url, notes = [] }) {
  const description = (text || "").trim();
  return [
    "## Goal",
    "",
    description || "The source issue had no description.",
    "",
    "## Notes",
    "",
    marker + url,
    "",
    "Comments, attachments and status history were NOT brought over — they are the",
    "conversation around the task, not the task. They stay at the link above.",
    "",
    ...notes.flatMap((n) => [n, ""]),
    "This task has no `verification:` yet, so it cannot be closed. No tracker has",
    "that field; it is written by whoever picks the task up.",
    "",
  ].join("\n");
}
