#!/usr/bin/env node
/**
 * Product identity — the name and version, from ONE place (BL-1439).
 *
 * WHY. Before this file the name was written out 47 times across 9 scripts,
 * almost all of it inside help and usage text. That is fine right up to the
 * moment the name changes, and the name HAS changed: the tool was called
 * `tasklog` until 2026-09-01, when it became `worktrail`. Nothing is published
 * yet, so a rename is still cheap — and it must STAY cheap. One constant keeps
 * a rename an edit instead of a sweep.
 *
 * That rename showed the claim was not yet true: most of `scripts/` still spelled
 * the name out in help and error text, so the change was a sweep after all. Since
 * TL-117 the sweep is done and `check-product-name.mjs` fails on a literal in
 * `scripts/` or `bin/`, which is what keeps the claim from decaying again.
 *
 * WHY package.json IS THE SOURCE. The npm package name and the name printed in
 * `--help` are the same fact. Two copies of one fact drift; here the manifest
 * that npm reads is also the manifest the help text reads.
 *
 * WHY VERSION MAY BE null. A missing or unreadable package.json means a broken
 * install, and `--version` must say so rather than invent a number. The NAME
 * falls back, because a cosmetic default in help text is harmless; the VERSION
 * does not, because a made-up version is a lie a user would act on.
 *
 * Tests: `node --test backlog/scripts/tests/packaging.test.mjs`
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where the manifest sits relative to this file — the same when running from
 *  a checkout and when installed under node_modules. */
export const MANIFEST_PATH = join(HERE, "..", "package.json");

function readManifest(path = MANIFEST_PATH) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

const manifest = readManifest();

/** Name used in help, usage and error text. Never a literal elsewhere. */
export const PRODUCT_NAME = (manifest && manifest.name) || "worktrail";

/**
 * The name written INTO other people's files as a marker, frozen on purpose
 * (TL-117).
 *
 * WHY IT IS NOT `PRODUCT_NAME`. `init` surrounds the lines it appends to a
 * user's `.gitignore`/`.gitattributes` with `# >>> <marker>` / `# <<< <marker>`,
 * and a second `init` finds its own block by that text. So the marker is an
 * ON-DISK KEY, not display text: derived from `PRODUCT_NAME` it would change
 * with a rename, and every already-initialised repository would then get a
 * SECOND block instead of an update — in repositories we cannot reach to fix.
 * Display text may change freely; a key that identifies existing data may not.
 *
 * The cost is accepted and small: after a rename the marker keeps the old word.
 * That is a cosmetic surprise inside a comment; a duplicated block is a defect.
 */
export const BLOCK_MARKER_NAME = "worktrail";

/** Version, or null when the manifest is missing/unreadable. Never faked. */
export const PRODUCT_VERSION = (manifest && manifest.version) || null;

/** Exported for tests, so the fallback path can be exercised without moving
 *  the real manifest out of the way. */
export { readManifest };
