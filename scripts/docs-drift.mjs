#!/usr/bin/env node
/**
 * `docs-drift` — which documents have probably gone stale, and why (TL-100).
 *
 * THE SPLIT THIS COMMAND EXISTS TO KEEP. The tool does NOT write documentation.
 * It detects that a document is dying and turns that into a queue item with a
 * closing contract; an agent in the `docs_role` writes the prose, through the
 * same verification gate as any other work. That boundary is TL-96's — this is
 * not an agent — and `--seed-tasks` is exactly as far as it goes.
 *
 * WHY THE HARD HALF IS THE DETECTION. Writing a document is what a writer does;
 * KNOWING that one has gone stale is what nobody does, and it is computable
 * from evidence this repository already carries: git says when the document
 * last changed, the task files say what closed around it, and the document
 * itself says what it still claims.
 *
 * THREE DETECTORS, each a pure function, each with its own name so a caller can
 * ask for one:
 *
 *   tasks-newer   `docs_drift_task_threshold` tasks or more that name the
 *                 document in `related_docs:` closed AFTER it last changed
 *   dead-refs     the document links a file that is not there, or names a task
 *                 id this backlog does not have
 *   status-claim  a line matching `docs_status_pending_patterns` — this
 *                 project's way of writing "still ahead of us" — naming only
 *                 tasks that have since closed
 *
 * THE HONESTY RULES, without which the report becomes noise everybody ignores:
 *
 *   1. **Every flag lists its SIGNALS**, with the task ids and the dead targets
 *      spelled out. There is no bare "this document is stale" verdict, because
 *      a verdict with no evidence cannot be argued with and so is not acted on.
 *   2. **Below `docs_drift_min_signals` a document is NOT reported** — it is
 *      named in the "too little signal" section, the same rule the time reports
 *      follow with `min_report_n`. One dead link is a typo, not drift.
 *   3. **A detector that CANNOT run says so** rather than staying quiet: a
 *      document git has never seen, a project with no status-heading
 *      convention. Silence that means "nothing found" and silence that means
 *      "nothing asked" read identically, and that is how a green report loses
 *      its evidentiary force.
 *   4. **`--seed-tasks` is idempotent.** The key is the document path in the
 *      `related_docs:` of an OPEN task asking for the docs role; a second run
 *      creates nothing.
 *
 * Out of scope, deliberately: reading what a document SAYS (that is the docs
 * agent's work), watching files, and every write except `--seed-tasks`.
 *
 * Exit: 0 = nothing to report · 1 = documents flagged · 2 = the invocation was wrong.
 *
 * Tests: `node --test scripts/tests/docs-drift.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyTarget, documentsToCheck, linksIn, relatedDocsIn } from "./check-docs-links.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { printJson } from "./json-envelope.mjs";
import { createTask } from "./new-task.mjs";
import { backlogPaths, repositoryRoot, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { splitFrontmatter } from "./task-fields.mjs";
import { readTaskRecords } from "./task-select.mjs";
import { MARK, color, failure, heading, table } from "./ui.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The detector names, in report order. A caller narrows the gate with them,
 *  which is what makes a seeded task's `verification:` executable: signal 3 is
 *  a judgement about prose and does not always survive an automatic check. */
export const DETECTORS = ["tasks-newer", "dead-refs", "status-claim"];

const FLAGS = ["--document", "--signal", "--seed-tasks", "--json", "--dir"];

export const USAGE = [
  `${N} docs-drift [--document <path>] [--signal <name>] [--seed-tasks] [--json] [--dir <path>]`,
  "",
  "  Which documents have probably gone stale, and the specific signals that say",
  "  so. It never writes documentation — `--seed-tasks` turns a finding into a",
  "  task for whoever holds `docs_role`, and that is the whole of its authority.",
  "",
  "    tasks-newer    `docs_drift_task_threshold` tasks or more naming the document",
  "                   in `related_docs:` closed AFTER the document last changed",
  "    dead-refs      a link to a file that is not there, or a task id this backlog",
  "                   does not have",
  "    status-claim   a line matching `docs_status_pending_patterns` that names",
  "                   only tasks which have since closed",
  "",
  "  --document <p>  judge this one document (repository-relative), not the tree",
  "  --signal <n>    run only these detectors; repeatable. " + DETECTORS.join(" · "),
  "  --seed-tasks    create one task per flagged document, with its signals in the",
  "                  body. Idempotent: a document already named in the",
  "                  `related_docs:` of an open docs task is skipped",
  "  --json          the same findings for a program",
  "",
  "  BELOW `docs_drift_min_signals` A DOCUMENT IS NOT FLAGGED — it is named under",
  "  `too little signal` instead. One dead link is a typo, and a report that calls",
  "  it drift is one nobody reads twice.",
  "",
  "  exit: 0 nothing to report · 1 documents flagged · 2 the invocation was wrong",
].join("\n");

// ──────────────────────────────────────────────────────────────────────────
// Arguments — PURE
// ──────────────────────────────────────────────────────────────────────────

export function parseDriftArgs(args) {
  let document = null;
  let seed = false;
  let json = false;
  const signals = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") { json = true; continue; }
    if (a === "--seed-tasks") { seed = true; continue; }
    if (a === "--document") {
      document = args[++i];
      if (!document) throw new Error("`--document` with no path");
      continue;
    }
    if (a === "--signal") {
      const name = args[++i];
      if (!name) throw new Error("`--signal` with no name");
      if (DETECTORS.indexOf(name) < 0) {
        throw new Error("unknown signal: " + name + "\nknown signals: " + DETECTORS.join(" "));
      }
      signals.push(name);
      continue;
    }
    if (a.startsWith("-")) throw new Error("unknown flag: " + a + "\nknown flags: " + FLAGS.join(" "));
    throw new Error("unexpected argument: " + a + "\nthe document is `--document <path>`");
  }
  return { document, signals: signals.length ? [...new Set(signals)] : DETECTORS.slice(), seed, json };
}

// ──────────────────────────────────────────────────────────────────────────
// The detectors — PURE
// ──────────────────────────────────────────────────────────────────────────

/** A day, at the resolution both `updated:` and `git log --format=%cs` have. */
const day = (s) => String(s || "").slice(0, 10);

/** Repository-relative, with forward slashes — the shape `related_docs:` uses
 *  and the only one in which two paths can be compared. */
export function normalizeDocPath(p) {
  return String(p || "").split(sep).join("/").replace(/^\.\//, "").replace(/^\//, "");
}

/**
 * Tasks that name this document and closed AFTER it last changed.
 *
 * `changed` being null is NOT a silent zero: a document git has never seen has
 * no "after", and the caller reports that as a detector which could not run.
 */
export function tasksNewerThanDoc(tasks, { doc, changed, archived, threshold }) {
  if (!changed) {
    return { fired: false, tasks: [], reason: "git has no commit touching this document, so there is no `after` to compare against" };
  }
  const closed = new Set(archived);
  const found = [];
  for (const t of tasks) {
    if (!closed.has(t.status)) continue;
    if (!(t.related_docs || []).some((d) => normalizeDocPath(d) === doc)) continue;
    const when = day(t.updated);
    if (when && when > changed) found.push({ task: t.id, title: t.title, closed: when });
  }
  found.sort((a, b) => a.closed.localeCompare(b.closed));
  return { fired: found.length >= threshold, tasks: found, reason: null };
}

/**
 * Targets this document names that are not there — a file, or a task id.
 *
 * The file half deliberately repeats what `check --docs` gates on. The two are
 * not the same event: there it fails a commit, here it is one signal among
 * three that a document has been left behind, and a document with a dead link
 * AND four tasks closed around it is a different finding from either alone.
 */
export function deadReferences({ doc, text, exists, root, taskIds, taskIdRe }) {
  const { frontmatter, body } = splitFrontmatter(text);
  const dead = [];

  const targets = linksIn(body || text)
    .concat(relatedDocsIn(frontmatter).map((e) => ({ ...e, kind: "related_docs" })));
  for (const entry of targets) {
    const verdict = classifyTarget(entry.target);
    if (verdict.skip) continue;
    // The two resolution rules of the format, as `check --docs` states them: a
    // markdown link is relative to the FILE, a `related_docs` entry to the
    // repository root.
    const base = entry.kind === "related_docs" || isAbsolute(verdict.path)
      ? root
      : dirname(join(root, doc));
    if (!exists(resolve(base, verdict.path.replace(/^\//, "")))) {
      dead.push({ kind: entry.kind === "related_docs" ? "related_docs" : "link", target: entry.target, line: entry.line });
    }
  }

  const known = new Set(taskIds);
  const seen = new Set();
  const lines = String(text || "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(taskIdRe)) {
      const id = m[0];
      if (known.has(id) || seen.has(id)) continue;
      seen.add(id);
      dead.push({ kind: "task", target: id, line: i + 1 });
    }
  }
  return { fired: dead.length > 0, dead };
}

/**
 * A line claiming the work is still ahead of the document, naming only tasks
 * that have since closed.
 *
 * The PATTERNS are the project's, not the code's: `**Status:** PROJECT` is one
 * repository's habit. With none declared the detector reports that it was never
 * asked anything, which is not the same answer as "nothing found".
 */
export function statusClaims({ text, patterns, archived, taskIdRe, statusById }) {
  if (!(patterns || []).length) {
    return { fired: false, claims: [], reason: "`docs_status_pending_patterns` is empty — this project has not said how its documents claim work is still ahead of them" };
  }
  const closed = new Set(archived);
  const res = patterns.map((p) => new RegExp(p));
  const claims = [];
  const lines = String(text || "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!res.some((re) => re.test(lines[i]))) continue;
    const ids = [...new Set([...lines[i].matchAll(taskIdRe)].map((m) => m[0]))]
      .filter((id) => statusById.has(id));
    if (!ids.length) continue;
    if (!ids.every((id) => closed.has(statusById.get(id)))) continue;
    claims.push({ line: i + 1, text: lines[i].trim(), tasks: ids });
  }
  return { fired: claims.length > 0, claims, reason: null };
}

// ──────────────────────────────────────────────────────────────────────────
// One document, then the tree — PURE
// ──────────────────────────────────────────────────────────────────────────

/** Every signal for one document, as a flat list plus the detectors that could
 *  not run. `signals` selects which detectors are asked at all. */
export function judgeDocument({ doc, text, changed, tasks, config, exists, root, signals }) {
  const wanted = new Set(signals || DETECTORS);
  const archived = config.archivedStatuses || [];
  const taskIdRe = new RegExp(config.taskId.anywhere.source, "g");
  const taskIds = new Set(tasks.map((t) => t.id));
  const statusById = new Map(tasks.map((t) => [t.id, t.status]));

  const out = [];
  const notes = [];

  if (wanted.has("tasks-newer")) {
    const r = tasksNewerThanDoc(tasks, { doc, changed, archived, threshold: config.docsDrift.taskThreshold });
    if (r.reason) notes.push({ detector: "tasks-newer", reason: r.reason });
    else if (r.fired) {
      out.push({
        detector: "tasks-newer",
        detail: r.tasks.length + " task(s) naming this document closed after it last changed (" + changed + ")",
        items: r.tasks.map((t) => t.task + " — closed " + t.closed + " — " + t.title),
      });
    }
  }

  if (wanted.has("dead-refs")) {
    const r = deadReferences({ doc, text, exists, root, taskIds, taskIdRe });
    for (const d of r.dead) {
      out.push({
        detector: "dead-refs",
        detail: (d.kind === "task" ? "no such task" : "nothing at that path") + ": " + d.target,
        items: [doc + ":" + d.line + " → " + d.target + (d.kind === "related_docs" ? "  (related_docs)" : "")],
      });
    }
  }

  if (wanted.has("status-claim")) {
    const r = statusClaims({ text, patterns: config.docsDrift.pendingPatterns, archived, taskIdRe, statusById });
    if (r.reason) notes.push({ detector: "status-claim", reason: r.reason });
    else for (const c of r.claims) {
      out.push({
        detector: "status-claim",
        detail: "the line claims the work is still ahead, and every task it names is closed",
        items: [doc + ":" + c.line + " → " + c.text, "closed: " + c.tasks.join(", ")],
      });
    }
  }

  return { doc, changed, signals: out, notes };
}

/** The whole report. `documents` is `[{doc, text, changed}]`, already read. */
export function driftReport({ documents, tasks, config, exists, root, signals }) {
  const min = config.docsDrift.minSignals;
  const flagged = [];
  const tooLittle = [];
  for (const d of documents) {
    const judged = judgeDocument({ ...d, tasks, config, exists, root, signals });
    if (judged.signals.length >= min) flagged.push(judged);
    else if (judged.signals.length) tooLittle.push(judged);
  }
  return { documents: documents.length, minSignals: min, flagged, tooLittle };
}

// ──────────────────────────────────────────────────────────────────────────
// Seeding — the only write, and the only place a task is created
// ──────────────────────────────────────────────────────────────────────────

/** Documents that already have an OPEN task asking for the docs role. The key
 *  is the path in `related_docs:`, which is what makes a second run silent. */
export function alreadySeeded(tasks, { role, archived }) {
  const closed = new Set(archived);
  const covered = new Map();
  for (const t of tasks) {
    if (closed.has(t.status)) continue;
    if ((t.role || "") !== role) continue;
    for (const d of t.related_docs || []) {
      const key = normalizeDocPath(d);
      if (!covered.has(key)) covered.set(key, t.id);
    }
  }
  return covered;
}

/** The body of a seeded task. Every signal is written out: a task saying only
 *  "this document is stale" hands its reader the detection problem again. */
export function seedBody(judged, { command }) {
  const lines = [
    "",
    "## Goal",
    "",
    "`" + judged.doc + "` has drifted away from the project. Bring it back into",
    "agreement with the tree, then close this task on the contract below.",
    "",
    "## Context",
    "",
    "Created by `" + N + " docs-drift --seed-tasks`. The signals below are what the",
    "detectors found; they are evidence, not a verdict, and a signal that turns out",
    "to describe a document which is still correct is worth saying so in the commit.",
    "",
  ];
  for (const s of judged.signals) {
    lines.push("- **" + s.detector + "** — " + s.detail);
    for (const item of s.items) lines.push("  - " + item);
  }
  if (judged.notes.length) {
    lines.push("");
    lines.push("Detectors that could not run here:");
    for (const n of judged.notes) lines.push("- **" + n.detector + "** — " + n.reason);
  }
  lines.push(
    "",
    "## Pre-flight reading",
    "",
    "1. `" + judged.doc + "` — the document itself, and what it still claims",
    "",
    "## Steps",
    "",
    "1. Read the signals above against the document.",
    "2. Update what is wrong; where a signal was a false alarm, say so in the commit.",
    "",
    "## Acceptance criteria",
    "",
    // ONE LINE. A criterion wrapped onto a second one loses its `[proof:]` — the
    // guard reads a criterion line by line — so a seeded task written across two
    // would arrive unlinked and `check --criteria` would complain about a task
    // nobody typed.
    "- [ ] No signal from `tasks-newer` or `dead-refs` is left on this document. [proof: drift-clear]",
    "",
    "`" + command + "` is what proves it.",
    ""
  );
  return lines.join("\n");
}

/** Create one task per flagged document, skipping the ones already covered.
 *  `create` is injected so the test can watch what would be written. */
export function seedTasks(report, { tasks, config, board, create }) {
  const role = config.docsDrift.role;
  const covered = alreadySeeded(tasks, { role, archived: config.archivedStatuses });
  const created = [];
  const skipped = [];
  for (const judged of report.flagged) {
    if (covered.has(judged.doc)) {
      skipped.push({ doc: judged.doc, task: covered.get(judged.doc) });
      continue;
    }
    // Detectors 1 and 2 only. `status-claim` is a judgement about a sentence,
    // and a gate that demanded it would refuse to close a document somebody had
    // correctly decided to leave as it stands.
    const command = N + " docs-drift --document " + judged.doc +
      " --signal tasks-newer --signal dead-refs";
    const title = ("Documentation drift: " + judged.doc.split("/").pop())
      .slice(0, config.titleMaxLength);
    const r = create({
      title,
      role,
      board,
      relatedDocs: [judged.doc],
      verification: [{ id: "drift-clear", bash: command }],
      body: seedBody(judged, { command }),
    });
    created.push({ doc: judged.doc, task: r.taskId, path: r.path });
  }
  return { created, skipped };
}

// ──────────────────────────────────────────────────────────────────────────
// Reading the tree
// ──────────────────────────────────────────────────────────────────────────

/** The day a document last changed, as git records it. `null` when git has
 *  never seen the file — reported as a detector that could not run, never as
 *  "nothing changed". */
export function gitLastChange(root, doc) {
  const r = spawnSync("git", ["-C", root, "log", "-1", "--format=%cs", "--", doc], {
    encoding: "utf8", timeout: 20_000,
  });
  if (r.status !== 0) return null;
  const d = String(r.stdout || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/** Which documents this command judges: the prose, never the task files. A task
 *  is not documentation and has its own guards. */
export function documentsInScope(root, tasksDir) {
  return documentsToCheck(root, tasksDir)
    .filter((f) => !normalizeDocPath(relative(root, f)).startsWith(normalizeDocPath(relative(root, tasksDir)) + "/"))
    .map((f) => normalizeDocPath(relative(root, f)));
}

// ──────────────────────────────────────────────────────────────────────────
// Reporting
// ──────────────────────────────────────────────────────────────────────────

export function render(report, config, { seeded } = {}) {
  const out = [heading(N + " docs-drift — " + report.documents + " document(s)")];
  out.push("  " + color.dim("a report, not a gate: nothing here was changed, and nothing failed"));

  out.push("");
  out.push(heading("  flagged  (" + report.flagged.length + ")"));
  for (const d of report.flagged) {
    out.push("");
    out.push("   " + color.warn(MARK.warn) + " " + d.doc + color.dim("  last changed " + (d.changed || "never, as far as git knows")));
    for (const s of d.signals) {
      out.push("     " + s.detector + " — " + s.detail);
      for (const item of s.items) out.push("       " + color.dim(item));
    }
  }

  out.push("");
  out.push(heading("  too little signal  (" + report.tooLittle.length + ")"));
  out.push("  " + color.dim("below " + report.minSignals + " signal(s) a document is not called stale — one dead link is a typo"));
  if (report.tooLittle.length) {
    out.push(table(report.tooLittle.map((d) => ["   ", d.doc, d.signals.length + " signal(s)", d.signals.map((s) => s.detector).join(", ")])));
  }

  const notes = new Map();
  for (const d of report.flagged.concat(report.tooLittle)) {
    for (const n of d.notes) if (!notes.has(n.detector)) notes.set(n.detector, n.reason);
  }
  if (notes.size) {
    out.push("");
    out.push(heading("  detectors that could not run"));
    for (const [detector, reason] of notes) out.push("   " + detector + " — " + color.dim(reason));
  }

  if (seeded) {
    out.push("");
    out.push(heading("  seeded  (" + seeded.created.length + ")"));
    for (const c of seeded.created) out.push("   " + color.ok(MARK.ok) + " " + c.task + "  " + c.doc);
    for (const s of seeded.skipped) out.push("   " + color.dim("· " + s.doc + " — already covered by " + s.task));
  }

  out.push("");
  out.push(report.flagged.length
    ? "  " + color.warn(MARK.warn) + " " + report.flagged.length + " document(s) flagged."
    : "  " + color.ok(MARK.ok) + " nothing to report — no document carries enough signal to call it stale.");
  return out.join("\n");
}

// ──────────────────────────────────────────────────────────────────────────
// The run
// ──────────────────────────────────────────────────────────────────────────

export function main(argv) {
  const cli = takeDirFlag(argv);
  let opts;
  try {
    opts = parseDriftArgs(cli.argv);
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N + " docs-drift", head, rest, [`${N} docs-drift --help`]));
    return 2;
  }

  let backlog;
  try {
    backlog = resolveBacklogDir({ dir: cli.dir, moduleDir: HERE }).root;
  } catch (e) {
    console.error(failure(N + " docs-drift", e.message, [], [`${N} docs-drift --dir <path>`]));
    return 2;
  }
  const config = loadConfigOrExit(backlog);
  const paths = backlogPaths(backlog);
  const root = repositoryRoot(backlog);
  const tasks = readTaskRecords(paths.tasksDir, config.taskId.file);

  let docs;
  if (opts.document) {
    docs = [normalizeDocPath(opts.document)];
    if (!existsSync(join(root, docs[0]))) {
      console.error(failure(
        N + " docs-drift",
        "no such document: " + opts.document,
        ["the path is relative to the repository root — " + root],
        [`${N} docs-drift`]
      ));
      return 2;
    }
  } else {
    docs = documentsInScope(root, paths.tasksDir);
  }

  const documents = docs.map((doc) => ({
    doc,
    text: readFileSync(join(root, doc), "utf8"),
    changed: gitLastChange(root, doc),
  }));

  const report = driftReport({
    documents, tasks, config, exists: (p) => existsSync(p), root, signals: opts.signals,
  });

  let seeded = null;
  if (opts.seed) {
    if (!config.docsDrift.role) {
      console.error(failure(
        N + " docs-drift",
        "this backlog has not said who maintains its documentation",
        [
          "`--seed-tasks` writes a task for a ROLE, and `docs_role` in config.yaml is empty.",
          "A task with no role goes into the general queue, which is the one place the",
          "split this command exists for stops working.",
        ],
        ["set `roles:` and `docs_role:` in config.yaml"]
      ));
      return 2;
    }
    seeded = seedTasks(report, {
      tasks, config, board: config.defaultBoard || "main",
      create: (spec) => createTask({
        root: backlog,
        config,
        board: spec.board,
        slug: slugForDoc(spec.title),
        fields: {
          title: spec.title, role: spec.role,
          related_docs: spec.relatedDocs, verification: spec.verification,
        },
        body: spec.body,
      }),
    });
  }

  if (opts.json) {
    printJson("docs-drift", {
      documents: report.documents,
      minSignals: report.minSignals,
      flagged: report.flagged,
      tooLittle: report.tooLittle,
      seeded: seeded || undefined,
    });
    return report.flagged.length ? 1 : 0;
  }
  console.log(render(report, config, { seeded }));
  return report.flagged.length ? 1 : 0;
}

/** The slug of a seeded task. Shared with `new` in shape, not in code: `new`
 *  slugifies a title typed by a person, and this one is derived from a path. */
function slugForDoc(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

if (process.argv[1] && process.argv[1].endsWith("docs-drift.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
