/**
 * Acceptance criteria linked to the verification that proves them (TL-86).
 *
 * The defect: a task carried two lists about the same "done" — the criteria in
 * prose and the commands in `verification:` — with no defined relation. Only
 * one of them was ever run, so the other rotted: 12 of 44 closed tasks in this
 * backlog left 60 criteria unticked beside a green, real verification.
 *
 * The test that carries the most weight here is the REORDERING one. A link
 * keyed on the position of a list item would pass every other assertion in this
 * file and break silently the first time somebody inserted a criterion in the
 * middle — which is the failure this mechanism exists to be immune to.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("criteria-mapping");

import { applyProofs, auditTask, parseCriteria, parseVerification } from "../criteria.mjs";

const GUARD = join(SCRIPTS_DIR, "check-backlog-criteria.mjs");
const CLI = join(SCRIPTS_DIR, "cli.mjs");

/** A whole task file. `verification` and `criteria` are given as raw lines, so a
 *  test can write a malformed one on purpose. */
function taskFile({ id = "BL-100", status = "pending", verification = [], criteria = null }) {
  const head = [
    "---",
    `id: ${id}`,
    'title: "T"',
    "type: code",
    "labels: []",
    "board: main",
    'epic: ""',
    "priority: P1",
    `status: ${status}`,
    "owner: unassigned",
    "estimate: 2h",
    "confidence: high",
    "created: 2026-08-01",
    "updated: 2026-08-01",
    "blocked_by: []",
    "blocks: []",
    "verification:",
    ...verification,
    "---",
    "",
    "## Goal",
    "",
    "x",
    "",
  ];
  if (criteria === null) return head.join("\n");
  return head.concat(["## Acceptance criteria", "", ...criteria, ""]).join("\n");
}

function split(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  return { frontmatter: m[1], body: m[2] };
}

function audit(raw, policy) {
  return auditTask({ ...split(raw), policy });
}

function sandbox(files, config = "") {
  const dir = mkdtempSync(join(tmpdir(), "branchling-criteria-"));
  mkdirSync(join(dir, "tasks"));
  writeFileSync(join(dir, "_template.md"), "---\nid: BL-NNN\n---\n", "utf8");
  writeFileSync(join(dir, "boards.yaml"), 'default: main\nboards:\n  - slug: main\n    name: "Main"\n', "utf8");
  writeFileSync(join(dir, "config.yaml"), 'task_id_prefix: "BL"\n' + config, "utf8");
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, "tasks", name), content, "utf8");
  }
  return dir;
}

function withSandbox(files, fn, config) {
  const dir = sandbox(files, config);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runGuard(args) {
  const r = spawnSync(process.execPath, [GUARD, ...args], { encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

// ──────────────────────────────────────────────────────────────────────────
// Decision 1: the link survives the list being reordered
// ──────────────────────────────────────────────────────────────────────────

test("reordering the criteria does NOT change which proof each one names", () => {
  const verification = ['  - id: alpha', '    bash: "true"', "  - id: beta", '    bash: "true"'];
  const first = taskFile({
    verification,
    criteria: ["- [ ] A. [proof: alpha]", "- [ ] B. [proof: beta]"],
  });
  const reordered = taskFile({
    verification,
    // Reversed AND with a new criterion wedged in the middle — the two edits that
    // shift every position below them.
    criteria: ["- [ ] B. [proof: beta]", "- [ ] C. [proof: alpha]", "- [ ] A. [proof: alpha]"],
  });

  const before = parseCriteria(split(first).body).items;
  const after = parseCriteria(split(reordered).body).items;
  const link = (items) => Object.fromEntries(items.map((i) => [i.text, i.proofs.join(",")]));

  assert.deepEqual(link(before), { "A.": "alpha", "B.": "beta" });
  assert.deepEqual(link(after), { "A.": "alpha", "B.": "beta", "C.": "alpha" });
  assert.equal(audit(reordered, "require").errors.length, 0, "reordering broke the links");
});

test("a proof naming no verification entry FAILS under every policy", () => {
  const raw = taskFile({
    verification: ['  - id: alpha', '    bash: "true"'],
    criteria: ["- [ ] A. [proof: typo]"],
  });
  for (const policy of ["off", "warn", "require"]) {
    // `off` silences the MISSING-link rules, so under that policy this is the
    // only message there can be — which is the point: a broken link is not a
    // migration matter, it can only have been written by someone already using
    // the mechanism.
    const { errors } = audit(raw, policy);
    assert.ok(
      errors.some((e) => /`\[proof: typo\]` names no/.test(e)),
      `a broken link passed under \`${policy}\`: ` + JSON.stringify(errors)
    );
  }
  assert.equal(audit(raw, "off").errors.length, 1, "`off` reported more than the broken link");
});

test("two entries with the same id FAIL — the reference would be ambiguous", () => {
  const { problems } = parseVerification(
    ["verification:", "  - id: alpha", '    bash: "true"', "  - id: alpha", '    bash: "false"'].join("\n")
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /duplicate/);
});

test("an unknown key inside a verification entry FAILS, like everywhere else in this tool", () => {
  const { problems } = parseVerification(["verification:", '  - bash: "true"', '    proof: "yes"'].join("\n"));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /unknown key `proof`/);
});

test("`manual:` is a verification entry too — it can be named by a criterion", () => {
  const raw = taskFile({
    verification: ["  - id: eyeballed", '    manual: "someone looked at the rendered page"'],
    criteria: ["- [ ] The page renders. [proof: eyeballed]"],
  });
  assert.deepEqual(audit(raw, "require").errors, []);
});

// ──────────────────────────────────────────────────────────────────────────
// Decision 3: a guard green on an empty sample is green with no force
// ──────────────────────────────────────────────────────────────────────────

test("an EMPTY criteria list does not pass — anything proves nothing", () => {
  const raw = taskFile({ verification: ['  - bash: "true"'], criteria: [] });
  assert.equal(audit(raw, "require").errors.length, 1);
  assert.match(audit(raw, "require").errors[0], /empty/);
});

test("a MISSING criteria section does not pass either, and says so differently", () => {
  const raw = taskFile({ verification: ['  - bash: "true"'], criteria: null });
  const { errors } = audit(raw, "require");
  assert.equal(errors.length, 1);
  assert.match(errors[0], /no `## Acceptance criteria`/);
});

test("a criterion with no proof, and an entry proving nothing, are both reported", () => {
  const raw = taskFile({
    verification: ["  - id: orphan", '    bash: "true"'],
    criteria: ["- [ ] A."],
  });
  const { errors } = audit(raw, "require");
  assert.equal(errors.length, 2);
  assert.ok(errors.some((e) => /criterion with no proof/.test(e)));
  assert.ok(errors.some((e) => /`orphan` proves no criterion/.test(e)));
});

// ──────────────────────────────────────────────────────────────────────────
// Decision 2: the migration path
// ──────────────────────────────────────────────────────────────────────────

test("a task with no links WARNS under `warn` and FAILS under `require`", () => {
  const raw = taskFile({ verification: ['  - bash: "true"'], criteria: ["- [ ] A."] });

  const warned = audit(raw, "warn");
  assert.deepEqual(warned.errors, [], "`warn` must keep an unlinked task closable");
  assert.equal(warned.warnings.length, 1);

  const required = audit(raw, "require");
  assert.equal(required.errors.length, 1);
  assert.deepEqual(required.warnings, []);

  assert.deepEqual(audit(raw, "off").warnings, [], "`off` must say nothing at all");
});

test("the default policy leaves a legacy backlog GREEN, and says how many are unlinked", () => {
  withSandbox({ "BL-100-x.md": taskFile({ verification: ['  - bash: "true"'], criteria: ["- [ ] A."] }) }, (dir) => {
    const r = runGuard(["--dir", dir]);
    assert.equal(r.code, 0, "the default policy made an old task fail: " + r.out);
    assert.match(r.out, /not linked yet/);
  });
});

test("`criteria_links: require` in config.yaml turns the same tree red", () => {
  withSandbox(
    { "BL-100-x.md": taskFile({ verification: ['  - bash: "true"'], criteria: ["- [ ] A."] }) },
    (dir) => {
      const r = runGuard(["--dir", dir]);
      assert.notEqual(r.code, 0, "`require` did not fail on an unlinked task: " + r.out);
    },
    'criteria_links: "require"\n'
  );
});

test("a closed task is NOT judged — its criteria are history nobody may edit", () => {
  withSandbox(
    { "BL-100-x.md": taskFile({ status: "done", verification: ['  - bash: "true"'], criteria: ["- [ ] A."] }) },
    (dir) => {
      const r = runGuard(["--dir", dir]);
      assert.equal(r.code, 0, "a closed task was judged: " + r.out);
      assert.doesNotMatch(r.out, /BL-100/);
    },
    'criteria_links: "require"\n'
  );
});

test("the guard counts the links it verified — a ✓ over zero is not evidence", () => {
  withSandbox(
    {
      "BL-100-x.md": taskFile({
        verification: ["  - id: alpha", '    bash: "true"'],
        criteria: ["- [ ] A. [proof: alpha]"],
      }),
    },
    (dir) => {
      const r = runGuard(["--dir", dir]);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /1 criterion→verification link/, "the ✓ does not say what it checked");
    },
    'criteria_links: "require"\n'
  );
});

test("`check --criteria` is reachable from the CLI and an unknown selector still fails", () => {
  withSandbox(
    {
      "BL-100-x.md": taskFile({
        verification: ["  - id: alpha", '    bash: "true"'],
        criteria: ["- [ ] A. [proof: alpha]"],
      }),
    },
    (dir) => {
      const ok = spawnSync(process.execPath, [CLI, "check", "--criteria", "--dir", dir], { encoding: "utf8" });
      assert.equal(ok.status, 0, ok.stdout + ok.stderr);
      assert.match(ok.stdout + ok.stderr, /criterion→verification/);

      const typo = spawnSync(process.execPath, [CLI, "check", "--criteri", "--dir", dir], { encoding: "utf8" });
      assert.equal(typo.status, 2, "a mistyped selector did not fail");
    }
  );
});

// ──────────────────────────────────────────────────────────────────────────
// Decision 4: the tick is a record of a run, and is written once
// ──────────────────────────────────────────────────────────────────────────

test("a green run ticks exactly the criteria it proves, and is idempotent", () => {
  const raw = taskFile({
    verification: ["  - id: alpha", '    bash: "true"', "  - id: beta", '    bash: "true"'],
    criteria: ["- [ ] A. [proof: alpha]", "- [ ] B. [proof: beta]", "- [ ] C."],
  });

  const once = applyProofs(raw, ["alpha"]);
  assert.deepEqual(once.ticked, ["A."]);
  assert.match(once.text, /- \[x\] A\. \[proof: alpha\]/);
  assert.match(once.text, /- \[ \] B\./, "a criterion whose proof did not run was ticked");
  assert.match(once.text, /- \[ \] C\./, "a criterion with no proof was ticked");

  const twice = applyProofs(once.text, ["alpha"]);
  assert.deepEqual(twice.ticked, [], "the second run reported a tick it did not make");
  assert.equal(twice.text, once.text, "the second run changed the file");
});

test("a criterion naming TWO proofs is ticked only when both passed", () => {
  const raw = taskFile({
    verification: ["  - id: alpha", '    bash: "true"', "  - id: beta", '    bash: "true"'],
    criteria: ["- [ ] A. [proof: alpha, beta]"],
  });
  assert.deepEqual(applyProofs(raw, ["alpha"]).ticked, [], "half a proof ticked a criterion");
  assert.deepEqual(applyProofs(raw, ["alpha", "beta"]).ticked, ["A."]);
});

test("ticking touches the body only — the frontmatter comes back byte for byte", () => {
  const raw = taskFile({
    verification: ["  - id: alpha", '    bash: "true"'],
    criteria: ["- [ ] A. [proof: alpha]"],
  });
  const out = applyProofs(raw, ["alpha"]).text;
  const head = (s) => s.slice(0, s.indexOf("\n---\n", 3));
  assert.equal(head(out), head(raw));
  assert.equal(out.split("\n").length, raw.split("\n").length, "ticking changed the line count");
});

test("a tick is never taken back — a red run does not un-happen a green one", () => {
  const raw = taskFile({
    verification: ["  - id: alpha", '    bash: "true"'],
    criteria: ["- [x] A. [proof: alpha]"],
  });
  const out = applyProofs(raw, []);
  assert.match(out.text, /- \[x\] A\./);
  assert.deepEqual(out.ticked, []);
});

// ──────────────────────────────────────────────────────────────────────────
// Positive control on the real tree
// ──────────────────────────────────────────────────────────────────────────

test("this repository's own template demonstrates a link, not just describes it", () => {
  const raw = readFileSync(join(SCRIPTS_DIR, "..", "_template.md"), "utf8");
  const { entries } = parseVerification(split(raw).frontmatter);
  const { items } = parseCriteria(split(raw).body);
  const ids = new Set(entries.map((e) => e.id).filter(Boolean));
  assert.ok(ids.size > 0, "_template.md shows no `id:` on a verification entry");
  assert.ok(items.length > 0, "_template.md has no acceptance criteria to link");
  for (const item of items) {
    assert.ok(item.proofs.length, `the template criterion "${item.text}" names no proof`);
    for (const p of item.proofs) assert.ok(ids.has(p), `the template names a proof \`${p}\` it does not define`);
  }
});

// ── A criterion that wraps onto a second line (TL-118) ────────────────────
//
// Wrapping at eighty columns is the NORM in this format, and the one-line
// reader that used to stand in `parseCriteria` saw only the first line: the
// rest of the sentence vanished from every report and the `[proof:]` at the end
// of the last line vanished with it. Measured on this repository the moment the
// fix landed: 15 links appeared that had been written all along, and four tasks
// stopped being reported as unlinked. `check --criteria` was stating an untruth
// about correctly written tasks — under `criteria_links: require` it would have
// FAILED them, and a guard that fails on correct data is a guard people
// switch off.

const wrapped = [
  "## Acceptance criteria",
  "",
  "- [ ] The first half of a sentence and",
  "      the second half of it. [proof: suite]",
  "- [ ] A criterion on three lines that goes",
  "      on, and on,",
  "      and finally ends. [proof: suite]",
  "- [ ] One that wraps and names",
  "      no proof at all.",
  "",
].join("\n");

test("a wrapped criterion is read WHOLE, proof and all", () => {
  const { items } = parseCriteria(wrapped);
  assert.equal(items.length, 3);
  assert.equal(items[0].text, "The first half of a sentence and the second half of it.");
  assert.deepEqual(items[0].proofs, ["suite"]);
  assert.equal(items[1].text, "A criterion on three lines that goes on, and on, and finally ends.");
  assert.deepEqual(items[1].proofs, ["suite"]);
});

test("POSITIVE CONTROL: a wrapped criterion with no proof is still reported", () => {
  // Without this the fix could be "treat everything as linked", which passes
  // every other assertion here and destroys the guard.
  const { items } = parseCriteria(wrapped);
  assert.deepEqual(items[2].proofs, []);
  assert.equal(items[2].text, "One that wraps and names no proof at all.");
  const audit = auditTask({
    frontmatter: 'verification:\n  - id: suite\n    bash: "true"\n',
    body: wrapped,
  });
  assert.equal(audit.warnings.length, 1, JSON.stringify(audit.warnings));
  assert.match(audit.warnings[0], /One that wraps and names no proof at all\./);
});

test("the report quotes the WHOLE criterion, not its first line", () => {
  const audit = auditTask({
    frontmatter: 'verification:\n  - id: suite\n    bash: "true"\n',
    body: "## Acceptance criteria\n\n- [ ] A sentence broken\n      across two lines.\n",
  });
  assert.match(audit.warnings.join("\n"), /A sentence broken across two lines\./);
});

test("what ENDS a criterion: a blank line, a new item, a heading, an unindented line", () => {
  const { items } = parseCriteria([
    "## Acceptance criteria",
    "",
    "- [ ] First one,",
    "      continued. [proof: a]",
    "",
    "      This paragraph follows a blank line and is NOT part of it.",
    "- [ ] Second one. [proof: b]",
    "unindented prose, which is not a continuation either",
    "",
    "## Log",
    "",
    "- [ ] not a criterion, it is past the heading",
  ].join("\n"));
  assert.equal(items.length, 2);
  assert.equal(items[0].text, "First one, continued.");
  assert.equal(items[1].text, "Second one.");
});

test("`[proof:]` counts at the end of the LAST line and nowhere else", () => {
  const { items } = parseCriteria([
    "## Acceptance criteria",
    "",
    "- [ ] It names its proof [proof: middle] and then keeps",
    "      talking.",
  ].join("\n"));
  assert.deepEqual(items[0].proofs, [], "one position, not two — see the comment in parseCriteria");
});

test("the tick lands on the `- [ ]` line, and the file is otherwise byte-identical", () => {
  const raw = [
    "---",
    "id: MAP-1",
    'verification:',
    "  - id: suite",
    '    bash: "true"',
    "---",
    "",
    "## Acceptance criteria",
    "",
    "- [ ] A sentence broken",
    "      across two lines. [proof: suite]",
    "",
  ].join("\n");
  const { text, ticked } = applyProofs(raw, ["suite"]);
  assert.deepEqual(ticked, ["A sentence broken across two lines."]);
  const before = raw.split("\n");
  const after = text.split("\n");
  assert.equal(before.length, after.length);
  for (let i = 0; i < before.length; i++) {
    if (i === 9) {
      assert.equal(after[i], "- [x] A sentence broken", "the tick must land on the item line");
    } else {
      assert.equal(after[i], before[i], "line " + i + " changed and must not have");
    }
  }
});

test("a criterion knows both its first line and its last", () => {
  const { items } = parseCriteria("## Acceptance criteria\n\n- [ ] One\n      two\n      three. [proof: a]\n");
  assert.equal(items[0].line, 2);
  assert.equal(items[0].endLine, 4);
});
