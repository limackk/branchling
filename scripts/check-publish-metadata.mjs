#!/usr/bin/env node
/**
 * The gate that stands where `"private": true` used to stand (TL-48).
 *
 * WHY IT EXISTS. `"private": true` was never a statement about privacy — it was
 * a brake. TL-33 chose it deliberately so that a package with no licence and
 * no metadata could not leave by accident. TL-48 had to remove it, because a
 * private manifest is exactly what `npm publish` refuses. Removing a brake
 * without fitting another one leaves the tree one mistyped command away from a
 * permanent mistake: a version number on the public registry cannot be reused,
 * and an npm page with no repository, no issue tracker and no homepage is the
 * last screen a developer reads before deciding whether to try the tool.
 *
 * WHY IT CHECKS THE URLS AND NOT EVERYTHING. This is a brake, not a review. The
 * full pre-publication checklist is a human procedure — see
 * `.agents/skills/branchling-release/SKILL.md` (product-name: allow) — and a script pretending to be that
 * checklist would be worse than none, because a green run would read as "the
 * package is ready". It answers one question: does the npm page have an address
 * to point at. Add a check by adding an entry to REQUIRED, not by widening the
 * promise this file makes.
 *
 * WHY `prepublishOnly` AND NOT `prepublish`. `prepublishOnly` runs on
 * `npm publish` and nowhere else. `prepublish` also fires on a plain
 * `npm install`, which would make a working tree fail to set up over a field
 * that only matters when publishing.
 *
 * Tests: `node --test scripts/tests/publish-gate.test.mjs`
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fail, ok } from "./ui.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Each field, and what it is FOR — the message has to say why it is wanted,
 *  or the reader fills it in with a placeholder to get past the gate. */
const REQUIRED = [
  ["repository", "where the source is — npm links the page to it"],
  ["bugs", "where a user reports a problem"],
  ["homepage", "what the package page links to as the project"],
];

/** A value that is present but empty, or a placeholder, is not an answer. */
function missingFrom(manifest) {
  const missing = [];
  for (const [key, why] of REQUIRED) {
    const value = manifest[key];
    const text =
      typeof value === "string" ? value
        : value && typeof value === "object" ? String(value.url || value.type || "")
          : "";
    if (!text.trim() || /example\.com|<|TODO/i.test(text)) missing.push([key, why]);
  }
  return missing;
}

export function checkPublishMetadata(manifest) {
  const missing = missingFrom(manifest);
  return { ok: missing.length === 0, missing };
}

function main(manifestPath = join(HERE, "..", "package.json")) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    return fail("npm publish", "cannot read the manifest: " + manifestPath,
      [String(e.message)], ["node scripts/check-publish-metadata.mjs"]);
  }

  const result = checkPublishMetadata(manifest);
  if (result.ok) {
    console.log(ok("publish gate: repository, bugs and homepage are all set"));
    return 0;
  }

  return fail(
    "npm publish",
    "the package has no address, so its npm page would be a blank box",
    [
      "missing in package.json:",
      ...result.missing.map(([key, why]) => `  ${key} — ${why}`),
      "",
      "A published version number cannot be reused, so this is checked before,",
      "not after. TL-48 carries the remaining work.",
    ],
    ["node scripts/cli.mjs query --text TL-48"],
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
