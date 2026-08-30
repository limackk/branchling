#!/usr/bin/env node
/**
 * Record in the history the changes made OUTSIDE the viewer (BL-1397).
 *
 * The viewer and the server know the "before" and the "after", so they log by
 * themselves. An agent editing a `.md` through Edit/Write does not. This script
 * closes that route: it compares the files against the last seen state
 * (`history/.snapshot.json`) and appends the differences under the given author.
 * It is run from a post-edit hook (`regen-hook`), by hand after an
 * editing session, or after a `git pull`.
 *
 * Usage:
 *   history                                    # the whole directory
 *   history --file backlog/tasks/TASK-900-x.md
 *   history --actor local:me --source manual
 *
 * The author: --actor, otherwise $BACKLOG_ACTOR, otherwise `agent:claude` (an
 * agent session's hook is what calls this script — that is the default case, not
 * a guess).
 *
 * A first run with no snapshot only creates one: we do not invent history for
 * changes nobody was watching.
 */

import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ACTOR_NAMESPACES, REASON_SENTINELS, isValidActor, isValidReason, reconcile, taskIdFromFile } from "./history.mjs";
import { resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const cli = takeDirFlag(process.argv.slice(2));
const argv = cli.argv;
// The data directory from --dir / BACKLOG_DIR / discovery: the hook calls this
// script for a file that need not live in the same tree as the code (BL-1399).
const BACKLOG_DIR = resolveBacklogDir({ dir: cli.dir, moduleDir: __dirname }).root;
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

// An unknown flag FAILS, BEFORE entering reconcile() (BL-1417). Without this
// `--file` simply did not land on a value, the script took the "whole directory"
// path and performed a REAL reconciliation — `history --help` genuinely
// appended history entries in a real session. It is the same class of defect
// BL-1411 fixed in the server: a silent no-op with a side effect is worse than an
// error, because it looks like the tool working.
const KNOWN_FLAGS = ["--file", "--actor", "--source", "--quiet", "--reason"];
const FLAGS_WITH_VALUE = ["--file", "--actor", "--source", "--reason"];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith("-")) {
    if (i > 0 && FLAGS_WITH_VALUE.indexOf(argv[i - 1]) >= 0) continue; // the previous flag's value
    console.error(`${N} history: unexpected argument: ` + a);
    console.error("  available: " + KNOWN_FLAGS.join(" ") + " --dir <path>");
    process.exit(2);
  }
  if (KNOWN_FLAGS.indexOf(a) < 0) {
    console.error(`${N} history: unknown flag: ` + a);
    console.error("  available: " + KNOWN_FLAGS.join(" ") + " --dir <path>");
    process.exit(2);
  }
}

const file = arg("--file", "");
const actor = arg("--actor", process.env.BACKLOG_ACTOR || "agent:claude");
const source = arg("--source", file ? "hook" : "cli");
const quiet = argv.includes("--quiet");

// WHY THE REASON IS OPTIONAL ON THIS ROUTE ALONE (TL-105). Reconciliation looks
// at changes that have ALREADY happened in files somebody edited elsewhere;
// there is nobody left to refuse. Without the flag every entry lands as
// `unknown`, which is the honest record of what is known. With it, a person who
// has just made a batch of edits by hand speaks for their own batch — one reason
// for the run, because that is the granularity this route actually has.
const reasonFlag = arg("--reason", "");
if (reasonFlag && !isValidReason(reasonFlag)) {
  console.error(
    `${N} history: \`--reason\` is empty or reserved (` + REASON_SENTINELS.join(", ") + ").\n" +
      "  Those are what the tool writes when nobody stated a reason; typing one by hand\n" +
      "  would dress a machine's answer up as yours."
  );
  process.exit(2);
}

// An actor with no namespace would quietly degrade to `unknown` while the
// message still said "recorded changes (name)" — the output would be lying about
// the author, which is the one thing this history exists for. Loud, and early.
if (!isValidActor(actor)) {
  console.error(
    `${N} history: the actor \`` + actor + "` has no valid namespace.\n" +
      "  Use one of: " + ACTOR_NAMESPACES.map((n) => n + ":<name>").join(" | ") +
      "  (or `unknown`, when the author really is not known).\n" +
      "  The namespace says how much the attribution is worth — local: declared,\n" +
      "  agent: automated, user: an authenticated account. BL-1404."
  );
  process.exit(2);
}

let only = null;
if (file) {
  const id = taskIdFromFile(basename(file));
  if (!id) {
    if (!quiet) console.error(`${N} history: this is not a task file: ` + file);
    process.exit(0);
  }
  only = [id];
}

const { entries, seeded } = reconcile(BACKLOG_DIR, { actor, source, only, reason: reasonFlag || undefined });

if (quiet) process.exit(0);
if (seeded) {
  console.log(`${N} history: reference point (snapshot) created — no history entries written`);
} else if (!entries.length) {
  console.log(`${N} history: no changes to record`);
} else {
  console.log(`${N} history: recorded ` + entries.length + " change(s) (" + actor + "):");
  for (const e of entries.slice(0, 20)) {
    const fmt = (v) => (Array.isArray(v) ? v.join(", ") : String(v == null ? "" : v)) || "—";
    console.log("  " + e.task + " · " + e.field + ": " + fmt(e.from) + " → " + fmt(e.to));
  }
  if (entries.length > 20) console.log("  … and " + (entries.length - 20) + " more");
}
