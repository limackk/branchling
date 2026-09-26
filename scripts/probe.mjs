/**
 * The rendered result of a contract probe (TL-268): what a hand is shown, after
 * the task file, when it asks `next --probe` or `take --probe`.
 *
 * WHY THIS BLOCK EXISTS. A task file says what should be true when the work is
 * done; the contract says how that will be checked; neither says what is true
 * NOW, and the difference is the work. A hand handed the contract's live state
 * starts from "this is what is red" instead of a description of green — and a
 * contract that is green before any work is named at the moment it is handed
 * out, which is the earliest place an unfalsifiable proof can be seen.
 *
 * PURE: takes the probe, returns text. Nothing here reaches the file on disk.
 */

import { transcriptBlock } from "./done-task.mjs";
import { plain } from "./ui.mjs";

const HEAD_LIMIT = 40;

/** The last lines of a command's output, capped — the tail is where a test
 *  runner puts its summary and a shell puts its error. */
function tail(output, limit = HEAD_LIMIT) {
  const lines = String(output || "").replace(/\s+$/, "").split("\n");
  if (lines.length <= limit) return { rows: lines, omittedLines: 0 };
  return { rows: lines.slice(-limit), omittedLines: lines.length - limit };
}

/** @param {{rows: Array<object>, ran: number, failed: number, allPassed: boolean, problems?: string[]}} probe */
export function renderProbe(probe) {
  if (!probe) return "";
  const out = ["", "## The contract, as it stands now", ""];
  if (probe.problems && probe.problems.length) {
    out.push("The `verification:` block could not be read, so nothing was run:");
    for (const p of probe.problems) out.push("- " + p);
    out.push("");
    out.push("_Probed at handover; it is not in the file on disk._");
    return out.join("\n");
  }
  if (!probe.rows.length) {
    out.push("This task carries no `verification:` entries. There is nothing to prove it by, and `done` will refuse it.");
    out.push("");
    out.push("_Probed at handover; it is not in the file on disk._");
    return out.join("\n");
  }
  if (probe.allPassed) {
    out.push("**Every entry passed before any work was done.** Either the task is already finished, " +
      "or this contract cannot fail and proves nothing — a guard that passes on a zero sample is green with no force. " +
      "Establish which before changing anything.");
    out.push("");
  } else if (probe.failed) {
    out.push(probe.failed + " of " + probe.ran + " entr" + (probe.ran === 1 ? "y" : "ies") + " fail" +
      (probe.failed === 1 ? "s" : "") + " now. That is the target.");
    out.push("");
  }
  probe.rows.forEach((r, i) => {
    const name = r.id ? "`" + r.id + "`" : "(no id)";
    if (r.kind === "manual") {
      out.push("- " + (i + 1) + ". " + name + " — **manual**, asks a person: " + r.command);
      return;
    }
    const mark = r.ok ? "passes" : "FAILS (exit " + r.exitCode + ")";
    out.push("- " + (i + 1) + ". " + name + " — **" + mark + "**, " + r.ms + " ms: `" + r.command + "`");
    if (!r.ok && r.output && String(r.output).trim()) {
      const excerpt = tail(r.output);
      out.push(...transcriptBlock(excerpt.rows.join("\n"), {
        command: r.command,
        exitCode: r.exitCode,
        omittedLines: excerpt.omittedLines,
        reportName: "handover",
        // This block becomes task text and JSON data as well as terminal text.
        // It therefore has no stream whose TTY state may colour it.
        color: plain,
      }).replace(/\n$/, "").split("\n"));
    }
  });
  out.push("");
  out.push("_Probed at handover; it is not in the file on disk._");
  return out.join("\n");
}

/** The task text with the probe block appended after the body — after the
 *  decisions, which sit under the frontmatter, so a reader meets the answers
 *  first and the contract's state last, where a refused `done` would arrive. */
export function withProbe(text, probe) {
  if (!probe) return text;
  return String(text).replace(/\n+$/, "") + "\n" + renderProbe(probe) + "\n";
}
