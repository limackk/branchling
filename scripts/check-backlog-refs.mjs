#!/usr/bin/env node
/**
 * Guard: `blocked_by` / `blocks` name tasks that EXIST (BL-1451).
 *
 * THE DEFECT THIS CLOSES. A reference to a deleted task passed both
 * `build` and `check` in silence. That is worse than a loud error: `blocked_by`
 * is the field the tool answers "can I take this?" with, so a task blocked by
 * something that no longer exists looks exactly like a task that has to wait —
 * forever, with no signal that anything is wrong.
 *
 * WHY IT IS NOT A TYPO GUARD. These references are not mistyped, they are
 * ORPHANED: something deleted or moved the task they pointed at. Splitting a
 * backlog, archiving with deletion and migrating tasks between repositories all
 * produce them, and all three are normal operations. So the guard judges the
 * SET — like check-backlog-id-collisions.mjs, and unlike check-backlog-boards.mjs,
 * which judges one file at a time. A reference is only wrong RELATIVE to the
 * whole tree; no single file contains enough to tell.
 *
 * WHY `done` STILL COUNTS AS EXISTING. A blocker that is finished is the normal
 * end state of a dependency, and the file is still there. The distinction that
 * matters is "closed" versus "gone", and only the second is a defect. The
 * cheaper rule — "must point at an ACTIVE task" — would force people to delete
 * true dependency history to get green, which is how a guard teaches people to
 * lie to it.
 *
 * KNOWN LIMIT, stated rather than discovered later: this resolves against the
 * files in `tasks/`, and archived tasks live there today. If closed tasks ever
 * move to their own directory, this guard starts failing on correct data and
 * must learn about that directory in the SAME change.
 *
 * WHY A CROSS-REPO FORM IS REJECTED, NOT SKIPPED. `<repo>#BL-NNNN` reads like
 * it should be allowed through as "deliberately external". It is not, because
 * the field would then hold something the tool cannot resolve — it has no way
 * to know whether `other#BL-1` is done, so `blocked_by` would stop being a
 * complete answer to "can I take this?". External dependencies belong in prose
 * (`## Notes`), where nothing pretends to have checked them. The
 * message says so, so the user is not left guessing.
 *
 * Usage:
 *   node scripts/check-backlog-refs.mjs [--dir <backlog>]
 *
 * Exit 0 = clean (and it prints how many references it verified — a ✓ over
 * zero references means "nothing to check", not "checked and fine").
 * Exit 1 = at least one dangling or unresolvable reference.
 *
 * Tests: `node --test scripts/tests/dangling-refs.test.mjs`
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { backlogPaths, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { taskIdPatterns } from "./task-id.mjs";
import { MARK, color, errColor } from "./ui.mjs";
import { stripComment, unquote } from "./task-fields.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";


const OKM = color.ok(MARK.ok);
const ERRM = errColor.err(MARK.err);
const __dirname = dirname(fileURLToPath(import.meta.url));

// Same filename shape the generator and the collision guard accept, so the
// three cannot disagree about what counts as a task.

const REF_FIELDS = ["blocked_by", "blocks"];

/** The leading `---` block only — a later "blocked_by:" in prose is not frontmatter. */
function frontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : "";
}

function inlineList(fm, key) {
  // No `$` anchor after `]`: `blocked_by: [] # ids of tasks that MUST be closed`
  // is what `_template.md` writes, and an anchored pattern read that line as NO
  // FIELD AT ALL — so a dangling reference beside a comment was invisible to
  // this guard rather than reported (TL-70).
  const m = fm.match(new RegExp("^" + key + ":\\s*\\[(.*?)\\]", "m"));
  if (!m) return [];
  return m[1].split(",").map((s) => unquote(s.trim())).filter(Boolean);
}

export function auditRefs(tasksDir, prefix, read = readFileSync, list = readdirSync) {
  // Patterns built from the configured prefix (BL-1452) — the guard and the
  // generator have no right to disagree about what counts as a task.
  const pat = taskIdPatterns(prefix);
  const files = list(tasksDir).filter((f) => pat.file.test(f)).sort();

  const known = new Set();
  const parsed = [];
  for (const file of files) {
    const fm = frontmatter(read(join(tasksDir, file), "utf8"));
    const idMatch = fm.match(/^id:\s*(.+?)\s*$/m);
    const id = idMatch ? unquote(stripComment(idMatch[1])) : file.match(pat.fileId)[1];
    known.add(id);
    parsed.push({ id, file, fm });
  }

  let checked = 0;
  const dangling = [];
  const unresolvable = [];
  for (const t of parsed) {
    for (const field of REF_FIELDS) {
      for (const ref of inlineList(t.fm, field)) {
        checked++;
        if (!pat.id.test(ref)) {
          unresolvable.push({ from: t.id, file: t.file, field, ref });
        } else if (!known.has(ref)) {
          dangling.push({ from: t.id, file: t.file, field, ref });
        }
      }
    }
  }
  return {
    checked, dangling, unresolvable, taskCount: parsed.length,
    // The parsed set travels out so a second rule can judge it without reading
    // every file again (TL-134). One pass over the tree, two questions asked of
    // it.
    tasks: parsed.map((t) => ({
      id: t.id,
      file: t.file,
      status: unquote(stripComment((t.fm.match(/^status:\s*(.+?)\s*$/m) || [])[1] || "")),
      blocked_by: inlineList(t.fm, "blocked_by"),
    })),
  };
}

/**
 * Tasks standing in a blocking status whose every stated blocker is closed.
 * PURE (TL-134).
 *
 * WHY IT IS A DIFFERENT DEFECT FROM A DANGLING REFERENCE. There the reference
 * points at nothing; here every reference is correct and closed. The guard above
 * cannot see this — checked, on this tree, before the rule was written.
 *
 * WHICH STATUSES BLOCK is DERIVED, never the literal `blocked`: the statuses a
 * project protects with `reason_required_statuses`, minus the archived ones.
 * Those are exactly the statuses somebody had to state a reason to enter, and
 * the reason a `blocked_by` list states is discharged when every task in it
 * closes.
 *
 * AN EMPTY `blocked_by` IS NOT STALE. Such a task waits on something outside the
 * tree — a decision, another team — and nothing here can observe that arriving.
 * Reporting it would ask people to justify a state the tool cannot judge, which
 * is how a guard teaches people to work around it.
 *
 * @param {Array<{id: string, status: string, blocked_by: string[]}>} tasks
 * @param {{archivedStatuses?: string[], reasonRequiredStatuses?: string[]}} config
 */
export function staleBlocked(tasks, config = {}) {
  const archived = new Set(config.archivedStatuses || []);
  const blocking = (config.reasonRequiredStatuses || []).filter((s) => !archived.has(s));
  const byId = new Map((tasks || []).map((t) => [t.id, t]));
  const out = [];
  for (const t of tasks || []) {
    if (blocking.indexOf(t.status) < 0) continue;
    const refs = t.blocked_by || [];
    if (!refs.length) continue;
    // An unknown id is not a closed one — that is the dangling-reference defect,
    // and reporting the same task under both rules would say one problem twice.
    if (!refs.every((r) => byId.has(r) && archived.has(byId.get(r).status))) continue;
    out.push({ id: t.id, file: t.file, status: t.status, blockers: refs.slice() });
  }
  return out;
}

function main(argv) {
  const { dir, argv: rest } = takeDirFlag(argv);
  if (rest.length) {
    console.error(`${N} check: unknown argument: ` + rest.join(" "));
    console.error("  usage: check-backlog-refs.mjs [--dir <backlog>]");
    return 2;
  }

  const root = resolveBacklogDir({ dir: dir || undefined, moduleDir: __dirname }).root;
  // STRICT (TL-60): guard.
  const config = loadConfigOrExit(root);
  const prefix = config.taskIdPrefix;
  const { checked, dangling, unresolvable, taskCount, tasks } = auditRefs(backlogPaths(root).tasksDir, prefix);
  const stale = staleBlocked(tasks, config);

  // REPORTED, NEVER FAILED, and the level is the decision this task asked for.
  // Closing a blocker and lifting the status are two writes by nature, so a
  // tree caught between them is mid-work rather than broken. Since TL-127 the
  // dispatcher hands such a task out and clears the status itself, which makes
  // this a state that corrects itself — failing a build over it would stop a
  // queue that was already fixing the problem. And the guard changes nothing:
  // leaving a blocking status is a state change and goes through a write with a
  // stated reason, like every other.
  const staleLines = [];
  if (stale.length) {
    staleLines.push(
      color.warn(MARK.warn) + " backlog: " + stale.length + " task(s) stand in a blocking status " +
        "whose every stated blocker is closed"
    );
    for (const t of stale) {
      staleLines.push(`  - ${t.file}: \`${t.status}\`, waiting on ${t.blockers.join(", ")} — all closed`);
    }
    staleLines.push(
      "  Nothing was changed. `" + N + " next` will hand these out and record leaving the status;"
    );
    staleLines.push("  to lift it by hand, write the change with its reason rather than editing the field.");
  }

  if (!dangling.length && !unresolvable.length) {
    console.log(
      `${OKM} backlog: ${checked} blocked_by/blocks references across ${taskCount} tasks all point at tasks that exist`
    );
    for (const line of staleLines) console.log(line);
    return 0;
  }

  console.error(ERRM + " backlog: references to tasks that do not exist");
  for (const d of dangling) {
    console.error(`  - ${d.file}: \`${d.field}\` points at ${d.ref} — there is no such task in this backlog`);
  }
  for (const u of unresolvable) {
    console.error(
      `  - ${u.file}: \`${u.field}\` contains ${u.ref} — that is not a number from THIS backlog`
    );
  }
  for (const line of staleLines) console.error(line);
  console.error("");
  if (dangling.length) {
    console.error("A reference usually dangles after a task was DELETED or moved, not after a typo.");
    console.error("Use the git history to find where it went, and fix the MEANING, not just the number:");
    console.error("  git log --diff-filter=D --oneline -- 'backlog/tasks/<ID>-*.md'");
  }
  if (unresolvable.length) {
    console.error("A dependency outside this backlog does NOT fit in these fields: the tool has no way");
    console.error("to check whether it is satisfied, so `blocked_by` would stop answering the question");
    console.error("\"can I take this?\". Record it in prose in `## Notes`, in the form");
    console.error("`<repo>#<ID>`, and keep the field for local numbers only.");
  }
  return 1;
}

if (process.argv[1] && process.argv[1].endsWith("check-backlog-refs.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
