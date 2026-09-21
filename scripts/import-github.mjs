#!/usr/bin/env node
/**
 * `import --from github` — a team's existing GitHub Issues, brought over ONCE
 * (TL-67).
 *
 * WHAT THIS ANSWERS. Everything else in onboarding lowers the cost of STARTING
 * a backlog; this is the one command that answers "I already have two hundred
 * tasks somewhere else". That is the difference between a tool somebody likes
 * and a tool somebody adopts.
 *
 * THE SIX DECISIONS THIS COMMAND STANDS ON, all settled in TL-67:
 *
 *   1. **It never touches the network.** JSON arrives on stdin, from `gh` or
 *      from a fixture. Zero dependencies stays zero, nobody's token is ever
 *      read by this code, and the test needs no mock server:
 *
 *        gh issue list --state all --limit 500 \
 *          --json number,title,body,state,labels,url \
 *          | <the binary> import --from github --dry-run
 *
 *   2. **One-off, never synchronous.** Synchronisation is a second source of
 *      truth living outside the branch — the defect external trackers were
 *      rejected for (Law 1). Import copies and forgets.
 *   3. **`verification:` stays EMPTY, and the count of such tasks is part of
 *      the report.** A placeholder here would make hundreds of tasks LOOK
 *      finishable while disarming the only defence against a "done" that is not
 *      done. No tracker has this field; import must not invent one.
 *   4. **The task travels, the archive does not.** Comments, attachments and
 *      status history stay behind a link to the source: that is the
 *      conversation around a task, not the task.
 *   5. **Numbers are LOCAL**, allocated by `createTask()` exactly as `new`
 *      allocates them. `#412` does not become `TL-412`; pretending somebody
 *      else's number is ours lies at the first collision.
 *   6. **Vocabulary mapping is an argument, not configuration.** A key in
 *      `config.yaml` would break Law 3 — that file holds the PROJECT's
 *      vocabulary, not the instructions for one operation that runs once and is
 *      over. `--label from=to` and `--label-map <file>` live as long as the run.
 *
 * WHERE THE POINTER TO THE SOURCE LIVES, and why not in a field. Idempotency
 * needs a way to recognise an issue that is already here. TL-67 left the choice
 * open between a `source:` frontmatter field and a line in the body; the line
 * in the body wins, for one reason that outranks the ergonomics of a
 * first-class field: a field is a SCHEMA change — `FIELD_SHAPES`, the viewer,
 * the history axis — and TL-67 itself says such a change would have to be its
 * own task, taken BEFORE this one. Adding the field later stays possible; the
 * import written today does not have to wait for it, and nothing it writes has
 * to be migrated when it arrives, because the line stays true either way.
 *
 * The cost is stated rather than hidden: the scan reads task BODIES instead of
 * asking `query` for a field, and it reads THIS CHECKOUT only. An issue
 * imported on somebody else's branch will be imported again here and the two
 * copies meet at the merge. That is the same boundary `next` has and for the
 * same reason (data travels with the branch); an import is a one-off act
 * somebody watches, not a queue running unattended.
 *
 * Tests: `node --test scripts/tests/import-github.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveActor } from "./actor.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { ACTOR_NAMESPACES, isValidActor, isValidReason, recordCreation, reconcile } from "./history.mjs";
import { printJson } from "./json-envelope.mjs";
import { createTask, driftMessage, slugify } from "./new-task.mjs";
import { backlogPaths, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { detectPrefixMismatch, prefixMismatchMessage } from "./task-id.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { MARK, color, failure, warn } from "./ui.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The only source this command knows. TL-67: do NOT build an importer in the
 *  plural — an adapter for two trackers at once starts from an abstraction
 *  nobody needs yet. */
export const SOURCES = ["github"];

const FLAGS = ["--from", "--dry-run", "--json", "--actor", "--reason", "--label", "--label-map"];

export const USAGE = [
  `${N} import --from github [--dry-run] [--label <from>=<to>] [--label-map <file.json>]`,
  `                        [--actor <ns:name>] [--reason "…"] [--json] [--dir <path>]`,
  "",
  "  The issues arrive as JSON on STDIN. This command makes no network request —",
  "  authentication stays inside `gh`, where it already is:",
  "",
  `    gh issue list --state all --limit 500 --json number,title,body,state,labels,url \\`,
  `      | ${N} import --from github --dry-run`,
  "",
  "  --dry-run            print the plan and write nothing. Run this first: a command",
  "                       that creates hundreds of files should show them to you before",
  "                       it does",
  "  --label <from>=<to>  map ONE label; repeatable. An empty <to> drops that label.",
  "                       Mapping is an argument and not a key in config.yaml, because",
  "                       that file holds the project's vocabulary and this instruction",
  "                       is over when the run is",
  "  --label-map <file>   the same mapping as a JSON object, for more than a handful",
  "  --actor <ns:name>    who is importing; goes into the history beside every task",
  "",
  "  WHAT IT DOES NOT BRING OVER: comments, attachments, status history, assignees.",
  "  Those are the conversation around a task, not the task — the link to the source",
  "  issue keeps them one click away.",
].join("\n");

// ──────────────────────────────────────────────────────────────────────────
// Arguments — PURE
// ──────────────────────────────────────────────────────────────────────────

export function parseImportArgs(args) {
  let from = null;
  let dryRun = false;
  let json = false;
  let actor = null;
  let reason = null;
  const labelMap = new Map();

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry-run") { dryRun = true; continue; }
    if (a === "--json") { json = true; continue; }
    if (a === "--from") {
      from = args[++i] || null;
      if (!from) throw new Error("`--from` with no source\nknown sources: " + SOURCES.join(" | "));
      continue;
    }
    if (a === "--actor") {
      actor = args[++i] || null;
      if (!actor) throw new Error("`--actor` with no name");
      continue;
    }
    if (a === "--reason") {
      reason = args[++i] || null;
      if (!reason) throw new Error("`--reason` with no text");
      if (!isValidReason(reason)) {
        throw new Error(
          "`--reason " + reason + "` is reserved\n" +
            "`unknown` and `proven` are what the tool writes when nobody stated a reason\n" +
            "or when a run stood in for one. Typing them by hand would dress a machine's\n" +
            "answer up as yours."
        );
      }
      continue;
    }
    if (a === "--label") {
      const pair = args[++i];
      if (pair === undefined) throw new Error("`--label` with no mapping\nit takes `<from>=<to>`, and an empty <to> drops the label");
      const eq = pair.indexOf("=");
      if (eq <= 0) throw new Error("`--label " + pair + "` is not a mapping\nit takes `<from>=<to>`, and an empty <to> drops the label");
      labelMap.set(pair.slice(0, eq), pair.slice(eq + 1));
      continue;
    }
    if (a === "--label-map") {
      const file = args[++i];
      if (!file) throw new Error("`--label-map` with no file");
      let parsed;
      try {
        parsed = JSON.parse(readFileSync(file, "utf8"));
      } catch (e) {
        throw new Error("could not read the label map `" + file + "`\n" + e.message);
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("the label map must be a JSON object of `\"from\": \"to\"` pairs");
      }
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v !== "string") throw new Error("the label map entry `" + k + "` is not a string");
        labelMap.set(k, v);
      }
      continue;
    }
    if (a.startsWith("-")) throw new Error("unknown flag: " + a + "\navailable: " + FLAGS.join(" "));
    throw new Error(
      "unexpected argument: " + a + "\nthe issues come in on stdin: `gh issue list --json … | " + N + " import --from github`"
    );
  }

  if (!from) throw new Error("`--from` is required\nknown sources: " + SOURCES.join(" | "));
  if (SOURCES.indexOf(from) < 0) {
    throw new Error(
      "`--from " + from + "` is not a source this command knows\n" +
        "known sources: " + SOURCES.join(" | ") + "\n" +
        "Import is deliberately singular: an adapter for two trackers at once starts\n" +
        "from an abstraction nobody needs yet. A second source is a second task."
    );
  }
  if (actor && !isValidActor(actor)) {
    throw new Error(
      "the actor `" + actor + "` has no valid namespace\n" +
        "use one of: " + ACTOR_NAMESPACES.map((n) => n + ":<name>").join(" | ")
    );
  }
  return { from, dryRun, json, actor, reason, labelMap };
}

// ──────────────────────────────────────────────────────────────────────────
// Reading the issues — PURE, no filesystem
// ──────────────────────────────────────────────────────────────────────────

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
      number: raw.number, title: raw.title.trim(), body: typeof raw.body === "string" ? raw.body : "",
      state, url: raw.url, labels,
    });
  });
  return { issues, errors };
}

/** The one line a re-import recognises an issue by. Written into every imported
 *  task and read back by `importedSources()` — the two must not drift, so they
 *  are next to each other. */
export const SOURCE_MARKER = "Imported from GitHub: ";
const SOURCE_LINE = new RegExp("^" + SOURCE_MARKER + "(\\S+)\\s*$", "m");

/** Every source URL already present in this checkout's tasks. */
export function importedSources(tasksDir) {
  const seen = new Set();
  let names;
  try {
    names = readdirSync(tasksDir);
  } catch {
    return seen;
  }
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    let text;
    try {
      text = readFileSync(join(tasksDir, name), "utf8");
    } catch {
      continue; // unreadable is not "not imported", but it is not a reason to stop an import
    }
    const m = text.match(SOURCE_LINE);
    if (m) seen.add(m[1]);
  }
  return seen;
}

/**
 * The body of an imported task. The issue's own text goes in whole; what did
 * NOT come over is named out loud, because a reader who cannot see the omission
 * assumes there was nothing to omit.
 */
export function renderBody(issue) {
  const text = issue.body.trim();
  return [
    "## Goal",
    "",
    text || "The source issue had no description.",
    "",
    "## Notes",
    "",
    SOURCE_MARKER + issue.url,
    "",
    "Comments, attachments and status history were NOT brought over — they are the",
    "conversation around the task, not the task. They stay at the link above.",
    "",
    "This task has no `verification:` yet, so it cannot be closed. No tracker has",
    "that field; it is written by whoever picks the task up.",
    "",
  ].join("\n");
}

/**
 * What the run would do, judged against this project's vocabulary — and judged
 * COMPLETELY, before anything is written. Every complaint at once: an import
 * refused one problem at a time costs a full re-run per problem.
 *
 * @returns {{items: object[], skipped: object[], errors: string[], dropped: {label: string, issue: number}[]}}
 */
export function planImport({ issues, config, labelMap, alreadyImported }) {
  const items = [];
  const skipped = [];
  const errors = [];
  const dropped = [];

  const openStatus = config.statuses[0];
  const closedStatus = (config.archivedStatuses && config.archivedStatuses[0]) || config.statuses[config.statuses.length - 1];
  const vocabulary = config.labels || [];

  for (const issue of issues) {
    if (alreadyImported.has(issue.url)) {
      skipped.push(issue);
      continue;
    }
    const labels = [];
    for (const raw of issue.labels) {
      const mapped = labelMap.has(raw) ? labelMap.get(raw) : raw;
      if (!mapped) continue; // `--label x=` drops it on purpose, so it is not "dropped" news
      if (vocabulary.indexOf(mapped) >= 0) {
        if (labels.indexOf(mapped) < 0) labels.push(mapped);
        continue;
      }
      if (config.labelsClosed) {
        errors.push(
          "issue #" + issue.number + ": the label `" + raw + "`" + (mapped === raw ? "" : " maps to `" + mapped + "`, which") +
            " is not in this project's CLOSED label vocabulary (" + (vocabulary.length ? vocabulary.join(" | ") : "empty") + ")"
        );
        continue;
      }
      dropped.push({ label: mapped, issue: issue.number });
    }
    items.push({
      issue,
      title: issue.title,
      status: issue.state === "open" ? openStatus : closedStatus,
      labels,
    });
  }

  if (errors.length) {
    errors.push(
      "Nothing was written. Map these with `--label <from>=<to>`, or add them to " +
        "`labels:` in config.yaml if they belong to this project's vocabulary."
    );
    // The PLAN is emptied, not merely reported alongside the errors. A caller
    // holding both a list of complaints and a list of items to write has been
    // handed the choice of ignoring the first — and a half-honoured vocabulary
    // is the drift this project fails builds over.
    return { items: [], skipped, errors, dropped };
  }
  return { items, skipped, errors, dropped };
}

// ──────────────────────────────────────────────────────────────────────────
// Writing
// ──────────────────────────────────────────────────────────────────────────

/**
 * ALL OR NOTHING, for the reason `seed` is: a tree holding half an import reads
 * as an import somebody has already reconciled, and the second run would then
 * be judged against a state nobody chose.
 *
 * @throws {Error & {rolledBack: number}}
 */
export function writeImport({ root, config, board, items, createOne = createTask }) {
  const written = [];
  try {
    for (const item of items) {
      const created = createOne({
        root, config, board,
        slug: slugify(item.title) || "issue-" + item.issue.number,
        fields: {
          title: item.title,
          status: item.status,
          labels: item.labels,
          // EMPTY, not the template's placeholder (TL-67 decision 3). A field
          // filled in by the template was filled in by nobody, and hundreds of
          // tasks carrying one would make `done` refuse for a reason that reads
          // like a bug rather than like the point.
          verification: [],
        },
        body: renderBody(item.issue),
      });
      written.push({ id: created.taskId, file: created.path, title: item.title, item });
    }
  } catch (e) {
    for (const w of written) {
      try { unlinkSync(w.file); } catch { /* already gone — nothing to undo */ }
    }
    e.rolledBack = written.length;
    throw e;
  }
  return written;
}

function recordCreations(root, written, opts) {
  const actor = resolveActor(opts.actor);
  const ts = new Date().toISOString();
  // ONE SHAPE FOR A CREATION, in `history.mjs` (TL-187): `new` writes this
  // entry too now, and three hand-built copies of it would drift.
  for (const w of written) {
    recordCreation(root, { id: w.id, title: w.title }, { actor, source: "import", reason: opts.reason, ts });
  }
  reconcile(root, { actor, source: "import", reason: opts.reason || undefined });
}

// ──────────────────────────────────────────────────────────────────────────
// Reporting
// ──────────────────────────────────────────────────────────────────────────

function droppedSummary(dropped) {
  const counts = new Map();
  for (const d of dropped) counts.set(d.label, (counts.get(d.label) || 0) + 1);
  return [...counts.entries()].map(([label, n]) => label + " ×" + n);
}

function refused(problems, json) {
  if (json) {
    printJson("import", { ok: false, errors: problems });
  } else {
    const [head, ...rest] = problems;
    console.error(failure(N + " import", head, rest, [`${N} import --help`]));
  }
  return 1;
}

export function main(argv) {
  const cli = takeDirFlag(argv);
  let opts;
  try {
    opts = parseImportArgs(cli.argv);
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N + " import", head, rest, [`${N} import --help`]));
    return 2;
  }

  if (process.stdin.isTTY) {
    console.error(failure(
      N + " import", "no issues on stdin",
      ["The issues are JSON and they arrive on standard input. There is no `--repo` and",
       "no token: this command makes no network request, so authentication stays inside",
       "`gh`, where it already works."],
      [`gh issue list --state all --json number,title,body,state,labels,url | ${N} import --from github --dry-run`]
    ));
    return 2;
  }

  let input;
  try {
    input = readFileSync(0, "utf8");
  } catch (e) {
    console.error(failure(N + " import", "could not read the issues from stdin", [e.message], []));
    return 2;
  }

  // The SHAPE of the input, judged before the backlog is even resolved: a
  // refusal that costs nothing to undo.
  const { issues, errors: shapeErrors } = parseIssues(input);
  if (shapeErrors.length) return refused(shapeErrors, opts.json);

  let root;
  try {
    root = resolveBacklogDir({ dir: cli.dir, moduleDir: HERE }).root;
  } catch (e) {
    console.error(failure(N + " import", e.message, [], [`${N} import --from github --dir <path> < issues.json`]));
    return 2;
  }
  const config = loadConfigOrExit(root);
  const paths = backlogPaths(root);

  // The same gate `new` and `seed` have: a task written under a prefix the tree
  // does not use gives the tree two number spaces, and an import multiplies that
  // by the size of the input.
  const mismatch = detectPrefixMismatch(readdirSync(paths.tasksDir), config.taskIdPrefix);
  if (!mismatch.ok) {
    console.error(prefixMismatchMessage(mismatch, paths.tasksDir, {
      consequence: [
        "  Stopping BEFORE anything is written. Every imported issue would get the",
        "  prefix `" + mismatch.expected + "` and stand next to `" + mismatch.found.join("`, `") + "`.",
      ],
    }));
    return 1;
  }

  const alreadyImported = importedSources(paths.tasksDir);
  const plan = planImport({ issues, config, labelMap: opts.labelMap, alreadyImported });
  if (plan.errors.length) return refused(plan.errors, opts.json);

  const board = config.defaultBoard || (config.boards || []).map((b) => b.slug)[0] || "main";

  if (opts.dryRun) {
    if (opts.json) {
      printJson("import", {
        ok: true, root, dryRun: true,
        wouldCreate: plan.items.map((i) => ({ title: i.title, status: i.status, labels: i.labels, source: i.issue.url })),
        skipped: plan.skipped.map((i) => i.url),
        droppedLabels: droppedSummary(plan.dropped),
      });
      return 0;
    }
    console.log(`${N} import --dry-run: ` + plan.items.length + " task(s) would be created in " + root);
    for (const item of plan.items) {
      console.log("  " + color.dim("#" + item.issue.number) + "  " + item.status + "  " + item.title);
    }
    if (plan.skipped.length) console.log("  " + plan.skipped.length + " issue(s) already here — a re-import creates nothing for them");
    if (plan.dropped.length) console.log("  labels dropped (not in this project's vocabulary): " + droppedSummary(plan.dropped).join(", "));
    if (plan.items.length) {
      console.log("  all " + plan.items.length + " would have an EMPTY `verification:` — none of them could be closed until it is written");
    }
    // The exact sentence the contract greps for. It is the whole promise of the
    // flag, so it is the last thing printed and it says nothing else.
    console.log("  nothing was written");
    return 0;
  }

  let written;
  try {
    written = writeImport({ root, config, board, items: plan.items });
  } catch (e) {
    if (e && e.code === "EVOCABULARY") {
      // The same distinction `seed` draws: nothing about the input was wrong, and
      // the fix is one line in `_template.md` (TL-69).
      console.error(driftMessage(e.divergences, { templatePath: e.templatePath, fields: {}, command: N + " import" }));
      return 1;
    }
    console.error(failure(
      N + " import", "the import failed part-way through and was rolled back",
      [e.message, (e.rolledBack || 0) + " task file(s) created by this run were removed"], []
    ));
    return 1;
  }

  recordCreations(root, written, opts);
  const built = spawnSync(process.execPath, [join(HERE, "build-backlog.mjs"), "--dir", root], { stdio: "ignore" });

  if (opts.json) {
    printJson("import", {
      ok: true, root, dryRun: false,
      created: written.map((w) => ({ id: w.id, file: w.file, title: w.title, source: w.item.issue.url })),
      skipped: plan.skipped.map((i) => i.url),
      droppedLabels: droppedSummary(plan.dropped),
      withoutVerification: written.length,
    });
    return 0;
  }

  console.log(color.ok(MARK.ok) + " " + N + " import: " + written.length + " task(s) from github in " + root);
  for (const w of written) {
    console.log("  " + color.id(w.id) + "  " + color.dim("#" + w.item.issue.number) + "  " + w.title);
  }
  if (plan.skipped.length) console.log("  " + plan.skipped.length + " issue(s) skipped — already imported into this checkout");
  if (plan.dropped.length) console.log("  labels dropped (not in this project's vocabulary): " + droppedSummary(plan.dropped).join(", "));
  if (written.length) {
    // A RESULT of the import, not a footnote to it: this is the number that says
    // how much work the import did not do.
    console.error(warn(written.length + " of them have no `verification:` — they cannot be closed until you write it"));
    console.error("  " + MARK.arrow + " " + `${N} query --status ` + config.statuses[0] + " --json");
  }
  if (built.status !== 0) console.log("  WARNING: could not rebuild the views — run `" + N + " build`");
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("import-github.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
