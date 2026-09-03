/**
 * A run of specialists can be invoked, and it serves nobody it has no hand for
 * (TL-223).
 *
 * WHAT WAS WRONG. `run` refused before the loop started unless `--agent` was
 * given, and the check never looked at `--agent-for`. So the one arrangement
 * `--agent-for` exists for — a fleet of named hands with no generalist — was the
 * one arrangement that could not be invoked, while `run --help` described the
 * opposite model.
 *
 * THE DECISION THIS ENCODES. `next` widens `--role r` to mean `r OR no role`, so
 * a fleet of specialists does not strand every roleless task on the generalist's
 * absence. That widening is right exactly when the run HAS a generalist. Without
 * one the filter is narrowed with `--role-strict`, and the roleless tasks are
 * counted in the report as one more audience nobody served — not stopped on, not
 * failed over, not silently skipped.
 *
 * THE POSITIVE CONTROL is the last test: a run with no command of ANY kind is
 * still refused. Without it, a green file here would also be green for a change
 * that simply deleted the check.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { waitingForRole } from "../run-loop.mjs";
import { isolateHome } from "./_repo.mjs";

isolateHome("run-roles");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

const MAKER = "maker";
const CHECKER = "checker";
const PASSING = 'verification:\n  - id: it-runs\n    bash: "true"';

let counter = 0;
function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), "branchling-" + prefix + "-" + (counter++) + "-"));
}

function cli(args, env, opts = {}) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 120_000,
    env: { ...process.env, NO_COLOR: "1", ...(env || {}) },
    ...opts,
  });
}

function taskFile(backlog, id) {
  return join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-")));
}

function statusOf(backlog, id) {
  return (readFileSync(taskFile(backlog, id), "utf8").match(/^status: ([a-z_]+)/m) || [])[1];
}

/** A backlog declaring the fixture's own roles. Tasks are added by `add()`. */
function fixture() {
  const dir = tmp("roles");
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  const backlog = join(repo, "backlog");
  const env = { BACKLOG_STATE_DIR: join(dir, "state") };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env).status, 0);

  const configPath = join(backlog, "config.yaml");
  writeFileSync(configPath, readFileSync(configPath, "utf8") +
    "\nroles: [" + MAKER + ", " + CHECKER + "]\n", "utf8");
  assert.match(readFileSync(configPath, "utf8"), new RegExp("roles: \\[" + MAKER),
    "the fixture's own `roles:` line was not written — every assertion below would be vacuous");

  const add = (title, role) => {
    const r = cli(["new", "--dir", backlog, "--title", title, "--priority", "P1"], env);
    assert.equal(r.status, 0, r.stderr);
    const id = (r.stdout.match(/([A-Z]+-\d+)/) || [])[1];
    const file = taskFile(backlog, id);
    let text = readFileSync(file, "utf8")
      .replace(/verification:[\s\S]*?\n---/, PASSING + "\n---")
      .replace(/\[proof:[^\]]*\]/g, "[proof: it-runs]");
    if (role) text = text.replace(/^role: .*$/m, "role: " + role);
    writeFileSync(file, text, "utf8");
    cli(["build", "--dir", backlog], env);
    return id;
  };
  return { dir, repo, backlog, env, add };
}

/** An agent that prints, so the attempt is not read as one that never started. */
function worker(dir, name) {
  const p = join(dir, name);
  writeFileSync(p, "#!/bin/sh\ncat >/dev/null\necho 'the work is done'\n", "utf8");
  chmodSync(p, 0o755);
  return p;
}

function cleanup(...dirs) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

test("a run with only `--agent-for` is invoked and closes the task of that role", () => {
  const f = fixture();
  try {
    const id = f.add("Work for the maker", MAKER);
    const r = cli(["run", "--dir", f.backlog, "--actor", "agent:fleet", "--max-attempts", "1", "--json",
      "--agent-for", MAKER + "=" + worker(f.dir, "maker.sh")], f.env, { cwd: f.repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(statusOf(f.backlog, id), "done", "the specialist's task was not closed");
  } finally {
    cleanup(f.dir);
  }
});

test("without a generalist a roleless task is left alone, not handed out", () => {
  const f = fixture();
  try {
    const served = f.add("Work for the maker", MAKER);
    const loose = f.add("Work for nobody in particular", null);
    const r = cli(["run", "--dir", f.backlog, "--actor", "agent:fleet", "--max-attempts", "1", "--json",
      "--agent-for", MAKER + "=" + worker(f.dir, "maker.sh")], f.env, { cwd: f.repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(statusOf(f.backlog, served), "done");
    assert.equal(statusOf(f.backlog, loose), "pending",
      "a task this run had no hand for was taken anyway");
  } finally {
    cleanup(f.dir);
  }
});

test("the report counts the roleless remainder as an audience nobody served", () => {
  const f = fixture();
  try {
    f.add("Work for the maker", MAKER);
    const loose = f.add("Work for nobody in particular", null);
    const waiting = f.add("Work for the checker", CHECKER);
    const r = cli(["run", "--dir", f.backlog, "--actor", "agent:fleet", "--max-attempts", "1", "--json",
      "--agent-for", MAKER + "=" + worker(f.dir, "maker.sh")], f.env, { cwd: f.repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);

    const report = JSON.parse(r.stdout);
    const rows = report.waitingForRole || [];
    const roleless = rows.find((x) => x.role === "");
    assert.ok(roleless, "the tasks nobody served are missing from the report entirely");
    assert.deepEqual(roleless.ids, [loose]);
    const checker = rows.find((x) => x.role === CHECKER);
    assert.ok(checker, "the unserved role stopped being reported once the roleless one was added");
    assert.deepEqual(checker.ids, [waiting]);
  } finally {
    cleanup(f.dir);
  }
});

test("with a generalist the roleless tasks are served and reported as nobody's remainder", () => {
  const f = fixture();
  try {
    const served = f.add("Work for the maker", MAKER);
    const loose = f.add("Work for nobody in particular", null);
    const r = cli(["run", "--dir", f.backlog, "--actor", "agent:fleet", "--max-attempts", "1", "--json",
      "--agent", worker(f.dir, "generalist.sh"),
      "--agent-for", MAKER + "=" + worker(f.dir, "maker.sh")], f.env, { cwd: f.repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(statusOf(f.backlog, served), "done");
    assert.equal(statusOf(f.backlog, loose), "done", "the generalist was given no roleless work");
    assert.ok(!(report(r).waitingForRole || []).some((x) => x.role === ""),
      "a run that served the roleless tasks still reports them as waiting");
  } finally {
    cleanup(f.dir);
  }
});

function report(r) { return JSON.parse(r.stdout); }

test("`waitingForRole` is pure and its roleless branch is opt-in", () => {
  const config = { archivedStatuses: ["done"], inProgressStatus: "in_progress" };
  const records = [
    { id: "T-1", role: "", status: "pending" },
    { id: "T-2", role: MAKER, status: "pending" },
    { id: "T-3", role: "", status: "done" },
  ];
  assert.deepEqual(waitingForRole(records, config, [MAKER]), {},
    "the default reports the roleless tasks, which would break every existing caller");
  assert.deepEqual(waitingForRole(records, config, [MAKER], false), { "": ["T-1"] },
    "an archived roleless task was counted, or an open one was not");
});

test("a run with no command of any kind is still refused", () => {
  const f = fixture();
  try {
    f.add("Work for the maker", MAKER);
    const r = cli(["run", "--dir", f.backlog, "--actor", "agent:fleet"],
      { ...f.env, BACKLOG_AGENT_COMMAND: "" }, { cwd: f.repo });
    assert.equal(r.status, 2, "a run with nothing to hand the work to was allowed");
    assert.match(r.stderr, /no agent command/);
  } finally {
    cleanup(f.dir);
  }
});
