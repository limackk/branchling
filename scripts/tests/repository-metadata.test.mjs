/**
 * The npm manifest and public repository card are two entrances to the same
 * product. This file keeps the versioned half specific enough that a release
 * cannot quietly fall back to a project name or a generic Markdown backlog.
 * The external GitHub values remain an owner-reviewed setting; their checklist
 * lives in docs/repository-metadata.md.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isolateHome, REPO_ROOT } from "./_repo.mjs";

isolateHome("repository-metadata");

const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
const expectedDescription =
  "Git-native task execution for people and coding agents with verification-gated closure.";
const expectedRepository = "https://github.com/limackk/branchling";
const requiredKeywords = [
  "git",
  "markdown",
  "task-management",
  "coding-agents",
  "cli",
  "verification",
];

function publicRepositoryUrl(repository) {
  const raw = typeof repository === "string" ? repository : repository?.url;
  return String(raw || "")
    .replace(/^git\+/, "")
    .replace(/\.git$/, "");
}

test("the package description states the product's distinguishing contract", () => {
  assert.equal(manifest.description, expectedDescription);
});

test("the package carries focused vocabulary for its intended users", () => {
  assert.ok(Array.isArray(manifest.keywords));
  assert.equal(new Set(manifest.keywords).size, manifest.keywords.length,
    "npm keywords must not contain duplicates");
  assert.ok(manifest.keywords.length <= 10,
    "a focused keyword set must not become search-engine stuffing");

  for (const keyword of requiredKeywords) {
    assert.ok(manifest.keywords.includes(keyword), `missing npm keyword: ${keyword}`);
  }
});

test("repository, issues and homepage resolve to one canonical public project", () => {
  assert.equal(publicRepositoryUrl(manifest.repository), expectedRepository);
  assert.equal(manifest.bugs, `${expectedRepository}/issues`);
  assert.equal(manifest.homepage, `${expectedRepository}#readme`);
  assert.equal(manifest.license, "MIT");
});

test("the external-settings checklist carries the exact public metadata", () => {
  const checklist = readFileSync(
    join(REPO_ROOT, "docs", "repository-metadata.md"),
    "utf8",
  );

  assert.match(checklist, new RegExp(expectedDescription.replaceAll("-", "[-]")));
  assert.match(checklist, /Homepage:\s+`https:\/\/github\.com\/limackk\/branchling#readme`/);
  for (const topic of requiredKeywords) {
    assert.match(checklist, new RegExp(`\\b${topic.replaceAll("-", "[-]")}\\b`));
  }
  assert.match(checklist, /signed out/i);
  assert.match(checklist, /social preview/i);
});
