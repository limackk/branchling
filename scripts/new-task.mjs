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
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveActorReport } from "./actor.mjs";
import { ConfigError, formatConfigError, loadConfig } from "./config.mjs";
import { actorRefusal, recordCreation } from "./history.mjs";
import { withBacklogMutex } from "./lock.mjs";
import { editPlanText, newPlanErrors, waveTargetProblem } from "./plan-write.mjs";
import { detectPrefixMismatch, prefixMismatchMessage, taskIdPatterns } from "./task-id.mjs";
import { answerBacklogDirRefusal, backlogPaths, isBacklogDirRefusal, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { auditVocabulary, extractMeta, lineEnding, splitFrontmatter, withLineEnding } from "./task-fields.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { readStdinText } from "./stdin.mjs";
import { parseTaskDocument, taskContent } from "./task-input.mjs";
import { failure, plural, refusal, warn } from "./ui.mjs";
import { printJson } from "./json-envelope.mjs";
import { readTaskMetas } from "./task-io.mjs";
import { agentEstimate, agentEstimateText } from "./agent-time.mjs";
import { readAgentTime } from "./agent-time-read.mjs";
import { todayStamp } from "./today.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// The table's keys ARE the accented letters this function exists to fold.
const DIACRITICS = {
  ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z",
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

/**
 * A TITLE AS A SET OF WORDS (TL-649): lowercased, diacritics folded by the same
 * table `slugify()` uses, split on every run of characters that is neither a
 * letter nor a digit. A set and not a sequence, so word order and a repeated
 * word do not count; `--json` and `json` are the same word.
 */
export function titleWords(title) {
  const lowered = String(title || "").toLowerCase();
  let folded = "";
  for (const ch of lowered) folded += Object.prototype.hasOwnProperty.call(DIACRITICS, ch) ? DIACRITICS[ch] : ch;
  return new Set(folded.split(/[^a-z0-9]+/).filter(Boolean));
}

/**
 * How nearly two titles say the same thing: the Jaccard index of their word
 * sets — the words they share over the words either of them uses, from 0 (none
 * in common) to 1 (the same set).
 *
 * WHY THIS MEASURE. It reads the titles and nothing else, so comparing one
 * title against every open task costs one pass over words already in memory,
 * and it carries no vocabulary of its own: no stop-word list, which would be
 * one language's grammar written into the code. Its known blind spots are
 * stated rather than discovered: two titles with the same words in another
 * order score 1, and a rephrasing that shares few words scores low.
 */
export function titleSimilarity(a, b) {
  const left = a instanceof Set ? a : titleWords(a);
  const right = b instanceof Set ? b : titleWords(b);
  let shared = 0;
  for (const w of left) if (right.has(w)) shared++;
  const union = left.size + right.size - shared;
  // Two empty titles share nothing; without this they would score NaN.
  return union ? shared / union : 0;
}

/**
 * The score at or above which `new` names an open task (TL-649).
 *
 * WHY 0.7. Replacing one word of an n-word title scores (n-1)/(n+1): 0.71 at
 * six words, 0.8 at nine. Measured across all 659 titles of this tool's own
 * backlog on 2026-11-08, five pairs scored at or above 0.7: the duplicate that
 * motivated the check (TL-571 and TL-613 at 0.80), two pairs that differ by one
 * word, one rephrasing of the same refusal, and one pair that swaps "file" and
 * "directory" (1.00 — the word-order blind spot above). At 0.6 the note started
 * naming families of related but distinct tasks ("A file in place of …"), and
 * a note that fires on every second title stops being read. Below
 * six words a one-word change stays under the threshold — the price of not
 * naming every short title that shares a verb.
 */
export const NEAR_DUPLICATE_THRESHOLD = 0.7;

/**
 * The OPEN tasks whose title nearly repeats `title`, most similar first. Open
 * means a status outside `archived_statuses`: a closed task with the same title
 * is history, and a second task for work already done is a separate question
 * this note does not answer. It only reports — two similar titles can be two
 * real tasks, so nothing here refuses.
 *
 * @returns {Array<{id: string, title: string, similarity: number}>} the
 *          similarity rounded to two decimals
 */
export function nearDuplicateTitles(title, metas, config) {
  const archived = new Set(config.archivedStatuses);
  const words = titleWords(title);
  const found = [];
  for (const m of metas) {
    if (!m || !m.id || archived.has(m.status)) continue;
    const similarity = titleSimilarity(words, titleWords(m.title));
    if (similarity >= NEAR_DUPLICATE_THRESHOLD) {
      found.push({ id: m.id, title: String(m.title), similarity: Math.round(similarity * 100) / 100 });
    }
  }
  return found.sort((x, y) => y.similarity - x.similarity || String(x.id).localeCompare(String(y.id)));
}

/**
 * The note `new` prints when the title nearly repeats open tasks (TL-649), as
 * lines for stderr; empty when nothing is close. One builder for both answers
 * that follow a write — success and a plan refused after it — so a person
 * without `--json` is told about the duplicate on either.
 */
export function nearDuplicateNote(nearDuplicates) {
  if (!nearDuplicates.length) return [];
  return [warn("the title nearly repeats " + plural(nearDuplicates.length, "an open task", "open tasks") +
    " — the task was created; check it is not the same work:")]
    .concat(nearDuplicates.map((d) => "    " + d.id + "  " + d.title + "  (similarity " + d.similarity.toFixed(2) + ")"));
}

/** A YAML scalar for a value that may contain spaces and colons. */
function quoted(v) {
  return '"' + String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
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
  // The release the task is PLANNED for (TL-505), from `releases:` — closed, so
  // checked below like the board.
  "--release": "release",
  // The targets in another repository the task ships from (TL-514), from the
  // `deploy_targets` that carry `repository:` — a comma-separated list, checked
  // below. A local target is refused: its tasks are computed from commit paths.
  "--target": "target",
  // NOT a frontmatter field: it schedules the task in `plan.yaml` (TL-213). The
  // value is checked against the waves that exist BEFORE anything is written.
  "--wave": "wave",
  // NOT a frontmatter field either: it names the file the task DOCUMENT is read
  // from, in place of stdin (TL-237).
  "--body-file": "bodyFile",
  // Who records the creation (TL-550). Not `owner:` — a task created by one
  // actor is routinely held by another, or by nobody.
  "--actor": "actor",
};

/** Flags that take NO value. Kept apart from FLAGS, because there every flag
 *  consumes the next argument, and `--json --title x` must not read `--title`
 *  as the value of `--json`. */
const SWITCHES = { "--json": "json" };

/**
 * `--` ENDS FLAG READING (TL-58).
 *
 * Without a separator a value beginning with a dash is still refused, and that
 * heuristic stays: `--title --board main` is overwhelmingly a mistake, and a
 * task titled `--board` is the silent no-op it was written against. The price
 * was that a title which LEGITIMATELY begins with a dash — every task this tool
 * writes about a flag — had no way in at all.
 *
 * The separator is that way in, in the form a user already knows from `git` and
 * `rm`: the flag before it takes the next argument WHATEVER it looks like, and
 * nothing beyond the separator is read as a flag. That second half is why the
 * fix is not merely a leading dash being tolerated: `new --title -- --priority`
 * must title the task `--priority`, not also set the priority from the word
 * after it.
 *
 * `new` takes no positional arguments, so anything left over past the value is
 * refused rather than dropped — an argument accepted and ignored is the no-op
 * this tool refuses to be.
 */
function parseArgs(argv) {
  const values = {};
  const sep = argv.indexOf("--");
  const flags = sep < 0 ? argv : argv.slice(0, sep);
  const literal = sep < 0 ? [] : argv.slice(sep + 1);
  for (let i = 0; i < flags.length; i++) {
    const a = flags[i];
    if (!a.startsWith("-")) {
      if (i > 0 && FLAGS[flags[i - 1]]) continue; // the previous flag's value
      return { error: "unexpected argument: " + a, available: true };
    }
    if (SWITCHES[a]) { values[SWITCHES[a]] = true; continue; }
    if (!FLAGS[a]) return { error: "unknown flag: " + a, available: true };
    // Only the LAST flag before the separator reaches past it, and only that
    // one is exempt from the dash heuristic.
    const beyond = i + 1 === flags.length;
    const value = beyond ? literal[0] : flags[i + 1];
    if (!value || (!beyond && value.startsWith("-"))) return { error: a + " requires a value" };
    values[FLAGS[a]] = value;
  }
  const spent = flags.length > 0 && FLAGS[flags[flags.length - 1]] ? 1 : 0;
  if (literal.length > spent) return { error: "unexpected argument: " + literal[spent], available: true };
  return { values };
}

/**
 * A REFUSAL IS DESCRIBED ONCE AND PRINTED IN ONE OF TWO SHAPES (TL-568).
 *
 * `new --json` answered in its envelope only on success and for a missing
 * backlog; every other refusal was a sentence on stderr and an empty stdout, so
 * a program calling it had to branch on the exit code and parse prose to learn
 * why. Every refusal path now builds this descriptor and hands it to
 * `answerRefusal()`, which prints the `task-new` envelope under `--json` and the
 * unchanged text otherwise — one function, so a new refusal cannot be added
 * with only one of the two shapes.
 *
 * `refusalKind` is the word a consumer branches on:
 *
 *   usage             the invocation: an unknown flag, a missing value or
 *                     title, an actor with no namespace, a target of this
 *                     repository named in `--target`
 *   unknown-value     a value outside its field's vocabulary (TL-630), with
 *                     `rejected` `{ field, value }` and `declared`
 *   invalid-document  the task document from stdin or `--body-file`
 *   invalid-config    config.yaml cannot be loaded
 *   prefix-mismatch   the configured prefix is not the one the tree uses
 *   template-drift    `_template.md` carries a value config.yaml does not know
 *   plan-refused      `--wave` names no wave, or the plan refused the task
 *                     after it was written (then `id` and `file` are set)
 *   id-taken          the file for the reserved number already exists
 *   no-backlog        shared with every command (`answerBacklogDirRefusal()`)
 *
 * `text` is the stderr form exactly as it was before the envelope existed.
 */
function said(message, hint, refusalKind = "usage", code = 2) {
  return {
    code, refusalKind, message, details: hint ? [hint] : [],
    text: `${N} new: ` + message + (hint ? "\n  " + hint : ""),
  };
}

/**
 * A VALUE OUTSIDE A VOCABULARY IS A REFUSAL, NOT A USAGE ERROR (TL-630). The
 * call was built right and the value a person typed is what is wrong, so it
 * exits 1 and names the field, the value and what the field accepts — the
 * shape `set` (TL-543), `query`, `handoff` (TL-559) and `next` (TL-574) refuse
 * with. Until then `new` said `usage` with exit 2, and a consumer branching on
 * `refusalKind` across the writers saw two words for one refusal. The stderr
 * form is the sentence it always was.
 */
function unknownValue(field, value, declared, message, hint) {
  return {
    ...said(message, hint, "unknown-value", 1),
    payload: { rejected: { field, value }, declared },
  };
}

/**
 * Print a refusal descriptor and return its exit code. Under `--json` stdout
 * carries the envelope and stderr stays empty, as `answerBacklogDirRefusal()`
 * does for the missing backlog.
 */
function answerRefusal(r, { json, actorSource = null }) {
  if (json) {
    printJson("task-new", {
      ...(r.payload || {}), ok: false, actorSource,
      refusalKind: r.refusalKind, refusal: r.message, details: r.details,
    });
  } else {
    console.error(r.text);
  }
  return r.code;
}

/**
 * Was `--json` asked for? Read from the raw arguments, BEFORE parsing, because
 * a refusal of the parse itself has to answer in the shape that was asked for.
 * Only the words before `--` count: past the separator `--json` is a value — a
 * title about the flag — and not the flag.
 */
function jsonRequested(argv) {
  const sep = argv.indexOf("--");
  return (sep < 0 ? argv : argv.slice(0, sep)).includes("--json");
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
  const r = driftRefusal(divergences, { templatePath, fields });
  return failure(command, r.problem, r.findings.concat([""], r.explanation), r.next);
}

/**
 * The same refusal as PARTS, so `new --json` (TL-568) carries the findings and
 * the remedies as `details` without the paragraph written for a terminal.
 */
export function driftRefusal(divergences, { templatePath, fields }) {
  const opts = fields || {};
  const findings = [];
  for (const d of divergences) {
    for (const f of d.found) {
      const fromCaller = String(opts[d.field] || "") === f.value;
      findings.push(
        "`" + d.field + ": " + f.value + "` is not a value this project uses" +
          (d.allowed.length ? " (" + d.allowed.join(" | ") + ")" : " — the vocabulary is empty")
      );
      findings.push(
        fromCaller
          ? "  it came from the arguments of this call"
          : "  it came from the template, not from your command — " + templatePath
      );
    }
  }
  return {
    problem: "the template does not fit this project's vocabulary",
    findings,
    explanation: [
      "The template is a copy of the DEFAULT vocabularies taken at `init`. Once",
      "config.yaml changes, the two drift, and every task made from the template",
      "would carry a value the configuration does not know.",
    ],
    next: [
      "edit " + templatePath + " to use a value from config.yaml",
      "or add the value to config.yaml, if it belongs to this project",
    ],
  };
}

/**
 * One `verification:` entry, as YAML. A plain string is the short form (a bash
 * command with no id); an object may carry `id` — the handle a criterion points
 * at with `[proof: <id>]` (TL-86) — and either `bash` or `manual`.
 *
 * The command goes through `quoted()`, never between two bare quotes (TL-500).
 * A string carrying `"` or `\` came out as invalid YAML, and the tool's own
 * reader did not notice: `unquote()` strips the first and last quote whatever
 * stands between them, so the damage surfaced only in a parser that reads YAML
 * as YAML. A line break is refused before this point (`validateVerification`),
 * because no spelling of one survives the line-based readers.
 */
function verificationEntry(v) {
  if (typeof v === "string") return "  - bash: " + quoted(v) + "\n";
  const kind = v.manual ? "manual" : "bash";
  const command = quoted(v.manual || v.bash);
  if (!v.id) return "  - " + kind + ": " + command + "\n";
  return "  - id: " + v.id + "\n    " + kind + ": " + command + "\n";
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

function createTaskUnlocked({ root, config, board, slug, fields, body }) {
  const paths = backlogPaths(root);
  const pat = taskIdPatterns(config.taskIdPrefix);
  const { id, source } = nextId(root, paths.tasksDir, pat.fileNumber);
  const taskId = config.taskIdPrefix + "-" + id;
  const file = taskId + "-" + slug + ".md";
  const full = join(paths.tasksDir, file);
  const day = todayStamp();
  const opts = fields || {};

  // The banner is dropped BEFORE the rewrites, not after: every `^key:` pattern
  // below is anchored per line, and a comment line that happened to start with
  // one of those words would otherwise be a rewrite target.
  //
  // The rewrites below are written against LF, so a template checked out with
  // CRLF is read as LF and the task is written back in the template's ending
  // (TL-479). Matched against `\r\n` directly, the banner, the verification
  // block and the body boundary all missed, and `new` exited 0 with the
  // template's placeholders standing in for the caller's task.
  const raw = readFileSync(join(root, "_template.md"), "utf8");
  const eol = lineEnding(raw);
  const template = stripTemplateBanner(withLineEnding(raw, "\n"));
  // Every rewrite below inserts its value through a replacer FUNCTION, never a
  // replacement STRING (TL-527). A string is not literal in JavaScript: `$'`,
  // `` $` ``, `$&`, `$1` and `$$` are expanded, and a shell command anchored at
  // the end of a line (`grep -q x$' f`) spliced the template body into the
  // frontmatter while `new` and `check` both stayed green. A function's return
  // value is inserted as it is.
  const literal = (value) => () => value;
  let text = template
    .replace(/^id: .*$/m, literal("id: " + taskId))
    .replace(/^title: .*$/m, literal("title: " + quoted(opts.title)))
    .replace(/^board: .*$/m, literal("board: " + board))
    .replace(/^created: .*$/m, literal("created: " + day))
    .replace(/^updated: .*$/m, literal("updated: " + day));
  // `role` joins the scalar fields rather than getting a branch of its own: it
  // is one more enum from the configuration, and `docs-drift --seed-tasks`
  // (TL-100) is the first caller that has to set it programmatically. `executor`
  // is the same kind of field, and `seed` (TL-493) the caller that sets it.
  for (const key of ["priority", "status", "type", "estimate", "owner", "role", "executor"]) {
    if (opts[key]) text = text.replace(new RegExp("^" + key + ": .*$", "m"), literal(key + ": " + opts[key]));
  }
  if (opts.epic) text = text.replace(/^epic: .*$/m, literal("epic: " + quoted(opts.epic)));
  // A template written before TL-505 has no `release:` line, and it is a file in
  // somebody else's repository that this command does not get to rewrite. The
  // value is then INSERTED after `epic:` (else `board:`), where the current
  // template keeps it; a replace that matched nothing would drop the caller's
  // value and still exit 0.
  if (opts.release) {
    if (/^release:.*$/m.test(text)) text = text.replace(/^release:.*$/m, literal("release: " + opts.release));
    else if (/^epic:.*$/m.test(text)) text = text.replace(/^epic:.*$/m, (m) => m + "\nrelease: " + opts.release);
    else text = text.replace(/^board:.*$/m, (m) => m + "\nrelease: " + opts.release);
  }
  // `target:` (TL-514) is an inline list like `labels`. A template written
  // before it has no line for it, and — as with `release:` above — the value is
  // then INSERTED after `release:`, `epic:` or `board:`, whichever comes first,
  // rather than dropped.
  if (Array.isArray(opts.target) && opts.target.length) {
    const line = "target: [" + opts.target.join(", ") + "]";
    if (/^target:.*$/m.test(text)) text = text.replace(/^target:.*$/m, literal(line));
    else {
      const after = ["release", "epic", "board"].find((k) => new RegExp("^" + k + ":.*$", "m").test(text));
      text = after ? text.replace(new RegExp("^" + after + ":.*$", "m"), (m) => m + "\n" + line) : text;
    }
  }
  // A LIST, so it is set as a block rather than by the scalar loop above. An
  // empty list leaves the template's `labels: []` exactly as it is, which is
  // already the right answer.
  if (Array.isArray(opts.labels) && opts.labels.length) {
    text = text.replace(/^labels: .*$/m, literal("labels: [" + opts.labels.join(", ") + "]"));
  }
  // A BLOCK list, like `verification` below and unlike `labels`: the template
  // carries `related_docs: []` on one line, and the tree's convention — the one
  // `check --docs` resolves against — is one indented entry per line.
  if (Array.isArray(opts.related_docs) && opts.related_docs.length) {
    text = text.replace(
      /^related_docs:.*\n(?:[ \t]+[^\n]*\n)*/m,
      literal("related_docs:\n" + opts.related_docs.map((d) => "  - " + d + "\n").join(""))
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
      literal(opts.verification.length
        ? "verification:\n" + opts.verification.map(verificationEntry).join("")
        : "verification: []\n")
    );
  }

  if (body != null) {
    // The frontmatter is generated, the body comes from the caller. The boundary
    // runs along the second `---`, because that is the only place where the two
    // are disjoint.
    const end = text.indexOf("\n---\n", 3);
    if (end >= 0) text = text.slice(0, end + 5) + body;
  }
  text = withLineEnding(text, eol);

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

/**
 * Selecting a number and reserving it on disk are one operation across every
 * worktree of the repository. The file's `wx` remains the final guard against
 * a collision from outside this machine; the mutex closes the local scan/write
 * window that `wx` alone cannot protect when slugs differ.
 */
export function createTask(args) {
  return withBacklogMutex(args.root, "new-task-id", () => createTaskUnlocked(args));
}

/**
 * THE CALLABLE INPUT (TL-237) — the task's prose and its closing contract, as a
 * JSON document, in the shape `seed` already reads for one plan item.
 *
 * WHY A DOCUMENT AND NOT A FLAG PER SECTION. `--goal`, `--context`, `--steps`
 * would write this project's template into the tool, and the template is data.
 * The document carries what is the TASK's (goal, context, steps, verification);
 * the frontmatter stays on flags, where it has been validated against this
 * project's vocabulary since long before this input existed.
 *
 * WHY STDIN IS READ WITHOUT BEING ASKED FOR, and why an empty one is not an
 * error. The fourth law is about composition: a session that has just found
 * something pipes the task in, and a flag to announce that it is doing so would
 * be a second thing to get right. The cost is that every OTHER caller of `new`
 * — the suite, `init`, a script — also arrives with a stdin that is not a
 * terminal, so nothing arriving has to mean exactly what it meant before this
 * change: create the task from the template. The wait is bounded in
 * `stdin.mjs`, so a parent that leaves stdin inherited and idle costs seconds
 * rather than forever.
 *
 * `--body-file` is the same document from a file, for a caller whose stdin is
 * already spoken for. It SUPPRESSES the read of stdin rather than competing
 * with it: reading a pipe only to refuse it would reintroduce the block the
 * flag exists to avoid.
 *
 * @returns {Promise<{document: object|null, refused: object|null}>} `refused`
 *          is a refusal descriptor when the document was refused; nothing has
 *          been written by then.
 */
async function readTaskInput(opts) {
  let text = null;
  if (opts.bodyFile) {
    try {
      text = readFileSync(opts.bodyFile, "utf8");
    } catch (e) {
      return { document: null, refused: said("`--body-file " + opts.bodyFile + "` could not be read: " + e.message, null, "invalid-document") };
    }
    if (!text.trim()) {
      return { document: null, refused: said("`--body-file " + opts.bodyFile + "` is empty", "a file named and empty is a document somebody meant to write", "invalid-document") };
    }
  } else {
    text = await readStdinText();
    // A terminal (`null`) and a writer that closed without sending anything are
    // the same answer here: no document.
    if (text === null || !text.trim()) return { document: null, refused: null };
  }

  const { task, errors } = parseTaskDocument(text);
  if (errors.length) {
    const message = "the task document was refused, and nothing was written";
    const shape = `the shape: { "goal": "…", "context": "…", "steps": ["…"], "verification": [ { "id": "…", "bash": "…", "proves": "…" } ] }`;
    return {
      document: null,
      refused: {
        code: 2, refusalKind: "invalid-document", message, details: errors.concat([shape]),
        text: failure(`${N} new`, message, errors, [shape]),
      },
    };
  }
  return { document: task, refused: null };
}

export async function main(argv) {
  const cli = takeDirFlag(argv);
  // Null until the actor is resolved, so a refusal before it never names a
  // rung nobody consulted (TL-550).
  const answer = { json: jsonRequested(cli.argv), actorSource: null };
  const refuse = (r) => answerRefusal(r, answer);
  const parsed = parseArgs(cli.argv);
  if (parsed.error) {
    // An argument error names the ACCEPTED SET, in the one wording every command
    // uses (TL-220); the old `usage:` line read well and could not be asked what
    // `new` takes. `--dir` is taken off by takeDirFlag before this point, so it
    // is named here rather than read out of FLAGS.
    if (parsed.available) {
      const available = Object.keys(FLAGS).concat(Object.keys(SWITCHES)).join(" ") + " --dir <path>";
      return refuse({
        code: 2, refusalKind: "usage", message: parsed.error, details: ["available: " + available],
        text: refusal(N + " new", parsed.error, available),
      });
    }
    return refuse(said(parsed.error, `usage: ${N} new --title "…" [--board b] [--priority P1] [--epic e] [--estimate 2h] [--body-file f]`));
  }

  const opts = parsed.values;
  if (!opts.title) return refuse(said(`give it a title: ${N} new --title "Do the thing"`, "a task with no title is useless to the next person"));

  const slug = slugify(opts.title);
  if (!slug) return refuse(said("no filename can be made from this title: " + JSON.stringify(opts.title), "at least one letter or digit is needed"));

  // The actor is judged BEFORE anything is written (TL-550), as every other
  // writing command judges it: a creation recorded under an actor with no
  // namespace would be a history row nobody can weigh.
  const { actor, actorSource } = resolveActorReport(opts.actor);
  answer.actorSource = actorSource;
  const badActor = actorRefusal(actor);
  if (badActor) return refuse(said(badActor.refusal, badActor.hint));

  // BEFORE the directory is even resolved: a refused document must leave a tree
  // that looks exactly like the one before the command ran.
  const input = await readTaskInput(opts);
  if (input.refused) return refuse(input.refused);
  const content = input.document ? taskContent(input.document) : null;

  // A missing backlog answers under `--json` in this command's own kind
  // (TL-548), carrying the actor source already resolved above, so a consumer
  // reads `ok: false` instead of an empty stdout it cannot tell from a crash.
  let root;
  try {
    root = resolveBacklogDir({ dir: cli.dir, moduleDir: HERE }).root;
  } catch (e) {
    if (!isBacklogDirRefusal(e)) throw e;
    return answerBacklogDirRefusal(e, { command: N + " new", jsonKind: opts.json ? "task-new" : null, payload: { actorSource } });
  }
  // Not `loadConfigOrExit()`: that one prints on stderr and exits, which under
  // `--json` would leave stdout empty — the gap this command closes (TL-568).
  let config;
  try {
    config = loadConfig(root);
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    return refuse({
      code: 1, refusalKind: "invalid-config", message: e.headline + " — " + e.configPath,
      details: e.problems.slice(), text: formatConfigError(e),
    });
  }
  const paths = backlogPaths(root);

  // Values from the configuration's VOCABULARIES — not from a list written here
  // (BL-1400).
  const checks = [
    ["priority", config.priorities], ["status", config.statuses],
    ["type", config.types], ["owner", config.owners],
  ];
  for (const [key, allowed] of checks) {
    if (opts[key] && allowed && allowed.length && allowed.indexOf(opts[key]) < 0) {
      return refuse(unknownValue(key, opts[key], allowed,
        "`" + opts[key] + "` is not an allowed value for the field `" + key + "`",
        "allowed: " + allowed.join(" | ")));
    }
  }
  // `releases:` is CLOSED even when it is empty (TL-505): an empty list says this
  // project plans no releases, so any value is a release nobody will look for.
  if (opts.release) {
    const releases = config.releases || [];
    if (releases.indexOf(opts.release) < 0) {
      return refuse(unknownValue("release", opts.release, releases,
        "`" + opts.release + "` is not a release this project plans",
        releases.length ? "allowed: " + releases.join(" | ") : "`releases:` is not declared in config.yaml, so this backlog plans no releases"));
    }
  }
  // `target:` is CLOSED even when it is empty (TL-514), like `releases:`. A
  // local target gets its own message, because the name IS declared — the
  // reader would otherwise go looking for a typo that is not there.
  if (opts.target !== undefined) {
    const named = String(opts.target).split(",").map((v) => v.trim()).filter(Boolean);
    if (!named.length) return refuse(said("--target requires a value", "one or more target names, comma-separated"));
    const external = config.externalTargets || [];
    for (const name of named) {
      if (external.indexOf(name) >= 0) continue;
      const local = (config.deployTargets || []).some((t) => t.name === name);
      if (local) {
        return refuse(said("`" + name + "` is a target of this repository, and a task cannot name it in `target:`",
          "its tasks are computed from the paths their commits touch; `target:` takes only a target that declares `repository:`" +
            (external.length ? " (" + external.join(" | ") + ")" : "")));
      }
      return refuse(unknownValue("target", name, external,
        "`" + name + "` is not a declared target in another repository",
        external.length
          ? "allowed: " + external.join(" | ")
          : "no target in `deploy_targets` declares `repository:`, so this backlog has none a task could name"));
    }
    opts.target = [...new Set(named)];
  }
  const boardSlugs = (config.boards || []).map((b) => b.slug);
  const board = opts.board || config.defaultBoard || boardSlugs[0];
  if (boardSlugs.length && boardSlugs.indexOf(board) < 0) {
    return refuse(unknownValue("board", board, boardSlugs,
      "the board `" + board + "` does not exist in the registry",
      "the board vocabulary is CLOSED; available: " + boardSlugs.join(" | ")));
  }

  // `--wave` IS CHECKED BEFORE A NUMBER IS RESERVED (TL-213). Creating the task
  // and scheduling it are one act, so the half that can be refused is settled
  // first: a wave named by a typo must leave a tree that looks exactly like the
  // one before the command ran, rather than a task scheduled nowhere anybody is
  // reading. Creating a wave is `plan add --why`, because a wave needs an
  // argument and this command has nowhere to ask for one.
  let scheduling = null;
  if (opts.wave) {
    const target = waveTargetProblem(paths.planPath, [opts.wave]);
    if (target.problem) return refuse(said(target.problem, target.hint, "plan-refused"));
    scheduling = { text: target.text };
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
    return refuse({
      code: 1, refusalKind: "prefix-mismatch",
      message: "the configuration says `task_id_prefix: " + mismatch.expected + "`, but " + paths.tasksDir +
        " holds not one task with that prefix, so nothing was written",
      details: [
        "what is there instead: " + mismatch.found.join(", "),
        "correct `task_id_prefix` in config.yaml to what the tree uses — if nobody owns these tasks yet, set it back to `" +
          mismatch.found.join("` or `") + "`",
        "or renumber the tree: `" + N + " migrate-prefix --to " + mismatch.expected + "` (with `--dry-run` first)",
      ],
      text: [
        prefixMismatchMessage(mismatch, paths.tasksDir, {
          consequence: [
            "  Stopping BEFORE anything is written. A task written now would get the",
            "  prefix `" + mismatch.expected + "` and stand next to `" + mismatch.found.join("`, `") + "` — the tree would",
            "  have two number spaces, and the numbering would start over.",
          ],
        }),
        // One line more than `build` says: for a NEW backlog the most common case is
        // a prefix changed just after `init`, and renumbering there is a sledgehammer
        // for a nut.
        "",
        "  If nobody owns these tasks yet, the cheapest fix is to set `task_id_prefix`",
        "  back to `" + mismatch.found.join("` or `") + "`.",
      ].join("\n"),
    });
  }

  // The open tasks this title nearly repeats (TL-649), read BEFORE the write so
  // the task being created is not among them. A note, never a refusal.
  const nearDuplicates = nearDuplicateTitles(opts.title, readTaskMetas(paths.tasksDir, config), config);

  let created;
  try {
    created = createTask({
      root, config, board, slug,
      // The document's contract REPLACES the template's placeholder; with no
      // document the template is left exactly as it was.
      fields: content ? { ...opts, verification: content.verification } : opts,
      body: content ? content.body : null,
    });
  } catch (e) {
    if (e && e.code === "EEXIST") {
      return refuse(said("the file already exists: " + e.file,
        "the number " + e.taskId + " is taken — check `" + N + " next-id --explain`", "id-taken"));
    }
    if (e && e.code === "EVOCABULARY") {
      const drift = { templatePath: e.templatePath, fields: opts };
      const parts = driftRefusal(e.divergences, drift);
      return refuse({
        code: 1, refusalKind: "template-drift", message: parts.problem,
        details: parts.findings.map((line) => line.trim()).concat(parts.next),
        text: driftMessage(e.divergences, { ...drift, command: N + " new" }),
      });
    }
    throw e;
  }
  const { path: full, taskId, source } = created;

  // THE BIRTH IS RECORDED BY WHOEVER CAUSED IT (TL-187). Left to reconciliation,
  // the `__created__` entry is written by whichever tree diffs the tasks
  // directory first, under THAT tree's actor — and on a backlog with no snapshot
  // yet it is never written at all. The actor comes from the one chain in
  // `actor.mjs` — `--actor`, the environment, the user layer, then the default —
  // and `--json` names which of them answered (TL-550).
  //
  // The failure is NOT fatal: the task file is already on disk, and a command
  // that wrote the task and then exited non-zero would read as "nothing
  // happened". The log is the record of the write, not the write itself.
  try {
    recordCreation(root, { id: taskId, title: opts.title }, { actor, source: "new" });
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
      // The ONE refusal after a write: the task exists, so the envelope names it
      // — a consumer must not be told `ok: false` and be left to guess that a
      // file was created anyway.
      const problems = edit.problems.concat(introduced);
      const schedule = `schedule it with \`${N} plan add ${taskId} --wave "${opts.wave}"\` once the plan allows it`;
      return refuse({
        code: 1, refusalKind: "plan-refused", message: "the task was written and the plan was NOT",
        details: problems.concat([schedule]),
        payload: { id: taskId, file: full, board, idSource: source, nearDuplicates },
        text: [`${N} new: the task was written and the plan was NOT`, "  " + full]
          .concat(problems.map((p) => "  - " + p), ["  " + schedule], nearDuplicateNote(nearDuplicates)).join("\n"),
      });
    }
    writeFileSync(paths.planPath, edit.text, "utf8");
  }

  if (opts.json) {
    printJson("task-new", {
      ok: true, id: taskId, file: full, board, wave: scheduling ? opts.wave : null, idSource: source, actorSource,
      nearDuplicates,
    });
    return 0;
  }

  console.log(`${N} new: ` + full);
  if (source === "local") {
    // A known risk said out loud, not hidden.
    console.log("  NOTE: the number comes from a LOCAL scan of this directory, not from the repository's branches.");
    console.log("  If you work in a repository with several branches, another session may already hold " + taskId + ".");
  }
  console.log("  board: " + board + (opts.board ? "" : " (the registry default)"));
  if (scheduling) console.log("  wave: " + opts.wave + " — scheduled in " + paths.planPath);
  // On stderr: the task WAS created, and this is something to know about it.
  for (const line of nearDuplicateNote(nearDuplicates)) console.error(line);
  // The one moment an estimate can still change a decision is while it is being
  // written (TL-480), shown as the computed field it is everywhere else
  // (TL-482). Silent below the threshold: a value from three samples would be
  // advice with the authority of a measurement.
  if (opts.estimate) {
    const field = agentEstimate(readAgentTime(root, config), opts.estimate);
    if (field) console.log("  agent_estimate: " + agentEstimateText(field) + " (computed, not stored)");
  }
  // What is left to do depends on what arrived: a task written from a document
  // already has its goal and its closing contract, and telling its author to go
  // and fill them in would be the tool disbelieving its own input.
  console.log(content
    ? `  next: \`${N} build\` — the goal and the verification came from the document`
    : `  next: fill in ## Goal and ## Context, then \`${N} build\``);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("new-task.mjs")) {
  process.exitCode = await main(process.argv.slice(2));
}
