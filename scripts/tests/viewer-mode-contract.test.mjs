/**
 * Snapshot and live viewer claims agree across every public surface (TL-448).
 *
 * The defect was semantic, not a dead link: README called the page read-only,
 * the manual and skill promised field writes, the server advertised those
 * writes at startup, and the routes answered 404. Each sentence was plausible
 * alone. This guard reads the set and requires the two-mode boundary in all of
 * it, including an honest statement about the current implementation stage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isolateHome, REPO_ROOT } from "./_repo.mjs";

isolateHome("viewer-mode-contract");

const read = (path) => readFileSync(join(REPO_ROOT, path), "utf8");

const SOURCES = {
  readme: read("README.md"),
  manual: read("docs/manual.md"),
  brief: read("docs/viewer-redesign-brief.md"),
  skill: read(".agents/skills/branchling-viewer/SKILL.md"),
  server: read("scripts/serve-backlog.mjs"),
};

export function contractProblems(sources) {
  const problems = [];
  const snapshotReaders = ["readme", "manual", "brief", "skill"];
  const liveReaders = ["readme", "manual", "brief", "skill", "server"];

  for (const name of snapshotReaders) {
    if (!/snapshot[^.\n]{0,80}read-only/i.test(sources[name] || "")) {
      problems.push(`${name} does not say that snapshot mode is read-only`);
    }
  }
  for (const name of liveReaders) {
    const text = sources[name] || "";
    if (!/(only\s+(?:viewer\s+)?mode\s+permitted\s+to\s+write|only a served viewer may regain a write path)/i.test(text)) {
      problems.push(`${name} does not reserve writes for served live mode`);
    }
  }
  const publicText = [sources.readme, sources.manual, sources.brief].join("\n");
  if (!/(guarded write API|attributed server API is implemented|short-lived per-process capability)/i.test(publicText)) {
    problems.push("public documentation does not state that the guarded live write API is implemented");
  }
  if (!/Served-page write API enabled; snapshots remain read-only/.test(sources.server || "")) {
    problems.push("serve startup does not state the current write boundary");
  }
  return problems;
}

test("the viewer modes have one contract across docs, skill and terminal", () => {
  assert.deepEqual(contractProblems(SOURCES), []);
});

test("NEGATIVE CONTROL: one old contradictory surface fails the contract", () => {
  const broken = { ...SOURCES, readme: "The browser page is read-only." };
  assert.ok(contractProblems(broken).some((problem) => problem.startsWith("readme ")));
});
