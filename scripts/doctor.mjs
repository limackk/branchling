#!/usr/bin/env node
/**
 * The `doctor` command — one answer to the question "is this set up correctly
 * and what next" (TL-62).
 *
 * WHY. Adapting the tool to a project means editing `config.yaml`, and until
 * TL-62 there was no way to check whether it had worked: you had to run one of
 * the commands and hope that this particular one would notice the problem.
 * Spreading the diagnostics across the guards is deliberate — they have different
 * scopes — but there was no entry point that COLLECTS them and speaks plainly.
 *
 * DOCTOR FIXES NOTHING. A command that "while it is here" corrects somebody's
 * configuration stops being a diagnosis and becomes a change nobody decided on.
 * What it does give is the repair command next to each item — that is the
 * difference between `doctor` and a `fix`, and the second one is a separate
 * decision. This is why it reads the git rules from `git-rules.mjs` (reads only)
 * and not from `init-backlog.mjs`, which knows how to write.
 *
 * THE CHECKS ARE CALLED, NOT REWRITTEN. A second set of rules would drift away
 * from the first, and then `doctor` would say something different from `check` —
 * which would be worse than not having it at all.
 *
 * EXIT CODES: 0 = no errors (warnings allowed), 1 = there is an error. A warning
 * does NOT fail, because a `doctor` in CI that fails over a detail gets switched
 * off, and then nobody sees anything.
 *
 * Tests: `node --test scripts/tests/doctor.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { auditLogStatus, readTaskTexts } from "./check-backlog-log-status.mjs";
import { archivedElsewhereBySource, crossBranchState, divergences } from "./branch-scan.mjs";
import { ConfigError, formatConfigError, loadConfig } from "./config.mjs";
import { deployFetchState } from "./deploy-fetch.mjs";
import { commandRunner, contextBudget } from "./context-budget.mjs";
import { ATTRIBUTE_RULES, IGNORE_RULES, hasUnionMerge, insideGitRepo, trackedViews, unignoredViews } from "./git-rules.mjs";
import { SNAPSHOT_FILE, loadSnapshot, readMigrations, reconcile } from "./history.mjs";
import { HOOK_NAMES, hooksTarget, inspect } from "./hooks-command.mjs";
import { CLAUDE_AGENT_FILE, CLAUDE_IMPORT_LINE, NEUTRAL_AGENT_FILE, NUDGE_VERSION, nudgeState } from "./instructions.mjs";
import { USER_SKILLS, compareInstalled, skillsTarget } from "./install-skills.mjs";
import { printJson } from "./json-envelope.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { MARK as UI_MARK, color, errColor, heading, refusal } from "./ui.mjs";
import { backlogPaths, TEMPLATE_FILENAME, BACKLOG_DIR_REFUSAL_KIND, isBacklogDirRefusal, NotABacklogError, repositoryRoot, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { summarize } from "./stats.mjs";
import { vocabularyUsage } from "./task-fields.mjs";
import { detectPrefixMismatch, taskIdPatterns } from "./task-id.mjs";
import { listTaskFileNames, readTaskMetas } from "./task-io.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

export const USAGE = [
  `${N} doctor [--dir <path>] [--json]`,
  "",
  "  collects the configuration, tree and git checks into one answer",
  "  it fixes NOTHING — it prints the repair command next to each problem",
  "  exit code: 0 = no errors (warnings allowed), 1 = there is an error",
].join("\n");

const OK = "ok";
const WARN = "warn";
const ERR = "error";
const INFO = "info";

// The symbol carries the meaning, the colour only emphasises it — a `doctor` row
// read without colour (in a pipe, in CI) has to mean exactly the same thing.
const MARK = {
  [OK]: color.ok(UI_MARK.ok),
  [WARN]: color.warn(UI_MARK.warn),
  [ERR]: color.err(UI_MARK.err),
  [INFO]: color.dim(UI_MARK.bullet),
};
/** The width of the symbol WITHOUT the escape sequence — otherwise colour throws
 *  the column alignment out. */
const MARK_WIDTH = 1;

function check(id, title, status, detail, fix) {
  return { id, title, status, detail: detail || "", fix: fix || null };
}

// ──────────────────────────────────────────────────────────────────────────
// The individual checks
// ──────────────────────────────────────────────────────────────────────────

function checkConfig(root) {
  try {
    const config = loadConfig(root);
    const keys = existsSync(backlogPaths(root).configPath) ? "config.yaml reads in full" : "no config.yaml — the built-in defaults apply";
    return { config, row: check("config", "configuration", OK, keys) };
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    return {
      config: null,
      row: check("config", "configuration", ERR, e.problems.join("; "), "fix " + e.configPath),
      error: e,
    };
  }
}

function checkVocabulary(root, config) {
  const metas = readTaskMetas(backlogPaths(root).tasksDir, config);
  const { divergent, unused, taskCount } = vocabularyUsage(metas, config);
  // TWO ROWS, because they are two questions with two verdicts: a value the
  // vocabulary does not allow is wrong, and a value nothing carries is a number
  // for a person. Folding them into one row would put an ERROR's symbol on a
  // measurement, or a measurement's symbol on an error.
  const rows = [unusedRow(unused, taskCount)];
  if (!divergent.length) {
    return { metas, row: check("vocabulary", "vocabulary vs tree", OK, "the field values fit inside the vocabularies"), rows };
  }

  const first = divergent[0];
  const detail = divergent
    .map((d) => "`" + d.field + "`: " + d.found.map((f) => f.value + " ×" + f.count).join(", ") + " outside [" + d.allowed.join(", ") + "]")
    .join("; ");
  return {
    metas,
    row: check("vocabulary", "vocabulary vs tree", ERR, detail,
      "add the missing values to `" + first.dictionary + ":` in config.yaml, or correct the tasks"),
    rows,
  };
}

/**
 * The declared values no task carries (TL-156).
 *
 * INFO, never a warning and never an error, and the exit code does not move: the
 * same measurement is a healthy backlog in one repository and a forgotten
 * workflow in another, and nothing here can tell which. What the row owes the
 * reader is the number WITH ITS DENOMINATOR — "0 uses" out of 12 tasks is noise
 * and out of 1397 is a finding — and the two edits that resolve it.
 */
function unusedRow(unused, taskCount) {
  const title = "declared but unused";
  if (!unused.length) {
    return check("unused-vocabulary", title, OK,
      taskCount ? "every declared value is carried by at least one task" : "no tasks yet — nothing to measure against");
  }
  const detail = unused
    .map((u) => "`" + u.field + "`: " + u.values.join(", ") + " carried by 0 of " + taskCount + " task(s)")
    .join("; ");
  const where = unused.length === 1 ? "`" + unused[0].dictionary + ":` in config.yaml" : "config.yaml";
  return check("unused-vocabulary", title, INFO, detail,
    "use the value, or drop it from " + where + " — nothing here can tell which");
}

/**
 * Does any task's legacy `## Log` still claim a status its field contradicts?
 * (TL-68)
 *
 * WHY IT IS HERE and not only in `check`. The defect that produced this row was
 * found by a person noticing that a finished task sat in the index as open —
 * that is, by nobody's tool. `doctor` is the command somebody runs when the
 * backlog "feels wrong", and a row is the only place this question gets asked
 * without knowing to ask it.
 *
 * The audit is IMPORTED from the guard rather than repeated: a second reader
 * would drift, and then `doctor` and `check` would disagree about one file,
 * which is worse than neither of them looking.
 */
function checkLogStatus(root, config) {
  const { ahead, behind, logged } = auditLogStatus(readTaskTexts(backlogPaths(root).tasksDir), config);
  if (ahead.length) {
    return check("log-status", "log vs status field", ERR,
      ahead.length + " task(s) log a closed status while the field is still open — " +
        ahead.slice(0, 3).map((r) => r.file.replace(/-.*$/, "")).join(", "),
      N + " check --log-status");
  }
  if (behind.length) {
    // A WARNING and not an error, for the reason the guard gives: since TL-105
    // nothing writes `## Log`, so a legacy section falling behind is the normal
    // end state of a task, not a mistake anybody made.
    return check("log-status", "log vs status field", WARN,
      behind.length + " of " + logged + " legacy `## Log` section(s) are behind their field — prose, not state",
      null);
  }
  return check("log-status", "log vs status field", OK,
    logged + " task(s) with a status-bearing `## Log`, each agreeing with its field");
}

function checkPrefix(root, config) {
  const names = listTaskFileNames(backlogPaths(root).tasksDir, { taskId: { file: /.*/ } });
  const mismatch = detectPrefixMismatch(names, config.taskIdPrefix);
  if (mismatch.ok) {
    return check("prefix", "id prefix", OK, "config.yaml and the tree both say `" + config.taskIdPrefix + "`");
  }
  return check("prefix", "id prefix", ERR,
    "config.yaml says `" + mismatch.expected + "`, the tree uses `" + mismatch.found.join("`, `") + "`",
    N + " migrate-prefix --to " + mismatch.expected + " --dry-run");
}

/**
 * Is the history's reference point keyed by the prefix the tree actually uses?
 *
 * WHY THIS ROW EXISTS (TL-111). A snapshot left on the previous prefix does not
 * break anything visibly — it makes the NEXT reconcile record the whole backlog
 * as deleted and created again, into a versioned log that merges by union and
 * therefore keeps the tombstones for good. That is a defect noticed by a human
 * reading `git status`, which is exactly the kind the tool should notice first.
 *
 * WHY IT DOES NOT REPORT DRIFT IN GENERAL. A snapshot missing a task added five
 * minutes ago is the normal state between two reconciles, and a row that is
 * amber whenever somebody is working would be read as noise within a day. Only
 * a PREFIX that no longer matches is reported, because only that one is a
 * migration that did not finish.
 */
function checkSnapshot(root, config) {
  const snapshot = loadSnapshot(root);
  if (!snapshot) {
    return check("snapshot", "history reference point", INFO,
      "no " + SNAPSHOT_FILE + " yet — the first run writes one and records no entries");
  }
  const pat = taskIdPatterns(config.taskIdPrefix);
  const foreign = Object.keys(snapshot.tasks || {}).filter((id) => !pat.id.test(id));
  if (!foreign.length) {
    return check("snapshot", "history reference point", OK,
      "keyed by `" + config.taskIdPrefix + "`, the same prefix as the tree");
  }

  // A record covering them means the repointing is already decided and the next
  // reconcile carries it out — a fact in transit, not a problem.
  const records = readMigrations(root).filter((m) => m.to === config.taskIdPrefix);
  const uncovered = foreign.filter((id) => !records.some((m) => taskIdPatterns(m.from).id.test(id)));
  if (!uncovered.length) {
    return check("snapshot", "history reference point", INFO,
      foreign.length + " key(s) still on a previous prefix — the recorded migration repoints them on the next run");
  }
  return check("snapshot", "history reference point", WARN,
    uncovered.length + " key(s) under a prefix the tree does not use (" + uncovered.slice(0, 3).join(", ") +
      ") and no migration record explains it — the next reconcile will log them as deleted",
    "rm " + join("history", SNAPSHOT_FILE) + "   # drop the stale reference point instead of recording tombstones");
}

/**
 * Is there a change on disk that the history has never seen? (TL-162)
 *
 * THE LOOSE END THIS CLOSES. TL-84 made editing a task file by hand a SUPPORTED
 * path. Measured afterwards: `build` does not reconcile, and neither do `query`,
 * `stats` or `check` — only `history --actor <ns:name> --source manual` does. So
 * between a hand edit and somebody remembering that command, the change is
 * invisible on the history axis, and nothing anywhere said so. `doctor` already
 * carries the rows that need no remembering; this is the one that was missing.
 *
 * A WARNING, NEVER AN ERROR. An unrecorded change is the NORMAL state between an
 * edit and the command that records it. A row that went red while somebody was
 * working would be read as noise inside a day, which is how a real signal gets
 * trained out of a reader.
 *
 * AND IT DOES NOT RECORD ANYTHING. `doctor` fixes nothing by design, and a
 * diagnosis that wrote to the log would sign somebody else's edit with whoever
 * happened to run it — the defect TL-130 describes on the server's side. The
 * row reports; the person decides who signs it. That is why `reconcile` grew a
 * `dryRun` rather than this row growing a second copy of the diff.
 */
function checkUnrecorded(root) {
  let result;
  try {
    result = reconcile(root, { dryRun: true });
  } catch (e) {
    // A history directory that cannot be read is the `history` guard's finding,
    // not this row's. Saying "not checked" is more honest than a count of zero.
    return check("unrecorded", "changes not in the log", INFO,
      "not checked — the history could not be read: " + e.message);
  }
  if (result.seeded) {
    return check("unrecorded", "changes not in the log", INFO,
      "no reference point yet — the first `history` run writes one and records nothing",
      N + " history --actor <ns:name> --source manual");
  }
  if (!result.entries.length) {
    return check("unrecorded", "changes not in the log", OK,
      "every change on disk is in the history");
  }
  const tasks = [...new Set(result.entries.map((e) => e.task))];
  return check("unrecorded", "changes not in the log", WARN,
    result.entries.length + " change(s) across " + tasks.length + " task(s) the history has not seen (" +
      tasks.slice(0, 3).join(", ") + (tasks.length > 3 ? ", …" : "") + ")" +
      " — normal between an edit and the command that records it",
    N + " history --actor <ns:name> --source manual");
}

function checkGitIgnore(root) {
  if (!insideGitRepo(root)) {
    return [check("git-repo", "git", INFO, "this is not a repository — the rules have nothing to apply to")];
  }
  const rows = [];
  const unignored = unignoredViews(root);
  const tracked = trackedViews(root);
  const stillUnignored = unignored.filter((p) => tracked.indexOf(p) < 0);

  if (stillUnignored.length) {
    rows.push(check("git-ignore", "git ignores the views", ERR,
      "not ignored: " + stillUnignored.join(", ") + " — a committed aggregate conflicts between branches that share no task",
      "add to .gitignore: " + IGNORE_RULES.join(" ")));
  } else {
    rows.push(check("git-ignore", "git ignores the views", OK, "INDEX.yaml, NOW.yaml, viewer.html and the rest are outside git"));
  }

  if (tracked.length) {
    rows.push(check("git-tracked", "views out of the index", ERR,
      "already tracked: " + tracked.join(", ") + " — ignore rules will not undo that",
      "git rm --cached " + tracked.join(" ")));
  }

  rows.push(hasUnionMerge(root)
    ? check("git-merge", "history merges by union of lines", OK, ATTRIBUTE_RULES[0])
    : check("git-merge", "history merges by union of lines", WARN,
        "no `merge=union` — an append-only log will conflict on a merge",
        "add to .gitattributes: " + ATTRIBUTE_RULES[0]));
  return rows;
}

/** The template this release would write into a new backlog. */
const SHIPPED_TEMPLATE = join(HERE, "..", TEMPLATE_FILENAME);

/**
 * The top-level frontmatter keys of a template, each with its one-line comment.
 * Read by line, not by a YAML parser, because the comment IS the payload: it is
 * the only explanation of the field a person editing a task by hand ever sees,
 * and a parser discards it. Indented lines belong to a nested value. PURE.
 */
export function templateFields(text) {
  const lines = String(text).split(/\r?\n/);
  if (lines[0].trim() !== "---") return [];
  const fields = [];
  for (const line of lines.slice(1)) {
    if (line.trim() === "---") break;
    // A quoted value is skipped whole, so a `#` inside it is not a comment.
    const m = /^([A-Za-z_][\w-]*):\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*')?(.*)$/.exec(line);
    if (!m) continue;
    const comment = /(?:^|\s)#\s*(.*)$/.exec(m[2]);
    fields.push({ key: m[1], comment: comment ? comment[1].trim() : "" });
  }
  return fields;
}

/**
 * Does the backlog's template carry every field this release ships? (TL-588)
 *
 * `init` copies `_template.md` once and never again, so a backlog started on an
 * earlier release keeps that release's field list. Nothing breaks — the writing
 * commands add a missing field on demand — which is exactly why nothing said
 * so: a person editing a task by hand never learns the field exists. INFO, not
 * a warning: the template is the project's own file, and a field it leaves out
 * may be one it decided against. A field the project ADDED is not reported;
 * only the shipped ones it lacks are. `shipped` is for the tests.
 */
export function checkTemplate(root, { shipped = SHIPPED_TEMPLATE } = {}) {
  const title = "task template fields";
  const own = backlogPaths(root).templatePath;
  if (!existsSync(own)) {
    return check("template", title, INFO, "not checked — this backlog has no " + TEMPLATE_FILENAME);
  }
  if (!existsSync(shipped)) {
    return check("template", title, INFO, "not checked — the packaged template is missing: " + shipped);
  }
  const present = new Set(templateFields(readFileSync(own, "utf8")).map((f) => f.key));
  const expected = templateFields(readFileSync(shipped, "utf8"));
  const missing = expected.filter((f) => !present.has(f.key));
  if (!missing.length) {
    return check("template", title, OK, "every field this release ships is in " + TEMPLATE_FILENAME);
  }
  return check("template", title, INFO,
    // `; ` between fields and `: ` before a comment, because the comments
    // themselves carry parentheses and commas.
    "missing " + missing.map((f) => "`" + f.key + "`" + (f.comment ? ": " + f.comment : "")).join("; ") +
      ". The writing commands add " + plural(missing.length, "it", "them") + " on demand, so only a task edited by hand goes without",
    "copy the " + plural(missing.length, "line", "lines") + " for " + missing.map((f) => f.key).join(", ") +
      " from " + shipped + " into " + own);
}

/**
 * The agent-facing setup (TL-475): the pointer to `instructions`, the packaged
 * skill, the git gates. Each one is OPTIONAL — `init --no-nudge`, an editor
 * without skills, a team that gates in CI — so none of them is an error. What
 * an error-free doctor must not do is stay silent about a repository where an
 * agent has no path to the procedure at all.
 */
function checkAgentPointer(root) {
  const { files } = nudgeState(root);
  const carrying = files.filter((f) => f.version !== null);
  if (!carrying.length) {
    return check("agent-pointer", "agent instructions pointer", WARN,
      files.length
        ? "no pointer in " + files.map((f) => f.name).join(" or ") + " — an agent here works the backlog by guesswork"
        : "no CLAUDE.md or AGENTS.md — an agent here works the backlog by guesswork",
      N + " instructions --update-nudge");
  }
  const stale = carrying.filter((f) => f.version !== NUDGE_VERSION);
  if (stale.length) {
    return check("agent-pointer", "agent instructions pointer", WARN,
      stale.map((f) => f.name + " carries v" + f.version).join(", ") + ", this release writes v" + NUDGE_VERSION,
      N + " instructions --update-nudge");
  }
  // Claude Code reads CLAUDE.md and what it imports, never AGENTS.md on its own.
  const claude = files.find((f) => f.name === CLAUDE_AGENT_FILE);
  const neutral = files.find((f) => f.name === NEUTRAL_AGENT_FILE);
  const claudeReaches = claude && (claude.version !== null || (claude.importsNeutral && neutral && neutral.version !== null));
  if (!claudeReaches) {
    return check("agent-pointer", "agent instructions pointer", INFO,
      "in " + carrying.map((f) => f.name).join(", ") + ", which Claude Code does not load",
      "add the line `" + CLAUDE_IMPORT_LINE + "` to " + CLAUDE_AGENT_FILE + ", if Claude Code works here");
  }
  return check("agent-pointer", "agent instructions pointer", OK,
    carrying.map((f) => f.name).join(", ") + plural(carrying.length, " points", " point") + " at `" + N + " instructions overview`");
}

/**
 * Installed AND current (TL-585). `skills install` never overwrites, so an
 * installed copy keeps the description of the day it was installed — and the
 * description is what decides whether an editor loads the skill at all. A
 * difference is INFO, like an absent skill: the copy may be the user's own edit,
 * and doctor cannot tell a deliberate edit from a forgotten one. What it can
 * tell is whether the copy is a version this package shipped, and that decides
 * which command to print. `opts` is `compareInstalled`'s, for the tests.
 */
export function checkSkill(root, opts = {}) {
  const target = skillsTarget(repositoryRoot(root));
  const missing = (opts.skills || USER_SKILLS).filter((name) => !existsSync(join(target, name, "SKILL.md")));
  if (missing.length) {
    return check("agent-skill", "packaged skill", INFO,
      "not installed: " + missing.join(", ") + " — an editor that loads skills will not know a backlog is here",
      N + " skills install");
  }
  const state = compareInstalled(repositoryRoot(root), opts);
  // A WARNING, unlike an absent or edited skill (TL-594): nobody chooses a
  // directory where the skill file belongs, the editor reads nothing from it,
  // and no refresh can repair it — `skills install` leaves it alone too.
  const blocked = state.ok ? state.files.filter((f) => f.state === "blocked").map((f) => f.file) : [];
  if (blocked.length) {
    return check("agent-skill", "packaged skill", WARN,
      blocked.join(", ") + plural(blocked.length, " is not a regular file", " are not regular files") + " — an editor cannot read the skill from " +
        plural(blocked.length, "it", "them"),
      N + " skills install   # after moving " + blocked.map((f) => join(state.target, f)).join(" ") + " aside");
  }
  // An installation without its packaged skills cannot be compared with them;
  // that is a broken tarball, and `skills install` is where it is reported.
  const differ = state.ok ? state.files.filter((f) => f.state === "shipped" || f.state === "edited") : [];
  if (differ.length) {
    const edited = differ.filter((f) => f.state === "edited").map((f) => f.file);
    return check("agent-skill", "packaged skill", INFO,
      differ.map((f) => f.file + (f.state === "shipped" ? " is an older packaged version" : " differs from every packaged version")).join(", ") +
        " — its description is not the one this release ships",
      N + " skills install --refresh" + (edited.length ? " " + edited.join(" ") + "   # replaces your edit of it" : ""));
  }
  return check("agent-skill", "packaged skill", OK, (opts.skills || USER_SKILLS).join(", ") + " in " + target);
}

function checkHooks(root) {
  if (!insideGitRepo(root)) return [];
  const states = HOOK_NAMES.map((name) => {
    const target = hooksTarget(root, name);
    const found = target.ok ? inspect(target) : { state: "unknown" };
    return { name, state: found.state, current: found.current === true };
  });
  const missing = states.filter((s) => s.state !== "ours");
  const rows = [missing.length
    ? check("git-hooks", "git gates on commit", INFO,
        missing.map((s) => s.name + (s.state === "foreign" ? " (a hook of your own, without ours)" : " (none)")).join(", ") +
          " — the guards run only when somebody remembers",
        N + " hooks print")
    : check("git-hooks", "git gates on commit", OK, HOOK_NAMES.join(", ") + " run the guards")];
  rows.push(...staleHooksRow(states));
  return rows;
}

/**
 * Our block, but not the text this release writes (TL-588). A WARNING, unlike
 * an absent gate: the person chose to install it, and what runs on their commit
 * is no longer what they chose. No row while every installed block is current —
 * the presence row above already says so. `hooks install` refuses outright
 * while any hook is somebody else's, so then the repair it names is the paste
 * that `hooks print` shows, not a command that would fail.
 */
function staleHooksRow(states) {
  const stale = states.filter((s) => s.state === "ours" && !s.current).map((s) => s.name);
  if (!stale.length) return [];
  const foreign = states.filter((s) => s.state === "foreign").map((s) => s.name);
  return [check("git-hooks-current", "git gates are current", WARN,
    stale.join(", ") + " carr" + plural(stale.length, "ies a block", "y blocks") +
      " that differ" + plural(stale.length, "s", "") + " from the one this release writes — a change to the gate never reached " +
      plural(stale.length, "it", "them"),
    foreign.length
      ? N + " hooks print   # " + foreign.join(", ") + " is your own hook, so `hooks install` refuses; replace our block in " + stale.join(", ") + " by hand"
      : N + " hooks install   # replaces only the lines between its markers")];
}

/**
 * Does every declared deploy ref reach this clone on `git fetch`? (TL-508)
 *
 * AN ERROR, not a warning. A ref the remote's refspec does not carry is not
 * stale by a few minutes — it never moves here at all, so every stage built on
 * it reads as unknown or, worse, as the copy this clone happened to write once,
 * which looks exactly like the current one. The fix is one line of the owner's
 * git configuration; doctor prints it and never applies it, for the same
 * reason the tool never pushes.
 *
 * A SHORT NAME is judged by what it resolves to in this clone (TL-510): one
 * that reads a ref outside git's own namespaces is checked under that full
 * name, and one that resolves to nothing — while its first component names no
 * remote — is a WARNING. In a fresh clone `deploys/web/production` is exactly
 * that, and skipping it would let the stage this row exists for pass
 * unnoticed. A warning rather than an error, because this clone cannot tell a
 * deploy ref no refspec brings in from a branch that was never fetched.
 *
 * NO ROW when nothing is declared outside git's own namespaces: a project
 * without `deploy_targets`, or one whose stages are branches and tags, has
 * nothing to ask here, and a tick about it would be green with no evidentiary
 * force.
 */
function checkDeployFetch(root, config) {
  if (!insideGitRepo(root)) return [];
  const title = "deploy refs reach every clone";
  const st = deployFetchState({ root, targets: config.deployTargets });
  if (!st.declared.length && !st.unresolved.length) return [];
  // A glob whose first component under refs/ starts with a glob character has
  // no namespace narrower than `refs/*`; it is named by its spec instead.
  const namespaces = [...new Set(st.declared.map((d) => d.namespace || d.spec))];
  const unresolvedNote = st.unresolved.length
    ? "short ref name" + (st.unresolved.length === 1 ? " " : "s ") +
      st.unresolved.map((u) => u.spec + " (" + u.target + "/" + u.stage + ")").join(", ") +
      " resolve" + (st.unresolved.length === 1 ? "s" : "") +
      " to no ref here and name" + (st.unresolved.length === 1 ? "s" : "") +
      " no remote — a ref such as refs/" + st.unresolved[0].spec + " that the remote's refspec does not fetch reads as unknown"
    : null;
  const unresolvedFix = st.unresolved.length
    ? "declare " + st.unresolved.map((u) => "`refs/" + u.spec + "`").join(", ") +
      " by its full refs/ name in deploy_targets (or the branch or tag it is meant to be)   # then " + N + " doctor"
    : null;
  if (st.why === "no-remote") {
    return [check("deploy-fetch", title, INFO,
      "no remote — " + (namespaces.length ? namespaces.join(", ") : st.unresolved.map((u) => u.spec).join(", ")) +
        " can reach no other clone from here")];
  }
  if (st.why === "ambiguous") {
    return [check("deploy-fetch", title, WARN,
      "remotes " + st.remotes.join(", ") + " and no upstream on this branch — cannot tell which one the deploy refs come from",
      "git branch --set-upstream-to <remote>/<branch>   # then " + N + " doctor")];
  }
  if (st.missing.length) {
    const commands = st.missing.filter((m) => m.fix).map((m) => m.fix);
    const inexpressible = st.missing.filter((m) => !m.fix).flatMap((m) => m.specs);
    const note = inexpressible.length
      ? "declare " + inexpressible.join(", ") + " under a literal namespace such as refs/<name>/ — only refs/* covers it, and that mirrors every ref of the remote"
      : null;
    return [check("deploy-fetch", title, ERR,
      "remote `" + st.remote + "` does not fetch " +
        st.missing.map((m) => (m.namespace || "any refspec narrower than refs/*") + " (" + m.specs.join(", ") + ")").join("; ") +
        " — another clone reads those stages as unknown or stale" + (unresolvedNote ? "; " + unresolvedNote : ""),
      commands.length ? commands.join(" && ") + (note ? "   # then " + note : "") : note)];
  }
  if (st.unresolved.length) {
    return [check("deploy-fetch", title, WARN, unresolvedNote, unresolvedFix)];
  }
  return [check("deploy-fetch", title, OK,
    "remote `" + st.remote + "` fetches " + namespaces.join(", ") + " under the same names")];
}

/** How long the guards may take before the run is abandoned. Named, because the
 *  row below has to be able to say the number when it is hit. */
const GUARD_TIMEOUT_MS = 60_000;

function checkGuards(root) {
  const r = spawnSync(process.execPath, [join(HERE, "cli.mjs"), "check", "--dir", root],
    { encoding: "utf8", timeout: GUARD_TIMEOUT_MS });
  if (r.status === 0) return check("guards", "backlog guards", OK, "id collisions, boards, references — all green");

  // A RUN THAT NEVER FINISHED IS NOT A VERDICT (TL-163). `spawnSync` reports a
  // timeout, a signal or a failure to start with `status: null`, and the old
  // code turned every one of them into "a guard failed" — an ERROR row about a
  // question nobody managed to ask. That is the shape of finding that teaches a
  // reader to re-run instead of read, after which a real failure looks exactly
  // like the flake. "I could not ask" is INFO, the same answer this file already
  // gives when the configuration cannot be read.
  if (r.status === null) {
    const why = r.signal === "SIGTERM"
      ? "it did not finish within " + (GUARD_TIMEOUT_MS / 1000) + "s"
      : r.error ? "it could not be started: " + (r.error.code || r.error.message)
      : "it was ended by " + r.signal;
    return check("guards", "backlog guards", INFO,
      "not checked — the guard run gave no verdict: " + why, N + " check");
  }

  const firstProblem = String(r.stderr || r.stdout || "").split("\n").filter(Boolean)[0] || "a guard failed";
  return check("guards", "backlog guards", ERR, firstProblem, N + " check");
}

/**
 * What asking "what should I work on" costs this backlog (TL-106).
 *
 * A WARNING, never an error: a large backlog is not a defect, and the answer is
 * to ask differently rather than to delete tasks. The threshold is a share of a
 * reference window rather than a raw count of tasks, because the number that
 * hurts is tokens — a backlog of short tasks and one of long ones cross it in
 * very different places.
 */
function checkContextBudget(root, config) {
  const budget = contextBudget({
    // A diagnosis must not rerun a task's whole closing contract just to
    // measure its terminal output. That run can itself contain the full suite;
    // on a large tree it makes `doctor --json` time out before it can answer.
    root, config, run: commandRunner(join(HERE, "cli.mjs"), root), measureDone: false,
  });
  const share = (budget.listTokens / budget.window) * 100;
  const detail = "the full list costs ~" + budget.listTokens + " tok (" + share.toFixed(1) +
    "% of a " + (budget.window / 1000) + "k window)";
  return budget.listOverBudget
    ? check("context", "cost of asking", WARN,
        detail + " — looking for work now costs more than doing it",
        N + " next   # one task, constant cost; or query with a filter")
    : check("context", "cost of asking", OK, detail);
}

function checkVolume(metas, config) {
  const s = summarize(metas, config);
  return check("volume", "tasks", INFO,
    s.total + " (" + s.active + " active, " + s.archived + " archived)");
}

function checkClosedElsewhere(root, config, metas) {
  const scan = crossBranchState(root, config);
  if (!scan.scanned) return [];
  const tasks = metas
    .filter((task) => !config.archivedStatuses.includes(task.status))
    .map((task) => ({ ...task, elsewhere: divergences(task.status, scan.byId.get(task.id)) }));
  return archivedElsewhereBySource(tasks, config.archivedStatuses).map((group) =>
    check("closed-elsewhere-" + group.source, "closed elsewhere", WARN,
      group.ids.length + " task(s) closed on " + group.source + " are still open here",
      "merge or rebase before taking work"));
}

// ──────────────────────────────────────────────────────────────────────────
// The run
// ──────────────────────────────────────────────────────────────────────────

export function diagnose(root) {
  const rows = [];
  const { config, row: configRow } = checkConfig(root);
  rows.push(configRow);

  if (!config) {
    // Without a configuration that could be read, the remaining questions make no
    // sense: they would be counting under a vocabulary we do not know. "Not
    // checked" is more honest than a result.
    for (const [id, title] of [["vocabulary", "vocabulary vs tree"], ["unused-vocabulary", "declared but unused"], ["prefix", "id prefix"], ["snapshot", "history reference point"], ["unrecorded", "changes not in the log"], ["log-status", "log vs status field"], ["guards", "backlog guards"], ["volume", "tasks"], ["context", "cost of asking"]]) {
      rows.push(check(id, title, INFO, "not checked — the configuration comes first"));
    }
    rows.push(...checkGitIgnore(root));
    return rows;
  }

  const { metas, row: vocabRow, rows: vocabExtra } = checkVocabulary(root, config);
  rows.push(vocabRow, ...(vocabExtra || []));
  rows.push(checkPrefix(root, config));
  rows.push(checkSnapshot(root, config));
  rows.push(checkUnrecorded(root));
  rows.push(checkLogStatus(root, config));
  rows.push(...checkGitIgnore(root));
  rows.push(...checkDeployFetch(root, config));
  rows.push(checkGuards(root));
  rows.push(...checkClosedElsewhere(root, config, metas));
  rows.push(checkVolume(metas, config));
  rows.push(checkContextBudget(root, config));
  rows.push(checkTemplate(root));
  rows.push(checkAgentPointer(root), checkSkill(root), ...checkHooks(root));
  return rows;
}

/** What to do next — depending on what doctor saw. */
export function nextStep(rows) {
  if (rows.some((r) => r.status === ERR)) return N + " doctor   # once it is fixed";
  const volume = rows.find((r) => r.id === "volume");
  if (volume && /^0 /.test(volume.detail)) return N + ' new --title "…"   # the backlog is empty';
  return N + "   # the viewer, in your browser";
}

/** Singular or plural, spelled out. Written as a function rather than an inline
 *  `n === 1 ? …` because "1 error(s)" is not text — it is a programmer's note
 *  seen by a user. */
function plural(n, one, many) {
  return n === 1 ? one : many;
}

function render(root, rows) {
  const width = Math.max(...rows.map((r) => r.title.length));
  const out = [heading(N + " doctor — " + root), ""];
  for (const r of rows) {
    out.push("  " + MARK[r.status] + " " + r.title.padEnd(width) + "  " + r.detail);
    if (r.fix) out.push("      " + color.id(UI_MARK.arrow + " " + r.fix));
  }
  const errors = rows.filter((r) => r.status === ERR).length;
  const warns = rows.filter((r) => r.status === WARN).length;
  out.push("");
  out.push("  " + (errors ? errors + " " + plural(errors, "error", "errors") : "no errors") +
    (warns ? ", " + warns + " " + plural(warns, "warning", "warnings") : ""));
  out.push("  next: " + nextStep(rows));
  return out.join("\n");
}

const KNOWN_FLAGS = ["--json", "--help", "-h"];

export function main(argv) {
  const cli = takeDirFlag(argv);
  for (const a of cli.argv) {
    if (KNOWN_FLAGS.indexOf(a) < 0) {
      console.error(refusal(N + " doctor", "unknown flag: " + a,
        KNOWN_FLAGS.join(" ") + " --dir <path>"));
      return 2;
    }
  }
  if (cli.argv.some((a) => a === "--help" || a === "-h")) {
    console.log(USAGE);
    return 0;
  }
  const asJson = cli.argv.includes("--json");

  let root;
  try {
    root = resolveBacklogDir({ dir: cli.dir, moduleDir: HERE }).root;
  } catch (e) {
    if (!isBacklogDirRefusal(e)) throw e;
    // A missing backlog is an ANSWER here, not a crash — this is the command
    // somebody who has just installed the tool will reach for by reflex.
    //
    // A directory NAMED with --dir or BACKLOG_DIR that is not a backlog gets
    // its own sentence (TL-545): "no backlog here" plus "point at one with
    // --dir" answers somebody who has just done exactly that.
    const named = e instanceof NotABacklogError;
    const detail = named ? e.message : "no backlog directory found";
    const rows = [check("backlog", "backlog", ERR, detail, N + " init --dir ./backlog")];
    if (asJson) {
      printJson("doctor", {
        ok: false, root: null, next: nextStep(rows), checks: rows,
        refusalKind: BACKLOG_DIR_REFUSAL_KIND, refusal: e.message, details: e.details || [],
      });
    }
    else if (named) {
      console.error(errColor.err(UI_MARK.err) + " " + errColor.bold(N + " doctor") + ": " + e.message);
      console.error("  → create one there:       " + N + " init --dir <path>");
    } else {
      console.error(errColor.err(UI_MARK.err) + " " + errColor.bold(N + " doctor") + ": no backlog here");
      console.error("  → create one:            " + N + " init --dir ./backlog");
      console.error("  → or point at an existing one: " + N + " doctor --dir <path>");
    }
    return 1;
  }

  const rows = diagnose(root);
  const ok = !rows.some((r) => r.status === ERR);

  if (asJson) {
    // No ornament and no colour — this is the entry point for CI, not for the eye.
    printJson("doctor", { ok, root, next: nextStep(rows), checks: rows });
  } else {
    console.log(render(root, rows));
  }
  return ok ? 0 : 1;
}

if (process.argv[1] && process.argv[1].endsWith("doctor.mjs")) {
  process.exitCode = main(process.argv.slice(2));
}
