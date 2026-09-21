/**
 * Guard: a task filename is its own id followed by a lowercase ASCII slug
 * (TL-385).
 *
 * WHAT WAS FOUND. 134 of 428 task files carried a slug written in the language
 * this repository used before it adopted English, e.g.
 * `TL-87-tasklog-next-atomowy-przydzial-taska-dla-agenta.md`. TL-137 translated
 * the task BODIES and deliberately renamed nothing, because a filename
 * migration has to preserve ids and move every path reference with it. TL-385
 * performed that migration; this guard is what keeps the shape from drifting
 * back.
 *
 * WHAT THIS GUARD CLAIMS, AND WHAT IT DOES NOT.
 *
 *   IT CLAIMS a SHAPE: the name is `<id>-<slug>.md`, the id is the one in the
 *   file's own frontmatter, and the slug is lowercase ASCII words joined by
 *   single hyphens — no uppercase, no diacritics, no underscores, no spaces,
 *   no doubled or edge hyphens. It also claims that the slug `new` generates
 *   from a title has that shape, so a task created tomorrow conforms by
 *   construction rather than by review.
 *
 *   IT DOES NOT CLAIM THE WORDS ARE ENGLISH, and must not be read as if it
 *   did. AGENTS.md is explicit about why: the former detector recognised
 *   Polish-specific characters and word shapes, so a green result from it said
 *   nothing about any other language, and it was deleted. No automated guard in
 *   this repository decides whether prose is English — that is a review
 *   responsibility, and the `manual:` entry in TL-385 is where it is recorded.
 *   A file named `TL-7-ein-deutscher-satz.md` passes here. That is not a hole
 *   to be plugged with a dictionary; it is the honest limit of a shape rule.
 *
 * WHY THE PREFIX IS NOT A LITERAL. It comes from `config.yaml` through
 * `taskIdPatterns` (TL-42/TL-44). A test spelling `TL` would fall silent after
 * `migrate-prefix` and report "0 files" instead of failing.
 *
 * THE POSITIVE CONTROL IS THE POINT. Every assertion over the real tree is of
 * the form "nothing is wrong", which is exactly what an empty sample and a
 * matcher that can never fire both produce. So the matcher is a pure function,
 * fed names that ARE wrong, and the tree scan asserts its own sample size.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { BACKLOG_DIR, TASKS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("task-filename-shape");

import { loadConfig } from "../config.mjs";
import { SLUG_MAX, slugify } from "../new-task.mjs";
import { taskIdPatterns } from "../task-id.mjs";

const PREFIX = loadConfig(BACKLOG_DIR, { strict: false }).taskIdPrefix;

/**
 * PURE — the shape a task filename must have, built from THIS backlog's prefix.
 *
 * `[a-z0-9]+(-[a-z0-9]+)*` is the whole rule: ASCII lowercase words, single
 * hyphens between them, nothing at either edge. It is anchored at both ends, so
 * a trailing `.md.bak` or a leading space is not a match.
 */
export function taskFilenameShape(prefix) {
  const p = String(prefix).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("^" + p + "-\\d+-[a-z0-9]+(?:-[a-z0-9]+)*\\.md$");
}

/** PURE — the id a filename declares, or null when it declares none. */
export function idFromFilename(name, prefix) {
  return name.match(taskIdPatterns(prefix).fileId)?.[1] ?? null;
}

/** PURE — the `id:` in the FIRST frontmatter block, and nowhere else. */
export function frontmatterId(text) {
  const block = text.match(/^---\n([\s\S]*?)\n---/);
  return block ? (block[1].match(/^id:\s*(\S+)/m)?.[1] ?? null) : null;
}

/** The task files of the real tree, template excluded — it carries no id. */
function taskFiles() {
  return readdirSync(TASKS_DIR).filter((f) => f.endsWith(".md") && f !== "_template.md");
}

test("every task filename in this tree has the shape, on a non-zero sample", () => {
  const files = taskFiles();
  assert.ok(files.length > 100,
    "only " + files.length + " task files found — the scan is looking in the wrong place");
  const shape = taskFilenameShape(PREFIX);
  const offences = files.filter((f) => !shape.test(f));
  assert.deepEqual(offences, [],
    "these filenames are not `" + PREFIX + "-<number>-<lowercase-ascii-slug>.md`");
});

test("the id in the filename is the id inside the file — a rename preserved identity", () => {
  // This is the half a shape rule cannot see. A `git mv` that renumbered while
  // renaming would produce a perfectly shaped filename pointing at the wrong
  // record, and every id-keyed thing in the tool — history logs, blocked_by,
  // the boards — would follow the FILE name.
  const mismatches = [];
  for (const f of taskFiles()) {
    const inName = idFromFilename(f, PREFIX);
    const inFile = frontmatterId(readFileSync(join(TASKS_DIR, f), "utf8"));
    if (inName !== inFile) mismatches.push(f + " declares `id: " + inFile + "`");
  }
  assert.deepEqual(mismatches, [], "the filename and the frontmatter disagree about which task this is");
});

test("history logs are named by id alone, so no filename migration reaches them", () => {
  // TL-385 renamed task files and nothing else. A history log is keyed by id on
  // purpose: it has no slug to translate and no title to follow.
  const dir = join(BACKLOG_DIR, "history");
  // A leading dot marks the directory's own bookkeeping (`.migrations.jsonl`),
  // which belongs to no task and therefore carries no id.
  const logs = readdirSync(dir).filter((f) => f.endsWith(".jsonl") && !f.startsWith("."));
  assert.ok(logs.length > 100, "only " + logs.length + " history logs found — wrong directory");
  const idOnly = taskIdPatterns(PREFIX).id;
  const offences = logs.filter((f) => !idOnly.test(f.replace(/\.jsonl$/, "")));
  assert.deepEqual(offences, [], "a history log is named by something other than a bare id");
});

test("POSITIVE CONTROL: the shape rejects what it is looking for", () => {
  // Without this, "no offences" would be just as true of a pattern that matches
  // everything.
  const shape = taskFilenameShape("TL");
  for (const bad of [
    "TL-87-Tasklog-Next.md",              // uppercase
    "TL-87-przydzial-zadań.md",           // a diacritic survived the slug
    "TL-87-two  words.md",                // a space
    "TL-87-snake_case.md",                // an underscore
    "TL-87--double-hyphen.md",            // a doubled hyphen
    "TL-87-trailing-.md",                 // a hyphen at the edge
    "TL-87.md",                           // no slug at all
    "tl-87-lowercase-prefix.md",          // the prefix is a value, and it is cased
    "TL-87-slug.md.bak",                  // anchored at the end
    " TL-87-slug.md",                     // anchored at the start
  ]) {
    assert.equal(shape.test(bad), false, "accepted a name it must refuse: " + bad);
  }
  for (const good of ["TL-1-a.md", "TL-87-worktrail-next-atomic-task-assignment-for-an-agent.md"]) {
    assert.equal(shape.test(good), true, "refused a conforming name: " + good);
  }
});

test("POSITIVE CONTROL: the prefix comes from the configuration, not from a literal", () => {
  // A guard that spelled `TL` would keep passing after `migrate-prefix` while
  // judging nothing.
  assert.equal(taskFilenameShape("PROJ").test("PROJ-9-a-slug.md"), true);
  assert.equal(taskFilenameShape("PROJ").test("TL-9-a-slug.md"), false);
  assert.equal(taskFilenameShape("A.B").test("AxB-9-a-slug.md"), false, "the prefix was not escaped");
});

test("the slug `new` generates has the shape — a new task conforms by construction", () => {
  // The migration fixed what is on disk. This is what stops the next `new` from
  // putting a non-conforming name back: `slugify` is the function `new` calls,
  // so the guard and the generator cannot disagree.
  const shape = taskFilenameShape(PREFIX);
  const titles = [
    "Task filenames use English slugs",
    "  Leading and trailing space  ",
    "Punctuation: commas, dots. Slashes/too — and a dash",
    "MiXeD CaSe And 123 Numbers",
    "Ćwiczenie z żółwiem — diacritics folded down to ASCII",
    "Übergrößen, cañón, façade, Straße",
    "A title so long that the generated slug has to be trimmed on a word boundary rather than mid-word",
    "!!! ???",
  ];
  for (const title of titles) {
    const slug = slugify(title);
    if (!slug) continue; // a title of pure punctuation yields nothing; `new` refuses it elsewhere
    assert.ok(slug.length <= SLUG_MAX, "slug over " + SLUG_MAX + " characters: " + slug);
    assert.equal(shape.test(PREFIX + "-1-" + slug + ".md"), true,
      "`new` would create a filename this guard refuses: " + slug + "  (from: " + title + ")");
  }
});

test("POSITIVE CONTROL: a title of pure punctuation produces no slug, and is not silently shaped", () => {
  // The loop above skips an empty slug; this states outright what that case is,
  // so the skip cannot quietly hide a regression that empties every slug.
  assert.equal(slugify("!!! ???"), "");
  assert.equal(slugify(""), "");
});
