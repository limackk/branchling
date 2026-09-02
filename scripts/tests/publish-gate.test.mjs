/**
 * The brake fitted where `"private": true` used to be (TL-48).
 *
 * WHAT THIS GUARDS AGAINST is not a wrong value in a field — it is a version
 * number leaving the machine before the package has an address. That mistake is
 * permanent: npm does not let a published version be reused.
 *
 * TWO HALVES, AND THE SECOND IS THE ONE THAT ROTS. The first half is whether
 * the check says no to a manifest with no URLs. The second is whether anything
 * still CALLS it — a gate wired to nothing passes every test about its own
 * logic while `npm publish` sails straight past. So the wiring is asserted from
 * package.json itself, not assumed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { checkPublishMetadata } from "../check-publish-metadata.mjs";
import { isolateHome, REPO_ROOT } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("publish-gate");


const MANIFEST = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));

const complete = {
  repository: { type: "git", url: "git+https://github.com/owner/worktrail.git" },
  bugs: { url: "https://github.com/owner/worktrail/issues" },
  homepage: "https://github.com/owner/worktrail#readme",
};

const names = (r) => r.missing.map(([k]) => k);

// ── What the check answers ────────────────────────────────────────────────

test("a manifest with all three addresses passes", () => {
  assert.equal(checkPublishMetadata(complete).ok, true);
});

test("each missing field is reported BY NAME — 'incomplete' is not an answer", () => {
  for (const key of ["repository", "bugs", "homepage"]) {
    const m = { ...complete };
    delete m[key];
    const r = checkPublishMetadata(m);
    assert.equal(r.ok, false, `${key} missing and the gate let it through`);
    assert.deepEqual(names(r), [key]);
  }
});

test("a field that is present but empty is not an answer either", () => {
  assert.deepEqual(names(checkPublishMetadata({ ...complete, homepage: "   " })), ["homepage"]);
  assert.deepEqual(names(checkPublishMetadata({ ...complete, bugs: { url: "" } })), ["bugs"]);
});

test("a placeholder does not get past the gate", () => {
  // The failure mode this exists for: filling the fields in to make the error
  // go away. A gate that accepts `example.com` teaches exactly that.
  assert.deepEqual(names(checkPublishMetadata({ ...complete, homepage: "https://example.com" })), ["homepage"]);
  assert.deepEqual(names(checkPublishMetadata({ ...complete, homepage: "<your repo>" })), ["homepage"]);
  assert.deepEqual(names(checkPublishMetadata({ ...complete, bugs: { url: "TODO" } })), ["bugs"]);
});

test("repository is accepted both as a string and as {type,url}", () => {
  assert.equal(checkPublishMetadata({ ...complete, repository: "github:owner/worktrail" }).ok, true);
});

// ── Whether anything calls it ─────────────────────────────────────────────

test("package.json wires the gate to prepublishOnly, not to prepublish", () => {
  const scripts = MANIFEST.scripts || {};
  assert.match(String(scripts.prepublishOnly || ""), /check-publish-metadata\.mjs/,
    "the gate is not wired to `npm publish` — it protects nothing");
  assert.equal(scripts.prepublish, undefined,
    "`prepublish` also fires on a plain `npm install`, which would break setting up a working tree");
});

test("the gate itself does not ship — it is the publisher's tool, not the installer's", () => {
  assert.ok(MANIFEST.files.includes("!scripts/check-publish-metadata.mjs"),
    "the gate would travel to every install for no reason");
});

test("POSITIVE CONTROL: on THIS repository, today, the gate says no", () => {
  // The whole point is that publishing is blocked right now. If this ever
  // passes, either TL-48 was finished — in which case delete this assertion
  // and say so in its log — or the gate stopped looking at anything.
  const r = checkPublishMetadata(MANIFEST);
  assert.equal(r.ok, false, "publishing is no longer blocked; was TL-48 closed?");
  assert.deepEqual(names(r).sort(), ["bugs", "homepage", "repository"]);
});
