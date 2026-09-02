#!/usr/bin/env node
/**
 * Guard: field values in the tree that no vocabulary in config.yaml allows (TL-56).
 *
 * WHAT IT ANSWERS. The writing path already enforces the vocabularies: `new
 * --type <x>` refuses a value the configuration does not know. The reading path
 * did not ask the same question, and the asymmetry produced the inverted result
 * it was meant to prevent — 73 files stood outside `types:` without a word of
 * protest, while the one thing the tool blocked was writing a seventy-fourth
 * file exactly like all the existing ones. This puts the write-time question to
 * the tree that is already there.
 *
 * WHY IT FAILS AND DOES NOT WARN. Unlike the reason guard, everything it reports
 * is fixable by the person running it, and by exactly two edits: add the value
 * to config.yaml, or correct the task. Nothing here is a fact about the past
 * that nobody can reconstruct. The class of error is already settled in this
 * project — a prefix that diverges from the tree FAILS before the write
 * (`detectPrefixMismatch`), and a vocabulary is the same kind of claim.
 *
 * ONE MEASUREMENT, NOT A SECOND SET OF RULES. The verdict comes from
 * `auditVocabulary()` — the same function `doctor` reports with. This file adds
 * only the pairing of a value back to the files carrying it, so the message can
 * name where to go. A guard with its own copy of the rules would eventually
 * disagree with the report, and then neither could be trusted.
 *
 * WHICH FIELDS IT JUDGES is decided in `auditVocabulary`, not here: closed
 * vocabularies only. `owner` and `estimate` are `suggestFrom` fields whose lists
 * are suggestions, `labels` is closed only under `labels_closed: true`, and
 * `board` has its own guard with its own message.
 *
 * Usage:
 *   node scripts/check-backlog-vocabulary.mjs [--dir <backlog>]
 *
 * Exit 1 on a divergence, 2 on a usage error, 0 otherwise.
 *
 * Tests: `node --test scripts/tests/config-vocabulary.test.mjs`
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigOrExit } from "./config.mjs";
import { resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { listTaskFileNames, readTaskMetas } from "./task-io.mjs";
import { auditVocabulary } from "./task-fields.mjs";
import { MARK, color } from "./ui.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";

const OKM = color.ok(MARK.ok);
const ERRM = color.err(MARK.err);
const __dirname = dirname(fileURLToPath(import.meta.url));

/** How many example files a single offending value is worth printing. */
const SHOWN_FILES = 3;

/**
 * PURE — names the files carrying one out-of-vocabulary value.
 *
 * This is a lookup, not a judgement: WHICH values count as divergent has already
 * been decided by `auditVocabulary`.
 *
 * @param {string[]} names task file names, in the order `metas` was read
 * @param {Array<object>} metas the results of `extractMeta()`
 * @param {string} field the frontmatter key
 * @param {string} value the offending value
 * @returns {string[]} file names, in tree order
 */
export function filesCarrying(names, metas, field, value) {
  const out = [];
  for (let i = 0; i < metas.length; i++) {
    const raw = metas[i] ? metas[i][field] : undefined;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const v of values) {
      if (String(v == null ? "" : v).trim() !== value) continue;
      out.push(names[i]);
      break;
    }
  }
  return out;
}

/**
 * PURE — renders the report for an already-computed audit.
 *
 * @param {Array<object>} divergent the result of `auditVocabulary()`
 * @param {string[]} names task file names
 * @param {Array<object>} metas the results of `extractMeta()`
 * @returns {{lines: string[], code: number}}
 */
export function report(divergent, names, metas) {
  if (!divergent.length) {
    // The counts are the positive control. "no divergence" over 0 tasks or 0
    // vocabularies is a guard that read nothing, not a tree that is in order —
    // and it would stay green through any regression.
    return {
      lines: [
        `${OKM} vocabulary: ${metas.length} task(s) checked, every value inside the ` +
          "vocabularies config.yaml declares",
      ],
      code: 0,
    };
  }

  const lines = [];
  const fields = divergent.map((d) => "`" + d.field + "`").join(", ");
  lines.push(`${ERRM} vocabulary: ${divergent.length} field(s) carry a value outside their vocabulary: ${fields}`);
  for (const d of divergent) {
    // A field whose values are the TOOL's shape has no key in config.yaml, and
    // saying it "diverges from config.yaml" would send the reader to edit
    // something that is not there (TL-113).
    lines.push(d.fixed
      ? `  \`${d.field}\` — a fixed set, not a vocabulary of this project: [${d.allowed.join(", ")}]`
      : `  \`${d.field}\` — allowed by \`${d.dictionary}:\` [${d.allowed.join(", ")}]`);
    for (const f of d.found) {
      const carriers = filesCarrying(names, metas, d.field, f.value);
      lines.push(`    ${f.value} ×${f.count} in ${carriers.length} file(s):`);
      for (const name of carriers.slice(0, SHOWN_FILES)) lines.push(`      - ${name}`);
      if (carriers.length > SHOWN_FILES) {
        lines.push(`      … and ${carriers.length - SHOWN_FILES} more`);
      }
    }
  }
  if (divergent.some((d) => !d.fixed)) {
    lines.push("  Two ways out, and they are not equivalent: add the value to config.yaml if the");
    lines.push("  tree is right, or correct the tasks if the vocabulary is. Which side is the");
    lines.push("  truth is a decision about this project, so the guard does not pick one.");
  }
  if (divergent.some((d) => d.fixed)) {
    lines.push("  A FIXED set has only one way out: correct the task. Those values are the shape");
    lines.push("  of the field rather than this project's words, so there is no key to add to.");
  }
  return { lines, code: 1 };
}

function main(argv) {
  const { dir, argv: rest } = takeDirFlag(argv);
  if (rest.length) {
    console.error(`${N} check: unknown argument: ` + rest.join(" "));
    console.error("  usage: check-backlog-vocabulary.mjs [--dir <backlog>]");
    return 2;
  }
  const root = resolveBacklogDir({ dir: dir || undefined, moduleDir: __dirname }).root;
  const config = loadConfigOrExit(root);
  const tasksDir = join(root, "tasks");
  const names = listTaskFileNames(tasksDir, config);
  const metas = readTaskMetas(tasksDir, config);
  const { lines, code } = report(auditVocabulary(metas, config), names, metas);
  for (const line of lines) (code === 0 ? console.log : console.error)(line);
  return code;
}

if (process.argv[1] && process.argv[1].endsWith("check-backlog-vocabulary.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
