#!/usr/bin/env node
/**
 * `quote <ID>` — the forecast in the terminal (TL-88).
 *
 * The disk read and the formatting only; the arithmetic is `quote.mjs`, the
 * same separation `stats-report.mjs` keeps from `stats.mjs`. The forecast can
 * then be tested without a directory, and this file can be reworded without
 * touching a number.
 *
 * Exit: 0 answered (including "not enough data" — that IS an answer) · 1 no such
 * task · 2 the invocation was wrong, a missing estimate included.
 *
 * Tests: `node --test scripts/tests/quote.test.mjs`
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { forecastSamples } from "./activity.mjs";
import { amountLabel, tokensLabel } from "./cost.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { printJson } from "./json-envelope.mjs";
import { backlogPaths, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { bucketLabel, forecast, rangeLabel } from "./quote.mjs";
import { readTaskMetas } from "./task-io.mjs";
import { MARK, color, failure, heading, line, table } from "./ui.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const KNOWN_FLAGS = ["--json", "--dir"];

/** PURE. The forecast as a page of text. */
export function renderQuote(f, opts = {}) {
  const paint = opts.color || color;
  const out = [heading("quote " + f.task)];
  out.push("");
  out.push(line("estimate", f.estimate || "—"));
  out.push(line("bucket", bucketLabel(f.bucket), "n=" + f.n + ", threshold n>=" + f.minN));
  if (f.degraded) {
    // SAID OUT LOUD. A fallback nobody can see is indistinguishable from a
    // narrower answer than the tool actually has.
    out.push("  " + MARK.warn + " no cell for this estimate AND type reached the threshold — " +
      "this is the estimate bucket alone");
  }
  out.push("");

  if (f.insufficient) {
    out.push("  " + f.message);
    out.push("");
    out.push("  Not a zero and not a guess: a median of a handful of tasks is a number,");
    out.push("  not knowledge. The bucket answers as soon as it fills.");
    return out.join("\n");
  }

  out.push(line("time", rangeLabel(f.time), "p20-p80 of measured time"));
  if (f.unknownRatio != null) {
    // PART OF THE ANSWER, not a footnote to it. A forecast built from data where
    // most minutes were unattributed is worth much less, and only this number
    // says so.
    out.push(line("unattributed", Math.round(f.unknownRatio * 100) + "%",
      "of the minutes behind this forecast could not be placed"));
  }

  out.push("");
  if (!f.tokens) {
    out.push("  no token column: no cost adapter has written tokens for the tasks in this");
    out.push("  bucket. That is an absence, not a zero — see `" + N + " time --cost`.");
    return out.join("\n");
  }
  const rows = [["  model", "n", "tokens p20-p80", "amount p20-p80", ""]];
  for (const cell of f.tokens) {
    if (cell.insufficient) {
      rows.push(["  " + cell.model, String(cell.n), "not enough data", "", ""]);
      continue;
    }
    rows.push([
      "  " + cell.model, String(cell.n),
      tokensLabel(cell.p20) + " - " + tokensLabel(cell.p80),
      cell.amount ? amountLabel(cell.amount.p20) + " - " + amountLabel(cell.amount.p80) : "—",
      cell.why || "",
    ]);
  }
  out.push(table(rows));
  out.push("");
  out.push("  " + paint.dim("Models are never averaged together: tokens of two models are two units of effort."));
  return out.join("\n");
}

export function main(argv) {
  const cli = takeDirFlag(argv);
  const rest = cli.argv;
  const asJson = rest.includes("--json");
  const args = rest.filter((a) => !a.startsWith("--"));
  const unknown = rest.filter((a) => a.startsWith("--") && !KNOWN_FLAGS.includes(a));
  if (unknown.length) {
    console.error(failure(N + " quote", "unknown flag: " + unknown.join(" "),
      ["known flags: " + KNOWN_FLAGS.join(" ") + " --dir <path>"], [N + " quote --help"]));
    return 2;
  }
  if (args.length !== 1) {
    console.error(failure(N + " quote", args.length ? "one task id, not " + args.length : "no task id",
      [], [N + " quote <ID>"]));
    return 2;
  }

  let root;
  try {
    root = resolveBacklogDir({ dir: cli.dir, moduleDir: __dirname }).root;
  } catch (e) {
    console.error(failure(N + " quote", e.message, []));
    return 2;
  }
  const config = loadConfigOrExit(root);
  const tasks = readTaskMetas(backlogPaths(root).tasksDir, config);
  const target = tasks.find((t) => t.id === args[0]);
  if (!target) {
    // "NO SUCH TASK" IS AN ANSWER, and under `--json` it is an envelope with
    // `quote: null` and a non-zero exit — the same shape `session` gives for a
    // session it does not have. A consumer must not have to parse stderr to
    // learn that the id was wrong.
    if (asJson) {
      printJson("quote", { root, quote: null });
      return 1;
    }
    console.error(failure(N + " quote", "no task " + args[0] + " in " + root, [],
      [N + " query --text \"" + args[0] + "\""]));
    return 1;
  }

  const f = forecast(forecastSamples(root, tasks, config), target,
    { minN: config.minReportN, pricing: config.modelPricing });

  if (!f.ok) {
    // A USAGE ERROR, not an empty answer: the task names no bucket, so there is
    // nothing to look up, and "not enough data" would blame the backlog for a
    // field somebody has not filled in.
    console.error(failure(N + " quote", f.message, [],
      ["set an `estimate:` on " + target.id + " — the forecast is a lookup by estimate"]));
    return 2;
  }

  if (asJson) {
    printJson("quote", { root, quote: f });
    return 0;
  }
  console.log(renderQuote(f));
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("quote-command.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
