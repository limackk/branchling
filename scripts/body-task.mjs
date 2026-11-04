#!/usr/bin/env node
/**
 * `body <ID>` — rewriting a task's prose through the tool, with the reason on
 * the record (TL-523).
 *
 * WHAT WAS MISSING. Every frontmatter field had a writer that recorded who
 * changed it and why; the body had none. A body edited by hand reaches the
 * history as nothing at all — `diffMeta` reads frontmatter only, by design — so
 * an interface that wanted to offer body editing (a separate package, a web
 * page) could only write the file behind the tool's back and leave a change no
 * record explains. This command is the write path such an interface calls.
 *
 * THE RECORD SHAPE, and why it holds no text. docs/branchling-state-and-sync.md // product-name: allow
 * §5.3 settles how a body write is guarded: it CARRIES A BASE-VERSION HASH, and
 * a mismatch with the head is refused rather than merged. So the `__body__`
 * entry records exactly those two versions — `from` and `to` are
 * `sha256:<hex>` of the body before and after — plus `lines: {added, removed}`
 * so that a reader sees the size of the edit without two opaque hashes being
 * the whole of it. The bodies themselves are NOT stored: the text already lives
 * in the task file and in git, and a log that copied every revision would grow
 * with the prose rather than with the number of edits, which is the opposite of
 * what an append-only log is for.
 *
 * `--base` IS THE §5.3 GUARD, and it is optional. An interface that read the
 * body before letting somebody edit it passes the hash it read; if the file has
 * moved since, the write is refused (exit 1, `stale-base`) and nothing is
 * written — "someone changed this, refresh". A person at a terminal who is
 * writing the whole body from a file has no earlier read to protect, and
 * requiring the flag of them would only teach them to paste the current hash.
 *
 * WHAT IT REFUSES, before anything is written:
 *   - no reason — the record would explain nothing, which is the defect it
 *     exists to remove;
 *   - an empty body, and a body that opens with a `---` fence: the frontmatter
 *     is written by field commands, and a pasted block would become prose that
 *     looks like configuration;
 *   - a body that breaks the acceptance-criteria contract (`criteria.mjs`):
 *     any error, or a warning the CURRENT body does not already carry. "No
 *     worse than before" rather than "perfect", because a body write should not
 *     be refused for a weakness it did not introduce — and should not be the
 *     quiet way to delete the section `done` proves.
 *
 * WHAT IT DOES NOT TOUCH. The frontmatter stays byte-identical, `updated:`
 * included: the file is rebuilt as the original bytes up to the closing fence
 * plus the new body. Bumping `updated:` would be a second change, recorded as a
 * field row, inside an act the caller asked to be about prose.
 *
 * WHY THE WRITE IS STAGED. The order `handoff` settled (TL-351): the new text
 * is written beside the task file, the append-only history second, and the
 * rename last — so a history that cannot be written fails while the task file
 * still holds its old body.
 *
 * Tests: `node --test scripts/tests/body-history.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveActor } from "./actor.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { auditTask } from "./criteria.mjs";
import { ACTOR_NAMESPACES, appendEntries, currentSession, eventId, isValidActor, normalizeReason, reasonRefusal } from "./history.mjs";
import { printJson } from "./json-envelope.mjs";
import { BACKLOG_DIR_REFUSAL_EXIT, isBacklogDirRefusal, resolveBacklogDir, backlogPaths, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { readStdinText } from "./stdin.mjs";
import { FIELD_BODY, describeBodyChange, lineEnding, splitFrontmatter, withLineEnding } from "./task-fields.mjs";
import { readTaskRecords } from "./task-select.mjs";
import { MARK, color, failure, refusal } from "./ui.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMMAND = N + " body";

export const BODY_FLAGS = ["--reason", "--body-file", "--base", "--actor", "--json"];

/** PURE — resolves `body`'s arguments. Throws on a usage error; an error whose
 *  message starts `unknown flag` is printed with the accepted set. */
export function parseBodyArgs(args) {
  const plan = { id: null, reason: null, bodyFile: null, base: null, actor: null, json: false };
  const key = { "--body-file": "bodyFile" };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") { plan.json = true; continue; }
    if (BODY_FLAGS.indexOf(a) >= 0) {
      const value = args[++i];
      if (value === undefined) throw new Error("`" + a + "` with no value");
      plan[key[a] || a.slice(2)] = value;
      continue;
    }
    if (a.startsWith("-")) {
      const e = new Error("unknown flag: " + a);
      e.unknownFlag = true;
      throw e;
    }
    if (plan.id) throw new Error("two task ids given: " + plan.id + " and " + a + " — rewrite one body at a time");
    plan.id = a;
  }
  if (!plan.id) throw new Error("no task id\nusage: " + N + " body <ID> --reason \"…\" [--body-file <f>]");
  if (plan.reason === null) {
    throw new Error(
      "`--reason` is required\n" +
        "a body rewritten with no sentence beside it is the unexplained change this\n" +
        "command exists to replace."
    );
  }
  const refused = reasonRefusal(plan.reason, "--reason");
  if (refused) throw new Error(refused);
  if (plan.base !== null && !/^(sha256:)?[0-9a-f]{64}$/.test(plan.base)) {
    throw new Error(
      "`--base " + plan.base + "` is not a body hash\n" +
        "expecting `sha256:<64 hex digits>`, as `" + N + " body --json` reports it in `body.to`."
    );
  }
  return plan;
}

/** The base-version hash of a body, exactly as its bytes sit in the file. PURE. */
export function bodyHash(body) {
  return "sha256:" + createHash("sha256").update(String(body), "utf8").digest("hex");
}

/**
 * How many lines an edit added and removed — the size of the change, for a
 * reader. PURE.
 *
 * A longest-common-subsequence count, because a multiset comparison would call
 * a moved paragraph unchanged. Above the bound the table would cost more than
 * the answer is worth, and the count falls back to the multiset one: still a
 * true statement about the size, never a refusal.
 */
export function lineDelta(before, after) {
  const a = String(before).replace(/\r\n/g, "\n").split("\n");
  const b = String(after).replace(/\r\n/g, "\n").split("\n");
  let common;
  if (a.length * b.length <= 4_000_000) {
    let prev = new Array(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
      const row = new Array(b.length + 1).fill(0);
      for (let j = 1; j <= b.length; j++) {
        row[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1]);
      }
      prev = row;
    }
    common = prev[b.length];
  } else {
    const counts = new Map();
    for (const l of a) counts.set(l, (counts.get(l) || 0) + 1);
    common = 0;
    for (const l of b) {
      const n = counts.get(l) || 0;
      if (n) { common++; counts.set(l, n - 1); }
    }
  }
  return { added: b.length - common, removed: a.length - common };
}

/**
 * Why `body` may not replace `current` in a task whose frontmatter is
 * `frontmatter`, or `[]`. PURE.
 */
export function bodyProblems({ frontmatter, current, body, policy }) {
  const problems = [];
  if (!String(body).trim()) {
    return ["the new body is empty — a task with no prose has nothing for the next person to read"];
  }
  if (/^---\r?\n/.test(String(body))) {
    problems.push("the new body opens with a `---` fence — frontmatter is written by field commands, never through the body");
  }
  const now = auditTask({ frontmatter, body: current, policy });
  const next = auditTask({ frontmatter, body, policy });
  for (const e of next.errors) problems.push(e);
  const had = new Set(now.warnings);
  for (const w of next.warnings) if (!had.has(w)) problems.push(w);
  return problems;
}

function stage(file, text) {
  const tmp = file + "." + process.pid + "." + randomBytes(4).toString("hex") + ".tmp";
  writeFileSync(tmp, text, "utf8");
  try { chmodSync(tmp, statSync(file).mode & 0o7777); } catch { /* the mode is not the transaction */ }
  return tmp;
}

function discard(staged) {
  try { unlinkSync(staged); } catch { /* never created, or already renamed */ }
}

/**
 * Rewrite one task's body: validate, stage, record, replace. Returns a RESULT
 * rather than printing, so the shape is testable without a subprocess.
 *
 * @param {{root: string, config: object, id: string, body: string, actor: string,
 *          reason: string, base?: string|null, now?: number, env?: object}} opts
 */
export function writeBody(opts) {
  const { root, config, actor } = opts;
  const paths = backlogPaths(root);
  const wanted = String(opts.id || "").toUpperCase();
  const record = readTaskRecords(paths.tasksDir, config.taskId.file)
    .find((t) => String(t.id).toUpperCase() === wanted);
  if (!record) {
    return { ok: false, kind: "not-found", id: opts.id, message: "no task " + opts.id + " in " + paths.tasksDir };
  }
  const id = record.id;
  const file = join(paths.tasksDir, record.file.replace(/^tasks\//, ""));
  if (config.archivedStatuses.indexOf(record.status) >= 0) {
    return {
      ok: false, kind: "closed", id,
      message: id + " is closed (status: " + record.status + ")",
      details: ["A closed task is a record of what was decided; reopen it deliberately before rewriting it."],
    };
  }

  const raw = readFileSync(file, "utf8");
  const { frontmatter, body: current } = splitFrontmatter(raw);
  if (!frontmatter) {
    return { ok: false, kind: "unwritable", id, message: id + ": the file has no frontmatter block to keep" };
  }
  const head = raw.slice(0, raw.length - current.length);
  const fromHash = bodyHash(current);

  if (opts.base) {
    const base = opts.base.startsWith("sha256:") ? opts.base : "sha256:" + opts.base;
    if (base !== fromHash) {
      return {
        ok: false, kind: "stale-base", id,
        message: id + ": the body changed since " + base.slice(7, 15) + " was read",
        details: [
          "the body is now " + fromHash + "",
          "Nothing was written. Read the task again and apply the edit to what is there.",
        ],
      };
    }
  }

  // The new body takes the FILE's line ending, so a CRLF checkout does not turn
  // into a whole-file change because the caller wrote LF.
  const body = withLineEnding(opts.body, lineEnding(raw));
  const problems = bodyProblems({ frontmatter, current, body, policy: config.criteriaLinks });
  if (problems.length) {
    return { ok: false, kind: "invalid-body", id, message: id + ": the new body was refused, and nothing was written", details: problems };
  }

  const toHash = bodyHash(body);
  if (toHash === fromHash) {
    return { ok: true, id, file, changed: false, entry: null, from: fromHash, to: toHash };
  }

  const ts = new Date(opts.now || Date.now()).toISOString();
  const entry = {
    id: eventId(ts), ts, task: id, field: FIELD_BODY,
    from: fromHash, to: toHash,
    lines: lineDelta(current, body),
    actor, source: "body", reason: normalizeReason(opts.reason),
    session: currentSession(root, opts.env),
  };

  let staged;
  try {
    staged = stage(file, head + body);
  } catch (e) {
    return { ok: false, kind: "unwritable", id, message: id + ": " + e.message };
  }
  try {
    appendEntries(root, id, [entry]);
  } catch (e) {
    discard(staged);
    return {
      ok: false, kind: "history-unwritable", id,
      message: id + ": the body was not recorded — " + e.message,
      details: ["Nothing was changed: the task file still holds its previous body."],
    };
  }
  try {
    renameSync(staged, file);
  } catch (e) {
    discard(staged);
    return {
      ok: false, kind: "unwritable", id, message: id + ": " + e.message,
      details: ["The history already records the rewrite; it is append-only and was not undone."],
    };
  }
  return { ok: true, id, file, changed: true, entry, from: fromHash, to: toHash };
}

export function renderBody(result, opts = {}) {
  const paint = opts.color || color;
  const rel = relative(process.cwd(), result.file) || result.file;
  const shown = rel.length < result.file.length ? rel : result.file;
  if (!result.changed) {
    return paint.ok(MARK.ok) + " " + paint.id(result.id) + " body unchanged — nothing recorded\n  " + paint.dim(shown);
  }
  return [
    paint.ok(MARK.ok) + " " + paint.id(result.id) + " body rewritten by " + result.entry.actor,
    "  " + describeBodyChange(result.entry, MARK.arrow),
    "  reason: " + result.entry.reason,
    "  " + paint.dim(shown),
  ].join("\n");
}

export function bodyJson(result) {
  return {
    ok: true,
    id: result.id,
    file: result.file,
    changed: result.changed,
    body: { from: result.from, to: result.to },
    lines: result.entry ? result.entry.lines : { added: 0, removed: 0 },
    entry: result.entry ? { id: result.entry.id, ts: result.entry.ts, actor: result.entry.actor, reason: result.entry.reason } : null,
  };
}

function rebuildViews(root) {
  const build = spawnSync(process.execPath, [join(__dirname, "build-backlog.mjs"), "--dir", root], { encoding: "utf8" });
  return build.status === 0;
}

function fail2(problem, details) {
  console.error(failure(COMMAND, problem, details, [COMMAND + " --help"]));
  return 2;
}

/** The new body: `--body-file`, or stdin. Unlike `new`, nothing arriving is an
 *  error — there is no template to fall back to, and an empty body is refused. */
async function readNewBody(plan) {
  if (plan.bodyFile) {
    try {
      return { text: readFileSync(plan.bodyFile, "utf8") };
    } catch (e) {
      return { error: "`--body-file " + plan.bodyFile + "` could not be read: " + e.message };
    }
  }
  const text = await readStdinText();
  if (text === null) return { error: "no body given — pipe it on stdin or name it with `--body-file <f>`" };
  return { text };
}

export async function run(argv) {
  let cli;
  let plan;
  try {
    cli = takeDirFlag(argv, { missing: "`--dir` with no value" });
    plan = parseBodyArgs(cli.argv);
  } catch (e) {
    if (e.unknownFlag) {
      console.error(refusal(COMMAND, e.message, BODY_FLAGS.join(" ") + " --dir"));
      return 2;
    }
    const [head, ...rest] = e.message.split("\n");
    return fail2(head, rest);
  }

  const actor = resolveActor(plan.actor);
  if (!isValidActor(actor)) {
    return fail2("the actor `" + actor + "` has no valid namespace", [
      "Use one of: " + ACTOR_NAMESPACES.map((n) => n + ":<name>").join(" | "),
    ]);
  }

  const input = await readNewBody(plan);
  if (input.error) return fail2(input.error, []);

  let root;
  try {
    root = resolveBacklogDir({ dir: cli.dir || undefined, moduleDir: __dirname }).root;
  } catch (e) {
    if (!isBacklogDirRefusal(e)) throw e;
    console.error(failure(COMMAND, e.message, e.details || [], [COMMAND + " --help"]));
    return BACKLOG_DIR_REFUSAL_EXIT;
  }
  const config = loadConfigOrExit(root);

  const result = writeBody({ root, config, id: plan.id, body: input.text, actor, reason: plan.reason, base: plan.base });
  if (!result.ok) {
    if (plan.json) {
      printJson("task-body", {
        ok: false, id: result.id || plan.id, refusalKind: result.kind,
        refusal: result.message, details: result.details || [],
      });
    } else {
      console.error(failure(COMMAND, result.message, result.details || []));
    }
    return result.kind === "not-found" ? 2 : 1;
  }
  if (result.changed && !rebuildViews(root)) {
    console.error(failure(COMMAND, "the views were not rebuilt — run `" + N + " build` yourself", []));
  }
  if (plan.json) printJson("task-body", bodyJson(result));
  else console.log(renderBody(result));
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("body-task.mjs")) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
