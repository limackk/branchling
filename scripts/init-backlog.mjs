#!/usr/bin/env node
/**
 * The `init` command — create a new backlog in an empty directory (BL-1412).
 *
 * THE MOST IMPORTANT PROPERTY: this command WRITES into somebody else's
 * directory, and a write cannot be undone. Hence two decisions that look like
 * excessive caution and are not:
 *
 *   1. `--dir` is MANDATORY. Every other command discovers the backlog upwards
 *      from cwd — here discovery would be guessing WHERE to create the files,
 *      and a mistake scatters them through somebody's repository.
 *   2. An existing file is SKIPPED, never overwritten, and the skip is printed.
 *      Silence about a skipped file reads like a write.
 *
 * The templates are GENERIC — they carry no particular project's vocabulary.
 * Each project gets its values from its own `config.yaml` (BL-1400); if the
 * template carried one organisation's labels or owner names, every new user
 * would start out with somebody else's categories. A test enforces this.
 */

import {
  ATTRIBUTE_RULES,
  BLOCK_OPEN,
  BLOCK_CLOSE,
  IGNORE_RULES,
  hasUnionMerge,
  insideGitRepo,
  trackedViews,
  unignoredViews,
} from "./git-rules.mjs";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { DEFAULT_TASK_ID_PREFIX } from "./task-id.mjs";
import { loadConfig } from "./config.mjs";
import { TEMPLATE_FILENAME, backlogPaths } from "./paths.mjs";
import { PRODUCT_NAME as N, BLOCK_MARKER_NAME as BLOCK_LABEL } from "./product.mjs";
import { failure } from "./ui.mjs";
import { createTask, slugify } from "./new-task.mjs";
import { ensureNudge } from "./instructions.mjs";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const CONFIG_YAML = `# The backlog configuration — this project's vocabularies.
# The code knows the SHAPE of a field, this file knows the VALUES. An unknown key
# fails the build.
#
# Next to every key stands the COST of changing it, because it is not the same:
#   [free]       change it whenever you like, nothing in the tree has to agree
#   [tree]       existing tasks may hold values outside the new vocabulary;
#                after changing it run \`${N} doctor\`, which will say which
#   [migration]  changing it is not enough on its own, see the comment at the key

project_name: "Backlog"            # [free]

# [migration] The task number prefix. Changing this line WITHOUT renumbering the
# tree makes the tool unable to see its own tasks — the command for that is
# \`${N} migrate-prefix --to <NEW>\` (with \`--dry-run\` first).
# On an EMPTY backlog the change is free: correct this line and you are done.
task_id_prefix: ${DEFAULT_TASK_ID_PREFIX}

# [tree] The task statuses. The order matters — it is the sort order of the
# views. Changing this list? Correct the two below TOGETHER with it: both must
# contain only values from here, otherwise the build fails.
statuses: [pending, in_progress, blocked, done, cancelled]
# Which statuses fall out of the INDEX into archive/ and stop counting as queue.
archived_statuses: [done, cancelled]
dashboard_open_statuses: [pending, in_progress, blocked]

# [tree] Statuses nobody may ENTER without saying why — writing commands refuse
# rather than ask. It is also what an unattended dispatcher will not hand out:
# entering one of these was somebody's decision, and an agent must not undo it
# silently. Declared here rather than left out, because with the key absent it
# resolves to \`archived_statuses\` and \`blocked\` would then be dispatched to
# agents by default, which is not what the documentation says and not what
# \`${N} run\` can work with — it parks a task it could not finish in this
# very status. Two values are reserved and are never typed by hand:
# \`unknown\` (a change the tool observed rather than made) and \`proven\`
# (a verification run).
reason_required_statuses: [blocked, cancelled]

priorities: [P0, P1, P2, P3]       # [tree]

# [tree] How hard \`${N} check\` judges a task whose acceptance criteria do not
# name the \`verification:\` entry that proves them (\`[proof: <id>]\`):
#   off      say nothing
#   warn     report, but do not fail — the setting for a backlog written before
#            the mechanism existed, while it is being linked up
#   require  fail; a criterion nobody can prove is a checkbox that can lie
# A BROKEN link — a criterion naming an id that does not exist — fails under all
# three: only someone already using the mechanism can write one.
criteria_links: warn
types: [task]                      # [tree]

# [tree] Labels. \`labels_closed: true\` turns a typo into a build error instead
# of a new, silent label — and it applies to tasks that ALREADY exist too, so
# switch it on after checking what is in the tree.
labels: []
labels_closed: false

# [tree] WHO MAY take a task, as opposed to \`owner:\` — who holds it NOW — and
# the history's \`actor\` — who wrote the change. Commented out because an empty
# vocabulary is an ANSWER: this project does not use roles, and then a task
# carrying a non-empty \`role:\` fails the build rather than inventing a role no
# dispatcher serves. Lowercase slugs.
# roles: [analyst, developer, reviewer]

# [free] with respect to the tree — a task may have any owner; but \`${N} new\n# --owner X\` checks this list, so a new owner has to be added here.
owners: [unassigned]
estimates: [30m, 2h, 1d, 1w]       # [free] suggestions in the viewer

# [free] The history actors — the namespace is mandatory:
#   local:<nick>  declared locally, unverified
#   agent:<name>  an automated write (a hook, CI)
#   user:<id>     an authenticated account
actors: [local:me, agent:claude]

title_max_length: 60               # [free]

# [free] Which status means "somebody is working on this" — the one \`${N} take\`
# and \`${N} next\` write. Commented out because the default vocabulary above
# already has that word; a project that RENAMES its statuses has to say which one
# this is, or those two commands refuse rather than pick one for you.
# in_progress_status: in_progress

# [free] How long a task reservation is honoured, in minutes. A session that is
# killed leaves its lock behind; after this long the next caller takes it over
# and says so. The reservation is local to one machine — see \`${N} take --help\`.
lock_ttl_minutes: 120

# [free] After how many days without a change an \`in_progress\` task is judged
# ABANDONED, so that \`${N} next\` hands it out again — to a new owner, with the
# takeover written to the history. \`0\` means never, and that is the default:
# the evidence is \`updated:\`, which has a day's resolution and is written by
# commands rather than by working, so a window switched on carelessly reassigns
# live work. Switch it on for a queue that actually runs unattended. A held lock
# still wins — a running session is proof its task is not abandoned.
abandoned_after_days: 0

# [free] Whether reading state (\`${N} query\`, \`${N} stats\`, the viewer)
# also consults OTHER local branches and worktrees. Data travels with the branch,
# so a task started on \`feature/x\` is still \`pending\` on \`main\` — with this
# off, that is what a listing reports, with no sign the answer came from one
# checkout. Nothing is ever resolved silently: a disagreement is shown with both
# statuses and the branch each came from. Local refs only — no \`git fetch\`, ever.
cross_branch_state: true

# [free] How far back a branch's last commit may be for that scan to read it, in
# days; 0 means no window. Dead branches accumulate, and the scan is paid for on
# every listing. A branch CHECKED OUT in a worktree is always read whatever its
# age — somebody is standing in it.
active_branch_days: 30
`;

const BOARDS_YAML = `# Boards — the backlog PARTITION. A CLOSED vocabulary: every task has exactly
# one \`board:\`, and an unknown slug fails the build.
#
# A board is WHICH CONTEXT the work belongs to; an epic is WHAT is being
# delivered and is free text inside a board. They do not replace one another.

default: main

boards:
  - slug: main
    name: "Main"
    description: >-
      The default board. A task with no \`board:\` that matches no routing rule
      lands here.
`;

/**
 * The task template is READ from the package; we do not keep a second copy of it
 * here (TL-50).
 *
 * `_template.md` in the package root ships in the tarball anyway — it is a MARKER
 * by which `looksLikeBacklogDir()` recognises a backlog directory. Since it is
 * there, a second copy of the same content in the code could drift away from it,
 * and the drift would be invisible: one version would go into new backlogs, the
 * other would be read by whoever opens the file in node_modules.
 *
 * A missing file means a broken install and has to say so outright — a silent
 * fallback template would produce backlogs that differ from those of a normal
 * installation.
 */
const TEMPLATE_PATH = join(HERE, "..", TEMPLATE_FILENAME);

function readTemplate() {
  try {
    return readFileSync(TEMPLATE_PATH, "utf8");
  } catch {
    return null;
  }
}


const GITIGNORE = `# The views are GENERATED from tasks/*.md — we do not version them.
#
# The reason is not aesthetic: INDEX.yaml and archive/done.yaml are sorted
# aggregates of EVERY task, so each branch rewrites the same file and two
# branches conflict even when they share no task at all.
#
# Recreate them with: ${N} build
${IGNORE_RULES.slice(0, 6).join("\n")}

# The local reference point for reconciliation — NOT a source of truth.
${IGNORE_RULES[6]}
`;

const GITATTRIBUTES = `# The history log merges by the UNION OF LINES, not by a three-way comparison.
# It is append-only, so two branches append at the end of the same file — to git
# that is a conflict, although semantically there is no dispute. Duplicates are
# removed by the dedup on \`id\` at read time; without that, this rule would do
# harm.
${ATTRIBUTE_RULES.join("\n")}
`;

/**
 * The example task created by `init` (TL-64).
 *
 * WHY A TASK ABOUT THE CONFIGURATION AND NOT A PLACEHOLDER. An empty backlog is
 * judged on an empty screen: `stats` shows nothing but zeroes, the viewer has
 * nothing to draw, and the hardest convention of this tool to convey —
 * `verification:`, that is, "a task is not done until there is a command that
 * proves it" — has nowhere to show itself. An example that IS a genuine first
 * step teaches both at once, and closes itself once it is carried out.
 *
 * Its `verification` has to be runnable. An example with a placeholder command
 * would teach exactly the opposite of what is needed.
 */
const EXAMPLE_TITLE = "Adjust the vocabularies in config.yaml to your project";
// Each entry carries an `id`, because each acceptance criterion below points at
// one (TL-86). The example shows both kinds on purpose: what a command can
// prove, and what only a person can vouch for.
const EXAMPLE_VERIFICATION = [
  { id: "doctor-clean", bash: `${N} doctor` },
  { id: "config-is-yours", manual: "config.yaml names THIS project — project_name, task_id_prefix and statuses are no longer the defaults" },
];
const EXAMPLE_BODY = `
## Goal

Set the backlog up for YOUR project — and, along the way, see what a task looks
like in this tool.

**This file is an example.** Delete it once it stops being useful; nothing
depends on it.

## Context

\`config.yaml\` holds this project's vocabularies: statuses, priorities, labels,
the task number prefix. The code knows the SHAPE of a field, that file knows the
VALUES — so adapting the tool means editing that file, not the code.

Next to every key stands the cost of changing it. The cheapest moment to change
\`task_id_prefix\` is NOW, while the backlog is empty: later the same change
requires renumbering the tree.

## Steps

1. Open \`config.yaml\` and read the legend at the top.
2. Set \`project_name\` and \`task_id_prefix\` to your own.
3. Adjust \`statuses\` to how you actually work — together with
   \`archived_statuses\` and \`dashboard_open_statuses\`.
4. Run \`${N} doctor\`. It will say whether anything has come apart.
5. Delete this file and create your first real task:
   \`${N} new --title "…"\`.

## Acceptance criteria

Each one names the \`verification:\` entry that proves it; the tool ticks it after
a green run, so a checkbox here is evidence and not a claim.

- [ ] \`${N} doctor\` finishes with no errors. [proof: doctor-clean]
- [ ] \`config.yaml\` describes this project, not the defaults. [proof: config-is-yours]
`;

/**
 * @returns {string[]} the lines to print; empty when no example is created.
 */
function writeExample(root) {
  const paths = backlogPaths(root);
  // The example goes ONLY into an empty tree. A backlog that already has tasks is
  // not new — adding an example to it would be the same kind of surprise as
  // overwriting a file.
  if (readdirSync(paths.tasksDir).some((f) => f.endsWith(".md"))) return [];

  const config = loadConfig(root);
  const created = createTask({
    root,
    config,
    board: config.defaultBoard || "main",
    slug: slugify(EXAMPLE_TITLE),
    fields: { title: EXAMPLE_TITLE, priority: "P2", estimate: "30m", verification: EXAMPLE_VERIFICATION },
    body: EXAMPLE_BODY,
  });
  return ["  example: tasks/" + created.path.split("/").pop() + " (you can delete it)"];
}

const FILES = [
  { name: "config.yaml", content: CONFIG_YAML },
  { name: "boards.yaml", content: BOARDS_YAML },
  { name: TEMPLATE_FILENAME, content: readTemplate },
  { name: ".gitignore", content: GITIGNORE },
  { name: ".gitattributes", content: GITATTRIBUTES },
];

// ──────────────────────────────────────────────────────────────────────────
// Does git REALLY ignore the views
// ──────────────────────────────────────────────────────────────────────────
/**
 * WHY THIS EXISTS (TL-59). Writing `.gitignore` covers the nested layout,
 * where the file is ours to create. It does NOT cover the co-located layout
 * (`--dir .`) inside a repository that already has one: there the file is
 * skipped — correctly, since we must never overwrite it — and the rules end up
 * never existing. Measured consequence: `INDEX.yaml` and `NOW.yaml` show up as
 * untracked and get committed. A versioned aggregate makes two branches
 * conflict even when their tasks are disjoint, which is the exact failure the
 * views are unversioned to avoid.
 *
 * So the question this asks is not "did I write the file" but "does the rule
 * APPLY". Only git can answer that: it also knows `.git/info/exclude`, ignore
 * files in parent directories, and negations further down the same file.
 */

/**
 * Append a marked block, once. Returns true when something was written.
 *
 * Appending is not overwriting: nothing the user wrote is touched, and the
 * marker makes a second `init` a no-op. That is what allows this to be the
 * default — the alternative, a warning, is what we already had, and it scrolls
 * past in a list of nine other lines.
 */
function appendBlock(path, rules, note) {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (existing.includes(BLOCK_OPEN)) return false;
  const pad = existing && !existing.endsWith("\n") ? "\n" : "";
  const body = [BLOCK_OPEN, "# " + note, ...rules, BLOCK_CLOSE].join("\n");
  appendFileSync(path, pad + "\n" + body + "\n", "utf8");
  return true;
}

/**
 * @returns {string[]} lines to print; empty when everything is already right.
 */
export function ensureGitRules(root, opts = {}) {
  const out = [];
  if (!insideGitRepo(root)) {
    // Not a defect: a backlog outside a repository is a supported state. Say it
    // once so the user knows the check was made and why it said nothing.
    out.push("  git: this is not a repository — after `git init`, check that the views are ignored");
    return out;
  }

  const paths = { ignore: join(root, ".gitignore"), attributes: join(root, ".gitattributes") };

  // A tracked file is NOT reported by `check-ignore` as ignored, even though the
  // cause is not a missing rule. We compute it first, so as not to send the user
  // to `check-ignore -v` where the answer is `git rm --cached`.
  const tracked = trackedViews(root);

  if (unignoredViews(root).length) {
    if (opts.append === false) {
      out.push("! git does NOT ignore the views — a committed INDEX.yaml conflicts between");
      out.push("  branches that share no task. Add to .gitignore:");
      for (const r of IGNORE_RULES) out.push("      " + r);
    } else {
      if (appendBlock(paths.ignore, IGNORE_RULES, `the views are GENERATED from tasks/*.md — \`${N} build\` recreates them`)) {
        out.push(`  .gitignore: ${BLOCK_LABEL} block appended (the views are generated; \`${N} build\` recreates them)`);
      }
      // We check AFTER appending, and only when we did append. The rule is there
      // and still does not work: somebody negates it further down the file or
      // higher up the tree. Silence here would be the worst possible outcome —
      // block appended, message cheerful, views still tracked.
      const left = unignoredViews(root).filter((rel) => tracked.indexOf(rel) < 0);
      if (left.length) {
        out.push("! despite the appended rules git still does NOT ignore: " + left.join(", "));
        out.push("  check `git check-ignore -v <file>` — a `!` entry elsewhere may be negating the rule");
      }
    }
  }

  if (!hasUnionMerge(root)) {
    if (opts.append === false) {
      out.push("! history/*.jsonl without `merge=union` — an append-only log will conflict on");
      out.push("  every merge. Add to .gitattributes:");
      for (const r of ATTRIBUTE_RULES) out.push("      " + r);
    } else if (appendBlock(paths.attributes, ATTRIBUTE_RULES, "the history log is append-only — it merges by the union of lines, not three-way")) {
      out.push(`  .gitattributes: ${BLOCK_LABEL} block appended (history merges by the union of lines)`);
    }
  }

  if (tracked.length) {
    // Ignoring does not work retroactively on files that are already tracked, so
    // without this line the "I appended the rules" message would be true and
    // useless at the same time.
    out.push("! these views are ALREADY TRACKED by git — the rules will not remove them:");
    out.push("      git rm --cached " + tracked.join(" "));
  }

  return out;
}

function dirFlag(argv) {
  const i = argv.indexOf("--dir");
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}

const BOOL_FLAGS = ["--no-gitignore", "--no-example", "--no-nudge"];

export function main(argv) {
  const unknown = argv.filter(
    (a, i) => a.startsWith("-") && a !== "--dir" && BOOL_FLAGS.indexOf(a) < 0 && argv[i - 1] !== "--dir"
  );
  if (unknown.length) {
    console.error(`${N} init: unknown flag: ` + unknown[0]);
    console.error(`  usage: ${N} init --dir <path> [--no-gitignore] [--no-example] [--no-nudge]`);
    console.error("  available: --dir <path> " + BOOL_FLAGS.join(" "));
    return 2;
  }

  const target = dirFlag(argv);
  if (!target) {
    console.error(`${N} init: name a directory: ${N} init --dir <path>`);
    console.error("  --dir is mandatory on purpose: init WRITES files, and guessing the");
    console.error("  wrong directory scatters them through somebody else\'s repository.");
    return 2;
  }

  const root = resolve(target);
  const created = [];
  const skipped = [];

  mkdirSync(root, { recursive: true });
  for (const sub of ["tasks", "archive", "history", "boards"]) {
    const p = join(root, sub);
    if (existsSync(p)) skipped.push(sub + "/");
    else {
      mkdirSync(p, { recursive: true });
      created.push(sub + "/");
    }
  }
  for (const f of FILES) {
    const p = join(root, f.name);
    if (existsSync(p)) { skipped.push(f.name); continue; }
    // The content is sometimes a function, because the template is read from the
    // package (TL-50) — only now, once we know the file really is being
    // created.
    const content = typeof f.content === "function" ? f.content() : f.content;
    if (content === null) {
      console.error(failure(N + " init", "no `" + f.name + "` in the package — broken install",
        ["looked in: " + TEMPLATE_PATH],
        ["install the package again"]));
      return 1;
    }
    writeFileSync(p, content, "utf8");
    created.push(f.name);
  }

  console.log(`${N} init: ` + root);
  if (created.length) console.log("  created: " + created.join(", "));
  // Skips are ALWAYS printed — silence about a skipped file reads like a write.
  if (skipped.length) console.log("  skipped (already existed, left alone): " + skipped.join(", "));

  // Only now, because the question is "is the rule IN FORCE", not "was the file
  // created" — and that is settled after everything has been written (TL-59).
  for (const line of ensureGitRules(root, { append: argv.indexOf("--no-gitignore") < 0 })) {
    console.log(line);
  }

  // The POINTER to `instructions`, in the repository's agent file (TL-74). It
  // goes in by default and for the same reason as the git rules above: a user who
  // has to be told to run one more command is a user who will not, and then the
  // next agent in this repository works the backlog by guesswork. What is written
  // is a pointer with a version, never a copy of the guides — a copy freezes on
  // the day it is made, which is the defect the command exists to remove.
  // `--no-nudge` still ASKS, exactly as `--no-gitignore` does: it only stops the
  // write. Silence about a file we deliberately left alone reads like a file that
  // was already right.
  for (const line of ensureNudge(root, { create: argv.indexOf("--no-nudge") < 0 })) {
    console.log(line);
  }

  if (argv.indexOf("--no-example") < 0) {
    for (const line of writeExample(root)) console.log(line);
  }

  // We build the views here so that after ONE command both `stats` and the viewer
  // work. The hint "next: <product> build" was correct, but it left the first user
  // with a step the tool can perform by itself.
  const built = spawnSync(process.execPath, [join(HERE, "build-backlog.mjs"), "--dir", root], { stdio: "ignore" });
  if (built.status !== 0) console.log(`  WARNING: could not build the views — run \`${N} build\``);

  if (!created.length) console.log("  nothing to do — the backlog is already here");
  else console.log(`  next: ${N}        # the viewer, in your browser`);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("init-backlog.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
