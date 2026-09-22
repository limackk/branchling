/**
 * The README badge and the manifest must name ONE repository (TL-158).
 *
 * WHY A TEST AND NOT A DERIVATION. TL-158 asked for the badge's owner and
 * repository to come from the same place as `package.json`, "not typed a second
 * time". A README is static text: the forge renders it from the file as
 * committed and interpolates nothing, and generating it from a template would
 * put the generated copy in git anyway — the same two copies, with a build step
 * added. So the second copy is accepted and its agreement with the first is
 * MEASURED here. That is the honest version of "one source": one of them is the
 * source, and drift from it fails.
 *
 * WHAT DRIFT WOULD LOOK LIKE. The manifest is what npm reads and what
 * `npm publish` refuses to go without (`check-publish-metadata.mjs`); the badge
 * is what a stranger reads first. A repository renamed or moved to another owner
 * updates whichever of the two the person editing happened to think of, and the
 * other keeps pointing at an address that answers 404 — as an image, silently,
 * at the top of the page.
 *
 * WHY IT DOES NOT REQUIRE A BADGE TO EXIST. On 2026-09-22 the run of
 * `.github/workflows/test.yml` for 12bacb6 was RED on all six matrix jobs, so
 * TL-158 did not add the badge: a badge is a published claim, and this wave
 * exists to stop one being published before it holds. The rule this file
 * enforces is conditional on purpose — "whatever badge the README carries names
 * the repository the manifest names" — so it is already in place on the day the
 * badge is added rather than being written afterwards, when the drift it
 * guards against is the reason somebody is reading it.
 *
 * THE FIXTURE CASES ARE NOT DECORATION. Without a badge in the README the tree
 * cases would all pass over an empty sample, which is a green with no
 * evidentiary force (AGENTS.md). The fixtures are the positive control: they
 * show the comparison firing on drift and the parser recognising a badge.
 *
 * WHAT THIS DELIBERATELY DOES NOT CHECK: whether the badge is GREEN. That is a
 * fact about a run on the forge, not about this tree, and no assertion made
 * from a checkout can see it. It belongs to TL-158's verification block, which
 * fetches the SVG the forge serves.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT, isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it.
isolateHome("readme-badge");

const MANIFEST = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
const README = readFileSync(join(REPO_ROOT, "README.md"), "utf8");

/**
 * `owner/repository` out of anything npm accepts in `repository`, `bugs` or
 * `homepage` — a string, a `{type,url}` pair, `git+https://…`, `git+ssh://…`, a
 * trailing `.git`, the `github:` shorthand, a trailing `/issues` or `#readme`.
 * Returns null when the value names no forge path, so that "no answer" and "a
 * wrong answer" stay distinguishable at the call site.
 */
export function slugFromRepositoryField(value) {
  const text = typeof value === "string" ? value : String(value?.url || "");
  const match = /(?:github\.com[/:]|^github:)([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?].*)?$/.exec(text.trim());
  return match ? match[1] + "/" + match[2] : null;
}

/** Every workflow badge in a markdown text, as what it points at. */
export function badgesIn(markdown) {
  const pattern =
    /\[!\[[^\]]*\]\(https:\/\/github\.com\/([^/]+\/[^/]+)\/actions\/workflows\/([^/)]+)\/badge\.svg[^)]*\)\]\(https:\/\/github\.com\/([^/]+\/[^/]+)\/actions\/workflows\/([^)?]+)[^)]*\)/g;
  return [...markdown.matchAll(pattern)].map((m) => ({
    imageSlug: m[1],
    imageWorkflow: m[2],
    linkSlug: m[3],
    linkWorkflow: m[4],
  }));
}

const manifestSlug = slugFromRepositoryField(MANIFEST.repository);
const badges = badgesIn(README);

// ── This tree ─────────────────────────────────────────────────────────────

test("the manifest names a forge repository at all", () => {
  // Everything below compares against this one. With no slug here the
  // comparisons would be against null and could not fail.
  assert.ok(manifestSlug, "package.json `repository` does not resolve to owner/repository");
});

test("every badge in the README names the repository the manifest names", () => {
  for (const badge of badges) {
    assert.equal(badge.imageSlug, manifestSlug, "the badge image names another repository");
    assert.equal(badge.linkSlug, manifestSlug, "the badge link names another repository");
  }
});

test("every badge points at a workflow that exists in this tree", () => {
  for (const badge of badges) {
    const path = join(REPO_ROOT, ".github", "workflows", badge.imageWorkflow);
    assert.ok(existsSync(path), "the badge names " + badge.imageWorkflow + ", which is not in .github/workflows");
    assert.equal(badge.linkWorkflow, badge.imageWorkflow, "the image and the link name different workflows");
  }
});

test("`bugs` and `homepage` point at the same repository as `repository`", () => {
  // Three fields, one fact. The publish gate checks that they are PRESENT;
  // nothing until now checked that they agree with each other, and an npm page
  // whose issue link goes to somebody else's repository is worse than none.
  for (const key of ["bugs", "homepage"]) {
    assert.equal(slugFromRepositoryField(MANIFEST[key]), manifestSlug, key + " names a different repository");
  }
});

// ── The comparison itself, on fixtures ────────────────────────────────────
// The README carries no badge yet, so without these the cases above would pass
// over an empty sample and say nothing at all.

test("POSITIVE CONTROL: drift between a badge and the manifest is detected", () => {
  const drifted = "[![test](https://github.com/someone-else/branchling/actions/workflows/test.yml/badge.svg)]" +
    "(https://github.com/someone-else/branchling/actions/workflows/test.yml)";
  const [badge] = badgesIn(drifted);
  assert.ok(badge, "the fixture badge was not recognised — the pattern is wrong, not the fixture");
  assert.notEqual(badge.imageSlug, manifestSlug);
});

test("POSITIVE CONTROL: the badge the README is going to carry passes", () => {
  // The exact line TL-158 adds once the workflow is green. It is asserted here
  // so that the day it is pasted in is not the day the pattern is found wanting.
  const intended = "[![test](https://github.com/" + manifestSlug + "/actions/workflows/test.yml/badge.svg)]" +
    "(https://github.com/" + manifestSlug + "/actions/workflows/test.yml)";
  const [badge] = badgesIn(intended);
  assert.ok(badge, "the intended badge is not recognised as one");
  assert.equal(badge.imageSlug, manifestSlug);
  assert.equal(badge.linkSlug, manifestSlug);
  assert.equal(badge.imageWorkflow, "test.yml");
  assert.ok(existsSync(join(REPO_ROOT, ".github", "workflows", badge.imageWorkflow)));
});

test("the pattern reads badges, not any markdown link to the forge", () => {
  assert.equal(badgesIn("[branchling](https://github.com/limackk/branchling)").length, 0);
  // An image that is not a link: it renders, but clicking it lands nowhere.
  assert.equal(badgesIn("![test](https://github.com/o/r/actions/workflows/test.yml/badge.svg)").length, 0);
});

test("every shape npm accepts for an address resolves to the same slug", () => {
  for (const value of [
    "git+https://github.com/owner/repo.git",
    "https://github.com/owner/repo",
    "github:owner/repo",
    { type: "git", url: "git+ssh://git@github.com/owner/repo.git" },
    { type: "git", url: "https://github.com/owner/repo.git" },
    // The shapes `bugs` and `homepage` actually take.
    "https://github.com/owner/repo/issues",
    "https://github.com/owner/repo#readme",
  ]) {
    assert.equal(slugFromRepositoryField(value), "owner/repo", JSON.stringify(value));
  }
  assert.equal(slugFromRepositoryField("https://example.invalid/owner/repo"), null);
  assert.equal(slugFromRepositoryField(undefined), null);
});
