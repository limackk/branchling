/**
 * The version in package.json has its notes, and the notes install that
 * version (TL-455).
 *
 * The release workflow publishes `docs/releases/v<version>.md` as the GitHub
 * release body and refuses a tag without it — but a refusal at tag time is the
 * most expensive moment to learn the file is missing. This test moves the
 * failure to the commit that bumps the version, so the bump and its notes
 * travel together.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT, isolateHome } from "./_repo.mjs";

isolateHome("release-notes");

const RELEASES = join(REPO_ROOT, "docs", "releases");
const VERSION_FILE = /^v(\d+\.\d+\.\d+)\.md$/;

test("the manifest's version has a notes file that installs exactly that version", () => {
  const { name, version } = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  const file = join(RELEASES, "v" + version + ".md");
  assert.ok(existsSync(file), "docs/releases/v" + version + ".md is missing for the version in package.json");
  const notes = readFileSync(file, "utf8");
  assert.ok(notes.includes(name + "@" + version),
    "the notes for " + version + " do not install " + name + "@" + version);
  for (const heading of ["## Install or upgrade", "## Changes", "## Upgrade notes", "## Provenance"]) {
    assert.ok(notes.includes(heading), "the notes for " + version + " have no `" + heading + "` section");
  }
});

// Only the CURRENT version is held to a pinned install command. The 0.1.0 notes
// install the unpinned name; they are the published body of that release, and
// correcting them now would make the record say something it never said.
test("every notes file names the version its file name carries", () => {
  const files = readdirSync(RELEASES).filter((f) => VERSION_FILE.test(f));
  // Positive control: two releases exist before this test did, so an empty
  // directory or a pattern that matches nothing is a broken test, not a pass.
  assert.ok(files.length >= 2, "no versioned notes found under docs/releases");
  for (const f of files) {
    const version = f.match(VERSION_FILE)[1];
    assert.ok(readFileSync(join(RELEASES, f), "utf8").includes(version), f + " never names " + version);
  }
});

test("the release workflow publishes from a tag with provenance and checks the version", () => {
  const workflow = readFileSync(join(REPO_ROOT, ".github", "workflows", "release.yml"), "utf8");
  assert.match(workflow, /tags: \["v\*"\]/, "the workflow is not triggered by a version tag");
  assert.match(workflow, /id-token: write/, "without id-token the registry cannot attest provenance");
  assert.match(workflow, /npm publish --provenance/, "the workflow publishes without provenance");
  assert.match(workflow, /does not match package\.json version/, "the workflow does not compare the tag with the manifest");
});

// v0.2.0 failed twice at `npm publish` with E403 while both files described
// the credential as an organization's automation token: a kind npm no longer
// issues, for an owner the package does not have (TL-499).
test("the release document names the token that publishes and how to recover", () => {
  const releasing = readFileSync(join(REPO_ROOT, "docs", "releasing.md"), "utf8");
  const workflow = readFileSync(join(REPO_ROOT, ".github", "workflows", "release.yml"), "utf8");
  for (const [name, text] of [["docs/releasing.md", releasing], ["release.yml", workflow]]) {
    assert.doesNotMatch(text, /automation[\s#]+token/i, name + " still calls the credential an automation token");
  }
  assert.match(releasing, /granular access token/, "the document does not name the kind of token");
  assert.match(releasing, /bypasses two-factor authentication/, "the document omits the two-factor bypass");
  assert.match(releasing, /403 Forbidden/, "the document does not show what a refused token looks like");
  assert.match(releasing, /gh run rerun <run-id> --failed/, "the document does not say a failed publish is rerun, not retagged");
});
