/**
 * The contract audit, as a rule and as a claim about THIS tree (TL-233).
 *
 * The audit itself is `scripts/check-backlog-contracts.mjs` — since TL-234 it is
 * a guard `check` runs, not an assertion, and the reasoning for every line of it
 * lives in that module's header. This file is its second caller: the fixtures
 * below pin the RULE, and the two cases at the bottom pin its EFFECT on this
 * repository, which no fixture can state.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  auditOpenContracts,
  foreignInvocations,
  subcommands,
} from "../check-backlog-contracts.mjs";
import { loadConfig } from "../config.mjs";
import { parseVerification } from "../criteria.mjs";
import { PRODUCT_NAME } from "../product.mjs";
import { readTaskRecords } from "../task-select.mjs";
import { CHECK_GUARDS, parseCheckArgs } from "../cli.mjs";
import { BACKLOG_DIR, SCRIPTS_DIR, TASKS_DIR, isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("contract-product-name");

// ── the rule, on fixtures ─────────────────────────────────────────────────

test("POSITIVE CONTROL: a contract naming another binary is a finding", () => {
  // Without this the audit below would be satisfied by a pattern that matches
  // nothing at all, which reads exactly like a clean tree.
  const stale = { manual: "With a page open from `oldname serve`: running `oldname take <ID>`" };
  const found = foreignInvocations(stale);
  assert.deepEqual(found.map((f) => f.name), ["oldname", "oldname"]);
  assert.deepEqual(found.map((f) => f.sub), ["serve", "take"]);

  const bash = { bash: `oldname query --status blocked` };
  assert.equal(foreignInvocations(bash).length, 1);
});

test("the product's own name, however it is invoked, is not a finding", () => {
  const entries = [
    { manual: `In a fresh shell: \`${PRODUCT_NAME} query --status <TAB>\` suggests statuses` },
    { bash: `${PRODUCT_NAME} build && ${PRODUCT_NAME} check` },
    { bash: `! ${PRODUCT_NAME} done TL-1` },
    { bash: `BACKLOG_DIR=/tmp/x ${PRODUCT_NAME} stats` },
    { bash: "node scripts/cli.mjs done TL-1" },
  ];
  for (const e of entries) assert.deepEqual(foreignInvocations(e), [], JSON.stringify(e));
});

test("prose is not an invocation, and neither is another program's verb", () => {
  // The words `build`, `run` and `init` are this tool's subcommands AND ordinary
  // English AND other programs' subcommands. A guard that could not tell them
  // apart would be unusable in exactly the entries it exists for.
  const prose = { manual: "The views are rebuilt, and the loop is asked to run before the next take" };
  assert.deepEqual(foreignInvocations(prose), []);
  assert.deepEqual(foreignInvocations({ bash: "git init && npm run build" }), []);
  assert.deepEqual(foreignInvocations({ bash: "echo 'query returned nothing'" }), []);
});

// ── the effect, on this repository ────────────────────────────────────────

test("no OPEN task asks anybody to run a command that is not this tool", () => {
  const { findings, entriesChecked, tasksChecked } = auditOpenContracts(BACKLOG_DIR, TASKS_DIR);
  assert.deepEqual(
    findings,
    [],
    "a contract still names a binary that does not exist:\n" +
      findings.map((f) => `  ${f.task} (${f.kind}): ${f.name} ${f.sub}`).join("\n")
  );
  // The counts are the positive control for the WALK: zero entries read would
  // be a green run over an empty sample.
  assert.ok(tasksChecked > 0, "no open task was read at all");
  assert.ok(entriesChecked > 0, "no open task carries a verification entry — the walk read nothing");
});

test("a CLOSED task's contract is left alone, and this is deliberate", () => {
  // Not a wish: the audit above must be scoped, and the way to show it is that
  // the same pattern still finds something in the archive. If this ever comes
  // back empty, either the archive was rewritten — which is the falsification
  // this scope exists to prevent — or the scope stopped mattering.
  const config = loadConfig(BACKLOG_DIR);
  const archived = new Set(config.archivedStatuses || []);
  const verbs = subcommands();
  let inArchive = 0;
  for (const record of readTaskRecords(TASKS_DIR, config.taskId.file)) {
    if (!archived.has(record.status)) continue;
    const file = join(TASKS_DIR, String(record.file).replace(/^tasks\//, ""));
    const frontmatter = (readFileSync(file, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || "";
    for (const entry of parseVerification(frontmatter).entries) {
      inArchive += foreignInvocations(entry, PRODUCT_NAME, verbs).length;
    }
  }
  assert.ok(inArchive > 0, "the archive holds no such contract — the scope of the audit is untested");
});

// ── the guard, as `check` runs it (TL-234) ────────────────────────────────

/** A backlog of this tool's own making, holding one task to judge. */
function fixture(label) {
  const root = mkdtempSync(join(tmpdir(), "branchling-" + label + "-"));
  const backlog = join(root, "backlog");
  const made = spawnSync(process.execPath, [join(SCRIPTS_DIR, "cli.mjs"), "init", "--dir", backlog, "--no-example"],
    { cwd: root, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  assert.equal(made.status, 0, made.stdout + made.stderr);
  return { root, backlog };
}

const guard = (backlog) =>
  spawnSync(process.execPath, [join(SCRIPTS_DIR, "check-backlog-contracts.mjs"), "--dir", backlog],
    { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });

/** One task, with the contract the caller wants judged. */
function withContract(backlog, entry) {
  const made = spawnSync(process.execPath, [join(SCRIPTS_DIR, "cli.mjs"), "new", "--dir", backlog, "--title", "A judged contract"],
    { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  assert.equal(made.status, 0, made.stdout + made.stderr);
  const id = made.stdout.match(/[A-Z]+-\d+/)[0];
  const name = readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-"));
  const file = join(backlog, "tasks", name);
  const raw = readFileSync(file, "utf8");
  writeFileSync(file, raw.replace(/^verification:.*$/m, "verification:\n  - id: judged\n    " + entry), "utf8");
  return id;
}

test("POSITIVE CONTROL: the GUARD exits 1 on a contract naming a foreign command", () => {
  // The audit's own positive control is a pure call; this one is the guard as a
  // person meets it. Without it, registering the wrong script in the table — or
  // one that can no longer fail — would leave every case above green.
  const fx = fixture("contracts-red");
  const id = withContract(fx.backlog, 'manual: "Run `oldname take <ID>` and see the claim"');
  const r = guard(fx.backlog);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, new RegExp(id + " \\(manual\\): `oldname take`"));
  rmSync(fx.root, { recursive: true, force: true });
});

test("the guard says how many entries it read, and says when it read none", () => {
  // A ✓ over zero entries and a ✓ over ninety are the same line unless the guard
  // states its sample — the rule CLAUDE.md puts on any guard that can pass over
  // an empty tree.
  const fx = fixture("contracts-green");
  const empty = guard(fx.backlog);
  assert.equal(empty.status, 0, empty.stdout + empty.stderr);
  assert.match(empty.stdout, /nothing was examined/);

  withContract(fx.backlog, 'bash: "' + PRODUCT_NAME + ' check --refs"');
  const one = guard(fx.backlog);
  assert.equal(one.status, 0, one.stdout + one.stderr);
  const counted = one.stdout.match(/(\d+) verification entr\(ies\) across 1 open task\(s\)/);
  assert.ok(counted, one.stdout);
  // The NUMBER is the template's business, not this test's; what has to hold is
  // that the count is the guard's own sample and is no longer zero.
  assert.ok(Number(counted[1]) >= 1, one.stdout);
  rmSync(fx.root, { recursive: true, force: true });
});

test("the guard is registered, so a bare `check` runs it and names it", () => {
  // The whole point of TL-234: the audit answers when a person asks whether the
  // backlog is sound, not only when a developer runs the suite.
  const plan = parseCheckArgs([]);
  const contracts = CHECK_GUARDS.find((g) => g.name === "contracts");
  assert.ok(contracts, "no `contracts` guard in the table");
  assert.equal(plan[contracts.want], true, "`contracts` is not in the default run");
  assert.equal(contracts.severity, "gate");
  // It judges the backlog it is POINTED AT, not this installation's source.
  assert.equal(contracts.installationOnly, undefined);
  assert.deepEqual(contracts.args("/somewhere"), ["--dir", "/somewhere"]);
  assert.equal(parseCheckArgs(["--contracts"]).wantContracts, true);
  assert.equal(parseCheckArgs(["--contracts"]).wantIds, false, "asking for one guard ran them all");
});
