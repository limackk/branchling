/**
 * The README stays a short front door (TL-453).
 *
 * WHY A LENGTH LIMIT AT ALL. TL-153 cut the README below 400 lines, and by
 * 2026-09-26 it had grown back to 1033: every feature added one more paragraph
 * to the first page, and nothing objected. A README is what a stranger reads
 * to decide whether to read anything else, and the npm registry renders it as
 * the package page. The long form now lives in `docs/guide.md` and the
 * reference in `docs/manual.md`, so a paragraph that grows here has somewhere
 * else to go.
 *
 * WHAT IT DOES NOT CLAIM. That the page is clear. Comprehension is a review
 * responsibility; this file only refuses the regressions that can be measured:
 * the length, a repository placeholder, a repository URL that disagrees with
 * the manifest, and the loss of the path to a first successful command.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isolateHome, REPO_ROOT } from "./_repo.mjs";

isolateHome("readme-front-door");

/** Generous enough for a section or two to be added, tight enough that the reference cannot move back. */
export const MAX_README_LINES = 250;

const README = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
const CONTRIBUTING = readFileSync(join(REPO_ROOT, "CONTRIBUTING.md"), "utf8");
const MANIFEST = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));

/** Problems with a front-door text, as sentences; an empty list is a pass. */
export function frontDoorProblems(markdown, { name, repositorySlug }) {
  const problems = [];
  const lines = markdown.split("\n").length;
  if (lines > MAX_README_LINES) problems.push(`the README has ${lines} lines, more than ${MAX_README_LINES}`);
  if (/<repository-url>|<owner>\/|your-org\//i.test(markdown)) problems.push("the README carries a repository placeholder");
  if (!markdown.includes("github.com/" + repositorySlug)) problems.push(`the README never names the repository ${repositorySlug}`);
  const install = markdown.search(/^## Getting it/m);
  if (install === -1) problems.push("the README has no install section");
  else if (!markdown.slice(install).includes("npm install -g " + name)) problems.push("the install section does not install from npm");
  const start = markdown.search(/^## Quick start/m);
  if (start === -1) problems.push("the README has no quick start");
  else if (!/```bash\n[^`]*\binit --dir\b/.test(markdown.slice(start))) problems.push("the quick start does not begin with `init`");
  if (!/\]\(docs\/guide\.md/.test(markdown) || !/\]\(docs\/manual\.md/.test(markdown)) {
    problems.push("the README does not point at the guide and the manual it was shortened into");
  }
  return problems;
}

const slug = String(MANIFEST.repository?.url || MANIFEST.repository || "")
  .replace(/^git\+/, "").replace(/\.git$/, "").replace(/^https:\/\/github\.com\//, "");

test("the README is a short front door that leads to a first success", () => {
  assert.deepEqual(frontDoorProblems(README, { name: MANIFEST.name, repositorySlug: slug }), []);
});

test("the contributor guide carries no repository placeholder either", () => {
  assert.doesNotMatch(CONTRIBUTING, /<repository-url>/);
});

test("positive control: each regression is reported", () => {
  // Without these the test above could pass on a guard that reports nothing.
  const opts = { name: MANIFEST.name, repositorySlug: slug };
  const long = README + "\n".repeat(MAX_README_LINES);
  assert.ok(frontDoorProblems(long, opts).some((p) => p.includes("lines")));
  assert.ok(frontDoorProblems(README + "\ngit clone <repository-url>\n", opts).some((p) => p.includes("placeholder")));
  assert.ok(frontDoorProblems(README.replaceAll("npm install -g", "npm i"), opts).some((p) => p.includes("npm")));
  assert.ok(frontDoorProblems(README.replace("## Quick start", "## Later"), opts).some((p) => p.includes("quick start")));
  assert.ok(frontDoorProblems(README, { ...opts, repositorySlug: "someone/else" }).some((p) => p.includes("someone/else")));
});
