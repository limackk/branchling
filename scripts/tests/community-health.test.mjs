/**
 * The repository's public commitments are present and joined up (TL-457).
 *
 * GitHub recognises these top-level filenames as community health files, but a
 * file merely existing is weak evidence: the contributor-facing guide and the
 * issue chooser also have to lead to the right policy. These tests read the
 * actual public files, so an empty fixture cannot make the contract green.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isolateHome, REPO_ROOT } from "./_repo.mjs";

isolateHome("community-health");

const read = (path) => readFileSync(join(REPO_ROOT, path), "utf8");
const security = read("SECURITY.md");
const conduct = read("CODE_OF_CONDUCT.md");
const support = read("SUPPORT.md");
const contributing = read("CONTRIBUTING.md");
const issueConfig = read(".github/ISSUE_TEMPLATE/config.yml");

const PRIVATE_REPORT = "https://github.com/limackk/branchling/security/advisories/new";

test("security policy names maintained lines and a private reporting route", () => {
  assert.match(security, /only the latest published version and the\s+current `main` branch receive security fixes/i);
  assert.match(security, new RegExp(PRIVATE_REPORT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(security, /Do not open a public issue or pull request/i);
  assert.match(security, /does not promise a response, fix or disclosure date/i);
});

test("conduct policy has a bounded scope, named enforcement and a confidential route", () => {
  assert.match(conduct, /issues, pull requests, reviews/i);
  assert.match(conduct, /does not claim authority over\s+unrelated private communication/i);
  assert.match(conduct, /\[@limackk\]\(https:\/\/github\.com\/limackk\).*responsible for enforcement/is);
  assert.match(conduct, /private reporting form/);
  assert.match(conduct, /Conduct:/);
});

test("support policy states the product boundary and evidence-based expectations", () => {
  assert.match(support, /one person working in one clone/i);
  assert.match(support, /does not\s+create a guaranteed response or resolution time/i);
  assert.match(support, /evaluated for fit.*reproducible\s+evidence.*tests.*documentation/is);
  assert.match(support, /Acceptance is not\s+guaranteed/i);
  assert.match(support, /\[security policy\]\(SECURITY\.md\)/);
  assert.match(support, /\[code of conduct\]\(CODE_OF_CONDUCT\.md\)/);
});

test("the contribution guide links every policy instead of copying it", () => {
  for (const path of ["SECURITY.md", "CODE_OF_CONDUCT.md", "SUPPORT.md"]) {
    assert.match(contributing, new RegExp(`\\]\\(${path.replace(".", "\\.")}\\)`), path);
  }
});

test("the GitHub issue chooser exposes private security and support entry points", () => {
  assert.match(issueConfig, new RegExp(PRIVATE_REPORT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(issueConfig, /https:\/\/github\.com\/limackk\/branchling\/blob\/main\/SUPPORT\.md/);
  assert.doesNotMatch(issueConfig, /<[^>]+>|example\.com|TODO/i);
});

test("public policies contain no invented email address or response-time promise", () => {
  const policies = [security, conduct, support].join("\n");
  assert.doesNotMatch(policies, /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/);
  assert.doesNotMatch(policies, /(?:respond|reply|fix|resolve) within \d+|within \d+ (?:business )?(?:hours?|days?|weeks?)/i);
});
