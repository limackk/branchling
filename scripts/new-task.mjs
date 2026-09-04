#!/usr/bin/env node
/**
 * The `new` command — create a task from the template (BL-1413).
 *
 * THE RISK IN THIS COMMAND IS THE NUMBER, not the file. The rule is "never max+1
 * from your own tree", because somebody else's session can be holding the next id
 * on its branch before any file exists — two tasks with the same number only
 * surface at merge time. Hence three safeguards:
 *
 *   1. The number comes from `next-backlog-id.mjs`, which scans ALL of the
 *      repository's worktrees and branches.
 *   2. When that does not work (a fresh backlog with not a single task file, a
 *      directory outside a git repository), a local fallback scan takes over —
 *      and the command SAYS OUT LOUD that it went down that path. A local max+1
 *      is exactly what the rule warns against; passing over it in silence would
 *      turn a known risk into an invisible one.
 *   3. The write is exclusive (the `wx` flag) — a collision ends in an error,
 *      never in overwriting somebody else's task.
 *
 * The number is read from that script's STDOUT (its last line), because it is a
 * program with no exports. The result is validated as a number — otherwise a
 * failure of the scanner would produce a `TASK-NaN-*.md` file instead of an
 * error.
 *
 * Tests: `node --test scripts/tests/new-task.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { calibrationSamples } from "./activity.mjs";
import { resolveActor } from "./actor.mjs";
import { bucketFor, spanLabel } from "./calibration.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { recordCreation } from "./history.mjs";
import { parsePlanYaml } from "./plan.mjs";
import { editPlanText, newPlanErrors } from "./plan-write.mjs";
import { detectPrefixMismatch, prefixMismatchMessage, taskIdPatterns } from "./task-id.mjs";
import { backlogPaths, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { auditVocabulary, extractMeta, splitFrontmatter } from "./task-fields.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { failure } from "./ui.mjs";
import { readTaskMetas } from "./task-io.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// The table's keys ARE the accented letters this function exists to fold.
const DIACRITICS = {
  ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z",   // language-guard: allow
  á: "a", à: "a", ä: "a", â: "a", å: "a", ã: "a", é: "e", è: "e", ë: "e", ê: "e",
  í: "i", ì: "i", ï: "i", î: "i", ò: "o", ö: "o", ô: "o", õ: "o", ø: "o",
  ú: "u", ù: "u", ü: "u", û: "u", ý: "y", ÿ: "y", ç: "c", ñ: "n", ß: "ss",
};

export const SLUG_MAX = 60;

/**
 * Title → part of the filename. Diacritics are FOLDED DOWN to ASCII rather than
 * dropped: a title full of accented letters has to produce a recognisable name,
 * not a two-letter stump. The trim happens on a word boundary, so the name does
 * not break off mid-word.
 */
export function slugify(title) {
  const lowered = String(title || "").toLowerCase();
  let out = "";
  for (const ch of lowered) out += Object.prototype.hasOwnProperty.call(DIACRITICS, ch) ? DIACRITICS[ch] : ch;
  out = out.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (out.length <= SLUG_MAX) return out;
  const cut = out.slice(0, SLUG_MAX);
  const lastDash = cut.lastIndexOf("-");
  return (lastDash > 20 ? cut.slice(0, lastDash) : cut).replace(/-+$/, "");
}

/** A YAML scalar for a value that may contain spaces and colons. */
function quoted(v) {
  return '"' + String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

/** The numbers already taken in THIS directory — the fallback source, see the
 *  file header. */
function localMax(tasksDir, pattern) {
  let max = 0;
  for (const f of readdirSync(tasksDir)) {
    const m = f.match(pattern);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

/**
 * @returns {{id: number, source: "repo"|"local"}}
 */
function nextId(root, tasksDir, numberPattern) {
  // `cwd: root` matters, it is not cosmetic: next-backlog-id.mjs determines
  // the repository through `git rev-parse --show-toplevel` on the CURRENT
  // directory. Without this, `--dir /somewhere/else` got numbers from whichever
  // repository the shell happened to be standing in — somebody else's.
  const r = spawnSync(process.execPath, [join(HERE, "next-backlog-id.mjs"), "--dir", root, "--json"], {
    encoding: "utf8", timeout: 60_000, cwd: root,
  });
  if (r.status === 0) {
    // READ AS A FIELD, NOT AS THE LAST LINE OF STDOUT (TL-57). This used to take
    // the final line and test it against `/^\d+$/`, and the regex was not
    // caution — it was the only thing standing between a scanner that printed
    // anything unexpected and a file called `TASK-NaN-*.md`. `--json` is what
    // Law 4 exists for, and this call site is the reason it is a law rather than
    // a description: the workaround was here, in the tool's own code.
    try {
      const answer = JSON.parse(r.stdout);
      if (Number.isInteger(answer.nextId)) {
        // The warning about a NARROWER source for the number is passed on rather
        // than swallowed (BL-1452): this is the only place the user will see it.
        const warn = String(r.stderr || "").trim();
        if (warn) console.error(warn);
        return { id: answer.nextId, source: "repo" };
      }
    } catch {
      // A broken answer falls through to the local scan below, which is the same
      // outcome a non-zero exit produces — one fallback, not two.
    }
  }
  return { id: localMax(tasksDir, numberPattern) + 1, source: "local" };
}

const FLAGS = {
  "--title": "title", "--board": "board", "--priority": "priority", "--type": "type",
  "--epic": "epic", "--estimate": "estimate", "--owner": "owner", "--status": "status",
  // NOT a frontmatter field: it schedules the task in `plan.yaml` (TL-213). The
  // value is checked against the waves that exist BEFORE anything is written.
  "--wave": "wave",
};

function parseArgs(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("-")) {
      if (i > 0 && FLAGS[argv[i - 1]]) continue; // the previous flag's value
      return { error: "unexpected argument: " + a };
    }
    if (!FLAGS[a]) return { error: "unknown flag: " + a };
    if (!argv[i + 1] || argv[i + 1].startsWith("-")) return { error: a + " requires a value" };
    values[FLAGS[a]] = argv[i + 1];
  }
  return { values };
}

function fail(msg, hint) {
  console.error(`${N} new: ` + msg);
  if (hint) console.error("  " + hint);
  return 2;
}

/**
 * Writing a task — the number, the filename, the frontmatter, an exclusive
 * write. IT PRINTS NOTHING.
 *
 * EXTRACTED FROM `main()` (TL-64), because `init` now creates an
 * example task and has to do it BY THE SAME ROUTE. A second generator would
 * drift away from this one at the first schema change — and the drift would be
 * invisible, because it would affect only the files created by `init`, which is
 * the first thing a new user sees.
 *
 * The risk in this function is the NUMBER, not the file: which is why `nextId()`
 * supplies it (a scan of every branch and worktree) and the write is exclusive
 * (`wx`).
 *
 * @param {{body: string|null}} opts `body` replaces the template's content below
 *        the frontmatter; `null` leaves the template untouched. `fields.labels`
 *        is a list; `fields.verification` is a list whose EMPTY value means an
 *        empty contract, not an absent instruction.
 * @returns {{path: string, taskId: string, source: "repo"|"local"}}
 * @throws {Error & {code: "EEXIST", file: string, taskId: string}}
 */
/**
 * Does the ASSEMBLED frontmatter fit inside this project's vocabularies (TL-69)?
 *
 * THE DEFECT THIS CLOSES. `main()` validates the values it receives through
 * FLAGS, and does it correctly. It never validated the values that arrive from
 * `_template.md` — which is a copy of the DEFAULT vocabularies taken at `init`
 * and drifts away from `config.yaml` the moment anybody adjusts statuses to
 * their own process, which is the most common onboarding step there is. The
 * result was perverse: `new --status pending` was refused, while `new` with no
 * flags wrote exactly the same value without a word.
 *
 * WHY IT REFUSES RATHER THAN SUBSTITUTING OR WARNING. Substituting the first
 * value from the vocabulary changes somebody else's content silently, and "the
 * first status" does not always mean "new". Warning and writing anyway puts a
 * warning on every single `new`, and a warning that always fires stops being
 * read within a day. A refusal is also the only one of the three whose fix is
 * ONE-OFF: the cause is one line in one file, not a decision to remake per task.
 *
 * ONE MEASUREMENT, NOT A SECOND SET OF RULES. This is `auditVocabulary()` — the
 * same function `doctor` uses for its "vocabulary vs tree" row. Two readings of
 * one question would drift, and then the write path and the diagnosis would
 * disagree about the same file.
 *
 * @returns {Array} the divergences, empty when there are none
 */
export function templateDrift(text, config) {
  return auditVocabulary([extractMeta(splitFrontmatter(text).frontmatter)], config);
}

/**
 * The refusal, as text. It has to name the field, the value, the vocabulary AND
 * `_template.md`, because the user did not type the offending value and will
 * otherwise go looking for the mistake in their own command.
 *
 * A value the CALLER passed is reported as the caller's, not as the template's:
 * a message blaming a file somebody never edited is worse than no message.
 */
export function driftMessage(divergences, { templatePath, fields, command }) {
  const opts = fields || {};
  const details = [];
  for (const d of divergences) {
    for (const f of d.found) {
      const fromCaller = String(opts[d.field] || "") === f.value;
      details.push(
        "`" + d.field + ": " + f.value + "` is not a value this project uses" +
          (d.allowed.length ? " (" + d.allowed.join(" | ") + ")" : " — the vocabulary is empty")
      );
      details.push(
        fromCaller
          ? "  it came from the arguments of this call"
          : "  it came from the template, not from your command — " + templatePath
      );
    }
  }
  details.push("");
  details.push("The template is a copy of the DEFAULT vocabularies taken at `init`. Once");
  details.push("config.yaml changes, the two drift, and every task made from the template");
  details.push("would carry a value the configuration does not know.");
  return failure(command, "the template does not fit this project's vocabulary", details, [
    "edit " + templatePath + " to use a value from config.yaml",
    "or add the value to config.yaml, if it belongs to this project",
  ]);
}

/**
 * One `verification:` entry, as YAML. A plain string is the short form (a bash
 * command with no id); an object may carry `id` — the handle a criterion points
 * at with `[proof: <id>]` (TL-86) — and either `bash` or `manual`.
 */
function verificationEntry(v) {
  if (typeof v === "string") return '  - bash: "' + v + '"\n';
  const kind = v.manual ? "manual" : "bash";
  const command = v.manual || v.bash;
  if (!v.id) return "  - " + kind + ': "' + command + '"\n';
  return "  - id: " + v.id + "\n    " + kind + ': "' + command + '"\n';
}

/**
 * Remove the template's own banner — the comment block ABOVE the first field
 * (TL-165).
 *
 * WHY A TASK MUST NOT CARRY IT. The block says "TASK TEMPLATE. `new` copies this
 * file", which is true of the template and false of every file made from it. A
 * task that opens by describing itself as the thing tasks are copied from is a
 * file lying about what it is, and it has been that way in every consumer
 * repository since `init` first shipped a template with a comment block.
 *
 * WHERE THE LINE RUNS, and it is a decision rather than a lookup, because two
 * kinds of comment live in these files:
 *
 *   the banner       about the template AS A FILE — meaningless once copied
 *   a `# note`       about the FIELD it sits beside — useful in every task,
 *                    which is why `stripComment()` exists in the parsers
 *
 * THE DISCRIMINATOR IS POSITION, and it is not arbitrary: a comment standing
 * before the FIRST field has no field to annotate. There is nothing above it
 * but the opening `---`, so whatever it is about, it is not about a value in
 * this file. That is exactly the banner's position in both templates, and it is
 * the only position with that property.
 *
 * THE COST, stated rather than discovered later: a comment somebody deliberately
 * writes above `id:` — meaning it to annotate `id:` — is deleted with the
 * banner. The alternative was a sentinel line the template carries and this
 * function consumes, which is explicit and costs every template author one more
 * thing to know, forever, to fix a case nobody has yet written. A comment meant
 * to reach a task goes BELOW the first field, where it annotates something.
 *
 * A TEMPLATE WITH NO BANNER IS UNCHANGED, and so is anything after the
 * frontmatter: this reads only the block between the first two `---`.
 */
export function stripTemplateBanner(text) {
  const lines = String(text).split("\n");
  if (lines[0] !== "---") return text;
  let i = 1;
  // Blank lines go with it. A file that began with the blanks the banner was
  // separated by would be a different kind of wrong, not a smaller one.
  while (i < lines.length && (lines[i].trim() === "" || lines[i].trimStart().startsWith("#"))) i++;
  // The closing `---` reached with no field in between is not a frontmatter this
  // function understands, and it leaves it alone rather than emptying it.
  if (i === 1 || i >= lines.length || lines[i].trim() === "---") return text;
  return [lines[0]].concat(lines.slice(i)).join("\n");
}

export function createTask({ root, config, board, slug, fields, body }) {
  const paths = backlogPaths(root);
  const pat = taskIdPatterns(config.taskIdPrefix);
  const { id, source } = nextId(root, paths.tasksDir, pat.fileNumber);
  const taskId = config.taskIdPrefix + "-" + id;
  const file = taskId + "-" + slug + ".md";
  const full = join(paths.tasksDir, file);
  const day = today();
  const opts = fields || {};

  // The banner is dropped BEFORE the rewrites, not after: every `^key:` pattern
  // below is anchored per line, and a comment line that happened to start with
  // one of those words would otherwise be a rewrite target.
  const template = stripTemplateBanner(readFileSync(join(root, "_template.md"), "utf8"));
  let text = template
    .replace(/^id: .*$/m, "id: " + taskId)
    .replace(/^title: .*$/m, "title: " + quoted(opts.title))
    .replace(/^board: .*$/m, "board: " + board)
    .replace(/^created: .*$/m, "created: " + day)
    .replace(/^updated: .*$/m, "updated: " + day);
  // `role` joins the scalar fields rather than getting a branch of its own: it
  // is one more enum from the configuration, and `docs-drift --seed-tasks`
  // (TL-100) is the first caller that has to set it programmatically.
  for (const key of ["priority", "status", "type", "estimate", "owner", "role"]) {
    if (opts[key]) text = text.replace(new RegExp("^" + key + ": .*$", "m"), key + ": " + opts[key]);
  }
  if (opts.epic) text = text.replace(/^epic: .*$/m, "epic: " + quoted(opts.epic));
  // A LIST, so it is set as a block rather than by the scalar loop above. An
  // empty list leaves the template's `labels: []` exactly as it is, which is
  // already the right answer.
  if (Array.isArray(opts.labels) && opts.labels.length) {
    text = text.replace(/^labels: .*$/m, "labels: [" + opts.labels.join(", ") + "]");
  }
  // A BLOCK list, like `verification` below and unlike `labels`: the template
  // carries `related_docs: []` on one line, and the tree's convention — the one
  // `check --docs` resolves against — is one indented entry per line.
  if (Array.isArray(opts.related_docs) && opts.related_docs.length) {
    text = text.replace(
      /^related_docs:.*\n(?:[ \t]+[^\n]*\n)*/m,
      "related_docs:\n" + opts.related_docs.map((d) => "  - " + d + "\n").join("")
    );
  }
  if (Array.isArray(opts.verification)) {
    // A block, not a line — `verification` is a list, and the template carries a
    // placeholder in it. A task shipped with the placeholder would teach that the
    // field is decorative, when it is the only line of defence against a "done"
    // that is not done.
    text = text.replace(
      // Every INDENTED line, not only the `- ` ones: since TL-86 an entry may
      // span two lines (`- id:` then `bash:`), and a pattern that stops at the
      // first continuation line would leave it orphaned under the new block.
      /^verification:.*\n(?:[ \t]+[^\n]*\n)*/m,
      // An EMPTY list is a deliberate answer, not a missing one (TL-67): `import`
      // has no contract to write and must not leave the template's placeholder,
      // because a field filled in by the template was filled in by nobody.
      opts.verification.length
        ? "verification:\n" + opts.verification.map(verificationEntry).join("")
        : "verification: []\n"
    );
  }

  if (body != null) {
    // The frontmatter is generated, the body comes from the caller. The boundary
    // runs along the second `---`, because that is the only place where the two
    // are disjoint.
    const end = text.indexOf("\n---\n", 3);
    if (end >= 0) text = text.slice(0, end + 5) + body;
  }

  // BEFORE the write, not after (TL-69). A file already on disk is a value the
  // tree now carries, and every reader downstream — the views, `next`, the
  // viewer — would be counting it under a vocabulary that does not contain it.
  const divergences = templateDrift(text, config);
  if (divergences.length) {
    const e = new Error("the template does not fit this project's vocabulary");
    e.code = "EVOCABULARY";
    e.divergences = divergences;
    e.templatePath = join(root, "_template.md");
    throw e;
  }

  try {
    // `wx` — an exclusive write. A taken number is meant to be an error, not an
    // overwrite.
    writeFileSync(full, text, { encoding: "utf8", flag: "wx" });
  } catch (e) {
    if (e && e.code === "EEXIST") {
      e.file = file;
      e.taskId = taskId;
    }
    throw e;
  }
  return { path: full, taskId, source };
}

export function main(argv) {
  const cli = takeDirFlag(argv);
  const parsed = parseArgs(cli.argv);
  if (parsed.error) return fail(parsed.error, `usage: ${N} new --title "…" [--board b] [--priority P1] [--epic e] [--estimate 2h]`);

  const opts = parsed.values;
  if (!opts.title) return fail(`give it a title: ${N} new --title "Do the thing"`, "a task with no title is useless to the next person");

  const slug = slugify(opts.title);
  if (!slug) return fail("no filename can be made from this title: " + JSON.stringify(opts.title), "at least one letter or digit is needed");

  const root = resolveBacklogDir({ dir: cli.dir, moduleDir: HERE }).root;
  const config = loadConfigOrExit(root);
  const paths = backlogPaths(root);

  // Values from the configuration's VOCABULARIES — not from a list written here
  // (BL-1400).
  const checks = [
    ["priority", config.priorities], ["status", config.statuses],
    ["type", config.types], ["owner", config.owners],
  ];
  for (const [key, allowed] of checks) {
    if (opts[key] && allowed && allowed.length && allowed.indexOf(opts[key]) < 0) {
      return fail("`" + opts[key] + "` is not an allowed value for the field `" + key + "`",
        "allowed: " + allowed.join(" | "));
    }
  }
  const boardSlugs = (config.boards || []).map((b) => b.slug);
  const board = opts.board || config.defaultBoard || boardSlugs[0];
  if (boardSlugs.length && boardSlugs.indexOf(board) < 0) {
    return fail("the board `" + board + "` does not exist in the registry",
      "the board vocabulary is CLOSED; available: " + boardSlugs.join(" | "));
  }

  // `--wave` IS CHECKED BEFORE A NUMBER IS RESERVED (TL-213). Creating the task
  // and scheduling it are one act, so the half that can be refused is settled
  // first: a wave named by a typo must leave a tree that looks exactly like the
  // one before the command ran, rather than a task scheduled nowhere anybody is
  // reading. Creating a wave is `plan add --why`, because a wave needs an
  // argument and this command has nowhere to ask for one.
  let scheduling = null;
  if (opts.wave) {
    if (!existsSync(paths.planPath)) {
      return fail("`--wave` was given and this backlog has no plan to schedule into",
        "expected: " + paths.planPath + " — the execution order is an optional decision, and this backlog has not made it");
    }
    const text = readFileSync(paths.planPath, "utf8");
    const read = parsePlanYaml(text);
    if (read.problems.length) {
      return fail("the plan cannot be read, so nothing can be scheduled in it",
        paths.planPath + ": " + read.problems[0]);
    }
    const waves = read.plan.waves.map((w) => w.name);
    if (waves.indexOf(opts.wave) < 0) {
      return fail("there is no wave `" + opts.wave + "` in " + paths.planPath,
        (waves.length ? "the waves it has: " + waves.join(" | ") : "the plan has no waves yet") +
          ` — a wave is created by \`${N} plan add <ID> --wave "…" --why "…"\`, never by a typo here`);
    }
    scheduling = { text };
  }

  const pat = taskIdPatterns(config.taskIdPrefix);

  // A mismatch between the configuration and the tree MUST stop the WRITING OF A
  // TASK, not just the rebuilding of the views (TL-61). Until TL-61 the gate
  // sat only in `build-backlog.mjs`, so `build` refused while `new` happily
  // appended a task under the NEW prefix alongside the old ones — the tree got
  // two number spaces and a numbering that started over, and the symptom appeared
  // only at the next rebuild, pointing at the mismatch rather than at what had
  // deepened it.
  //
  // We check BEFORE `nextId()`, because that one calls the branch scanner: there
  // is no reason to pay for a scan whose result will not be used anyway.
  const mismatch = detectPrefixMismatch(readdirSync(paths.tasksDir), config.taskIdPrefix);
  if (!mismatch.ok) {
    console.error(prefixMismatchMessage(mismatch, paths.tasksDir, {
      consequence: [
        "  Stopping BEFORE anything is written. A task written now would get the",
        "  prefix `" + mismatch.expected + "` and stand next to `" + mismatch.found.join("`, `") + "` — the tree would",
        "  have two number spaces, and the numbering would start over.",
      ],
    }));
    // One line more than `build` says: for a NEW backlog the most common case is
    // a prefix changed just after `init`, and renumbering there is a sledgehammer
    // for a nut.
    console.error("");
    console.error("  If nobody owns these tasks yet, the cheapest fix is to set `task_id_prefix`");
    console.error("  back to `" + mismatch.found.join("` or `") + "`.");
    return 1;
  }

  let created;
  try {
    created = createTask({ root, config, board, slug, fields: opts, body: null });
  } catch (e) {
    if (e && e.code === "EEXIST") {
      return fail("the file already exists: " + e.file,
        "the number " + e.taskId + " is taken — check `" + N + " next-id --explain`");
    }
    if (e && e.code === "EVOCABULARY") {
      console.error(driftMessage(e.divergences, {
        templatePath: e.templatePath, fields: opts, command: N + " new",
      }));
      return 1;
    }
    throw e;
  }
  const { path: full, taskId, source } = created;

  // THE BIRTH IS RECORDED BY WHOEVER CAUSED IT (TL-187). Left to reconciliation,
  // the `__created__` entry is written by whichever tree diffs the tasks
  // directory first, under THAT tree's actor — and on a backlog with no snapshot
  // yet it is never written at all. The actor comes from the one chain in
  // `actor.mjs`; `new` has no `--actor` flag, so it is the environment, the user
  // layer, then the default.
  //
  // The failure is NOT fatal: the task file is already on disk, and a command
  // that wrote the task and then exited non-zero would read as "nothing
  // happened". The log is the record of the write, not the write itself.
  try {
    recordCreation(root, { id: taskId, title: opts.title }, { actor: resolveActor(""), source: "new" });
  } catch (e) {
    console.error("  NOTE: the creation could not be recorded in the history: " + (e && e.message));
  }

  // THE SECOND HALF OF THE ONE ACT. The wave was verified above and a task born
  // a moment ago carries no `blocked_by`, so the only way this fails is the disk
  // — and then it says the task exists and the schedule does not, rather than
  // reporting success over a half-completion.
  if (scheduling) {
    const edit = editPlanText(scheduling.text, { op: "add", id: taskId, wave: opts.wave });
    const introduced = edit.problems.length
      ? []
      : newPlanErrors(scheduling.text, edit.text, readTaskMetas(paths.tasksDir, config), config);
    if (edit.problems.length || introduced.length) {
      console.error(`${N} new: the task was written and the plan was NOT`);
      console.error("  " + full);
      for (const p of edit.problems.concat(introduced)) console.error("  - " + p);
      console.error(`  schedule it with \`${N} plan add ${taskId} --wave "${opts.wave}"\` once the plan allows it`);
      return 1;
    }
    writeFileSync(paths.planPath, edit.text, "utf8");
  }

  console.log(`${N} new: ` + full);
  if (source === "local") {
    // A known risk said out loud, not hidden.
    console.log("  NOTE: the number comes from a LOCAL scan of this directory, not from the repository's branches.");
    console.log("  If you work in a repository with several branches, another session may already hold " + taskId + ".");
  }
  console.log("  board: " + board + (opts.board ? "" : " (the registry default)"));
  if (scheduling) console.log("  wave: " + opts.wave + " — scheduled in " + paths.planPath);
  // WHAT THAT ESTIMATE HAS COST BEFORE (TL-29). Printed HERE and nowhere else,
  // because writing the estimate is the only moment the number can still change
  // a decision — a calibration report read a week later corrects nothing.
  //
  // SILENT BELOW THE THRESHOLD, deliberately: a hint drawn from three closed
  // tasks would be a guess wearing the authority of a measurement, and the cost
  // of that is paid by whoever believes it.
  if (opts.estimate) {
    const hint = bucketFor(calibrationSamples(root, readTaskMetas(paths.tasksDir, config), config), opts.estimate,
      { minN: config.minReportN });
    if (hint) {
      console.log("  calibration: closed `" + hint.label + "` tasks took " +
        spanLabel(hint.p20) + " - " + spanLabel(hint.p80) + ", median " + spanLabel(hint.median) +
        " (n=" + hint.n + ")");
    }
  }
  console.log(`  next: fill in ## Goal and ## Context, then \`${N} build\``);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("new-task.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
