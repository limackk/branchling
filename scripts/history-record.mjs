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
 * The author comes from the one chain in `actor.mjs` — the flag, the
 * environment, the user layer, then the default. An agent session's hook is
 * what calls this script, so the default case is an agent, not a guess.
 *
 * A first run with no snapshot only creates one: we do not invent history for
 * changes nobody was watching.
 */

import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveActor } from "./actor.mjs";
import { ACTOR_NAMESPACES, REASON_SENTINELS, attributeChanges, isValidActor, isValidReason, reconcile, taskIdFromFile, unattributedChanges } from "./history.mjs";
import { resolveBacklogDir, resolveBacklogDirOrExit, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const cli = takeDirFlag(process.argv.slice(2));
const argv = cli.argv;
// The data directory from --dir / BACKLOG_DIR / discovery: the hook calls this
// script for a file that need not live in the same tree as the code (BL-1399).
const BACKLOG_DIR = resolveBacklogDirOrExit({ dir: cli.dir, moduleDir: __dirname }, N + " history").root;
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
const KNOWN_FLAGS = ["--file", "--actor", "--source", "--quiet", "--reason", "--attribute"];
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
const actor = resolveActor(arg("--actor", ""));
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

const attribute = argv.includes("--attribute");
if (attribute && !reasonFlag) {
  console.error(
    `${N} history: \`--attribute\` needs \`--reason "…"\`.\n` +
      "  Claiming a change the log recorded as nobody's IS the statement of a reason;\n" +
      "  without one the claim would replace `unknown` with a name and nothing else."
  );
  process.exit(2);
}

const { entries, seeded, adopted, seeds } = reconcile(BACKLOG_DIR, { actor, source, only, reason: reasonFlag || undefined });

// WHAT RECONCILE COULD NOT SEE (TL-130). A change already written by somebody
// else's reconcile — the running server's, typically — is no longer a DIFFERENCE
// in the tree, so the run above finds nothing and used to say "no changes to
// record". It is not nothing: it is a change standing in the log with no author.
const unclaimed = seeded ? [] : unattributedChanges(BACKLOG_DIR, { only });
const claimed = attribute && unclaimed.length
  ? attributeChanges(BACKLOG_DIR, unclaimed, { actor, reason: reasonFlag, source })
  : [];

if (quiet) process.exit(0);
if (seeded) {
  console.log(`${N} history: reference point (snapshot) created — no history entries written`);
} else if (!entries.length) {
  if (!unclaimed.length && !adopted.length && !seeds.length) console.log(`${N} history: no changes to record`);
} else {
  console.log(`${N} history: recorded ` + entries.length + " change(s) (" + actor + "):");
  for (const e of entries.slice(0, 20)) {
    const fmt = (v) => (Array.isArray(v) ? v.join(", ") : String(v == null ? "" : v)) || "—";
    console.log("  " + e.task + " · " + e.field + ": " + fmt(e.from) + " → " + fmt(e.to));
  }
  if (entries.length > 20) console.log("  … and " + (entries.length - 20) + " more");
}

// TAKEN AS A REFERENCE POINT, WITH NOTHING TO GO ON (TL-180). These tasks were
// absent from a snapshot that had never covered the whole tree — one written by
// a single `next` or `take` in a fresh worktree — and their log is empty. That
// is equally the shape of a task created here and of one that arrived on the
// branch without its log, so the run declines to sign a `__created__` and
// records the file as the reference point instead. Said out loud, because a
// creation that never reaches the log is written the day somebody notices,
// while a false one cannot be taken back.
if (seeds.length) {
  console.log(
    `${N} history: ` + seeds.length + " task(s) taken as a reference point (seed) — no " +
      "creation claimed:"
  );
  for (const id of seeds.slice(0, 20)) console.log("  " + id);
  if (seeds.length > 20) console.log("  … and " + (seeds.length - 20) + " more");
  console.log("  Their log is empty and this snapshot has never covered the tree, so nothing");
  console.log("  here knows whether they were created in this checkout or arrived on the branch.");
}

// ABSORBED ON THE LOG'S WORD (TL-185). These tasks were not in the snapshot, so
// the run had no reference point of its own for them: it recorded every field
// the log could vouch for and took the rest of the file as read. Said out loud
// because the alternative is what happened on 2026-09-03 — ten changes moved
// into the snapshot, none reached a log, and the command printed nothing about
// either. Normal after a pull or a merge; anything else deserves a look.
if (adopted.length) {
  console.log(
    `${N} history: ` + adopted.length + " task(s) had no reference point and were adopted " +
      "from the log:"
  );
  for (const id of adopted.slice(0, 20)) console.log("  " + id);
  if (adopted.length > 20) console.log("  … and " + (adopted.length - 20) + " more");
  console.log("  Fields the log has never recorded have no earlier value to compare against,");
  console.log("  so a change to one of them before now cannot be recovered. Expected after a");
  console.log("  `git pull` or a merge, which bring a task and its log together.");
}

if (claimed.length) {
  console.log(`${N} history: claimed ` + claimed.length + " recorded change(s) for " + actor + ":");
  for (const c of claimed.slice(0, 20)) console.log("  " + c.task + " · " + c.to);
  if (claimed.length > 20) console.log("  … and " + (claimed.length - 20) + " more");
  console.log("  the original entries still say `unknown` — this log is append-only, so a");
  console.log("  claim stands BESIDE the change rather than rewriting it.");
} else if (unclaimed.length) {
  // NEVER "no changes to record" while this is true. That sentence is what made
  // the defect invisible: it reads as "everything is recorded", and what was
  // actually true was "everything is recorded as nobody's".
  console.log(
    `${N} history: ` + unclaimed.length + " recorded change(s) carry no author — somebody else's " +
      "reconcile\n  (a running `" + N + " serve`, a `git pull`) got to them first:"
  );
  for (const u of unclaimed.slice(0, 20)) {
    console.log("  " + u.task + " · " + u.entry.field + " · " + String(u.entry.ts).slice(0, 19));
  }
  if (unclaimed.length > 20) console.log("  … and " + (unclaimed.length - 20) + " more");
  console.log("  If they are yours, say so:");
  console.log("    " + N + ' history --attribute --actor ' + actor + ' --reason "…"');
  console.log("  The tool cannot work out whose they are, and guessing would invent attribution.");
}
