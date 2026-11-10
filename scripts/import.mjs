#!/usr/bin/env node
/**
 * `import --from <source>` — a team's existing issues, brought over ONCE, from
 * GitHub (TL-67) or Jira (TL-581).
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
 * TWO SOURCES, ONE COMMAND (TL-581). Parsing is per source — `import-github.mjs`
 * and `import-jira.mjs` each turn their tracker's JSON into the same issue
 * shape: `ref`, `title`, markdown `body`, the `url` a re-import recognises,
 * `labels`, a status `category` (`new` | `indeterminate` | `done`) and, where
 * the tracker has named statuses, `statusName`. Planning, writing, the
 * deduplication scan and the report are shared, because they were identical
 * for both. Nothing more general than that is extracted: a third source is a
 * third task, and it can say what it shares when it exists.
 *
 * Tests: `node --test scripts/tests/import-github.test.mjs`
 *        `node --test scripts/tests/import-jira.test.mjs`
 */


import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveActorReport } from "./actor.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { statedActorRefusal, reasonRefusal, recordCreation, reconcile } from "./history.mjs";
import * as github from "./import-github.mjs";
import * as jira from "./import-jira.mjs";
import { printJson } from "./json-envelope.mjs";
import { createTask, driftMessage, slugify } from "./new-task.mjs";
import { answerBacklogDirRefusal, backlogPaths, isBacklogDirRefusal, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { detectPrefixMismatch, prefixMismatchMessage } from "./task-id.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { MARK, color, failure, warn, plural } from "./ui.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The sources this command knows: a parser of ONE tracker's JSON, the body it
 * writes, and the marker line a re-import recognises its tasks by. Two concrete
 * entries, not a plugin interface — TL-67 refused an importer in the plural, and
 * a third tracker is a third task.
 */
export const SOURCES = {
  github: {
    name: "GitHub",
    parse: github.parseIssues,
    renderBody: github.renderBody,
    marker: github.SOURCE_MARKER,
    stdinHint: `gh issue list --state all --json number,title,body,state,labels,url | ${N} import --from github --dry-run`,
    credentials: "`gh`, where it already works",
  },
  jira: {
    name: "Jira",
    parse: jira.parseJiraIssues,
    renderBody: jira.renderBody,
    marker: jira.SOURCE_MARKER,
    stdinHint: `curl … /rest/api/3/search/jql … | jq -s . | ${N} import --from jira --dry-run   (see \`${N} import --help\`)`,
    credentials: "your own `curl` call to the Jira API",
  },
};
const SOURCE_NAMES = Object.keys(SOURCES);

const FLAGS = ["--from", "--dry-run", "--json", "--actor", "--reason", "--label", "--label-map", "--status", "--priority"];

// ──────────────────────────────────────────────────────────────────────────
// Arguments — PURE
// ──────────────────────────────────────────────────────────────────────────

/** `<from>=<to>`, the shape `--label`, `--status` and `--priority` share. */
function mappingPair(flag, pair, shape, { emptyTarget }) {
  if (pair === undefined) throw new Error("`" + flag + "` with no mapping\n" + shape);
  const eq = pair.indexOf("=");
  if (eq <= 0 || (!emptyTarget && eq === pair.length - 1)) throw new Error("`" + flag + " " + pair + "` is not a mapping\n" + shape);
  return [pair.slice(0, eq), pair.slice(eq + 1)];
}

export function parseImportArgs(args) {
  let from = null;
  let dryRun = false;
  let json = false;
  let actor = null;
  let reason = null;
  const labelMap = new Map();
  const statusMap = new Map();
  const priorityMap = new Map();

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry-run") { dryRun = true; continue; }
    if (a === "--json") { json = true; continue; }
    if (a === "--from") {
      from = args[++i] || null;
      if (!from) throw new Error("`--from` with no source\nknown sources: " + SOURCE_NAMES.join(" | "));
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
      const refusal = reasonRefusal(reason, "--reason");
      if (refusal) throw new Error(refusal);
      continue;
    }
    if (a === "--label") {
      const [k, v] = mappingPair("--label", args[++i], "it takes `<from>=<to>`, and an empty <to> drops the label", { emptyTarget: true });
      labelMap.set(k, v);
      continue;
    }
    if (a === "--status") {
      const [k, v] = mappingPair(
        "--status", args[++i], "it takes `<from>=<to>`: a Jira status name, and one of this project's statuses", { emptyTarget: false }
      );
      statusMap.set(k, v);
      continue;
    }
    if (a === "--priority") {
      const [k, v] = mappingPair(
        "--priority", args[++i], "it takes `<from>=<to>`: a Jira priority name, and one of this project's priorities", { emptyTarget: false }
      );
      priorityMap.set(k, v);
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
      "unexpected argument: " + a + "\nthe issues come in on stdin: `gh issue list --json … | " + N + " import --from github`,\n" +
        "or a Jira search response: `curl … | " + N + " import --from jira`"
    );
  }

  if (!from) throw new Error("`--from` is required\nknown sources: " + SOURCE_NAMES.join(" | "));
  if (!Object.prototype.hasOwnProperty.call(SOURCES, from)) {
    throw new Error(
      "`--from " + from + "` is not a source this command knows\n" +
        "known sources: " + SOURCE_NAMES.join(" | ") + "\n" +
        "Each source is a parser of one tracker's JSON, written as its own task; there is\n" +
        "no adapter interface to point at a third tracker."
    );
  }
  if (statusMap.size && from !== "jira") {
    // GitHub has two states and no workflow. A mapping that can apply to
    // nothing is refused rather than ignored.
    throw new Error("`--status` maps a Jira workflow status\na GitHub issue is only open or closed, and that is mapped already");
  }
  if (priorityMap.size && from !== "jira") {
    // The GitHub source reads no priority at all, so the mapping could apply
    // to nothing — refused for the reason `--status` is.
    throw new Error("`--priority` maps a Jira priority\na GitHub issue carries no priority this command reads");
  }
  const badActor = actor ? statedActorRefusal(actor) : null;
  if (badActor) throw new Error(badActor.refusal + "\n" + badActor.hint);
  return { from, dryRun, json, actor, reason, labelMap, statusMap, priorityMap };
}

// ──────────────────────────────────────────────────────────────────────────
// What is already here
// ──────────────────────────────────────────────────────────────────────────

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every source's marker line, read back by one pattern. A GitHub URL and a
 *  Jira browse URL never coincide, so one set of links serves both. */
const SOURCE_LINE = new RegExp(
  "^(?:" + Object.values(SOURCES).map((s) => escapeRe(s.marker)).join("|") + ")(\\S+)\\s*$",
  "m"
);

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

// ──────────────────────────────────────────────────────────────────────────
// The plan — PURE
// ──────────────────────────────────────────────────────────────────────────

/**
 * Where a status CATEGORY lands in this project: work not started on the first
 * status, work under way on the in-progress status (the first status where the
 * project has none), work finished on the first archived status. Never a
 * literal — `icebox | doing | shipped` is as valid a vocabulary as ours.
 */
function categoryStatuses(config) {
  const open = config.statuses[0];
  const closed = (config.archivedStatuses && config.archivedStatuses[0]) || config.statuses[config.statuses.length - 1];
  return { new: open, indeterminate: config.inProgressStatus || open, done: closed };
}

/**
 * What the run would do, judged against this project's vocabulary — and judged
 * COMPLETELY, before anything is written. Every complaint at once: an import
 * refused one problem at a time costs a full re-run per problem.
 *
 * @returns {{items: object[], skipped: object[], errors: string[], dropped: {label: string, issue: string}[]}}
 */
export function planImport({ issues, config, labelMap, statusMap = new Map(), priorityMap = new Map(), alreadyImported }) {
  const items = [];
  const skipped = [];
  const errors = [];
  const dropped = [];

  const byCategory = categoryStatuses(config);
  const vocabulary = config.labels || [];

  for (const [from, to] of statusMap) {
    if (config.statuses.indexOf(to) < 0) {
      errors.push("`--status " + from + "=" + to + "`: `" + to + "` is not one of this project's statuses (" + config.statuses.join(" | ") + ")");
    }
  }
  const priorities = config.priorities || [];
  for (const [from, to] of priorityMap) {
    if (priorities.indexOf(to) < 0) {
      errors.push(
        "`--priority " + from + "=" + to + "`: `" + to + "` is not one of this project's priorities (" +
          (priorities.length ? priorities.join(" | ") : "none declared") + ")"
      );
    }
  }

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
          "issue " + issue.ref + ": the label `" + raw + "`" + (mapped === raw ? "" : " maps to `" + mapped + "`, which") +
            " is not in this project's CLOSED label vocabulary (" + (vocabulary.length ? vocabulary.join(" | ") : "empty") + ")"
        );
        continue;
      }
      dropped.push({ label: mapped, issue: issue.ref });
    }
    const status = issue.statusName && statusMap.has(issue.statusName) ? statusMap.get(issue.statusName) : byCategory[issue.category];
    // No default mapping: Jira priority names are per site, so a ticket whose
    // priority was not named keeps the template's value, and the body says so.
    const priority = issue.priority && priorityMap.has(issue.priority) ? priorityMap.get(issue.priority) : null;
    items.push({ issue, title: issue.title, status, labels, priority });
  }

  if (errors.length) {
    errors.push(
      "Nothing was written. Map labels with `--label <from>=<to>` or add them to " +
        "`labels:` in config.yaml if they belong to this project's vocabulary; a status " +
        "is mapped onto one of `statuses:`, a priority onto one of `priorities:`."
    );
    // The PLAN is emptied, not merely reported alongside the errors. A caller
    // holding both a list of complaints and a list of items to write has been
    // handed the choice of ignoring the first — and a half-honoured vocabulary
    // is the drift this project fails builds over.
    return { items: [], skipped, errors, dropped };
  }
  return { items, skipped, errors, dropped };
}

/** Every node type the Jira converter did not know, summed over the plan. */
function unknownNodeSummary(items) {
  const counts = new Map();
  for (const { issue } of items) {
    if (!issue.unknownNodes) continue;
    for (const [type, n] of issue.unknownNodes) counts.set(type, (counts.get(type) || 0) + n);
  }
  return [...counts.entries()].map(([type, n]) => type + " ×" + n);
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
export function writeImport({ root, config, board, items, renderBody, createOne = createTask }) {
  const written = [];
  try {
    for (const item of items) {
      const created = createOne({
        root, config, board,
        slug: slugify(item.title) || "issue-" + slugify(String(item.issue.ref)),
        fields: {
          title: item.title,
          status: item.status,
          labels: item.labels,
          // `null` leaves the template's priority in place: `createTask()`
          // sets only a value it is given.
          priority: item.priority,
          // EMPTY, not the template's placeholder (TL-67 decision 3). A field
          // filled in by the template was filled in by nobody, and hundreds of
          // tasks carrying one would make `done` refuse for a reason that reads
          // like a bug rather than like the point.
          verification: [],
        },
        body: renderBody(item.issue, { priority: item.priority }),
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
  if (!written.length) return;
  const { actor } = opts.resolved;
  const ts = new Date().toISOString();
  // ONE SHAPE FOR A CREATION, in `history.mjs` (TL-187): `new` writes this
  // entry too now, and three hand-built copies of it would drift.
  for (const w of written) {
    recordCreation(root, { id: w.id, title: w.title }, { actor, source: "import", reason: opts.reason, ts });
  }
  // Import owns the tasks in `written`, not every task missing from this
  // checkout's local snapshot. Keep the reconciliation scope identical to the
  // write scope so an import cannot adopt unrelated append-only history.
  reconcile(root, {
    actor,
    source: "import",
    reason: opts.reason || undefined,
    only: written.map((w) => w.id),
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Reporting
// ──────────────────────────────────────────────────────────────────────────

function droppedSummary(dropped) {
  const counts = new Map();
  for (const d of dropped) counts.set(d.label, (counts.get(d.label) || 0) + 1);
  return [...counts.entries()].map(([label, n]) => label + " ×" + n);
}

function refused(problems, opts) {
  if (opts.json) {
    printJson("import", { ok: false, errors: problems, actorSource: opts.resolved.actorSource });
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
  // Resolved ONCE, before the input is read (TL-550): the creations are
  // recorded under this actor, and `--json` names the rung that answered.
  opts.resolved = resolveActorReport(opts.actor);
  const source = SOURCES[opts.from];

  if (process.stdin.isTTY) {
    console.error(failure(
      N + " import", "no issues on stdin",
      ["The issues are JSON and they arrive on standard input. There is no `--repo` and",
       "no token: this command makes no network request, so authentication stays inside",
       source.credentials + "."],
      [source.stdinHint]
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
  const { issues, errors: shapeErrors } = source.parse(input);
  if (shapeErrors.length) return refused(shapeErrors, opts);

  let root;
  try {
    root = resolveBacklogDir({ dir: cli.dir, moduleDir: HERE }).root;
  } catch (e) {
    if (!isBacklogDirRefusal(e)) throw e;
    return answerBacklogDirRefusal(e, { command: N + " import", jsonKind: opts.json ? "import" : null, hints: [`${N} import --from ${opts.from} --dir <path> < issues.json`] });
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
  const plan = planImport({ issues, config, labelMap: opts.labelMap, statusMap: opts.statusMap, priorityMap: opts.priorityMap, alreadyImported });
  if (plan.errors.length) return refused(plan.errors, opts);

  const board = config.defaultBoard || (config.boards || []).map((b) => b.slug)[0] || "main";
  const unknownNodes = unknownNodeSummary(plan.items);
  const unknownLine = "  description content kept as text, its formatting not converted: " + unknownNodes.join(", ");

  if (opts.dryRun) {
    if (opts.json) {
      printJson("import", {
        ok: true, root, dryRun: true,
        wouldCreate: plan.items.map((i) => ({
          title: i.title, status: i.status, priority: i.priority, labels: i.labels, source: i.issue.url, sourceState: i.issue.sourceState,
        })),
        skipped: plan.skipped.map((i) => i.url),
        droppedLabels: droppedSummary(plan.dropped),
        unknownNodes,
        actorSource: opts.resolved.actorSource,
      });
      return 0;
    }
    console.log(`${N} import --dry-run: ` + plan.items.length + " " + plural(plan.items.length, "task", "tasks") + " would be created in " + root);
    for (const item of plan.items) {
      console.log("  " + color.dim(item.issue.ref) + "  " + item.status + (item.priority ? "  " + item.priority : "") + "  " + item.title);
    }
    if (plan.skipped.length) console.log("  " + plan.skipped.length + " " + plural(plan.skipped.length, "issue", "issues") + " already here — a re-import creates nothing for them");
    if (plan.dropped.length) console.log("  labels dropped (not in this project's vocabulary): " + droppedSummary(plan.dropped).join(", "));
    if (unknownNodes.length) console.log(unknownLine);
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
    written = writeImport({ root, config, board, items: plan.items, renderBody: source.renderBody });
  } catch (e) {
    if (e && e.code === "EVOCABULARY") {
      // The same distinction `seed` draws: nothing about the input was wrong, and
      // the fix is one line in `_template.md` (TL-69).
      console.error(driftMessage(e.divergences, { templatePath: e.templatePath, fields: {}, command: N + " import" }));
      return 1;
    }
    console.error(failure(
      N + " import", "the import failed part-way through and was rolled back",
      [e.message, (e.rolledBack || 0) + " " +
        plural(e.rolledBack || 0, "task file created by this run was", "task files created by this run were") + " removed"], []
    ));
    return 1;
  }

  recordCreations(root, written, opts);
  const built = spawnSync(process.execPath, [join(HERE, "build-backlog.mjs"), "--dir", root], { stdio: "ignore" });

  if (opts.json) {
    printJson("import", {
      ok: true, root, dryRun: false,
      // `sourceState` is what a caller retiring the source needs and cannot
      // derive: the task's status is this project's vocabulary, the issue's
      // state is the tracker's — open or closed for GitHub, the workflow
      // status name for Jira — and only an issue that was open is still to close.
      created: written.map((w) => ({
        id: w.id, file: w.file, title: w.title, source: w.item.issue.url, sourceState: w.item.issue.sourceState,
      })),
      skipped: plan.skipped.map((i) => i.url),
      droppedLabels: droppedSummary(plan.dropped),
      unknownNodes,
      withoutVerification: written.length,
      actorSource: opts.resolved.actorSource,
    });
    return 0;
  }

  console.log(color.ok(MARK.ok) + " " + N + " import: " + written.length + " " + plural(written.length, "task", "tasks") + " from " + opts.from + " in " + root);
  for (const w of written) {
    console.log("  " + color.id(w.id) + "  " + color.dim(w.item.issue.ref) + "  " + w.title);
  }
  if (plan.skipped.length) console.log("  " + plan.skipped.length + " " + plural(plan.skipped.length, "issue", "issues") + " skipped — already imported into this checkout");
  if (plan.dropped.length) console.log("  labels dropped (not in this project's vocabulary): " + droppedSummary(plan.dropped).join(", "));
  if (unknownNodes.length) console.log(unknownLine);
  if (written.length) {
    // A RESULT of the import, not a footnote to it: this is the number that says
    // how much work the import did not do.
    console.error(warn(written.length + " of them have no `verification:` — they cannot be closed until you write it"));
    console.error("  " + MARK.arrow + " " + `${N} query --status ` + config.statuses[0] + " --json");
  }
  // Only an issue that was OPEN is still a second copy in GitHub; one that was
  // already closed needs nothing, and a pointer printed for it would send the
  // reader to close what is closed. A Jira ticket is deliberately left open
  // (TL-581): people outside the repository still work from it.
  const stillOpen = opts.from === "github" ? written.filter((w) => w.item.issue.state === "open").length : 0;
  if (stillOpen) {
    console.error("  " + stillOpen + " came from issues still OPEN in GitHub. After committing, close each with");
    console.error("  a comment naming its task — RETIRING THE SOURCE ISSUES in:");
    console.error("  " + MARK.arrow + " " + `${N} import --help`);
  }
  if (built.status !== 0) console.log("  WARNING: could not rebuild the views — run `" + N + " build`");
  return 0;
}

if (process.argv[1] && basename(process.argv[1]) === "import.mjs") {
  process.exitCode = main(process.argv.slice(2));
}
