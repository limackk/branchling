/**
 * The reserved reason `unknown` means what AGENTS.md says it means (TL-650).
 *
 * THE DEFECT. AGENTS.md described `unknown` as "a change that was observed, not
 * made by the tool", while `normalizeReason()` writes it for EVERY entry without
 * a usable reason — a claim by `next` included. A reader following the
 * documentation took such a claim for an edit made behind the tool's back.
 *
 * THE DECISION. The recording stands and the description moved: `unknown` says
 * that no reason was stated, and the entry's `source` says whether the tool saw
 * the change or made it. The append-only log already holds many command
 * entries with that value; narrowing its meaning now would have made every one
 * of them contradict the documentation instead.
 *
 * WHAT IS PROVED HERE. The command case and the observed case both record
 * `unknown`, told apart by `source`; a stated reason is recorded as given (the
 * positive control, so the first assertion cannot pass on a hard-wired value);
 * and both descriptions carry `REASON_UNKNOWN_MEANING` verbatim: AGENTS.md, and
 * the `config.yaml` that `init` writes into other people's repositories, which
 * is the copy a stranger actually reads.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fixtureDir } from "./_fixture-dir.mjs";
import { REPO_ROOT, isolateHome } from "./_repo.mjs";
import { readHistory, reconcile } from "../history.mjs";
import { REASON_UNKNOWN, REASON_UNKNOWN_MEANING } from "../task-fields.mjs";

isolateHome("unknown-reason-meaning");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

function run(args, env) {
  return spawnSync(process.execPath, [CLI].concat(args), { encoding: "utf8", timeout: 30_000, env });
}

/** A fresh backlog with `count` pending tasks; the state directory is the
 *  fixture's own, so no lock leaks into the developer's. */
function fixture(count) {
  const dir = fixtureDir(join(tmpdir(), "branchling-unknown-reason-"));
  const backlog = join(dir, "bl");
  const env = { ...process.env, BACKLOG_STATE_DIR: join(dir, "state"), NO_COLOR: "1" };
  const init = run(["init", "--dir", backlog, "--no-example"], env);
  assert.equal(init.status, 0, init.stderr);
  const ids = [];
  for (let i = 0; i < count; i++) {
    const r = run(["new", "--dir", backlog, "--title", "Task number " + (i + 1)], env);
    assert.equal(r.status, 0, r.stderr);
    ids.push((r.stdout.match(/([A-Z]+-\d+)/) || [])[1]);
  }
  return { backlog, env, ids };
}

function statusEntry(backlog, id, to) {
  const entry = readHistory(backlog, id).find((e) => e.field === "status" && e.to === to);
  assert.ok(entry, "no status entry into " + to + " for " + id);
  return entry;
}

test("a claim by `next` without --reason records `unknown`, and its source says the tool made it", () => {
  const { backlog, env, ids } = fixture(1);
  const r = run(["next", "--dir", backlog, "--actor", "agent:t"], env);
  assert.equal(r.status, 0, r.stderr);
  const entry = statusEntry(backlog, ids[0], "in_progress");
  assert.equal(entry.reason, REASON_UNKNOWN);
  assert.equal(entry.source, "next");
  assert.equal(entry.actor, "agent:t");
});

test("positive control: a claim with --reason records the sentence, not the sentinel", () => {
  const { backlog, env, ids } = fixture(1);
  const r = run(["next", "--dir", backlog, "--actor", "agent:t", "--reason", "picking up the queue"], env);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(statusEntry(backlog, ids[0], "in_progress").reason, "picking up the queue");
});

test("a change the tool only observed records `unknown` too, under an observing source", () => {
  const { backlog, ids } = fixture(1);
  reconcile(backlog, { actor: "unknown", source: "external" });
  const name = readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(ids[0] + "-"));
  const path = join(backlog, "tasks", name);
  const before = readFileSync(path, "utf8");
  const after = before.replace(/^status:\s*pending/m, "status: in_progress");
  assert.notEqual(after, before, "the fixture's task did not start as pending");
  writeFileSync(path, after, "utf8");
  const { entries } = reconcile(backlog, { actor: "unknown", source: "external" });
  const entry = entries.find((e) => e.field === "status");
  assert.ok(entry, "reconciliation recorded no status change");
  assert.equal(entry.reason, REASON_UNKNOWN);
  assert.equal(entry.source, "external");
});

test("AGENTS.md describes `unknown` in the module's own words", () => {
  const flat = (s) => s.replace(/\s+/g, " ");
  const agents = flat(readFileSync(join(REPO_ROOT, "AGENTS.md"), "utf8"));
  assert.ok(agents.includes("`" + REASON_UNKNOWN + "` (" + flat(REASON_UNKNOWN_MEANING) + ")"),
    "AGENTS.md has fallen behind `REASON_UNKNOWN_MEANING`:\n  " + REASON_UNKNOWN_MEANING);
  // The description the tool's own log contradicted must not come back.
  assert.ok(!agents.includes("a change that was observed, not made by the tool"));
});

test("the config.yaml that `init` writes describes `unknown` in the module's own words", () => {
  const { backlog } = fixture(0);
  const text = readFileSync(join(backlog, "config.yaml"), "utf8");
  // Comment lines are rejoined into prose, so the assertion holds however the
  // sentence is wrapped.
  const prose = text.replace(/^#[ \t]?/gm, "").replace(/\s+/g, " ");
  assert.ok(prose.includes("`" + REASON_UNKNOWN + "` (" + REASON_UNKNOWN_MEANING.replace(/\s+/g, " ") + ")"),
    "the init template has fallen behind `REASON_UNKNOWN_MEANING`:\n  " + REASON_UNKNOWN_MEANING);
  // The old definition, in which observation was the WHOLE meaning.
  assert.ok(!prose.includes("`" + REASON_UNKNOWN + "` (a change the tool observed rather than made)"),
    "the init template still defines `unknown` as an observation only");
});
