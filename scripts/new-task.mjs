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

import { loadConfigOrExit } from "./config.mjs";
import { detectPrefixMismatch, prefixMismatchMessage, taskIdPatterns } from "./task-id.mjs";
import { backlogPaths, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";

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
  const r = spawnSync(process.execPath, [join(HERE, "next-backlog-id.mjs"), "--dir", root], {
    encoding: "utf8", timeout: 60_000, cwd: root,
  });
  if (r.status === 0) {
    const last = String(r.stdout || "").trim().split("\n").pop().trim();
    if (/^\d+$/.test(last)) {
      // The warning about a NARROWER source for the number is passed on rather
      // than swallowed (BL-1452): this is the only place the user will see it.
      const warn = String(r.stderr || "").trim();
      if (warn) console.error(warn);
      return { id: parseInt(last, 10), source: "repo" };
    }
  }
  return { id: localMax(tasksDir, numberPattern) + 1, source: "local" };
}

const FLAGS = {
  "--title": "title", "--board": "board", "--priority": "priority", "--type": "type",
  "--epic": "epic", "--estimate": "estimate", "--owner": "owner", "--status": "status",
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
 *        the frontmatter; `null` leaves the template untouched.
 * @returns {{path: string, taskId: string, source: "repo"|"local"}}
 * @throws {Error & {code: "EEXIST", file: string, taskId: string}}
 */
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

export function createTask({ root, config, board, slug, fields, body }) {
  const paths = backlogPaths(root);
  const pat = taskIdPatterns(config.taskIdPrefix);
  const { id, source } = nextId(root, paths.tasksDir, pat.fileNumber);
  const taskId = config.taskIdPrefix + "-" + id;
  const file = taskId + "-" + slug + ".md";
  const full = join(paths.tasksDir, file);
  const day = today();
  const opts = fields || {};

  const template = readFileSync(join(root, "_template.md"), "utf8");
  let text = template
    .replace(/^id: .*$/m, "id: " + taskId)
    .replace(/^title: .*$/m, "title: " + quoted(opts.title))
    .replace(/^board: .*$/m, "board: " + board)
    .replace(/^created: .*$/m, "created: " + day)
    .replace(/^updated: .*$/m, "updated: " + day);
  for (const key of ["priority", "status", "type", "estimate", "owner"]) {
    if (opts[key]) text = text.replace(new RegExp("^" + key + ": .*$", "m"), key + ": " + opts[key]);
  }
  if (opts.epic) text = text.replace(/^epic: .*$/m, "epic: " + quoted(opts.epic));
  if (Array.isArray(opts.verification) && opts.verification.length) {
    // A block, not a line — `verification` is a list, and the template carries a
    // placeholder in it. A task shipped with the placeholder would teach that the
    // field is decorative, when it is the only line of defence against a "done"
    // that is not done.
    text = text.replace(
      // Every INDENTED line, not only the `- ` ones: since TL-86 an entry may
      // span two lines (`- id:` then `bash:`), and a pattern that stops at the
      // first continuation line would leave it orphaned under the new block.
      /^verification:.*\n(?:[ \t]+[^\n]*\n)*/m,
      "verification:\n" + opts.verification.map(verificationEntry).join("")
    );
  }

  if (body != null) {
    // The frontmatter is generated, the body comes from the caller. The boundary
    // runs along the second `---`, because that is the only place where the two
    // are disjoint.
    const end = text.indexOf("\n---\n", 3);
    if (end >= 0) text = text.slice(0, end + 5) + body;
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
    throw e;
  }
  const { path: full, taskId, source } = created;

  console.log(`${N} new: ` + full);
  if (source === "local") {
    // A known risk said out loud, not hidden.
    console.log("  NOTE: the number comes from a LOCAL scan of this directory, not from the repository's branches.");
    console.log("  If you work in a repository with several branches, another session may already hold " + taskId + ".");
  }
  console.log("  board: " + board + (opts.board ? "" : " (the registry default)"));
  console.log(`  next: fill in ## Goal and ## Context, then \`${N} build\``);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("new-task.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
