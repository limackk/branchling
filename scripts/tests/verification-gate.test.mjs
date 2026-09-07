/**
 * The closing gate: `branchling done` RUNS the verification (TL-82).
 *
 * The defect this closes: `verification:` was written, validated and taught, and
 * no script ever ran it. Enforcement lived in a skill file addressed to the same
 * agent it was supposed to police.
 *
 * Two assertions here carry more weight than the rest. The POSITIVE CONTROL on
 * an empty `verification:` — a gate that closes a task with no contract is green
 * with no evidential force, and would pass every other test in this file. And
 * the NO-OTHER-COMMAND test: a task from someone else's pull request carries a
 * shell command, so "only `done` runs it" is a security property, not a
 * preference.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("verification-gate");

import { closingStatus, contractProblem, parseDoneArgs, repoRootFor } from "../done-task.mjs";
import { parseVerification } from "../criteria.mjs";
import { readHistory } from "../history.mjs";

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function task({ id = "TASK-1", status = "pending", verification = [], criteria = ["- [ ] A. [proof: truth]"] }) {
  return [
    "---",
    `id: ${id}`,
    'title: "T"',
    "type: task",
    "labels: []",
    "board: main",
    'epic: ""',
    "priority: P1",
    `status: ${status}`,
    "owner: unassigned",
    "estimate: 2h",
    "confidence: high",
    "created: 2026-09-01",
    "updated: 2026-09-01",
    "blocked_by: []",
    "blocks: []",
    "verification:",
    ...verification,
    "---",
    "",
    "## Acceptance criteria",
    "",
    ...criteria,
    "",
    "## Log",
    "",
  ].join("\n");
}

function backlog(files, config = "") {
  const dir = mkdtempSync(join(tmpdir(), "branchling-gate-"));
  mkdirSync(join(dir, "tasks"));
  writeFileSync(join(dir, "_template.md"), "---\nid: TASK-NNN\n---\n", "utf8");
  writeFileSync(join(dir, "boards.yaml"), 'default: main\nboards:\n  - slug: main\n    name: "Main"\n', "utf8");
  writeFileSync(join(dir, "config.yaml"), 'task_id_prefix: "TASK"\n' + config, "utf8");
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, "tasks", name), content, "utf8");
  return dir;
}

function withBacklog(files, fn, config) {
  const dir = backlog(files, config);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function done(dir, args) {
  const r = spawnSync(process.execPath, [CLI, "done", ...args, "--dir", dir], {
    encoding: "utf8",
    input: "",
  });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || ""), stdout: r.stdout || "" };
}

const statusOf = (dir, file) => (readFileSync(join(dir, "tasks", file), "utf8").match(/^status: (.+)$/m) || [])[1];

// ──────────────────────────────────────────────────────────────────────────
// The contract has to exist before it can be run
// ──────────────────────────────────────────────────────────────────────────

test("POSITIVE CONTROL: an EMPTY verification does not close the task", () => {
  withBacklog({ "TASK-1-x.md": task({ verification: [], criteria: ["- [ ] A."] }) }, (dir) => {
    const r = done(dir, ["TASK-1"]);
    assert.notEqual(r.code, 0, "a task with no contract was closed: " + r.out);
    assert.match(r.out, /no closing contract/);
    assert.equal(statusOf(dir, "TASK-1-x.md"), "pending", "the file was touched");
  });
});

test("the template placeholder does not count as a contract", () => {
  withBacklog(
    { "TASK-1-x.md": task({ verification: ["  - id: truth", '    bash: "command to run"'] }) },
    (dir) => {
      const r = done(dir, ["TASK-1"]);
      assert.notEqual(r.code, 0, r.out);
      assert.match(r.out, /placeholder/);
      assert.equal(statusOf(dir, "TASK-1-x.md"), "pending");
    }
  );
});

test("the message for a missing contract is DIFFERENT from the one for a failed run", () => {
  const empty = withBacklog({ "TASK-1-x.md": task({ verification: [], criteria: ["- [ ] A."] }) }, (d) => done(d, ["TASK-1"]).out);
  const failed = withBacklog(
    { "TASK-1-x.md": task({ verification: ["  - id: truth", '    bash: "exit 1"'] }) },
    (d) => done(d, ["TASK-1"]).out
  );
  assert.match(empty, /no closing contract/);
  assert.match(failed, /verification failed/);
  assert.doesNotMatch(failed, /no closing contract/);
});

// ──────────────────────────────────────────────────────────────────────────
// Running it
// ──────────────────────────────────────────────────────────────────────────

test("all green: the status changes and the proved criteria are ticked", () => {
  withBacklog(
    {
      "TASK-1-x.md": task({
        verification: ["  - id: truth", '    bash: "true"'],
        criteria: ["- [ ] A. [proof: truth]"],
      }),
    },
    (dir) => {
      const r = done(dir, ["TASK-1"]);
      assert.equal(r.code, 0, r.out);
      assert.equal(statusOf(dir, "TASK-1-x.md"), "done");
      const text = readFileSync(join(dir, "tasks", "TASK-1-x.md"), "utf8");
      assert.match(text, /- \[x\] A\./, "a proved criterion was not ticked");
      // The prose line this used to assert on is gone (TL-105): the record of the
      // run lives in the history, with the reason, instead of in a second copy
      // kept by hand in the file.
      assert.ok(!/closed by/.test(text), "a prose line was appended to the task file");
      const status = readHistory(dir, "TASK-1").find((e) => e.field === "status");
      assert.equal(status.to, "done");
      assert.equal(status.reason, "proven", "the run did not record itself as the reason");
    }
  );
});

test("one failure leaves the file UNTOUCHED and exits non-zero", () => {
  withBacklog(
    {
      "TASK-1-x.md": task({
        verification: ["  - id: ok", '    bash: "true"', "  - id: nope", '    bash: "exit 7"'],
        criteria: ["- [ ] A. [proof: ok]"],
      }),
    },
    (dir) => {
      const before = readFileSync(join(dir, "tasks", "TASK-1-x.md"), "utf8");
      const r = done(dir, ["TASK-1"]);
      assert.notEqual(r.code, 0);
      assert.match(r.out, /exit 7/, "the message does not say what failed");
      assert.equal(readFileSync(join(dir, "tasks", "TASK-1-x.md"), "utf8"), before, "the file was modified");
    }
  );
});

test("the first failure STOPS the run — later entries are not executed", () => {
  withBacklog(
    {
      "TASK-1-x.md": task({
        verification: [
          "  - id: nope", '    bash: "exit 1"',
          "  - id: marker", '    bash: "echo LATER-ENTRY-RAN"',
        ],
        criteria: ["- [ ] A. [proof: nope]"],
      }),
    },
    (dir) => {
      const r = done(dir, ["TASK-1"]);
      assert.notEqual(r.code, 0);
      assert.doesNotMatch(r.out, /LATER-ENTRY-RAN/, "a command after the failure was run");
    }
  );
});

test("an already closed task is refused, unless a dry run only rehearses its contract", () => {
  withBacklog(
    {
      "TASK-1-x.md": task({
        status: "done",
        verification: ["  - id: marker", '    bash: "echo RAN-ANYWAY"'],
        criteria: ["- [ ] A. [proof: marker]"],
      }),
    },
    (dir) => {
      const file = join(dir, "tasks", "TASK-1-x.md");
      const before = readFileSync(file, "utf8");
      const r = done(dir, ["TASK-1"]);
      assert.notEqual(r.code, 0);
      assert.doesNotMatch(r.out, /RAN-ANYWAY/, "a closed task's commands were run");
      assert.match(r.out, /already closed/);

      const rehearsal = done(dir, ["TASK-1", "--dry-run"]);
      assert.equal(rehearsal.code, 0, rehearsal.out);
      assert.match(rehearsal.out, /RAN-ANYWAY/, "the dry-run contract was not run");
      assert.equal(readFileSync(file, "utf8"), before, "a closed-task dry run wrote to the backlog");
    }
  );
});

test("--dry-run runs everything and changes nothing", () => {
  withBacklog(
    { "TASK-1-x.md": task({ verification: ["  - id: truth", '    bash: "echo RAN"'] }) },
    (dir) => {
      const before = readFileSync(join(dir, "tasks", "TASK-1-x.md"), "utf8");
      const r = done(dir, ["TASK-1", "--dry-run"]);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /RAN/, "--dry-run did not actually run the command");
      assert.equal(readFileSync(join(dir, "tasks", "TASK-1-x.md"), "utf8"), before, "--dry-run changed the file");
    }
  );
});

test("--json returns the result of every entry, and a refusal is JSON too", () => {
  withBacklog(
    {
      "TASK-1-x.md": task({
        verification: ["  - id: truth", '    bash: "true"'],
      }),
    },
    (dir) => {
      const ok = done(dir, ["TASK-1", "--dry-run", "--json"]);
      assert.equal(ok.code, 0, ok.out);
      const parsed = JSON.parse(ok.stdout);
      assert.equal(parsed.entries.length, 1);
      assert.equal(parsed.entries[0].id, "truth");
      assert.equal(parsed.entries[0].ok, true);
      assert.equal(typeof parsed.entries[0].ms, "number");
      assert.equal(parsed.closed, false);

      const bad = done(dir, ["TASK-404", "--json"]);
      assert.notEqual(bad.code, 0);
      const refused = JSON.parse(bad.stdout);
      assert.equal(refused.kind, "verification-run", "a refusal is an envelope too (TL-119)");
      assert.equal(refused.ok, false);
      assert.equal(refused.refusalKind, "no-such-task");
    }
  );
});

// ──────────────────────────────────────────────────────────────────────────
// `manual:` — the only gap, and it has to cost something
// ──────────────────────────────────────────────────────────────────────────

test("a `manual:` entry does NOT close the task without a confirmation", () => {
  withBacklog(
    {
      "TASK-1-x.md": task({
        verification: ["  - id: eyeballed", '    manual: "somebody looked at it"'],
        criteria: ["- [ ] A. [proof: eyeballed]"],
      }),
    },
    (dir) => {
      const r = done(dir, ["TASK-1"]);
      assert.notEqual(r.code, 0, "a manual entry closed the task on its own: " + r.out);
      assert.equal(statusOf(dir, "TASK-1-x.md"), "pending");
    }
  );
});

test("the confirmation says what is NOT evidence — the enumeration, not a plea", () => {
  withBacklog(
    {
      "TASK-1-x.md": task({
        verification: ["  - id: eyeballed", '    manual: "somebody looked at it"'],
        criteria: ["- [ ] A. [proof: eyeballed]"],
      }),
    },
    (dir) => {
      const r = done(dir, ["TASK-1"]);
      assert.match(r.out, /NOT evidence/);
      assert.match(r.out, /grep/, "the enumeration does not name a grep as a non-proof");
      assert.match(r.out, /I checked/, "the enumeration does not name the commonest non-proof");
      assert.match(r.out, /somebody looked at it/, "the entry's own text was not shown before asking");
    }
  );
});

test("a confirmed `manual:` lands in the history with a namespaced actor", () => {
  withBacklog(
    {
      "TASK-1-x.md": task({
        verification: ["  - id: eyeballed", '    manual: "somebody looked at it"'],
        criteria: ["- [ ] A. [proof: eyeballed]"],
      }),
    },
    (dir) => {
      const r = done(dir, ["TASK-1", "--confirm-manual", "--actor", "local:kamil"]);
      assert.equal(r.code, 0, r.out);
      const lines = readFileSync(join(dir, "history", "TASK-1.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
      const vouch = lines.find((l) => l.field === "__verified__");
      assert.ok(vouch, "the vouching left no history entry: " + JSON.stringify(lines));
      assert.equal(vouch.actor, "local:kamil");
      assert.match(vouch.to, /somebody looked at it/, "the entry does not say WHAT was vouched for");
    }
  );
});

test("an actor with no namespace is refused — an unattributable vouching is worthless", () => {
  withBacklog(
    { "TASK-1-x.md": task({ verification: ["  - id: truth", '    bash: "true"'] }) },
    (dir) => {
      const r = done(dir, ["TASK-1", "--actor", "kamil"]);
      assert.equal(r.code, 2, r.out);
      assert.match(r.out, /namespace/);
    }
  );
});

// ──────────────────────────────────────────────────────────────────────────
// The criteria link (TL-86) is consumed, not redesigned
// ──────────────────────────────────────────────────────────────────────────

test("under `require`, a criterion naming no proof blocks the close BEFORE anything runs", () => {
  withBacklog(
    {
      "TASK-1-x.md": task({
        verification: ["  - id: marker", '    bash: "echo RAN-ANYWAY"'],
        criteria: ["- [ ] A. [proof: marker]", "- [ ] B, which nothing proves."],
      }),
    },
    (dir) => {
      const r = done(dir, ["TASK-1"]);
      assert.notEqual(r.code, 0, r.out);
      assert.doesNotMatch(r.out, /RAN-ANYWAY/, "commands were run only to be rejected afterwards");
      assert.equal(statusOf(dir, "TASK-1-x.md"), "pending");
    },
    'criteria_links: "require"\n'
  );
});

test("under the default `warn`, the same task closes — the migration path holds", () => {
  withBacklog(
    {
      "TASK-1-x.md": task({
        verification: ["  - id: truth", '    bash: "true"'],
        criteria: ["- [ ] A. [proof: truth]", "- [ ] B, which nothing proves."],
      }),
    },
    (dir) => {
      const r = done(dir, ["TASK-1"]);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /no proof/, "closing under `warn` said nothing about the unproved criterion");
      const text = readFileSync(join(dir, "tasks", "TASK-1-x.md"), "utf8");
      assert.match(text, /- \[x\] A\./);
      assert.match(text, /- \[ \] B,/, "an unproved criterion was ticked anyway");
    }
  );
});

test("a BROKEN link is refused under every policy, including `off`", () => {
  for (const policy of ["off", "warn", "require"]) {
    withBacklog(
      {
        "TASK-1-x.md": task({
          verification: ["  - id: truth", '    bash: "true"'],
          criteria: ["- [ ] A. [proof: typo]"],
        }),
      },
      (dir) => {
        const r = done(dir, ["TASK-1"]);
        assert.notEqual(r.code, 0, `a broken link closed under \`${policy}\`: ` + r.out);
      },
      `criteria_links: "${policy}"\n`
    );
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Nothing else may run a task's shell commands
// ──────────────────────────────────────────────────────────────────────────

test("NO other command runs `verification` — a task from a pull request is untrusted input", () => {
  withBacklog(
    {
      "TASK-1-x.md": task({
        verification: ["  - id: hostile", '    bash: "echo VERIFICATION-EXECUTED"'],
        criteria: ["- [ ] A. [proof: hostile]"],
      }),
    },
    (dir) => {
      for (const argv of [["build"], ["check"], ["query"], ["stats"], ["viewer"]]) {
        const r = spawnSync(process.execPath, [CLI, ...argv, "--dir", dir], { encoding: "utf8" });
        const out = (r.stdout || "") + (r.stderr || "");
        assert.doesNotMatch(
          out,
          /VERIFICATION-EXECUTED/,
          "`" + argv[0] + "` executed a task's shell command"
        );
      }
      // The positive control: the same command IS run by `done`, so the test above
      // is not merely observing a marker that never fires.
      const gate = done(dir, ["TASK-1", "--dry-run"]);
      assert.match(gate.out, /VERIFICATION-EXECUTED/, "the marker never fires — the test proves nothing");
    }
  );
});

// ──────────────────────────────────────────────────────────────────────────
// Pure units
// ──────────────────────────────────────────────────────────────────────────

test("an unknown flag fails with exit 2, like every other command", () => {
  withBacklog({ "TASK-1-x.md": task({ verification: ["  - id: truth", '    bash: "true"'] }) }, (dir) => {
    const r = done(dir, ["TASK-1", "--forse"]);
    assert.equal(r.code, 2, r.out);
  });
  assert.throws(() => parseDoneArgs(["TASK-1", "--force"]), /unknown flag/);
  assert.throws(() => parseDoneArgs([]), /no task id/);
  assert.throws(() => parseDoneArgs(["TASK-1", "TASK-2"]), /one task at a time/);
});

test("the closing status comes from `archived_statuses`, never from the word \"done\"", () => {
  assert.equal(closingStatus({ archivedStatuses: ["shipped", "dropped"] }), "shipped");
  assert.equal(closingStatus({ archivedStatuses: ["shipped", "dropped"] }, "dropped"), "dropped");
  assert.throws(() => closingStatus({ archivedStatuses: ["shipped"] }, "in_progress"), /archived_statuses/);
  assert.throws(() => closingStatus({ archivedStatuses: [] }), /empty/);
});

test("the working directory is the REPOSITORY root, in both layouts", () => {
  // The nested layout (`<repo>/backlog`) and the co-located one (`<repo>` IS the
  // backlog) put the root at different depths, which is exactly why it may not be
  // computed as `join(backlogRoot, "..")`. Git is asked; both layouts must give
  // the repository, not a level above or below it.
  const repo = mkdtempSync(join(tmpdir(), "branchling-root-"));
  try {
    assert.equal(spawnSync("git", ["-C", repo, "init", "-q"]).status, 0, "git init failed");
    const real = spawnSync("git", ["-C", repo, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).stdout.trim();

    mkdirSync(join(repo, "backlog", "tasks"), { recursive: true });
    assert.equal(repoRootFor(join(repo, "backlog")), real, "nested layout: not the repository root");
    assert.equal(repoRootFor(repo), real, "co-located layout: not the repository root");
    assert.notEqual(repoRootFor(join(repo, "backlog")), join(repo, "backlog"), "it returned the backlog directory");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("with no git at all it falls back to the backlog directory, and does not guess upwards", () => {
  const dir = mkdtempSync(join(tmpdir(), "branchling-nogit-"));
  try {
    // No repository anywhere above a temp dir is not guaranteed on every machine,
    // so this only asserts the property that matters: whatever comes back, it is
    // never the parent computed by hand.
    const root = repoRootFor(dir);
    assert.notEqual(root, join(dir, ".."), "it computed the parent by hand");
    assert.ok(root === dir || existsSync(join(root, ".git")), "it returned something that is neither the backlog nor a repository");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("contractProblem sees an empty list, a placeholder and a parse problem", () => {
  const of = (lines) => parseVerification(["verification:", ...lines].join("\n"));
  const empty = of([]);
  assert.match(contractProblem(empty.entries, empty.problems), /no `verification:`/);
  const placeholder = of(['  - bash: "command to run"']);
  assert.match(contractProblem(placeholder.entries, placeholder.problems), /placeholder/);
  const broken = of(['  - bash: "true"', '    nonsense: "x"']);
  assert.match(contractProblem(broken.entries, broken.problems), /unknown key/);
  const fine = of(['  - bash: "true"']);
  assert.equal(contractProblem(fine.entries, fine.problems), null);
});

// ──────────────────────────────────────────────────────────────────────────
// The closing write goes through the ONE door that writes frontmatter
// ──────────────────────────────────────────────────────────────────────────

test("closing keeps a comment beside the value — the same as `take` does (TL-93)", () => {
  // `done` used to write with `text.replace(/^status: .*$/m, …)` over the whole
  // file, which erased whatever a reader had written after the value. `take`
  // wrote the same field through `setFrontmatterField` and kept it, so the two
  // commands disagreed about what a task file is. A comment beside a field is a
  // comment in EVERY reader (TL-70) — and in every writer.
  const src = task({ verification: ['  - id: truth', '    bash: "true"'] })
    .replace(/^status: pending$/m, "status: pending  # set by hand while triaging")
    .replace(/^updated: 2026-09-01$/m, "updated: 2026-09-01  # touched during the import");
  withBacklog({ "TASK-1-x.md": src }, (dir) => {
    const r = done(dir, ["TASK-1", "--actor", "agent:t"]);
    assert.equal(r.code, 0, "the contract passes, so this must close: " + r.out);
    const text = readFileSync(join(dir, "tasks", "TASK-1-x.md"), "utf8");
    // Positive control: the value itself HAS to have changed. A writer that did
    // nothing at all would keep every comment and pass a test that only looked
    // for the comment.
    assert.match(text, /^status: done {2}# set by hand while triaging$/m, "the comment beside `status:` was erased: " + text);
    assert.match(text, /^updated: \d{4}-\d{2}-\d{2} {2}# touched during the import$/m, "the comment beside `updated:` was erased: " + text);
  });
});

test("closing a task whose frontmatter has no `updated:` WRITES one (TL-93)", () => {
  // The regex replacement matched nothing here and wrote nothing, silently: the
  // task closed, exit 0, and the field that says when it happened was still
  // absent. A no-op that reports success is the failure mode this tool exists to
  // refuse.
  const src = task({ verification: ['  - id: truth', '    bash: "true"'] })
    .split("\n").filter((l) => !/^updated:/.test(l)).join("\n");
  withBacklog({ "TASK-1-x.md": src }, (dir) => {
    const r = done(dir, ["TASK-1", "--actor", "agent:t"]);
    assert.equal(r.code, 0, "the contract passes, so this must close: " + r.out);
    const text = readFileSync(join(dir, "tasks", "TASK-1-x.md"), "utf8");
    assert.equal(statusOf(dir, "TASK-1-x.md"), "done", "the status did not change");
    assert.match(text, /^updated: \d{4}-\d{2}-\d{2}$/m, "the closed task still has no `updated:`: " + text);
    // In its ordered place, not appended after the last key.
    assert.match(text, /^created: [\s\S]*^updated: [\s\S]*^blocked_by:/m, "`updated:` was not inserted in frontmatter order: " + text);
  });
});
