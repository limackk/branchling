#!/usr/bin/env node
/**
 * Guard: which recorded transitions were made without a stated reason (TL-105).
 *
 * WHAT IT ANSWERS. `reason_required_statuses` names the status changes whose why
 * is irrecoverable afterwards. The writing commands refuse to make one without a
 * reason — that is where the rule is ENFORCED. This reads the history that
 * already exists and says where the answer is missing anyway.
 *
 * WHY IT WARNS AND DOES NOT FAIL. Every gap it can find is in the PAST, and the
 * past cannot be fixed by the person running it: nobody now knows why a task was
 * blocked in August. A guard that failed would leave `check` red for as long as
 * the log lives, with two ways out — invent reasons for entries somebody else
 * wrote, or switch the guard off. Both are worse than the gap. Enforcement lives
 * at write time, where the person who knows the answer is still standing there;
 * this is the report, not the gate.
 *
 * WHAT WOULD CHANGE THAT. A backlog started AFTER this mechanism has no
 * unfixable gaps, so a project may want the failure. That is a policy, and it
 * would belong in config.yaml next to `criteria_links` — deliberately not added
 * on speculation, because a setting nobody has asked for is a second thing to
 * explain.
 *
 * THREE KINDS OF MISSING, COUNTED APART. `unknown` is an entry from
 * reconciliation: a change the tool SAW rather than made, where the value is the
 * true record of what it knows. A MISSING `reason` field is an entry written
 * before this mechanism existed — the log is append-only and is not rewritten, so
 * those rows stay as they were. Only an entry that could have carried a reason
 * and does not is a gap in the sense the word suggests. Rolled into one number
 * they would read as "everybody skipped the question", which of the three is the
 * only one that is anybody's fault.
 *
 * Usage:
 *   node scripts/check-backlog-reasons.mjs [--dir <backlog>]
 *
 * Exit 0 always, except on a usage error (2) or an unreadable configuration (1).
 *
 * Tests: `node --test scripts/tests/change-reason.test.mjs`
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigOrExit } from "./config.mjs";
import { resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { MARK, color } from "./ui.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import {
  REASON_UNKNOWN,
  hasStatedReason,
  readAllHistory,
  requiresReason,
} from "./history.mjs";

const OKM = color.ok(MARK.ok);
const WARNM = color.warn(MARK.warn);
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * PURE — audits history already read, so a test can exercise it without a tree.
 *
 * @param {object} config the result of `loadConfig()`
 * @param {Record<string, object[]>} history `{ "<ID>": [entry, …] }`
 */
export function auditReasons(config, history) {
  const gaps = [];
  const unwitnessed = [];
  const legacy = [];
  let required = 0;
  for (const id of Object.keys(history || {}).sort()) {
    for (const e of history[id] || []) {
      if (!requiresReason(config, e)) continue;
      required++;
      if (hasStatedReason(e)) continue;
      const row = { task: id, ts: e.ts || "", to: e.to, actor: e.actor, source: e.source };
      if (e.reason === undefined || e.reason === null) legacy.push(row);
      else if (e.reason === REASON_UNKNOWN) unwitnessed.push(row);
      else gaps.push(row);
    }
  }
  return { gaps, unwitnessed, legacy, required };
}

function main(argv) {
  const { dir, argv: rest } = takeDirFlag(argv);
  if (rest.length) {
    console.error(`${N} check: unknown argument: ` + rest.join(" "));
    console.error("  usage: check-backlog-reasons.mjs [--dir <backlog>]");
    return 2;
  }
  const root = resolveBacklogDir({ dir: dir || undefined, moduleDir: __dirname }).root;
  const config = loadConfigOrExit(root);
  const history = readAllHistory(root);
  const { gaps, unwitnessed, legacy, required } = auditReasons(config, history);

  const named = (config.reasonRequiredStatuses || []).join(", ") || "none";
  if (!gaps.length && !unwitnessed.length && !legacy.length) {
    // The counts are the positive control: "0 gaps" over 0 transitions means the
    // guard read a history that has nothing to say, not that everything is
    // answered.
    console.log(
      `${OKM} reasons: ${required} recorded transition(s) into [${named}], each with a stated reason`
    );
    return 0;
  }

  console.log(
    `${WARNM} reasons: ${gaps.length + unwitnessed.length + legacy.length} of ${required} ` +
      `transition(s) into [${named}] carry no stated reason`
  );
  for (const g of gaps.slice(0, 10)) {
    console.log(`  - ${g.task} → ${g.to} (${g.ts.slice(0, 10)}, ${g.actor}, ${g.source})`);
  }
  if (gaps.length > 10) console.log(`  … and ${gaps.length - 10} more`);
  if (unwitnessed.length) {
    console.log(
      `  ${unwitnessed.length} recorded as \`${REASON_UNKNOWN}\` — changed outside the tool, ` +
        "where there was nobody to ask."
    );
  }
  if (legacy.length) {
    console.log(
      `  ${legacy.length} written before the field existed — the log is append-only and is ` +
        "not rewritten."
    );
  }
  if (!gaps.length) {
    console.log("  None of them is a skipped question: see the two lines above.");
  }
  console.log("  This reports, it does not fail: the answers are in the past. New transitions");
  console.log("  are refused at write time, which is where somebody still knows the answer.");
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("check-backlog-reasons.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
